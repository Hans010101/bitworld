#!/bin/bash
# 手动触发董秘生成日报并推送 Telegram
# 用法: ./scripts/send-daily-report.sh

SECRETARY_AGENT_ID="44115df3-6109-4616-99d0-d249c0115dd5"
PAPERCLIP_URL="http://localhost:3100"

echo "正在触发董秘生成日报..."
curl -s -X POST "${PAPERCLIP_URL}/api/agents/${SECRETARY_AGENT_ID}/heartbeat/invoke" \
  -H "Content-Type: application/json" \
  -d '{"source": "manual-daily-report"}'
echo ""
echo "已触发，请等待 Telegram 推送。"
