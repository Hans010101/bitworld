/**
 * Feishu sender whitelist (Phase 6 v14).
 *
 * v14 migrates from env-only (v11) to a DB-first model with env fallback:
 *
 *   1. Check `feishu_suspensions` — if active (until > now), return false.
 *   2. Check `feishu_whitelist` (DB) — if found, return true.
 *   3. Fall back to env `FEISHU_WHITELIST_OPEN_IDS` (seed mode for bootstrap):
 *        - undefined / not set       → PERMISSIVE: all senders allowed (initial-
 *                                       deploy safety so Hans isn't locked out).
 *        - JSON array of open_ids    → STRICT: only listed senders pass.
 *        - empty array `[]`          → STRICT (deny all) — emergency switch.
 *        - malformed JSON / non-array → STRICT (deny all), warn log.
 *
 * The env layer is cached once per process; DB checks hit on every call so
 * /admin add / remove / suspend take effect immediately without redeploy.
 *
 * Breaking change vs v11: `isWhitelisted` is now async and requires `db`.
 * All callers (currently only feishu-webhook.ts) must await.
 */
import type { Db } from "@paperclipai/db";
import { logger } from "../middleware/logger.js";
import { isInDbWhitelist, isSuspendedNow } from "./feishu-admin.js";

type EnvWhitelistResult =
  | { mode: "permissive" }
  | { mode: "strict"; whitelist: Set<string> };

let envCached: EnvWhitelistResult | null = null;

function getEnvWhitelist(): EnvWhitelistResult {
  if (envCached !== null) return envCached;
  const raw = process.env.FEISHU_WHITELIST_OPEN_IDS;
  if (raw === undefined) {
    logger.warn(
      {},
      "[feishu-whitelist] FEISHU_WHITELIST_OPEN_IDS not set; env layer in PERMISSIVE mode. DB whitelist still applies on top.",
    );
    envCached = { mode: "permissive" };
    return envCached;
  }
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (Array.isArray(parsed)) {
      const whitelist = new Set(parsed.filter((s): s is string => typeof s === "string"));
      envCached = { mode: "strict", whitelist };
      logger.info({ size: whitelist.size }, "[feishu-whitelist] env strict mode active (seed layer)");
      return envCached;
    }
    logger.warn(
      {},
      "[feishu-whitelist] FEISHU_WHITELIST_OPEN_IDS is not a JSON array; env layer fail-secure (deny all)",
    );
    envCached = { mode: "strict", whitelist: new Set() };
    return envCached;
  } catch (err) {
    // BW-93: explicit errMessage to avoid pino's err reserved-key serialization
    logger.warn(
      { errMessage: err instanceof Error ? err.message : String(err) },
      "[feishu-whitelist] FEISHU_WHITELIST_OPEN_IDS parse failed; env layer fail-secure (deny all)",
    );
    envCached = { mode: "strict", whitelist: new Set() };
    return envCached;
  }
}

/**
 * Async whitelist check (Phase 6 v14).
 *
 * Returns false if the sender is currently suspended; otherwise true if they
 * appear in either the DB whitelist or the env seed layer.
 */
export async function isWhitelisted(db: Db, openId: string): Promise<boolean> {
  // 1. Suspension overrides everything
  if (await isSuspendedNow(db, openId)) return false;

  // 2. DB whitelist (dynamic, set by /admin add)
  if (await isInDbWhitelist(db, openId)) return true;

  // 3. Env fallback (seed layer for bootstrap)
  const env = getEnvWhitelist();
  if (env.mode === "permissive") return true;
  return env.whitelist.has(openId);
}

/** Test-only: clear env cache so env var changes take effect mid-process. */
export function _resetWhitelistCache(): void {
  envCached = null;
}
