/**
 * Feishu sender whitelist (Phase 6 v11).
 *
 * Modes (driven by env `FEISHU_WHITELIST_OPEN_IDS`):
 *   - undefined / not set       → PERMISSIVE: all senders allowed (initial-deploy
 *                                  safety so Hans isn't immediately locked out).
 *                                  Logs a warn line on first access so Cloud Run
 *                                  ops can see the gap.
 *   - JSON array of open_ids    → STRICT: only listed senders pass.
 *   - empty array `[]`          → STRICT (deny all) — operator's emergency switch.
 *   - malformed JSON / non-array → STRICT (deny all), warn log.
 *
 * Cached on first read for the process lifetime. To pick up env changes,
 * the Cloud Run revision must be re-deployed (or call `_resetWhitelistCache`
 * from tests).
 */
import { logger } from "../middleware/logger.js";

type WhitelistResult =
  | { mode: "permissive" }
  | { mode: "strict"; whitelist: Set<string> };

let cached: WhitelistResult | null = null;

function getWhitelist(): WhitelistResult {
  if (cached !== null) return cached;
  const raw = process.env.FEISHU_WHITELIST_OPEN_IDS;
  if (raw === undefined) {
    logger.warn(
      {},
      "[feishu-whitelist] FEISHU_WHITELIST_OPEN_IDS not set; running in PERMISSIVE mode (all senders allowed). Set the env to enable strict whitelist.",
    );
    cached = { mode: "permissive" };
    return cached;
  }
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (Array.isArray(parsed)) {
      const whitelist = new Set(parsed.filter((s): s is string => typeof s === "string"));
      cached = { mode: "strict", whitelist };
      logger.info({ size: whitelist.size }, "[feishu-whitelist] strict mode active");
      return cached;
    }
    logger.warn(
      {},
      "[feishu-whitelist] FEISHU_WHITELIST_OPEN_IDS is not a JSON array; fail-secure (deny all)",
    );
    cached = { mode: "strict", whitelist: new Set() };
    return cached;
  } catch (err) {
    // BW-93: explicit errMessage to avoid pino's err reserved-key serialization
    logger.warn(
      { errMessage: err instanceof Error ? err.message : String(err) },
      "[feishu-whitelist] FEISHU_WHITELIST_OPEN_IDS parse failed; fail-secure (deny all)",
    );
    cached = { mode: "strict", whitelist: new Set() };
    return cached;
  }
}

export function isWhitelisted(openId: string): boolean {
  const r = getWhitelist();
  if (r.mode === "permissive") return true;
  return r.whitelist.has(openId);
}

/** Test-only: clear cache so env var changes take effect mid-process. */
export function _resetWhitelistCache(): void {
  cached = null;
}
