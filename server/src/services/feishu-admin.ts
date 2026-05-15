/**
 * Feishu super-admin service (Phase 6 v14).
 *
 * Combines:
 *   - isAdmin: check DB feishu_admins + env FEISHU_ADMIN_OPEN_IDS fallback
 *   - admin operations: addToWhitelist / removeFromWhitelist / suspendUser /
 *     unsuspendUser / listWhitelist
 *   - parseAdminCommand: parse `/admin <verb> <args>` strings into typed actions
 *
 * Admin invokes via feishu message starting with `/admin`. Non-admin senders
 * who send `/admin ...` get silent ignore (logged at webhook level).
 */
import type { Db } from "@paperclipai/db";
import { feishuWhitelist, feishuAdmins, feishuSuspensions } from "@paperclipai/db";
import { and, eq, gt } from "drizzle-orm";
import { logger } from "../middleware/logger.js";

// ─────────────────────────────────────────────────────────────────────────────
// Env-seed cache (parsed once per process)
// ─────────────────────────────────────────────────────────────────────────────

let envAdminCache: Set<string> | null = null;

function getEnvAdmins(): Set<string> {
  if (envAdminCache) return envAdminCache;
  const raw = process.env.FEISHU_ADMIN_OPEN_IDS;
  if (!raw) {
    envAdminCache = new Set();
    return envAdminCache;
  }
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (Array.isArray(parsed)) {
      envAdminCache = new Set(parsed.filter((s): s is string => typeof s === "string"));
    } else {
      envAdminCache = new Set();
    }
  } catch (err) {
    // BW-93: explicit errMessage to avoid pino err reserved-key serialization
    logger.warn(
      { errMessage: err instanceof Error ? err.message : String(err) },
      "[feishu-admin] FEISHU_ADMIN_OPEN_IDS parse failed; env admins = empty",
    );
    envAdminCache = new Set();
  }
  return envAdminCache;
}

// ─────────────────────────────────────────────────────────────────────────────
// Admin check
// ─────────────────────────────────────────────────────────────────────────────

