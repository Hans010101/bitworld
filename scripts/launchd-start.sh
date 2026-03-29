#!/bin/bash
# ========================================
# BitWorld LaunchAgent 包装脚本
# 由 com.bitworld.startup.plist 调用
# 解决 LaunchAgent 环境变量不完整的问题
# ========================================

# 显式设置完整环境变量
export HOME="/Users/hans.pan"
export TZ="Asia/Shanghai"
export NVM_DIR="$HOME/.nvm"
export PATH="$HOME/.nvm/versions/node/v22.22.1/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"

# 尝试加载 nvm（如果存在）
[ -s "$NVM_DIR/nvm.sh" ] && source "$NVM_DIR/nvm.sh" 2>/dev/null

# 切换到项目目录
cd /Users/hans.pan/bitworld || exit 1

# 带时间戳的日志
LOG="logs/launchd.log"
mkdir -p logs
echo "" >> "$LOG"
echo "========================================" >> "$LOG"
echo "[$(date '+%Y-%m-%d %H:%M:%S')] LaunchAgent 触发启动" >> "$LOG"
echo "PATH=$PATH" >> "$LOG"
echo "node=$(which node 2>/dev/null || echo 'NOT FOUND')" >> "$LOG"
echo "pnpm=$(which pnpm 2>/dev/null || echo 'NOT FOUND')" >> "$LOG"
echo "========================================" >> "$LOG"

# 延迟 15 秒等待网络就绪（开机时网络可能还没连上）
sleep 15

# 执行主启动脚本
exec bash scripts/start.sh >> "$LOG" 2>&1
