/**
 * Post-run handler for the openai_compatible adapter.
 *
 * Extracts all openai_compatible-specific post-run logic from heartbeat.ts:
 *   - Issue comment posting
 *   - DELEGATE marker parsing + sub-issue creation + agent wakeup
 *   - Issue status → done (when no delegation)
 *   - Reverse aggregation (sibling check → parent summarization wakeup)
 *   - TG notification (HQ-001-CEO only)
 */
import { and, eq, desc } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import { agents, issues, issueComments } from "@paperclipai/db";
import { logger } from "../middleware/logger.js";
import PDFDocument from "pdfkit";
import { sendTextMessage, uploadFile, sendFileMessage } from "./feishu-bot.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface OpenAIPostRunParams {
  db: Db;
  agent: { id: string; name: string; companyId: string };
  issueId: string | null;
  content: string;
  outcome: "succeeded" | "failed" | "timed_out" | "cancelled";
  context: Record<string, unknown>;
  enqueueWakeup: (agentId: string, opts: Record<string, unknown>) => Promise<unknown>;
  addIssueComment: (issueId: string, body: string, actor: { agentId: string }) => Promise<unknown>;
}

export interface PostRunResult {
  delegatedAgents: string[];
  isSummarizationWake: boolean;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function readNonEmptyString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function cleanDelegateMarkers(text: string): string {
  return text.replace(/<!--\s*DELEGATE:.*?-->/gs, "").trim();
}

// ---------------------------------------------------------------------------
// Sub-functions
// ---------------------------------------------------------------------------

async function postIssueComment(
  params: Pick<OpenAIPostRunParams, "addIssueComment" | "agent" | "issueId">,
  cleanContent: string,
): Promise<void> {
  if (!params.issueId || !cleanContent) return;
  try {
    await params.addIssueComment(params.issueId, cleanContent, { agentId: params.agent.id });
    logger.info(
      { agentId: params.agent.id, issueId: params.issueId, chars: cleanContent.length },
      "[post-run] posted output as issue comment",
    );
  } catch (err) {
    logger.warn({ err, agentId: params.agent.id, issueId: params.issueId }, "[post-run] failed to post issue comment");
  }
}

async function parseDelegations(
  params: Pick<OpenAIPostRunParams, "db" | "agent" | "issueId" | "enqueueWakeup">,
  rawContent: string,
): Promise<string[]> {
  const delegated: string[] = [];
  const pattern = /<!-- DELEGATE:(.*?) -->/g;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(rawContent)) !== null) {
    try {
      const parsed = JSON.parse(match[1]) as { agent?: string; title?: string; description?: string };
      const targetName = parsed.agent?.trim();
      const title = parsed.title?.trim();
      if (!targetName || !title) continue;

      const targetAgent = await params.db
        .select({ id: agents.id, companyId: agents.companyId })
        .from(agents)
        .where(eq(agents.name, targetName))
        .then((rows) => rows[0] ?? null);

      if (!targetAgent) {
        logger.warn({ targetName }, "[post-run] delegation target agent not found");
        continue;
      }

      const subIssueId = crypto.randomUUID();
      await params.db.insert(issues).values({
        id: subIssueId,
        companyId: targetAgent.companyId,
        title: `[委派] ${title}`,
        description: parsed.description ?? "",
        assigneeAgentId: targetAgent.id,
        parentId: params.issueId ?? undefined,
        priority: "medium",
        status: "todo",
      });

      void params.enqueueWakeup(targetAgent.id, {
        source: "assignment",
        triggerDetail: "system",
        reason: "issue_assigned",
        contextSnapshot: { issueId: subIssueId, source: "delegation" },
      }).catch((err) => {
        logger.warn({ err, targetName, subIssueId }, "[post-run] delegation wakeup failed");
      });

      delegated.push(`→ ${targetName}: ${title}`);
      logger.info({ parentIssueId: params.issueId, subIssueId, targetName, title }, "[post-run] delegation created");
    } catch (err) {
      logger.warn({ err, raw: match[1]?.slice(0, 200) }, "[post-run] failed to parse DELEGATE marker");
    }
  }

  return delegated;
}

async function markIssueDone(db: Db, issueId: string): Promise<void> {
  try {
    await db.update(issues).set({ status: "done", updatedAt: new Date() }).where(eq(issues.id, issueId));
    logger.info({ issueId }, "[post-run] marked issue as done");
  } catch (err) {
    logger.warn({ err, issueId }, "[post-run] failed to mark issue as done");
  }
}

