#!/bin/bash
# ========================================
# BitWorld 服务守护脚本
# 由 crontab 每 5 分钟调用
# 检测服务是否存活，异常时自动重启并通过 TG 通知
# ========================================

# 显式设置环境变量（cron 环境极其精简）
export HOME="/Users/hans.pan"
export TZ="Asia/Shanghai"
export NVM_DIR="$HOME/.nvm"
export PATH="$HOME/.nvm/versions/node/v22.22.1/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"
[ -s "$NVM_DIR/nvm.sh" ] && source "$NVM_DIR/nvm.sh" 2>/dev/null

cd /Users/hans.pan/paperclip || exit 1

LOG="logs/watchdog.log"
NOW=$(date '+%Y-%m-%d %H:%M:%S')

# 检查 Paperclip 服务是否存活
if curl -s --max-time 5 http://localhost:3100/api/health > /dev/null 2>&1; then
    # 服务正常，静默退出（不写日志，避免膨胀）
    exit 0
fi

# === 服务异常，开始重启 ===
echo "[$NOW] ⚠️ 服务无响应，正在重启..." >> "$LOG"

# 先停掉残留进程
bash scripts/stop.sh >> "$LOG" 2>&1
sleep 3

# 重新启动
bash scripts/start.sh >> "$LOG" 2>&1
RESULT=$?

if [ $RESULT -eq 0 ]; then
    echo "[$NOW] ✅ 重启完成" >> "$LOG"
else
    echo "[$NOW] ❌ 重启失败 (exit code: $RESULT)" >> "$LOG"
fi

# 通过 TG 通知董事长
BOT_TOKEN="***REMOVED_FROM_PUBLIC_HISTORY***"
CHAT_ID="***REMOVED_FROM_PUBLIC_HISTORY***"
if [ $RESULT -eq 0 ]; then
    MSG="🔄 BitWorld 守护进程检测到服务异常，已自动重启成功 | $NOW"
else
    MSG="🚨 BitWorld 守护进程检测到服务异常，重启失败！请手动检查 | $NOW"
fi
curl -s -X POST "https://api.telegram.org/bot${BOT_TOKEN}/sendMessage" \
    -d chat_id="$CHAT_ID" -d text="$MSG" > /dev/null 2>&1
