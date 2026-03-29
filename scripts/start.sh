#!/bin/bash
# ========================================
# BitWorld 集团 - 一键启动脚本
# 用法: bash scripts/start.sh
# ========================================

set -e
export TZ='Asia/Shanghai'
# Ensure node/pnpm are in PATH (needed for LaunchAgent which has minimal PATH)
export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && source "$NVM_DIR/nvm.sh"
export PATH="$HOME/.nvm/versions/node/v22.22.1/bin:/opt/homebrew/bin:/usr/local/bin:$PATH"
cd /Users/hans.pan/bitworld

BOT_TOKEN="***REMOVED_FROM_PUBLIC_HISTORY***"
CHAT_ID="***REMOVED_FROM_PUBLIC_HISTORY***"
LOGS_DIR="logs"
PIDS_FILE="$LOGS_DIR/pids.txt"

mkdir -p "$LOGS_DIR"
> "$PIDS_FILE"

send_tg() {
  curl -s -X POST "https://api.telegram.org/bot${BOT_TOKEN}/sendMessage" \
    -H "Content-Type: application/json" \
    -d "{\"chat_id\": \"${CHAT_ID}\", \"text\": \"$1\"}" > /dev/null 2>&1 || true
}

echo "========================================"
echo " BitWorld 集团系统启动中..."
echo "========================================"

# ── 1. 前置检查 ──
echo "[1/5] 前置检查..."

NODE_VER=$(node -v | sed 's/v//' | cut -d. -f1)
if [ "$NODE_VER" -lt 20 ]; then
  echo "❌ Node.js 版本需要 >= 20（当前: $(node -v)）"
  exit 1
fi
echo "  ✅ Node.js $(node -v)"

if ! command -v pnpm &> /dev/null; then
  echo "❌ pnpm 未安装"
  exit 1
fi
echo "  ✅ pnpm $(pnpm -v)"

if lsof -i :3100 -sTCP:LISTEN > /dev/null 2>&1; then
  echo "  ⚠️ 端口 3100 已被占用"
  EXISTING_PID=$(lsof -ti :3100 | head -1)
  echo "  正在停止现有进程 (PID: $EXISTING_PID)..."
  kill "$EXISTING_PID" 2>/dev/null || true
  sleep 3
fi

# ── 2. 创建每日输出文件夹 ──
echo "[2/5] 创建每日输出文件夹..."
bash scripts/create-daily-folders.sh 2>/dev/null || true

# ── 3. 启动 Paperclip 服务器 ──
echo "[3/5] 启动 Paperclip 服务器..."
nohup pnpm dev > "$LOGS_DIR/server.log" 2>&1 &
SERVER_PID=$!
echo "$SERVER_PID" >> "$PIDS_FILE"
echo "  PID: $SERVER_PID"

# 等待服务器就绪（最多 60 秒）
echo "  等待服务器启动..."
for i in $(seq 1 60); do
  if curl -s http://localhost:3100/api/health | grep -q '"ok"' 2>/dev/null; then
    echo "  ✅ 服务器已就绪（${i}s）"
    break
  fi
  if [ "$i" -eq 60 ]; then
    echo "  ❌ 服务器启动超时（60s）"
    echo "  查看日志: tail -50 $LOGS_DIR/server.log"
    exit 1
  fi
  sleep 1
done

# ── 4. 启动 TG Bot ──
echo "[4/5] 启动 Telegram Bot..."
pkill -f "telegram-bot.mjs" 2>/dev/null || true
sleep 1
nohup node scripts/telegram-bot.mjs > "$LOGS_DIR/telegram-bot.log" 2>&1 &
BOT_PID=$!
echo "$BOT_PID" >> "$PIDS_FILE"
sleep 3

if kill -0 "$BOT_PID" 2>/dev/null; then
  echo "  ✅ Bot 已启动 (PID: $BOT_PID)"
else
  echo "  ❌ Bot 启动失败，查看日志: tail -20 $LOGS_DIR/telegram-bot.log"
fi

# ── 5. 状态面板 ──
echo "[5/5] 采集状态..."
AGENT_COUNT=$(curl -s http://localhost:3100/api/companies/576ff49b-f9d7-4539-a718-59ff1654ef46/agents 2>/dev/null | python3 -c "import sys,json;print(len([a for a in json.load(sys.stdin) if a['status']!='terminated']))" 2>/dev/null || echo "?")
CRON_COUNT=$(crontab -l 2>/dev/null | grep -v "^#" | grep -v "^$" | wc -l | tr -d ' ')
TIMESTAMP=$(date '+%Y-%m-%d %H:%M:%S')

echo ""
echo "========================================"
echo " BitWorld 集团系统已启动 ✅"
echo "========================================"
echo " 时间:          $TIMESTAMP"
echo " Paperclip:     http://localhost:3100"
echo " TG Bot:        运行中 (PID: $BOT_PID)"
echo " Agent 总数:    $AGENT_COUNT"
echo " 定时任务:      $CRON_COUNT 个已加载"
echo "========================================"
echo " 日志目录:      $LOGS_DIR/"
echo " PID 文件:      $PIDS_FILE"
echo "========================================"
echo ""

# TG 启动通知
send_tg "🟢 BitWorld 系统已启动 | $TIMESTAMP | Agent: $AGENT_COUNT | 定时任务: $CRON_COUNT"

# 启动补发检查（后台执行，不阻塞主服务启动）
echo ""
echo "检查是否需要补发定时任务..."
nohup bash /Users/hans.pan/bitworld/scripts/startup-catchup.sh > /dev/null 2>&1 &
