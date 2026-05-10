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
  agent: { name: string },
  content: string,
  delegated: string[],
  isSummarizationWake: boolean,
  outcome: string,
  errorMessage?: string,
): Promise<void> {
  if (agent.name !== "HQ-001-CEO") return;

  const chatId = process.env.FEISHU_CHAT_ID ?? "";
  if (!chatId) return;

  try {
    const icon = outcome === "succeeded" ? "✅" : outcome === "failed" ? "❌" : "⏱️";

    if (isSummarizationWake && outcome === "succeeded" && content.length > 200) {
      const date = new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Shanghai" });
      const shortTitle = content.split("\n").find((l) => l.trim().length > 0)?.slice(0, 60) ?? "综合报告";
      const filename = `BitWorld_报告_${date}.pdf`;

      try {
        const pdfBuffer = await generateReportPdf(shortTitle, content, date);
        const fileKey = await uploadFile(filename, pdfBuffer);
        await sendFileMessage(chatId, fileKey);
        await sendTextMessage(chatId, `${icon} ${agent.name} 汇总完成\n\n${content.slice(0, 200)}...`);
        logger.info({ filename, pdfBytes: pdfBuffer.length, fileKey }, "[post-run] sent PDF report to Feishu");
        return;
      } catch (pdfErr) {
        logger.warn({ err: pdfErr }, "[post-run] PDF/Feishu upload failed, falling back to text");
      }
    }

    const outputText = outcome === "succeeded" ? content.slice(0, 800) : (errorMessage ?? outcome);
    const delegationNote = delegated.length > 0 ? `\n\n📋 已委派：\n${delegated.join("\n")}` : "";
    const label = isSummarizationWake ? "汇总完成" : delegated.length > 0 ? "任务分派完成" : "执行完成";
    await sendTextMessage(chatId, `${icon} ${agent.name} ${label}\n\n${outputText}${delegationNote}`);
  } catch {
    // Notification is best-effort
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

  // 5. TG notification (HQ-001-CEO only)
  await sendNotification(agent, cleanContent, delegatedAgents, isSummarizationWake, outcome);

  return { delegatedAgents, isSummarizationWake };
}
