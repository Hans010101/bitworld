#!/bin/bash
# ========================================
# BitWorld 集团 - 状态检查脚本
# 用法: bash scripts/status.sh
# ========================================

cd /Users/hans.pan/paperclip

echo "========================================"
echo " BitWorld 集团系统状态"
echo "========================================"

# 服务器状态
echo ""
echo "── Paperclip 服务器 ──"
HEALTH=$(curl -s http://localhost:3100/api/health 2>/dev/null)
if echo "$HEALTH" | grep -q '"ok"'; then
  echo "  状态: 🟢 运行中"
  echo "  地址: http://localhost:3100"
else
  echo "  状态: 🔴 未运行"
fi

# Bot 状态
echo ""
echo "── Telegram Bot ──"
BOT_PID=$(pgrep -f "telegram-bot.mjs" | head -1)
if [ -n "$BOT_PID" ]; then
  echo "  状态: 🟢 运行中 (PID: $BOT_PID)"
else
  echo "  状态: 🔴 未运行"
fi

# Agent 统计
echo ""
echo "── Agent 统计 ──"
if echo "$HEALTH" | grep -q '"ok"'; then
  node -e "
    fetch('http://localhost:3100/api/companies/576ff49b-f9d7-4539-a718-59ff1654ef46/agents')
      .then(r=>r.json())
      .then(agents => {
        const active = agents.filter(a => a.status !== 'terminated');
        const running = active.filter(a => a.status === 'running');
        const idle = active.filter(a => a.status === 'idle');
        console.log('  总数:   ' + active.length);
        console.log('  运行中: ' + running.length + (running.length > 0 ? ' (' + running.map(a=>a.name).join(', ') + ')' : ''));
        console.log('  空闲:   ' + idle.length);
      });
  " 2>/dev/null
fi

# 今日任务统计
echo ""
echo "── 今日任务统计 ──"
if echo "$HEALTH" | grep -q '"ok"'; then
  node -e "
    const today = new Date().toISOString().split('T')[0];
    fetch('http://localhost:3100/api/companies/576ff49b-f9d7-4539-a718-59ff1654ef46/issues')
      .then(r=>r.json())
      .then(issues => {
        const todayIssues = issues.filter(i => i.createdAt?.startsWith(today));
        const done = todayIssues.filter(i => i.status === 'done').length;
        const inProg = todayIssues.filter(i => i.status === 'in_progress').length;
        const todo = todayIssues.filter(i => i.status === 'todo').length;
        const failed = todayIssues.filter(i => i.status === 'failed').length;
        console.log('  总数:   ' + todayIssues.length);
        console.log('  完成:   ' + done);
        console.log('  进行中: ' + inProg);
        console.log('  待办:   ' + todo);
        if (failed > 0) console.log('  失败:   ' + failed);
      });
  " 2>/dev/null
fi

# 产出文件
echo ""
echo "── 今日产出文件 ──"
TODAY=$(date +%Y-%m-%d)
FILE_COUNT=$(find /Users/hans.pan/bitworld-output/$TODAY/ -name "*.md" -type f 2>/dev/null | wc -l | tr -d ' ')
echo "  .md 文件: $FILE_COUNT 个"

# 定时任务
echo ""
echo "── 定时任务 ──"
CRON_COUNT=$(crontab -l 2>/dev/null | grep -v "^#" | grep -v "^$" | wc -l | tr -d ' ')
echo "  已配置: $CRON_COUNT 个"

echo ""
echo "========================================"
echo " 检查时间: $(date '+%Y-%m-%d %H:%M:%S')"
echo "========================================"
