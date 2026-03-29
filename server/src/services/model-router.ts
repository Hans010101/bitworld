/**
 * Cloud Model Router
 *
 * Routes agents to different LLM tiers when MODEL_ROUTER_ENABLED=true
 * (typically in NODE_ENV=production cloud deployments).
 *
 * When disabled (local dev), agents use their configured adapterType as-is.
 *
 * All three tiers use Alibaba Cloud DashScope (百炼) with a single API key:
 *   Tier 1 (deepseek-v3)  — daily reporting / news / sentiment / routine HQ
 *   Tier 2 (qwen3-max)    — deep analysis / crypto / research / CEO routing
 *   Tier 3 (deepseek-r1)  — reasoning tasks (CTO)
 */

import { logger } from "../middleware/logger.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ModelTier = "tier1" | "tier2" | "tier3";

export interface ModelRouterOverride {
  adapterType: "openai_compatible";
  adapterConfig: {
    baseUrl: string;
    apiKey: string;
    model: string;
  };
}

// ---------------------------------------------------------------------------
// Tier → model mapping
// ---------------------------------------------------------------------------

const TIER_MODELS: Record<ModelTier, string> = {
  tier1: "deepseek-v3.1",
  tier2: "qwen3-max",
  tier3: "deepseek-r1",
};

// ---------------------------------------------------------------------------
// Tier → Agent prefix mapping
// ---------------------------------------------------------------------------

/**
 * Agent name prefixes that map to each tier.
 * Matching is case-insensitive against the agent name field.
 *
 * Tier 1 (deepseek-v3) — daily reporting / routine:
 *   News-*, Sentiment-* (or 舆情-*), HQ-003, HQ-004, HQ-005
 *
 * Tier 2 (qwen3-max) — deep analysis / complex reasoning:
 *   Crypto-* (or 加密-*), Research-* (or 研究-*), HQ-001
 *
 * Tier 3 (deepseek-r1) — reasoning tasks:
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
// Environment config — unified DashScope (百炼)
// ---------------------------------------------------------------------------

const DEFAULT_DASHSCOPE_BASE_URL = "https://dashscope.aliyuncs.com/compatible-mode/v1";

function isEnabled(): boolean {
  return process.env.MODEL_ROUTER_ENABLED === "true";
}

function getDashScopeConfig(): { baseUrl: string; apiKey: string } | null {
  const apiKey = process.env.DASHSCOPE_API_KEY ?? "";
  if (!apiKey) return null;
  const baseUrl = process.env.DASHSCOPE_BASE_URL ?? DEFAULT_DASHSCOPE_BASE_URL;
  return { baseUrl, apiKey };
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
 *   - DASHSCOPE_API_KEY is not configured
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

  const dashscope = getDashScopeConfig();
  if (!dashscope) {
    logger.warn(
      { agentName, tier },
      "model-router: tier matched but DASHSCOPE_API_KEY not configured, falling back to default adapter",
    );
    return null;
  }

  const model = TIER_MODELS[tier];

  logger.info(
    { agentName, tier, model, baseUrl: dashscope.baseUrl },
    "model-router: overriding adapter to openai_compatible",
  );

  return {
    adapterType: "openai_compatible",
    adapterConfig: {
      baseUrl: dashscope.baseUrl,
      apiKey: dashscope.apiKey,
      model,
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
  const dashscope = getDashScopeConfig();
  if (!dashscope) return `${tier} (DASHSCOPE_API_KEY not set)`;
  return `${tier} → ${TIER_MODELS[tier]} @ ${dashscope.baseUrl}`;
}