export async function isAdmin(db: Db, openId: string): Promise<boolean> {
  // 1. env seed admins
  if (getEnvAdmins().has(openId)) return true;
  // 2. DB feishu_admins
  try {
    const rows = await db
      .select({ id: feishuAdmins.id })
      .from(feishuAdmins)
      .where(eq(feishuAdmins.openId, openId))
      .limit(1);
    return rows.length > 0;
  } catch (err) {
    logger.warn(
      { errMessage: err instanceof Error ? err.message : String(err), openId },
      "[feishu-admin] DB admin check failed; env-only fallback",
    );
    return false;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Whitelist / suspension queries (used by feishu-whitelist v11 wrapper)
// ─────────────────────────────────────────────────────────────────────────────

export async function isInDbWhitelist(db: Db, openId: string): Promise<boolean> {
  try {
    const rows = await db
      .select({ id: feishuWhitelist.id })
      .from(feishuWhitelist)
      .where(eq(feishuWhitelist.openId, openId))
      .limit(1);
    return rows.length > 0;
  } catch (err) {
    logger.warn(
      { errMessage: err instanceof Error ? err.message : String(err), openId },
      "[feishu-admin] DB whitelist check failed",
    );
    return false;
  }
}

export async function isSuspendedNow(db: Db, openId: string): Promise<boolean> {
  try {
    const now = new Date();
    const rows = await db
      .select({ id: feishuSuspensions.id })
      .from(feishuSuspensions)
      .where(and(eq(feishuSuspensions.openId, openId), gt(feishuSuspensions.until, now)))
      .limit(1);
    return rows.length > 0;
  } catch (err) {
    logger.warn(
      { errMessage: err instanceof Error ? err.message : String(err), openId },
      "[feishu-admin] DB suspension check failed",
    );
    return false;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Admin mutations
// ─────────────────────────────────────────────────────────────────────────────

export async function addToWhitelist(db: Db, openId: string, addedBy: string, note?: string): Promise<void> {
  await db
    .insert(feishuWhitelist)
    .values({ openId, addedBy, note: note ?? null })
    .onConflictDoNothing();
}

export async function removeFromWhitelist(db: Db, openId: string): Promise<number> {
  const deleted = await db.delete(feishuWhitelist).where(eq(feishuWhitelist.openId, openId)).returning({ id: feishuWhitelist.id });
  return deleted.length;
}

export async function listWhitelist(db: Db): Promise<Array<{ openId: string; addedBy: string | null; note: string | null }>> {
  const rows = await db
    .select({ openId: feishuWhitelist.openId, addedBy: feishuWhitelist.addedBy, note: feishuWhitelist.note })
    .from(feishuWhitelist);
  return rows;
}

export async function suspendUser(db: Db, openId: string, days: number, suspendedBy: string, reason?: string): Promise<Date> {
  const until = new Date(Date.now() + days * 24 * 60 * 60 * 1000);
  await db.insert(feishuSuspensions).values({ openId, until, reason: reason ?? null, suspendedBy });
  return until;
}

export async function unsuspendUser(db: Db, openId: string): Promise<number> {
  // Delete future-active suspensions only
  const now = new Date();
  const deleted = await db
    .delete(feishuSuspensions)
    .where(and(eq(feishuSuspensions.openId, openId), gt(feishuSuspensions.until, now)))
    .returning({ id: feishuSuspensions.id });
  return deleted.length;
}

// ─────────────────────────────────────────────────────────────────────────────
// Command parser
// ─────────────────────────────────────────────────────────────────────────────

export type AdminCommand =
  | { verb: "add"; openId: string; note?: string }
  | { verb: "remove"; openId: string }
  | { verb: "list" }
  | { verb: "suspend"; openId: string; days: number; reason?: string }
  | { verb: "unsuspend"; openId: string }
  | { verb: "help" }
  | { verb: "invalid"; reason: string };

/**
 * Parse `/admin <verb> <args>` into a typed action.
 * Returns { verb: "invalid", reason } for malformed input.
 *
 * Supported:
 *   /admin add <open_id> [note...]
 *   /admin remove <open_id>
 *   /admin list
 *   /admin suspend <open_id> <Ndays> [reason...]
 *   /admin unsuspend <open_id>
 *   /admin help
 */
export function parseAdminCommand(text: string): AdminCommand {
  const trimmed = text.trim();
  if (!trimmed.startsWith("/admin")) {
    return { verb: "invalid", reason: "not an admin command" };
  }
  const rest = trimmed.slice("/admin".length).trim();
  if (!rest) return { verb: "help" };

  const tokens = rest.split(/\s+/);
  const verb = tokens[0].toLowerCase();

  if (verb === "help") return { verb: "help" };

  if (verb === "list") return { verb: "list" };

  if (verb === "add") {
    if (tokens.length < 2) return { verb: "invalid", reason: "用法:/admin add <open_id> [备注]" };
    const openId = tokens[1];
    const note = tokens.slice(2).join(" ") || undefined;
    return { verb: "add", openId, note };
  }

  if (verb === "remove") {
    if (tokens.length < 2) return { verb: "invalid", reason: "用法:/admin remove <open_id>" };
    return { verb: "remove", openId: tokens[1] };
  }

  if (verb === "suspend") {
    if (tokens.length < 3) return { verb: "invalid", reason: "用法:/admin suspend <open_id> <Ndays> [原因]" };
    const days = parseInt(tokens[2].replace(/d$/, ""), 10);
    if (!Number.isFinite(days) || days <= 0 || days > 365) {
      return { verb: "invalid", reason: "天数必须是 1-365 整数" };
    }
    const reason = tokens.slice(3).join(" ") || undefined;
    return { verb: "suspend", openId: tokens[1], days, reason };
  }

  if (verb === "unsuspend") {
    if (tokens.length < 2) return { verb: "invalid", reason: "用法:/admin unsuspend <open_id>" };
    return { verb: "unsuspend", openId: tokens[1] };
  }

  return { verb: "invalid", reason: `未知子命令:${verb}。发送 /admin help 看用法` };
}

/** Render help text in Chinese for feishu reply. */
export function adminHelpText(): string {
  return [
    "📖 /admin 命令用法",
    "",
    "/admin add <open_id> [备注]     加白名单",
    "/admin remove <open_id>          移白名单",
    "/admin list                      列当前白名单",
    "/admin suspend <open_id> <Ndays> [原因]  暂停 N 天",
    "/admin unsuspend <open_id>       解除暂停",
    "/admin help                      显示本帮助",
  ].join("\n");
}
