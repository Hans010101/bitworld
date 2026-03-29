import { eq } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import { issues, issueComments } from "@paperclipai/db";
import { logger } from "../middleware/logger.js";

export interface QualityFlag {
  rule: string;
  message: string;
}

export interface QualityCheckResult {
  passed: boolean;
  flags: QualityFlag[];
  wordCount: number;
  sectionCount: number;
  urlCount: number;
  dataPointCount: number;
}

/**
 * Check if this issue should skip quality check entirely.
 */
function shouldSkipQC(title: string, agentName?: string): boolean {
  // CTO tasks, CEO delegation tasks, technical/ops tasks
  if (agentName && /HQ-001-CEO|HQ-002-CTO/.test(agentName)) return true;
  if (/技术运维|解除|锁定|修复|Bug|部署|配置|委派|分配/.test(title)) return true;
  return false;
}

/**
 * Determine minimum word count based on issue title keywords.
 * Relaxed thresholds with buffer for practical use.
 */
function getMinWordCount(title: string): { min: number; label: string } {
  if (/早报/.test(title)) return { min: 1500, label: "早报" };
  if (/晚报/.test(title)) return { min: 800, label: "晚报" };
  if (/舆情日报/.test(title)) return { min: 1500, label: "舆情日报" };
  if (/周报/.test(title)) return { min: 3000, label: "周报" };
  return { min: 500, label: "常规" };
}

/**
 * Count Chinese + English words in text.
 * Chinese: each character counts as 1 word.
 * English: space-separated tokens.
 */
function countWords(text: string): number {
  // Count Chinese characters
  const chineseChars = (text.match(/[\u4e00-\u9fff\u3400-\u4dbf]/g) || []).length;
  // Count English words (sequences of latin chars)
  const englishWords = (text.match(/[a-zA-Z]+/g) || []).length;
  return chineseChars + englishWords;
}

/**
 * Run deterministic quality checks on the output text.
 */
export function checkQuality(text: string, issueTitle: string): QualityCheckResult {
  const flags: QualityFlag[] = [];

  // 1. Word count check
  const wordCount = countWords(text);
  const { min, label } = getMinWordCount(issueTitle);
  if (wordCount < min) {
    flags.push({
      rule: "字数不足",
      message: `${label}要求 ≥${min} 字，实际 ${wordCount} 字`,
    });
  }

  // 2. Structure check
  const sections = (text.match(/^## .+/gm) || []);
  const sectionCount = sections.length;
  if (sectionCount < 3) {
    flags.push({
      rule: "结构不完整",
      message: `章节标题（##）不足，要求 ≥3 个，实际 ${sectionCount} 个`,
    });
  }

  const hasSummary = /执行摘要|核心摘要|概览|Executive Summary/i.test(text);
  if (!hasSummary) {
    flags.push({
      rule: "结构不完整",
      message: "缺少执行摘要或核心摘要章节",
    });
  }

  const hasSourceSection = /数据来源|来源|参考|References|Sources/i.test(text);
  if (!hasSourceSection) {
    flags.push({
      rule: "结构不完整",
      message: "缺少数据来源章节",
    });
  }

  // 3. Data citation check (advisory only, not blocking)
  const urls = (text.match(/https?:\/\/[^\s)>\]]+/g) || []);
  const urlCount = urls.length;
  // URL and data point counts are tracked but NOT used as blocking criteria

  const dataPoints = (text.match(/\$[\d,]+\.?\d*|\d+\.\d+%|[\d,]+\s*(亿|万|美元|BTC|ETH)/g) || []);
  const dataPointCount = dataPoints.length;

  // Deduplicate flags by rule
  const uniqueFlags: QualityFlag[] = [];
  const seenRules = new Set<string>();
  for (const f of flags) {
    const key = f.rule;
    if (!seenRules.has(key)) {
      seenRules.add(key);
      uniqueFlags.push(f);
    } else {
      // Merge messages for same rule
      const existing = uniqueFlags.find((u) => u.rule === key);
      if (existing) existing.message += `；${f.message}`;
    }
  }

  return {
    passed: uniqueFlags.length === 0,
    flags: uniqueFlags,
    wordCount,
    sectionCount,
    urlCount,
    dataPointCount,
  };
}

/**
 * Quality check service that integrates with the issue system.
 */
export function qualityCheckService(db: Db) {
  /**
   * Run quality check on the latest comment of an issue.
   * Called after a heartbeat run completes successfully.
   */
  async function checkIssueQuality(issueId: string, agentName?: string): Promise<QualityCheckResult | null> {
    // Get issue title
    const [issue] = await db
      .select({ id: issues.id, title: issues.title, status: issues.status, companyId: issues.companyId })
      .from(issues)
      .where(eq(issues.id, issueId));
    if (!issue) return null;

    // Skip if issue is not done
    if (issue.status !== "done") return null;

    // Skip QC for exempt task types
    if (shouldSkipQC(issue.title, agentName)) {
      logger.info({ issueId, title: issue.title }, "quality check skipped (exempt)");
      return null;
    }

    // Get all comments for this issue, find the longest one (the report)
    const comments = await db
      .select({ id: issueComments.id, body: issueComments.body })
      .from(issueComments)
      .where(eq(issueComments.issueId, issueId));

    if (comments.length === 0) return null;

    // Find the longest comment (most likely the full report)
    const longestComment = comments.reduce((prev, curr) =>
      (curr.body?.length || 0) > (prev.body?.length || 0) ? curr : prev,
    );

    if (!longestComment.body || longestComment.body.length < 100) return null;

    const result = checkQuality(longestComment.body, issue.title);

    // Add quality result as a comment
    if (result.passed) {
      await db.insert(issueComments).values({
        companyId: issue.companyId,
        issueId,
        authorUserId: "system",
        body: `✅ 质检通过（${result.wordCount} 字 | ${result.sectionCount} 章节 | ${result.urlCount} 链接 | ${result.dataPointCount} 数据点）`,
      });
    } else {
      const flagList = result.flags.map((f) => `- ❌ ${f.rule}：${f.message}`).join("\n");
      const qcComment = `⚠️ 质检未通过\n\n${flagList}\n\n统计：${result.wordCount} 字 | ${result.sectionCount} 章节 | ${result.urlCount} 链接 | ${result.dataPointCount} 数据点`;

      await db.insert(issueComments).values({
        companyId: issue.companyId,
        issueId,
        authorUserId: "system",
        body: qcComment,
      });

      // Soft warning only — do NOT auto-reopen/retry, just log the issue
      logger.info({ issueId, flags: result.flags.length, wordCount: result.wordCount }, "quality check: flags found (advisory only, not blocking)");
    }

    return result;
  }

  return { checkIssueQuality, checkQuality };
}

// Need sql import for string concatenation
import { sql } from "drizzle-orm";
