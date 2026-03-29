# Cloud Environment Variables — Multi-Model Router

When deploying Paperclip to a cloud environment (NODE_ENV=production),
configure these environment variables to enable the multi-model routing system.

## Activation

| Variable | Value | Description |
|---|---|---|
| `MODEL_ROUTER_ENABLED` | `true` | Enable model routing (required) |
| `NODE_ENV` | `production` | Standard Node environment flag |

When `MODEL_ROUTER_ENABLED` is not `true`, all agents use their configured
`adapterType` as-is (local development behavior is unchanged).

## Tier 1 — DeepSeek V3 (Daily Reporting)

Used by: News-\*, Sentiment-\*, HQ-003 (董秘), HQ-004 (CHO), HQ-005 (CFO)

| Variable | Required | Default | Description |
|---|---|---|---|
| `DEEPSEEK_API_KEY` | Yes | — | DeepSeek API key (`sk-xxx`) |
| `DEEPSEEK_BASE_URL` | No | `https://api.deepseek.com/v1` | API base URL |
| `DEEPSEEK_MODEL` | No | `deepseek-chat` | Model identifier |

## Tier 2 — Qwen3 Max (Deep Analysis)

Used by: Crypto-\*, Research-\*, HQ-001 (CEO)

| Variable | Required | Default | Description |
|---|---|---|---|
| `QWEN_API_KEY` | Yes | — | Alibaba DashScope API key (`sk-xxx`) |
| `QWEN_BASE_URL` | No | `https://dashscope.aliyuncs.com/compatible-mode/v1` | API base URL |
| `QWEN_MODEL` | No | `qwen3-max` | Model identifier |

## Tier 3 — Claude Sonnet via Vertex AI (Reserved)

Used by: HQ-002 (CTO) — not yet activated

| Variable | Required | Default | Description |
|---|---|---|---|
| `VERTEX_API_KEY` | Yes | — | Vertex AI / Claude API key |
| `VERTEX_BASE_URL` | Yes | — | Vertex AI OpenAI-compatible endpoint URL |
| `VERTEX_MODEL` | No | `claude-sonnet-4-20250514` | Model identifier |

## Agent → Tier Mapping

The router matches agent names (case-insensitive prefix):

```
Tier 1 (DeepSeek V3):
  News-*          新闻-*           → Daily news collection/analysis
  Sentiment-*     舆情-*           → Sentiment monitoring
  HQ-003-董秘                      → Secretary
  HQ-004-CHO                       → Chief HR Officer
  HQ-005-CFO                       → Chief Financial Officer

Tier 2 (Qwen3 Max):
  Crypto-*        加密-*           → Crypto trading/analysis
  Research-*      研究-*           → Deep research
  HQ-001-CEO                       → Group CEO (complex routing)

Tier 3 (Claude Vertex) — reserved:
  HQ-002-CTO                       → Technical tasks
```

Agents not matching any prefix use their database-configured `adapterType`.

## Fallback Behavior

- If an agent matches a tier but the tier's API key is not configured,
  the agent falls back to its default configured adapter.
- Missing `MODEL_ROUTER_ENABLED` or value != `true` disables all routing.
- Local development (NODE_ENV != production) is unaffected; set
  `MODEL_ROUTER_ENABLED=true` explicitly to test routing locally.

## Example .env (cloud)

```bash
NODE_ENV=production
MODEL_ROUTER_ENABLED=true

# Tier 1 — DeepSeek
DEEPSEEK_API_KEY=sk-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
# DEEPSEEK_BASE_URL=https://api.deepseek.com/v1    # (default)
# DEEPSEEK_MODEL=deepseek-chat                       # (default)

# Tier 2 — Qwen
QWEN_API_KEY=sk-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
# QWEN_BASE_URL=https://dashscope.aliyuncs.com/compatible-mode/v1  # (default)
# QWEN_MODEL=qwen3-max                                              # (default)

# Tier 3 — Vertex AI Claude (reserved, configure when ready)
# VERTEX_API_KEY=
# VERTEX_BASE_URL=
# VERTEX_MODEL=claude-sonnet-4-20250514
```
