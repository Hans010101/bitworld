#!/bin/bash
# 通过 Telegram Bot 发送文件
BOT_TOKEN="${TELEGRAM_BOT_TOKEN}"
CHAT_ID="${TELEGRAM_CHAT_ID}"
FILE_PATH="$1"
CAPTION="${2:-}"

if [ ! -f "$FILE_PATH" ]; then
  echo "错误：文件不存在 $FILE_PATH"
  exit 1
fi

curl -s -X POST "https://api.telegram.org/bot${BOT_TOKEN}/sendDocument" \
  -F "chat_id=${CHAT_ID}" \
  -F "document=@${FILE_PATH}" \
  -F "caption=${CAPTION}" \
  -F "parse_mode=Markdown"
