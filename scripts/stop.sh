#!/bin/bash
# ========================================
# BitWorld 集团 - 停止脚本
# 用法: bash scripts/stop.sh
# ========================================

cd /Users/hans.pan/paperclip

BOT_TOKEN="***REMOVED_FROM_PUBLIC_HISTORY***"
CHAT_ID="***REMOVED_FROM_PUBLIC_HISTORY***"
PIDS_FILE="logs/pids.txt"
TIMESTAMP=$(date '+%Y-%m-%d %H:%M:%S')

echo "========================================"
echo " BitWorld 集团系统停止中..."
echo "========================================"

# 停止 TG Bot
echo "[1/3] 停止 Telegram Bot..."
pkill -f "telegram-bot.mjs" 2>/dev/null && echo "  ✅ Bot 已停止" || echo "  ⚠️ Bot 未运行"

# 停止 Paperclip 服务器
echo "[2/3] 停止 Paperclip 服务器..."
pkill -f "pnpm dev" 2>/dev/null || true
pkill -f "tsx watch.*src/index.ts" 2>/dev/null || true

# 从 PID 文件清理
if [ -f "$PIDS_FILE" ]; then
  while read -r pid; do
    kill "$pid" 2>/dev/null || true
  done < "$PIDS_FILE"
  rm -f "$PIDS_FILE"
fi

sleep 2

# 验证
if lsof -i :3100 -sTCP:LISTEN > /dev/null 2>&1; then
  echo "  ⚠️ 端口 3100 仍被占用，强制清理..."
  lsof -ti :3100 | xargs kill -9 2>/dev/null || true
fi

echo "  ✅ 服务器已停止"

# TG 停止通知
echo "[3/3] 发送停止通知..."
curl -s -X POST "https://api.telegram.org/bot${BOT_TOKEN}/sendMessage" \
  -H "Content-Type: application/json" \
  -d "{\"chat_id\": \"${CHAT_ID}\", \"text\": \"🔴 BitWorld 系统已停止 | ${TIMESTAMP}\"}" > /dev/null 2>&1 || true

echo ""
echo "========================================"
echo " BitWorld 集团系统已停止 🔴"
echo "========================================"
echo " 时间: $TIMESTAMP"
echo "========================================"
