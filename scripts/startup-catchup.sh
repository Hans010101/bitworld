#!/bin/bash
# BitWorld 启动补发脚本
# 功能：系统启动后检查今天哪些定时任务未执行，自动补发
export TZ='Asia/Shanghai'

LOG="/tmp/bitworld-startup.log"
TODAY=$(date +%Y-%m-%d)
NOW_HOUR=$(date +%H)
NOW_MIN=$(date +%M)
NOW_MINUTES=$((10#$NOW_HOUR * 60 + 10#$NOW_MIN))
API_URL="http://localhost:3100"

echo "$(date) [启动补发] 开始检查，当前时间 $NOW_HOUR:$NOW_MIN" >> "$LOG"

# 等待服务器就绪
for i in $(seq 1 30); do
  if curl -s "$API_URL/api/health" | grep -q "ok"; then
    echo "$(date) [启动补发] 服务器已就绪" >> "$LOG"
    break
  fi
  echo "$(date) [启动补发] 等待服务器启动... ($i/30)" >> "$LOG"
  sleep 10
done

if ! curl -s "$API_URL/api/health" | grep -q "ok"; then
  echo "$(date) [启动补发] 服务器未启动，退出" >> "$LOG"
  exit 1
fi

# 确保 Bot 在运行
if ! pgrep -f telegram-bot.mjs > /dev/null; then
  echo "$(date) [启动补发] Bot 未运行，启动中..." >> "$LOG"
  cd /Users/hans.pan/bitworld && nohup node scripts/telegram-bot.mjs > /tmp/bot.log 2>&1 &
  sleep 5
fi

# 定义今天的任务时间表：计划时间(分钟) 任务命令 频率(daily/monday/friday)
TASKS=(
  "480 news-morning daily"
  "485 tech-morning daily"
  "490 crypto-morning daily"
  "1140 justin-sentiment daily"
  "1260 news-evening daily"
  "1265 tech-evening daily"
  "1270 crypto-evening daily"
  "1275 secretary daily"
  "540 sentiment monday"
  "570 research monday"
  "1020 github-ai friday"
  "1035 cho friday"
  "1050 cfo friday"
)

DAY_OF_WEEK=$(date +%u)  # 1=周一, 5=周五
SCRIPT_PATH="/Users/hans.pan/bitworld/scripts/daily-tasks.sh"

# 获取今天已执行的任务（通过查询今日创建的 issue 标题）
COMPANY_ID="576ff49b-f9d7-4539-a718-59ff1654ef46"
TODAYS_ISSUES=$(curl -s "$API_URL/api/companies/$COMPANY_ID/issues" | python3 -c "
import json, sys
issues = json.load(sys.stdin)
today = '$TODAY'
for i in issues:
    created = i.get('createdAt', '')
    if today in created:
        print(i.get('title', ''))
" 2>/dev/null)

echo "$(date) [启动补发] 今日已有事项：" >> "$LOG"
echo "$TODAYS_ISSUES" >> "$LOG"

CATCH_UP_COUNT=0
CATCH_UP_DELAY=0

for task_line in "${TASKS[@]}"; do
  TASK_TIME=$(echo "$task_line" | awk '{print $1}')
  TASK_CMD=$(echo "$task_line" | awk '{print $2}')
  TASK_FREQ=$(echo "$task_line" | awk '{print $3}')

  # 检查频率是否匹配今天
  SHOULD_RUN=false
  case "$TASK_FREQ" in
    daily) SHOULD_RUN=true ;;
    monday) [ "$DAY_OF_WEEK" = "1" ] && SHOULD_RUN=true ;;
    friday) [ "$DAY_OF_WEEK" = "5" ] && SHOULD_RUN=true ;;
  esac

  if [ "$SHOULD_RUN" = "false" ]; then
    continue
  fi

  # 检查是否已过了计划时间
  if [ "$NOW_MINUTES" -lt "$TASK_TIME" ]; then
    echo "$(date) [启动补发] $TASK_CMD 计划时间未到（${TASK_TIME}min），跳过" >> "$LOG"
    continue
  fi

  # 检查今天是否已执行
  ALREADY_DONE=false
  case "$TASK_CMD" in
    news-morning)     echo "$TODAYS_ISSUES" | grep -q "新闻.*早报\|全球.*热点.*早报\|新闻日报" && ALREADY_DONE=true ;;
    tech-morning)     echo "$TODAYS_ISSUES" | grep -q "科技.*早报\|科技领域日报" && ALREADY_DONE=true ;;
    crypto-morning)   echo "$TODAYS_ISSUES" | grep -q "加密.*早报\|加密货币.*日报" && ALREADY_DONE=true ;;
    justin-sentiment) echo "$TODAYS_ISSUES" | grep -q "孙宇晨\|舆情日报" && ALREADY_DONE=true ;;
    news-evening)     echo "$TODAYS_ISSUES" | grep -q "新闻.*晚报\|全球.*晚报" && ALREADY_DONE=true ;;
    tech-evening)     echo "$TODAYS_ISSUES" | grep -q "科技.*晚报" && ALREADY_DONE=true ;;
    crypto-evening)   echo "$TODAYS_ISSUES" | grep -q "加密.*晚报" && ALREADY_DONE=true ;;
    secretary)        echo "$TODAYS_ISSUES" | grep -q "董秘\|日报汇总" && ALREADY_DONE=true ;;
    sentiment)        echo "$TODAYS_ISSUES" | grep -q "舆情.*周报\|品牌舆情" && ALREADY_DONE=true ;;
    research)         echo "$TODAYS_ISSUES" | grep -q "研究.*周报\|行业研究" && ALREADY_DONE=true ;;
    cho)              echo "$TODAYS_ISSUES" | grep -q "人力.*效能\|CHO" && ALREADY_DONE=true ;;
    cfo)              echo "$TODAYS_ISSUES" | grep -q "成本.*效益\|CFO" && ALREADY_DONE=true ;;
    github-ai)        echo "$TODAYS_ISSUES" | grep -q "GitHub\|github\|AI.*周刊" && ALREADY_DONE=true ;;
  esac

  if [ "$ALREADY_DONE" = "true" ]; then
    echo "$(date) [启动补发] $TASK_CMD 今日已执行，跳过" >> "$LOG"
    continue
  fi

  # 补发任务（间隔 30 秒执行）
  DELAY=$((CATCH_UP_DELAY * 30))
  echo "$(date) [启动补发] ${DELAY}秒后补发 $TASK_CMD" >> "$LOG"
  (sleep $DELAY && bash "$SCRIPT_PATH" "$TASK_CMD" >> "$LOG" 2>&1) &

  CATCH_UP_COUNT=$((CATCH_UP_COUNT + 1))
  CATCH_UP_DELAY=$((CATCH_UP_DELAY + 1))
done

if [ "$CATCH_UP_COUNT" -gt 0 ]; then
  curl -s -X POST "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage" \
    -H "Content-Type: application/json" \
    -d "{
      \"chat_id\": \"${TELEGRAM_CHAT_ID}\",
      \"text\": \"🔄 BitWorld 启动补发通知\n\n检测到 ${CATCH_UP_COUNT} 个定时任务因系统休眠未执行\n正在按 30 秒间隔依次补发\n预计 $((CATCH_UP_COUNT / 2)) 分钟内完成\"
    }" > /dev/null 2>&1
  echo "$(date) [启动补发] 共补发 $CATCH_UP_COUNT 个任务，已通知董事长" >> "$LOG"
else
  echo "$(date) [启动补发] 无需补发，所有任务已执行或未到时间" >> "$LOG"
fi