async function checkReverseAggregation(
  params: Pick<OpenAIPostRunParams, "db" | "enqueueWakeup">,
  issueId: string,
): Promise<void> {
  const currentIssue = await params.db
    .select({ parentId: issues.parentId })
    .from(issues)
    .where(eq(issues.id, issueId))
    .then((rows) => rows[0] ?? null);

  if (!currentIssue?.parentId) return;

  logger.info({ issueId, parentId: currentIssue.parentId }, "[reverse-agg] checking siblings");

  const siblings = await params.db
    .select({
      id: issues.id,
      status: issues.status,
      title: issues.title,
      assigneeAgentId: issues.assigneeAgentId,
    })
    .from(issues)
    .where(eq(issues.parentId, currentIssue.parentId));

  const allDone = siblings.length > 0 && siblings.every((s) => s.status === "done");
  logger.info({ parentId: currentIssue.parentId, total: siblings.length, allDone }, "[reverse-agg] sibling status");

  if (!allDone) return;

  // Collect results from all sibling issue comments
  const resultSections: string[] = [];
  for (const sibling of siblings) {
    const agentRow = sibling.assigneeAgentId
      ? await params.db
          .select({ name: agents.name })
          .from(agents)
          .where(eq(agents.id, sibling.assigneeAgentId))
          .then((r) => r[0] ?? null)
      : null;
    const latestComment = await params.db
      .select({ body: issueComments.body })
      .from(issueComments)
      .where(eq(issueComments.issueId, sibling.id))
      .orderBy(desc(issueComments.createdAt))
      .limit(1)
      .then((r) => r[0] ?? null);
    const agentName = agentRow?.name ?? "Unknown";
    const resultBody = cleanDelegateMarkers(latestComment?.body ?? "") || "(无输出)";
    resultSections.push(`### ${agentName} — ${sibling.title}\n\n${resultBody}`);
  }

  // Wake the parent agent with collected results
  const parentIssue = await params.db
    .select({ assigneeAgentId: issues.assigneeAgentId })
    .from(issues)
    .where(eq(issues.id, currentIssue.parentId))
    .then((r) => r[0] ?? null);

  if (!parentIssue?.assigneeAgentId) return;

  const subtaskResultsText = `## 团队成员执行成果\n\n${resultSections.join("\n\n---\n\n")}`;
  logger.info(
    { parentId: currentIssue.parentId, parentAgentId: parentIssue.assigneeAgentId, chars: subtaskResultsText.length },
    "[reverse-agg] waking parent with subtaskResults",
  );

  void params.enqueueWakeup(parentIssue.assigneeAgentId, {
    source: "automation",
    triggerDetail: "system",
    reason: "subtasks_completed",
    contextSnapshot: {
      issueId: currentIssue.parentId,
      source: "subtasks_completed",
      subtaskResults: subtaskResultsText,
    },
  }).catch((err) => {
    logger.warn({ err, parentId: currentIssue.parentId }, "[reverse-agg] parent wakeup failed");
  });
}

function generateReportPdf(title: string, content: string, date: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: "A4", margin: 50 });
    const chunks: Buffer[] = [];

    doc.on("data", (chunk: Buffer) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    // CJK font: use Noto Sans CJK if available, else fall back to Helvetica
    // Cloud Run Dockerfile should install fonts-noto-cjk
    const CJK_FONT_PATHS = [
      "/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc",
      "/usr/share/fonts/truetype/noto/NotoSansCJK-Regular.ttc",
      "/usr/share/fonts/noto-cjk/NotoSansCJK-Regular.ttc",
    ];
    let fontRegistered = false;
    for (const fontPath of CJK_FONT_PATHS) {
      try {
        doc.registerFont("CJK", fontPath);
        fontRegistered = true;
        break;
      } catch {
        // Font not found at this path, try next
      }
    }
    const bodyFont = fontRegistered ? "CJK" : "Helvetica";
    const titleFont = fontRegistered ? "CJK" : "Helvetica-Bold";

    // Header
    doc.font(titleFont).fontSize(18).text("BitWorld", { align: "center" });
    doc.font(bodyFont).fontSize(10).text(date, { align: "center" });
    doc.moveDown(0.5);
    doc.moveTo(50, doc.y).lineTo(545, doc.y).stroke("#cccccc");
    doc.moveDown(0.5);

    // Title
    doc.font(titleFont).fontSize(14).text(title);
    doc.moveDown(0.5);

    // Body — simple markdown rendering line by line
    const lines = content.split("\n");
    for (const line of lines) {
      if (line.startsWith("### ")) {
        doc.moveDown(0.3);
        doc.font(titleFont).fontSize(11).text(line.slice(4));
        doc.moveDown(0.2);
      } else if (line.startsWith("## ")) {
        doc.moveDown(0.4);
        doc.font(titleFont).fontSize(12).text(line.slice(3));
        doc.moveDown(0.2);
      } else if (line.startsWith("# ")) {
        doc.moveDown(0.5);
        doc.font(titleFont).fontSize(13).text(line.slice(2));
        doc.moveDown(0.3);
      } else if (line.startsWith("---")) {
        doc.moveDown(0.3);
        doc.moveTo(50, doc.y).lineTo(545, doc.y).stroke("#e5e5e5");
        doc.moveDown(0.3);
      } else if (line.startsWith("- ") || line.startsWith("* ")) {
        doc.font(bodyFont).fontSize(10).text(`  •  ${line.slice(2)}`, { indent: 10 });
      } else if (line.startsWith("> ")) {
        doc.font(bodyFont).fontSize(10).fillColor("#666666").text(line.slice(2), { indent: 20 });
        doc.fillColor("#000000");
      } else if (line.trim() === "") {
        doc.moveDown(0.3);
      } else {
        doc.font(bodyFont).fontSize(10).text(line);
      }
    }

    // Footer
    doc.moveDown(1);
    doc.moveTo(50, doc.y).lineTo(545, doc.y).stroke("#cccccc");
    doc.moveDown(0.3);
    doc.font(bodyFont).fontSize(8).fillColor("#999999").text(
      `Generated by BitWorld Agent System | ${date}`,
      { align: "center" },
    );

    doc.end();
  });
}

