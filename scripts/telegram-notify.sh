#!/bin/bash
BOT_TOKEN="${TELEGRAM_BOT_TOKEN}"
CHAT_ID="${TELEGRAM_CHAT_ID}"
MESSAGE="$1"

# 长消息拆分（Telegram 限制 4096 字符）
while [ ${#MESSAGE} -gt 4000 ]; do
  PART="${MESSAGE:0:4000}"
  curl -s -X POST "https://api.telegram.org/bot${BOT_TOKEN}/sendMessage" \
    -H "Content-Type: application/json" \
    -d "{\"chat_id\": ${CHAT_ID}, \"text\": \"${PART}\", \"parse_mode\": \"Markdown\"}" > /dev/null
  MESSAGE="${MESSAGE:4000}"
  sleep 1
done

curl -s -X POST "https://api.telegram.org/bot${BOT_TOKEN}/sendMessage" \
  -H "Content-Type: application/json" \
  -d "{\"chat_id\": ${CHAT_ID}, \"text\": \"${MESSAGE}\", \"parse_mode\": \"Markdown\"}" > /dev/null
