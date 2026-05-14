/**
 * Feishu per-sender quota service (Phase 6 v12).
 *
 * Two limits enforced before issue creation:
 *   1. Monthly pool: total command count across ALL senders this month
 *      must be < FEISHU_MONTHLY_COMMAND_BUDGET (default 2000). This is a
 *      rough proxy for token budget — proper token-pool accounting can
 *      be added in a follow-up by updating tokenUsed from sendNotification
 *      post-LLM-call. v12 uses commands as a deterministic, easy-to-meter
 *      proxy that hard-caps the DeepSeek bill.
 *   2. Per-user-per-day command limit: each sender_open_id can fire at
 *      most FEISHU_DAILY_PER_USER_LIMIT (default 50) commands per day.
 *
 * Storage: `feishu_quota_usage` table, one row per (sender_open_id, day).
 * Unique index on (sender_open_id, day) lets us upsert atomically via
 * onConflictDoUpdate.
 */
import type { Db } from "@paperclipai/db";
import { feishuQuotaUsage } from "@paperclipai/db";
import { and, eq, like, sql } from "drizzle-orm";
import { logger } from "../middleware/logger.js";

export interface QuotaCheckResult {
  ok: boolean;
  reason?: string;
  monthlyUsed?: number;
  monthlyBudget?: number;
  userDayCount?: number;
  dailyLimit?: number;
}

function parseIntEnv(name: string, def: number): number {
  const raw = process.env[name];
  if (!raw) return def;
  const n = parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : def;
}

/**
 * Atomically check + increment quota for a sender.
 * Returns ok:false (with reason) if either limit would be exceeded.
 * On ok:true, an upsert has been issued — the command is "reserved" before
 * the actual LLM call. If the LLM call fails the slot is consumed anyway
 * (acceptable; conservative metering).
 */
export async function checkAndIncrementQuota(db: Db, senderOpenId: string): Promise<QuotaCheckResult> {
  const day = new Date().toISOString().slice(0, 10); // YYYY-MM-DD UTC
  const month = day.slice(0, 7); // YYYY-MM
  const monthlyBudget = parseIntEnv("FEISHU_MONTHLY_COMMAND_BUDGET", 2000);
  const dailyLimit = parseIntEnv("FEISHU_DAILY_PER_USER_LIMIT", 50);

  try {
    // 1. Monthly pool: sum commandCount where day starts with current month.
    const monthlyRows = await db
      .select({ count: feishuQuotaUsage.commandCount })
      .from(feishuQuotaUsage)
      .where(like(feishuQuotaUsage.day, `${month}%`));
    const monthlyUsed = monthlyRows.reduce((s, r) => s + (r.count ?? 0), 0);
    if (monthlyUsed >= monthlyBudget) {
      return {
        ok: false,
        reason: `本月全池指令额度 ${monthlyBudget} 已用完(${monthlyUsed}/${monthlyBudget})。请联系管理员或下月再试。`,
        monthlyUsed,
        monthlyBudget,
      };
    }

    // 2. Per-user-per-day limit
    const userDayRows = await db
      .select({ count: feishuQuotaUsage.commandCount })
      .from(feishuQuotaUsage)
      .where(and(eq(feishuQuotaUsage.senderOpenId, senderOpenId), eq(feishuQuotaUsage.day, day)))
      .limit(1);
    const userDayCount = userDayRows[0]?.count ?? 0;
    if (userDayCount >= dailyLimit) {
      return {
        ok: false,
        reason: `您今日已发 ${userDayCount} 次指令,超过单人单日上限 ${dailyLimit}。请明日再试。`,
        userDayCount,
        dailyLimit,
      };
    }

    // 3. Upsert: increment commandCount atomically via unique-index conflict.
    await db
      .insert(feishuQuotaUsage)
      .values({ senderOpenId, day, commandCount: 1, tokenUsed: 0 })
      .onConflictDoUpdate({
        target: [feishuQuotaUsage.senderOpenId, feishuQuotaUsage.day],
        set: {
          commandCount: sql`${feishuQuotaUsage.commandCount} + 1`,
          updatedAt: new Date(),
        },
      });

    return {
      ok: true,
      monthlyUsed: monthlyUsed + 1,
      monthlyBudget,
      userDayCount: userDayCount + 1,
      dailyLimit,
    };
  } catch (err) {
    // BW-93: explicit errMessage to avoid pino's `err` reserved-key serialization
    logger.warn(
      { errMessage: err instanceof Error ? err.message : String(err), senderOpenId, day },
      "[feishu-quota] check/increment failed; allowing through as fail-open (avoid blocking ops during DB issues)",
    );
    // Fail-OPEN on DB error: don't block users during transient outages.
    // The whitelist (v11) is the security gate; quota is a budget gate.
    return { ok: true };
  }
}