async function sendNotification(
  db: Db,
  agent: { id: string; name: string },
  issueId: string | null,
  content: string,
  _delegated: string[],
  outcome: string,
  _errorMessage?: string,
): Promise<void> {
  try {
    // ── Segment 1: BW-36 6 条硬约束 check (任一失败 → return + log skip reason) ──
    if (!issueId) {
      logger.info({}, "[feishu-notify] skip: no issueId");
      return;
    }
    if (outcome !== "succeeded") {
      logger.info({ issueId, outcome }, "[feishu-notify] skip: outcome not succeeded");
      return;
    }

    const HQ_CEO_ID = "b1000000-0000-0000-0000-000000000001";
    const row = await db
      .select({
        parentId: issues.parentId,
        requestDepth: issues.requestDepth,
        assigneeAgentId: issues.assigneeAgentId,
        status: issues.status,
        metadata: issues.metadata,
        title: issues.title,
        identifier: issues.identifier,
      })
      .from(issues)
      .where(eq(issues.id, issueId))
      .then((r) => r[0] ?? null);

    if (!row) {
      logger.info({ issueId }, "[feishu-notify] skip: issue not found");
      return;
    }
    if (row.parentId !== null) {
      logger.info({ issueId, reason: "has_parent" }, "[feishu-notify] skip");
      return;
    }
    if ((row.requestDepth ?? 0) !== 0) {
      logger.info({ issueId, reason: "depth_nonzero", requestDepth: row.requestDepth }, "[feishu-notify] skip");
      return;
    }
    if (row.assigneeAgentId !== HQ_CEO_ID) {
      logger.info({ issueId, reason: "not_hq_ceo", assigneeAgentId: row.assigneeAgentId }, "[feishu-notify] skip");
      return;
    }
    if (row.status !== "done") {
      logger.info({ issueId, reason: "not_done", status: row.status }, "[feishu-notify] skip");
      return;
    }

    const meta = (row.metadata ?? {}) as Record<string, unknown>;
    const feishuChatId = typeof meta.feishuChatId === "string" ? meta.feishuChatId.trim() : "";
    if (!feishuChatId) {
      logger.info({ issueId, reason: "no_feishu_source" }, "[feishu-notify] skip");
      return;
    }
    if (meta.feishuNotifiedAt) {
      logger.info({ issueId, alreadyAt: meta.feishuNotifiedAt }, "[feishu-notify] skip: already_notified");
      return;
    }

    logger.info(
      { issueId, chatId: feishuChatId, title: row.title, agent: agent.name },
      "[feishu-notify] all 6 BW-36 checks passed, proceeding",
    );

    // ── Segment 2: 二次 LLM 推理生成结构化摘要 (失败降级 substring) ──
    const summaryPrompt = `你是 BitWorld 集团董事长秘书。以下是 HQ-001-CEO 刚完成的报告原文。请提炼为飞书消息卡片格式的结构化摘要:

要求:
1. 总长度 < 500 字(飞书消息预览友好)
2. 输出格式严格如下:

📌 主题:<10-15 字概括>
📅 时间:<报告涉及的时间范围,如"2026 年 3 月 23-29 日"或"今日">

💡 核心结论(3-5 条):
  • <每条 < 40 字,带具体数字/事实/趋势>
  • ...

🔥 关键趋势:
  • <2-3 条,趋势/风险/机会>

📎 完整报告见 PDF 附件

3. 严格按上述格式输出,不要加任何解释 / 前言 / 后记
4. 如原文涉及具体数据,优先保留数字

报告原文:
${content}`;

    let summaryText = "";
    try {
      const baseUrl = (process.env.DASHSCOPE_BASE_URL ?? "https://api.deepseek.com/v1").replace(/\/+$/, "");
      const apiKey = process.env.DASHSCOPE_API_KEY ?? "";
      if (!apiKey) throw new Error("DASHSCOPE_API_KEY not configured");

      const summaryRes = await fetch(`${baseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: "deepseek-chat",
          messages: [{ role: "user", content: summaryPrompt }],
          temperature: 0.3,
          max_tokens: 512,
        }),
      });

      if (!summaryRes.ok) throw new Error(`LLM call failed: HTTP ${summaryRes.status}`);
      const summaryJson = (await summaryRes.json()) as { choices?: Array<{ message?: { content?: string } }> };
      summaryText = summaryJson.choices?.[0]?.message?.content?.trim() ?? "";
      if (!summaryText) throw new Error("empty summary content");

      logger.info({ issueId, summaryLen: summaryText.length }, "[feishu-notify] structured summary generated");
    } catch (err) {
      logger.warn({ err: String(err), issueId }, "[feishu-notify] LLM summary failed, fallback to truncate");
      summaryText = `📌 ${row.title ?? "(无标题)"}\n\n${content.slice(0, 300)}...\n\n(结构化摘要生成失败,请看 PDF 附件)`;
    }

    // ── Segment 3: PDF 生成 (复用现有 generateReportPdf) ──
    const pdfTitle = row.title ?? "BitWorld 报告";
    const pdfDate = new Date().toLocaleString("zh-CN", { timeZone: "Asia/Shanghai" });
    const pdfBuffer = await generateReportPdf(pdfTitle, content, pdfDate);
    logger.info({ issueId, pdfBytes: pdfBuffer.length }, "[feishu-notify] PDF generated");

    // ── Segment 4: 飞书双消息推送 (摘要在前 + PDF 在后) ──
    const fileName = `BitWorld-${row.identifier ?? issueId.slice(0, 8)}-${new Date().toISOString().slice(0, 10).replace(/-/g, "")}.pdf`;

    await sendTextMessage(feishuChatId, summaryText);
    logger.info({ issueId, chatId: feishuChatId }, "[feishu-notify] summary sent");

    const fileKey = await uploadFile(fileName, pdfBuffer);
    await sendFileMessage(feishuChatId, fileKey);
    logger.info({ issueId, chatId: feishuChatId, fileName }, "[feishu-notify] PDF sent");

    // ── Segment 5: 写 feishuNotifiedAt 防重 (Pattern A: read-modify-write) ──
    await db
      .update(issues)
      .set({
        metadata: { ...meta, feishuNotifiedAt: new Date().toISOString() },
        updatedAt: new Date(),
      })
      .where(eq(issues.id, issueId));
    logger.info({ issueId }, "[feishu-notify] notification complete + feishuNotifiedAt flag set");
  } catch (err) {
    // ── Segment 6: try/catch 整段包裹 (只 log 不抛,不阻塞 post-run hook) ──
    logger.warn(
      { err: String(err), issueId, agent: agent.name },
      "[feishu-notify] failed (best-effort, not blocking post-run)",
    );
  }
}

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

export async function handleOpenAIPostRun(params: OpenAIPostRunParams): Promise<PostRunResult> {
  const { agent, issueId, content, outcome, context } = params;
  const isSummarizationWake = readNonEmptyString(context.wakeReason) === "subtasks_completed";
  const cleanContent = cleanDelegateMarkers(content);

  // 1. Post output as issue comment
  if (outcome === "succeeded") {
    await postIssueComment(params, cleanContent);
  }

  // 2. Parse delegations (skip on summarization wakeups to prevent loops)
  let delegatedAgents: string[] = [];
  if (outcome === "succeeded" && !isSummarizationWake) {
    delegatedAgents = await parseDelegations(params, content);
  }

  // 3. Mark issue done (only if no delegation happened)
  if (outcome === "succeeded" && issueId && delegatedAgents.length === 0) {
    await markIssueDone(params.db, issueId);
  }

  // 4. Reverse aggregation (check if sibling tasks complete → wake parent)
  if (outcome === "succeeded" && issueId && delegatedAgents.length === 0) {
    try {
      await checkReverseAggregation(params, issueId);
    } catch (err) {
      logger.warn({ err, issueId }, "[reverse-agg] check failed");
    }
  }

  // 5. Feishu notification (BW-36 hard constraints, only on done + feishu source + once)
  await sendNotification(params.db, agent, issueId, cleanContent, delegatedAgents, outcome);

  return { delegatedAgents, isSummarizationWake };
}
