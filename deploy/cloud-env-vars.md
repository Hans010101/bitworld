# Cloud Environment Variables — Multi-Model Router

When deploying Paperclip to a cloud environment, configure these environment
variables to enable the multi-model routing system via Alibaba Cloud DashScope (百炼).

All three model tiers share a single DashScope API key and base URL.

## Activation

| Variable | Value | Description |
|---|---|---|
| `MODEL_ROUTER_ENABLED` | `true` | Enable model routing (required) |

When `MODEL_ROUTER_ENABLED` is not `true`, all agents use their configured
`adapterType` as-is (local development behavior is unchanged).

## DashScope Configuration

| Variable | Required | Default | Description |
|---|---|---|---|
| `DASHSCOPE_API_KEY` | Yes | — | Alibaba Cloud DashScope API key |
| `DASHSCOPE_BASE_URL` | No | `https://dashscope.aliyuncs.com/compatible-mode/v1` | API base URL |

## Three-Tier Model Mapping

| Tier | Model | Use Case | Agents |
|---|---|---|---|
| Tier 1 | `deepseek-v3` | Daily reporting | News-\*, Sentiment-\*, HQ-003/004/005 |
| Tier 2 | `qwen3-max` | Deep analysis | Crypto-\*, Research-\*, HQ-001 |
| Tier 3 | `deepseek-r1` | Reasoning tasks | HQ-002 |

## Agent → Tier Mapping (prefix match, case-insensitive)

```
Tier 1 (deepseek-v3):
  News-*          新闻-*           → Daily news collection/analysis
  Sentiment-*     舆情-*           → Sentiment monitoring
  HQ-003-董秘                      → Secretary
  HQ-004-CHO                       → Chief HR Officer
  HQ-005-CFO                       → Chief Financial Officer

Tier 2 (qwen3-max):
  Crypto-*        加密-*           → Crypto trading/analysis
  Research-*      研究-*           → Deep research
  HQ-001-CEO                       → Group CEO (complex routing)

Tier 3 (deepseek-r1):
  HQ-002-CTO                       → Technical reasoning tasks
```

Agents not matching any prefix use their database-configured `adapterType`.

## Fallback Behavior

- If `DASHSCOPE_API_KEY` is not set, all agents fall back to their default adapter.
- Missing `MODEL_ROUTER_ENABLED` or value != `true` disables all routing.
- Local development is unaffected; set `MODEL_ROUTER_ENABLED=true` to test locally.

## Example .env (cloud)

```bash
NODE_ENV=production
MODEL_ROUTER_ENABLED=true

# DashScope (百炼) — powers all three tiers
DASHSCOPE_API_KEY=***REMOVED_FROM_PUBLIC_HISTORY***
# DASHSCOPE_BASE_URL=https://dashscope.aliyuncs.com/compatible-mode/v1  # (default)
```
