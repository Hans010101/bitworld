/**
 * Cloud Model Router
 *
 * Routes agents to different LLM tiers when MODEL_ROUTER_ENABLED=true
 * (typically in NODE_ENV=production cloud deployments).
 *
 * When disabled (local dev), agents use their configured adapterType as-is.
 *
 * Three tiers:
 *   Tier 1 (DeepSeek V3)  — daily reporting / news / sentiment / routine HQ
 *   Tier 2 (Qwen3 Max)    — deep analysis / crypto / research / CEO routing
 *   Tier 3 (Claude Vertex) — reserved for technical tasks (CTO)
 */

import { logger } from "../middleware/logger.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ModelTier = "tier1" | "tier2" | "tier3";

export interface TierConfig {
  baseUrl: string;
  apiKey: string;
  model: string;
}

export interface ModelRouterOverride {
  adapterType: "openai_compatible";
  adapterConfig: {
    baseUrl: string;
    apiKey: string;
    model: string;
  };
}

// ---------------------------------------------------------------------------
// Tier → Agent prefix mapping
// ---------------------------------------------------------------------------

/**
 * Agent name prefixes that map to each tier.
 * Matching is case-insensitive against the agent name field.
 *
 * Tier 1 (DeepSeek V3) — daily reporting / routine:
 *   News-*, Sentiment-* (or 舆情-*), HQ-003, HQ-004, HQ-005
 *
 * Tier 2 (Qwen3 Max) — deep analysis / complex reasoning:
 *   Crypto-* (or 加密-*), Research-* (or 研究-*), HQ-001
 *
 * Tier 3 (Claude via Vertex) — reserved:
 *   HQ-002
 */
const TIER1_PREFIXES = [
  "news-",
  "新闻-",
  "sentiment-",
  "舆情-",
  "hq-003",
  "hq-004",
  "hq-005",
];

const TIER2_PREFIXES = [
  "crypto-",
  "加密-",
  "research-",
  "研究-",
  "hq-001",
];

const TIER3_PREFIXES = [
  "hq-002",
];

// ---------------------------------------------------------------------------
// Environment config
// ---------------------------------------------------------------------------

function isEnabled(): boolean {
  return process.env.MODEL_ROUTER_ENABLED === "true";
}

function getTierConfig(tier: ModelTier): TierConfig | null {
  switch (tier) {
    case "tier1":
      return buildTierFromEnv(
        "DEEPSEEK_BASE_URL",
        "DEEPSEEK_API_KEY",
        "DEEPSEEK_MODEL",
        "https://api.deepseek.com/v1",
        "deepseek-chat",
      );
    case "tier2":
      return buildTierFromEnv(
        "QWEN_BASE_URL",
        "QWEN_API_KEY",
        "QWEN_MODEL",
        "https://dashscope.aliyuncs.com/compatible-mode/v1",
        "qwen3-max",
      );
    case "tier3":
      return buildTierFromEnv(
        "VERTEX_BASE_URL",
        "VERTEX_API_KEY",
        "VERTEX_MODEL",
        "",
        "claude-sonnet-4-20250514",
      );
    default:
      return null;
  }
}

function buildTierFromEnv(
  baseUrlKey: string,
  apiKeyKey: string,
  modelKey: string,
  defaultBaseUrl: string,
  defaultModel: string,
): TierConfig | null {
  const apiKey = process.env[apiKeyKey] ?? "";
  if (!apiKey) return null;

  const baseUrl = process.env[baseUrlKey] ?? defaultBaseUrl;
  if (!baseUrl) return null;

  const model = process.env[modelKey] ?? defaultModel;
  return { baseUrl, apiKey, model };
}

// ---------------------------------------------------------------------------
// Core routing logic
// ---------------------------------------------------------------------------

function matchTier(agentName: string): ModelTier | null {
  const lower = agentName.toLowerCase();

  for (const prefix of TIER1_PREFIXES) {
    if (lower.startsWith(prefix)) return "tier1";
  }
  for (const prefix of TIER2_PREFIXES) {
    if (lower.startsWith(prefix)) return "tier2";
  }
  for (const prefix of TIER3_PREFIXES) {
    if (lower.startsWith(prefix)) return "tier3";
  }

  return null;
}

/**
 * Resolve a model router override for an agent.
 *
 * Returns null if:
 *   - Model router is disabled (MODEL_ROUTER_ENABLED != true)
 *   - Agent name doesn't match any tier prefix
 *   - Tier's environment variables are not configured (missing API key)
 *
 * When an override is returned, the heartbeat should use the
 * openai_compatible adapter with the returned config instead of the
 * agent's configured adapterType.
 */
export function resolveModelRouterOverride(agentName: string): ModelRouterOverride | null {
  if (!isEnabled()) return null;

  const tier = matchTier(agentName);
  if (!tier) {
    logger.debug({ agentName }, "model-router: no tier match, using default adapter");
    return null;
  }

  const tierConfig = getTierConfig(tier);
  if (!tierConfig) {
    logger.warn(
      { agentName, tier },
      "model-router: tier matched but env vars not configured, falling back to default adapter",
    );
    return null;
  }

  logger.info(
    { agentName, tier, model: tierConfig.model, baseUrl: tierConfig.baseUrl },
    "model-router: overriding adapter to openai_compatible",
  );

  return {
    adapterType: "openai_compatible",
    adapterConfig: {
      baseUrl: tierConfig.baseUrl,
      apiKey: tierConfig.apiKey,
      model: tierConfig.model,
    },
  };
}

/**
 * Get a human-readable description of the tier for an agent.
 * Used for diagnostics and logging.
 */
export function describeModelRoute(agentName: string): string {
  if (!isEnabled()) return "model-router disabled";
  const tier = matchTier(agentName);
  if (!tier) return "no tier match (default adapter)";
  const config = getTierConfig(tier);
  if (!config) return `${tier} (not configured)`;
  return `${tier} → ${config.model} @ ${config.baseUrl}`;
}
