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
import { existsSync } from "node:fs";
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

/**
 * Extract report topic from markdown body for PDF filename + big title.
 * Priority: 📌 主题: > first H1 > issue title (strip "[董事长指令]" prefix) > "BitWorld"
 * BW-92: explicit fallback chain — never returns empty string.
 */
function extractReportTopic(markdownBody: string, issueTitle: string | null | undefined): string {
  try {
    // Priority 1: Agent-emitted "📌 主题: <text>" field (per skills/report-templates.md)
    const pinMatch = markdownBody.match(/📌\s*(?:主题|topic)[::]\s*(.+?)(?:\n|$)/u);
    if (pinMatch?.[1]) return sanitizeFilename(pinMatch[1].trim());

    // Priority 2: first H1 in body (strip trailing " | YYYY-MM-DD" suffix if present)
    const h1Match = markdownBody.match(/^#\s+(.+?)(?:\s*\|.*)?\s*$/m);
    if (h1Match?.[1]) return sanitizeFilename(h1Match[1].trim());

    // Priority 3: issue title (strip "[董事长指令]" prefix injected by feishu-webhook)
    if (issueTitle && issueTitle.trim().length > 0) {
      const stripped = issueTitle.replace(/^\[董事长指令\]\s*/u, "").trim();
      if (stripped.length > 0) return sanitizeFilename(stripped);
    }
  } catch (err) {
    // BW-93: log explicit message via errMessage (avoid pino's `err` reserved-key serialization)
    logger.warn(
      { errMessage: err instanceof Error ? err.message : String(err) },
      "[extractReportTopic] parse failed, falling back to BitWorld",
    );
  }
  return "BitWorld";
}

/**
 * Sanitize topic string for safe filesystem filename use.
 * Removes characters illegal on common filesystems (/, \, <, >, :, ", |, ?, *)
 * + control chars; collapses whitespace; trims; caps at 80 chars.
 */
function sanitizeFilename(s: string): string {
  return s
    // eslint-disable-next-line no-control-regex
    .replace(/[\/\\<>:"|?*\x00-\x1f]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80);
}

/**
 * Strip leading metadata block + trailing report-end markers from markdown body.
 * Hotfix-v9 (Phase 5b-2 9-a): Agent LLM often emits header noise that's already
 * encoded elsewhere (📌 主题, big title) or is process-only metadata that doesn't
 * belong in the final PDF.
 */
function stripReportMetadata(markdown: string): string {
  let s = markdown;
  // Header metadata lines (anywhere within first 30 lines effectively, via /m)
  const metaLinePatterns: RegExp[] = [
    /^\[董事长指令\][^\n]*$/gm,
    /^\*\*报告编号\*\*[::][^\n]*$/gm,
    /^\*\*报告生成时间\*\*[::][^\n]*$/gm,
    /^\*\*数据窗口\*\*[::][^\n]*$/gm,
    /^\*\*报告负责人\*\*[::][^\n]*$/gm,
    /^\*\*数据来源\*\*[::][^\n]*$/gm,
  ];
  for (const p of metaLinePatterns) s = s.replace(p, "");
  // Trailing "报告结束" markers (--- 报告结束 / ## 报告结束 / **报告结束**)
  s = s.replace(/\n*[-_]{3,}\s*\n*\*{0,2}\s*报告结束\s*\*{0,2}\s*\n*$/u, "");
  s = s.replace(/\n*#{1,3}\s+报告结束\s*$/u, "");
  s = s.replace(/\n*\*{2}\s*报告结束\s*\*{2}\s*$/u, "");
  // Collapse 3+ consecutive blank lines to 2
  s = s.replace(/\n{3,}/g, "\n\n");
  return s.trimStart();
}

/** Strip inline markdown markers (`**`, `*`, `_`, backtick) for plain rendering. */
function stripInlineMarkers(s: string): string {
  return s
    .replace(/\*\*([^*\n]+)\*\*/g, "$1")
    .replace(/`([^`\n]+)`/g, "$1")
    .replace(/(?<![*\w])\*([^*\s][^*\n]*?)\*(?!\w)/g, "$1")
    .replace(/(?<![_\w])_([^_\s][^_\n]*?)_(?!\w)/g, "$1");
}

/**
 * Render a markdown table (first row = header) as a pdfkit grid.
 * Hotfix-v9 (Phase 5b-2 9-b): pdfkit has no native table API, so we draw
 * cell rects + clipped text. Page-break safe.
 */
function renderTable(doc: PDFKit.PDFDocument, rows: string[][], bodyFont: string, titleFont: string): void {
  if (rows.length === 0 || rows[0].length === 0) return;
  const cols = Math.max(...rows.map((r) => r.length));
  const normalized = rows.map((r) => {
    const padded = [...r];
    while (padded.length < cols) padded.push("");
    return padded;
  });

  const pageWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right;
  const colWidth = pageWidth / cols;
  const startX = doc.page.margins.left;
  const rowPadding = 4;
  const rowHeight = 22;

  doc.moveDown(0.3);
  normalized.forEach((row, rowIdx) => {
    if (doc.y + rowHeight > doc.page.height - doc.page.margins.bottom) {
      doc.addPage();
    }
    const y = doc.y;
    const isHeader = rowIdx === 0;
    const font = isHeader ? titleFont : bodyFont;
    const fontSize = isHeader ? 10 : 9;
    row.forEach((cellRaw, colIdx) => {
      const cell = stripInlineMarkers(cellRaw);
      const x = startX + colIdx * colWidth;
      if (isHeader) {
        doc.rect(x, y, colWidth, rowHeight).fill("#f0f0f0");
      }
      doc.rect(x, y, colWidth, rowHeight).stroke("#cccccc");
      doc.fillColor("#000000").font(font).fontSize(fontSize)
        .text(cell, x + rowPadding, y + rowPadding, {
          width: colWidth - rowPadding * 2,
          height: rowHeight - rowPadding * 2,
          ellipsis: true,
        });
    });
    doc.y = y + rowHeight;
  });
  // Reset cursor x to left margin. Hotfix-v9.1: pdfkit's doc.text(t, x, y, opts)
  // form (used above for cell rendering) sets doc.x = last cell's x coordinate.
  // Without this reset, subsequent paragraphs/headings/lists inherit that x and
  // get squeezed into the narrow last-column width — Hans 2026-05-14 PDF痛点.
  doc.x = doc.page.margins.left;
  doc.moveDown(0.5);
}

/**
 * Render markdown body to pdfkit doc.
 * Hotfix-v9 (Phase 5b-2 9-b/9-c/9-d): handles tables, inline marker stripping,
 * headings (# ## ###), bullet/ordered lists, blockquote, hr.
 * Does NOT visually-bold inline `**text**` (NotoSansCJK has no bold variant
 * face registered); markers are stripped so user-visible text is clean.
 */
function renderMarkdownToPdf(
  doc: PDFKit.PDFDocument,
  markdown: string,
  opts: { bodyFont: string; titleFont: string },
): void {
  const { bodyFont, titleFont } = opts;
  const lines = markdown.split("\n");
  let tableBuffer: string[][] | null = null;

  const flushTable = (): void => {
    if (tableBuffer && tableBuffer.length > 0) {
      renderTable(doc, tableBuffer, bodyFont, titleFont);
    }
    tableBuffer = null;
  };

  for (const line of lines) {
    // Markdown table row
    if (/^\s*\|.*\|\s*$/.test(line)) {
      if (/^\s*\|[\s\-:|]+\|\s*$/.test(line)) {
        if (tableBuffer === null) tableBuffer = [];
        continue;
      }
      const cells = line.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map((c) => c.trim());
      if (tableBuffer === null) tableBuffer = [];
      tableBuffer.push(cells);
      continue;
    } else if (tableBuffer !== null) {
      flushTable();
    }

    // Heading
    const headingMatch = line.match(/^(#{1,6})\s+(.+?)\s*$/);
    if (headingMatch) {
      const level = headingMatch[1].length;
      const text = stripInlineMarkers(headingMatch[2]);
      const size = level === 1 ? 14 : level === 2 ? 12 : 11;
      const before = level === 1 ? 0.5 : level === 2 ? 0.4 : 0.3;
      doc.moveDown(before);
      doc.font(titleFont).fontSize(size).fillColor("#000000").text(text);
      doc.moveDown(0.2);
      continue;
    }

    // Horizontal rule
    if (/^---+\s*$/.test(line.trim())) {
      doc.moveDown(0.3);
      doc.moveTo(50, doc.y).lineTo(545, doc.y).stroke("#e5e5e5");
      doc.moveDown(0.3);
      continue;
    }

    // Unordered list
    const ulMatch = line.match(/^\s*[-*]\s+(.+)$/);
    if (ulMatch) {
      const text = stripInlineMarkers(ulMatch[1]);
      doc.font(bodyFont).fontSize(10).fillColor("#000000").text("•  " + text, { indent: 10 });
      continue;
    }

    // Ordered list
    const olMatch = line.match(/^\s*(\d+)\.\s+(.+)$/);
    if (olMatch) {
      const text = stripInlineMarkers(olMatch[2]);
      doc.font(bodyFont).fontSize(10).fillColor("#000000").text(`${olMatch[1]}.  ${text}`, { indent: 10 });
      continue;
    }

    // Blockquote
    if (line.startsWith("> ")) {
      const text = stripInlineMarkers(line.slice(2));
      doc.font(bodyFont).fontSize(10).fillColor("#666666").text(text, { indent: 20 });
      doc.fillColor("#000000");
      continue;
    }

    // Empty line
    if (line.trim() === "") {
      doc.moveDown(0.3);
      continue;
    }

    // Default paragraph
    const text = stripInlineMarkers(line);
    doc.font(bodyFont).fontSize(10).fillColor("#000000").text(text);
  }

  flushTable();
}

function generateReportPdf(title: string, content: string, date: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: "A4", margin: 50 });
    const chunks: Buffer[] = [];

    doc.on("data", (chunk: Buffer) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    // CJK font: use Noto Sans CJK if available, else fall back to Helvetica.
    // Cloud Run Dockerfile installs fonts-noto-cjk which provides a .ttc
    // (TrueType Collection) at /usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc
    // packing 4 CJK faces (SC, TC, JP, KR).
    //
    // pdfkit registerFont(name, src, family?) REQUIRES the 3rd `family` arg for
    // .ttc collections — without it, registerFont returns a Collection object
    // (not a Font), and subsequent doc.font("CJK") -> doc.text() throws
    // "this.font.createSubset is not a function" (BW Hotfix-v5 root cause).
    //
    // BW Hotfix-v6 (BW-94): the `family` arg must be a face PostScript name
    // (e.g. "NotoSansCJKsc-Regular"), NOT the human-readable family display
    // name ("Noto Sans CJK SC"). Hotfix-v5 used the display name, which made
    // pdfkit silently fallback to face index 0 (typically JP), causing CJK
    // Glyph index mismatch -> PDF rendered as garbled chars. Try multiple
    // naming conventions; first that loads + survives eager doc.font() wins.
    const CJK_FONT_PATHS = [
      "/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc",
      "/usr/share/fonts/truetype/noto/NotoSansCJK-Regular.ttc",
      "/usr/share/fonts/noto-cjk/NotoSansCJK-Regular.ttc",
    ];
    const CJK_FACE_NAMES = [
      "NotoSansCJKsc-Regular",     // pdfkit PostScript name (most common)
      "NotoSansSC-Regular",         // alternate PostScript name
      "Noto Sans CJK SC Regular",  // family + style
      "Noto Sans CJK SC",           // human-readable family (last resort)
    ];
    let fontRegistered = false;
    outer: for (const fontPath of CJK_FONT_PATHS) {
      if (!existsSync(fontPath)) continue;
      for (const faceName of CJK_FACE_NAMES) {
        try {
          doc.registerFont("CJK", fontPath, faceName);
          // Eager force load to trigger createSubset() now; if the face name
          // doesn't match an actual face inside the collection, this throws
          // and we try the next face name (or next path).
          doc.font("CJK");
          fontRegistered = true;
          break outer;
        } catch {
          // Path/face combo failed, try next face name (or next path)
        }
      }
    }
    const bodyFont = fontRegistered ? "CJK" : "Helvetica";
    const titleFont = fontRegistered ? "CJK" : "Helvetica-Bold";

    // Big title: caller passes "{topic} | YYYY-MM-DD"; centered, 20pt.
    // Phase 5b-2-a: removed "BitWorld" placeholder + separate precise-time line;
    // the title now embeds the date directly. Single-line clean header.
    doc.font(titleFont).fontSize(20).text(title, { align: "center" });
    doc.moveDown(0.5);
    doc.moveTo(50, doc.y).lineTo(545, doc.y).stroke("#cccccc");
    doc.moveDown(0.5);

    // Body — markdown→PDF pipeline (Phase 5b-2 / Hotfix-v9):
    //   stripReportMetadata removes Agent-emitted header/footer noise
    //   ([董事长指令] / 报告编号 / 生成时间 / 数据窗口 / 负责人 / 数据来源 / 报告结束).
    // renderMarkdownToPdf:
    //   - tables: | col | col | rendered as grid (renderTable)
    //   - inline: **bold** / *italic* / `code` strip markers (CJK no bold face)
    //   - lists: - / * / 1. with • prefix + indent
    //   - headings: # / ## / ### with size+font hierarchy
    //   - hr / blockquote / empty line / default paragraph
    const cleanedContent = stripReportMetadata(content);
    renderMarkdownToPdf(doc, cleanedContent, { bodyFont, titleFont });

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
    // v23: deliver reports from any role that produces top-level reports, not
    // only HQ-001-CEO. Was: assigneeAgentId !== hardcoded HQ_CEO_ID (which
    // (a) used a dev-DB UUID absent in prod and (b) excluded the 4 division
    // CEOs + secretary + CHO + CFO whose scheduled reports never delivered).
    // The 5 roles below match the assigneeAgentId of every cloud-scheduler
    // task (admin-seed.ts ground truth).
    if (!row.assigneeAgentId) {
      logger.info({ issueId, reason: "no_assignee" }, "[feishu-notify] skip");
      return;
    }
    const assigneeRow = await db
      .select({ role: agents.role, name: agents.name })
      .from(agents)
      .where(eq(agents.id, row.assigneeAgentId))
      .limit(1)
      .then((r) => r[0] ?? null);
    const REPORT_ROLES = new Set(["ceo", "division_ceo", "secretary", "cho", "cfo"]);
    if (!assigneeRow || !REPORT_ROLES.has(assigneeRow.role)) {
      logger.info(
        { issueId, reason: "role_not_reportable", role: assigneeRow?.role, assigneeAgentId: row.assigneeAgentId },
        "[feishu-notify] skip",
      );
      return;
    }
    if (row.status !== "done") {
      logger.info({ issueId, reason: "not_done", status: row.status }, "[feishu-notify] skip");
      return;
    }

    const meta = (row.metadata ?? {}) as Record<string, unknown>;
    // v23: user-initiated (feishu webhook) issues carry feishuChatId in
    // metadata. Scheduled reports (cloud-scheduler) have no sender chat, so
    // fall back to env FEISHU_CHAT_ID (the group/default chat Hans configured
    // for broadcast). If neither is set, still skip — no silent crash.
    let feishuChatId = typeof meta.feishuChatId === "string" ? meta.feishuChatId.trim() : "";
    if (!feishuChatId) {
      feishuChatId = (process.env.FEISHU_CHAT_ID ?? "").trim();
    }
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
    // Phase 5b-1 + 5b-2-a: extract report topic from content (📌 主题: > H1 > issue title)
    // for BOTH filename and big title. Fallback chain ensures zero-risk default ("BitWorld").
    const reportTopic = extractReportTopic(content, row.title);
    const dateForTitle = new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Shanghai" });
    const pdfTitle = `${reportTopic} | ${dateForTitle}`;
    const pdfDate = new Date().toLocaleString("zh-CN", { timeZone: "Asia/Shanghai" });
    let pdfBuffer: Buffer;
    try {
      pdfBuffer = await generateReportPdf(pdfTitle, content, pdfDate);
    } catch (stepErr) {
      throw new Error(`step:pdf_generate failed: ${stepErr instanceof Error ? stepErr.message : String(stepErr)}`);
    }
    logger.info({ issueId, pdfBytes: pdfBuffer.length, pdfTitle }, "[feishu-notify] PDF generated");

    // ── Segment 4: 飞书双消息推送 (摘要在前 + PDF 在后) ──
    // Phase 5b-1: filename uses extracted topic (not "BitWorld-{hash}"); YYYYMMDD date.
    const dateForFilename = new Date().toISOString().slice(0, 10).replace(/-/g, "");
    const fileName = `${reportTopic}-${dateForFilename}.pdf`;

    // Segment 4-a: sendTextMessage 摘要
    try {
      await sendTextMessage(feishuChatId, summaryText);
    } catch (stepErr) {
      throw new Error(`step:send_summary_message failed: ${stepErr instanceof Error ? stepErr.message : String(stepErr)}`);
    }
    logger.info({ issueId, chatId: feishuChatId }, "[feishu-notify] summary sent");

    // Segment 4-b: uploadFile PDF
    let fileKey: string;
    try {
      fileKey = await uploadFile(fileName, pdfBuffer);
    } catch (stepErr) {
      throw new Error(`step:upload_pdf_file failed: ${stepErr instanceof Error ? stepErr.message : String(stepErr)}`);
    }

    // Segment 4-c: sendFileMessage PDF
    try {
      await sendFileMessage(feishuChatId, fileKey);
    } catch (stepErr) {
      throw new Error(`step:send_pdf_message failed: ${stepErr instanceof Error ? stepErr.message : String(stepErr)}`);
    }
    logger.info({ issueId, chatId: feishuChatId, fileName }, "[feishu-notify] PDF sent");

    // ── Segment 5: 写 feishuNotifiedAt 防重 (Pattern A: read-modify-write) ──
    try {
      await db
        .update(issues)
        .set({
          metadata: { ...meta, feishuNotifiedAt: new Date().toISOString() },
          updatedAt: new Date(),
        })
        .where(eq(issues.id, issueId));
    } catch (stepErr) {
      throw new Error(`step:update_metadata failed: ${stepErr instanceof Error ? stepErr.message : String(stepErr)}`);
    }
    logger.info({ issueId }, "[feishu-notify] notification complete + feishuNotifiedAt flag set");
  } catch (err) {
    // ── Segment 6: try/catch 整段包裹 (只 log 不抛,不阻塞 post-run hook) ──
    // BW-93: 使用 errMessage / errStack 字段名,避开 pino 对 `err` key 的
    // errSerializer 特殊处理(当 err 是 string 时该 serializer 会丢字段)
    logger.warn(
      {
        errMessage: err instanceof Error ? err.message : String(err),
        errStack: err instanceof Error ? err.stack : undefined,
        issueId,
        agent: agent.name,
      },
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
