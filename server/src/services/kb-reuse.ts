/**
 * Phase 7 — Knowledge Base Reuse.
 *
 * Before a subsidiary CEO generates a recurring report, pull the summaries of
 * the *same division + same report type* reports from the last N days and
 * inject them into the prompt as a reference, so the agent reports only the
 * increment ("只报增量") instead of re-collecting what it already covered.
 *
 * Goals: save DeepSeek tokens ~30-50% on recurring reports + report continuity.
 *
 * Audit-driven design decisions (Phase 7 Step 1, see handoff):
 *   - Report bodies live in `issue_comments.body` (latest comment authored by
 *     the CEO agent on a `status = 'done'` issue) — NOT on the issues row.
 *   - A single agent (e.g. News-001-CEO) produces MULTIPLE report types
 *     (新闻早报 / 科技早报 / 新闻晚报 / 科技晚报). Filtering by `assigneeAgentId`
 *     alone would mix types, so we additionally match a date-stripped title
 *     "type signature" to enforce 同事业部 + 同类型, 不跨类型.
 *   - Everything is fail-safe: any DB error returns [] and never blocks report
 *     generation.
 *
 * Kill switch: env `KB_REUSE_ENABLED` (default on; set to "false" to disable).
 */
import type { Db } from "@paperclipai/db";
import { issues, issueComments } from "@paperclipai/db";
import { and, desc, eq, gt, ne } from "drizzle-orm";
import { logger } from "../middleware/logger.js";

const MAX_SUMMARIES = 7; // at most 7 same-type reports (one per day over a week)
const PER_SUMMARY_CHARS = 200; // truncate each summary to avoid prompt bloat
const TOTAL_CAP_CHARS = 1500; // hard cap on the whole injected block
const CANDIDATE_FETCH_LIMIT = 24; // fetch extra before signature filtering

/**
 * Derive a stable "report type signature" from an issue title by stripping the
 * date token. Two reports are the same type iff their signatures match.
 *
 *   "[早报] 2026-05-15 加密货币日报" → "[早报] 加密货币日报"
 *   "[晚报] 2026-05-15 加密货币晚报" → "[晚报] 加密货币晚报"   (different → excluded)
 *   "[早报] 2026-05-14 加密货币日报" → "[早报] 加密货币日报"   (matches yesterday → included)
 */
export function reportTypeSignature(title: string): string {
  return (title ?? "")
    .replace(/\d{4}[-/]\d{1,2}[-/]\d{1,2}/g, "") // strip YYYY-MM-DD / YYYY/M/D
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Extract a short summary section from a report markdown body. Prefers an
 * explicit 概要/执行摘要/摘要/overview section; falls back to the first
 * non-header paragraph. Truncated to PER_SUMMARY_CHARS.
 */
export function extractSummarySection(markdown: string): string {
  if (!markdown) return "";
  const m = markdown.match(
    /(?:执行摘要|概要|摘要|overview)[：:\s]*([\s\S]{0,400}?)(?:\n#{1,6}\s|\n\n#|$)/iu,
  );
  let text = m?.[1]?.trim() ?? "";
  if (!text) {
    // Fallback: drop markdown header lines, take the leading prose.
    text = markdown.replace(/^#{1,6}\s.*$/gm, "").trim().slice(0, 400);
  }
  return text.replace(/\s+/g, " ").trim().slice(0, PER_SUMMARY_CHARS);
}

/**
 * Fetch up to MAX_SUMMARIES recent same-division + same-type report summaries.
 * Fail-safe: returns [] on any error (never throws to the caller).
 */
export async function getRecentSimilarSummaries(
  db: Db,
  params: { agentId: string; currentIssueId: string; currentTitle: string; days: number },
): Promise<string[]> {
  try {
    const wantSig = reportTypeSignature(params.currentTitle);
    if (!wantSig) return [];

    const cutoff = new Date(Date.now() - params.days * 86_400_000);

    // Same agent (division) + completed + within window + not the current issue.
    const candidates = await db
      .select({ id: issues.id, title: issues.title })
      .from(issues)
      .where(
        and(
          eq(issues.assigneeAgentId, params.agentId),
          eq(issues.status, "done"),
          ne(issues.id, params.currentIssueId),
          gt(issues.createdAt, cutoff),
        ),
      )
      .orderBy(desc(issues.createdAt))
      .limit(CANDIDATE_FETCH_LIMIT);

    // Enforce same report type via date-stripped signature match.
    const sameType = candidates
      .filter((c) => reportTypeSignature(c.title) === wantSig)
      .slice(0, MAX_SUMMARIES);
    if (sameType.length === 0) return [];

    const summaries: string[] = [];
    for (const issue of sameType) {
      // The final report = latest comment authored by this CEO on the issue.
      const comment = await db
        .select({ body: issueComments.body })
        .from(issueComments)
        .where(and(eq(issueComments.issueId, issue.id), eq(issueComments.authorAgentId, params.agentId)))
        .orderBy(desc(issueComments.createdAt))
        .limit(1)
        .then((rows) => rows[0] ?? null);
      const summary = extractSummarySection(comment?.body ?? "");
      if (summary) summaries.push(summary);
    }
    return summaries;
  } catch (err) {
    // BW-93: explicit errMessage to avoid pino err reserved-key serialization
    logger.warn(
      { errMessage: err instanceof Error ? err.message : String(err), agentId: params.agentId },
      "[kb-reuse] query failed; returning empty (fail-safe)",
    );
    return [];
  }
}

/**
 * Format the summaries into a prompt-injectable block. Returns "" if empty.
 * Capped at TOTAL_CAP_CHARS to bound prompt growth.
 */
export function buildKbReuseBlock(summaries: string[]): string {
  if (summaries.length === 0) return "";
  const header = "## 近 7 天同类报告参考(只报增量,勿重复已报内容)";
  const lines = summaries.map((s, i) => `${i + 1}. ${s}`);
  return [header, ...lines].join("\n").slice(0, TOTAL_CAP_CHARS);
}
