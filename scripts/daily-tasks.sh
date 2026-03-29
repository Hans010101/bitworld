#!/bin/bash
# BitWorld 每日定时任务脚本
# 用法: daily-tasks.sh [news-morning|tech-morning|crypto-morning|news-evening|tech-evening|crypto-evening|justin-sentiment|sentiment|research|cho|cfo|all-morning|all-evening|all]
export TZ='Asia/Shanghai'

API="http://localhost:3100"
COMPANY_ID="576ff49b-f9d7-4539-a718-59ff1654ef46"
DATE=$(date +%Y-%m-%d)

# Agent IDs
NEWS_CEO="5a77cd8d-eba3-4813-9ced-e7f5408d8527"
CRYPTO_CEO="49ff2bdf-7f51-4be0-8c3a-09c044eef244"
SENTIMENT_CEO="88bee088-cf53-4394-ad08-9b4647456dd5"
RESEARCH_CEO="49b9e34a-1704-43d2-935b-40e923650c24"
CHO="8d8c2a99-7fc8-4172-ba4d-8c5b08cace87"
CFO="0a77ab78-5686-49fc-9364-df9c5bb5f0d3"
SECRETARY="44115df3-6109-4616-99d0-d249c0115dd5"

create_issue() {
  local AGENT_ID="$1"
  local TITLE="$2"
  local DESC="$3"
  local PRIORITY="${4:-high}"

  echo "[$(date +%H:%M:%S)] 创建任务: $TITLE"
  RESULT=$(curl -s -X POST "$API/api/companies/$COMPANY_ID/issues" \
    -H "Content-Type: application/json" \
    -d "{
      \"title\": \"$TITLE\",
      \"description\": \"$DESC\",
      \"assigneeAgentId\": \"$AGENT_ID\",
      \"priority\": \"$PRIORITY\",
      \"status\": \"todo\"
    }")

  ISSUE_ID=$(echo "$RESULT" | python3 -c "import sys,json; print(json.load(sys.stdin).get('identifier','FAIL'))" 2>/dev/null)
  echo "[$(date +%H:%M:%S)] ✅ 已创建: $ISSUE_ID"
}

# ========== 早报（每天 8:00 AM）==========

task_news_morning() {
  create_issue "$NEWS_CEO" \
    "[早报] ${DATE} 全球热点新闻日报" \
    "整理过去24小时全球热点新闻，分为以下类别，每类5-10条，清单体，阐述核心要点：\n1. 经济类（全球经济、金融市场、大宗商品）\n2. 政治类（国际关系、政策变化、选举动态）\n3. 军事类（冲突局势、军事行动、安全事件）\n4. 各平台热搜榜（微博热搜、抖音热榜、百度热搜、X/Twitter趋势）\n不必把来龙去脉讲透，聚焦核心要点即可。篇幅下限2000字。不需要免责声明等形式内容。"
}

task_tech_morning() {
  create_issue "$NEWS_CEO" \
    "[早报] ${DATE} 科技领域日报" \
    "整理过去24小时科技领域重要动态，清单体，每条附简要技术说明分析：\n1. AI 领域（模型发布、应用落地、行业动态、融资）\n2. 新产品与硬件（手机、电脑、芯片、消费电子）\n3. 互联网与软件（平台政策、产品更新、并购）\n4. 前沿科技（量子计算、生物科技、航天、新能源）\n篇幅下限2000字。不需要免责声明等形式内容。"
}

task_crypto_morning() {
  create_issue "$CRYPTO_CEO" \
    "[早报] ${DATE} 加密货币日报" \
    "整理过去24小时加密货币领域全面数据：\n1. 行业大事件（监管政策、交易所动态、项目进展）\n2. 涨幅榜 Top 20（币种、价格、24h涨幅%）\n3. 跌幅榜 Top 20（币种、价格、24h跌幅%）\n4. 主流币种价格变化（BTC/ETH/SOL/BNB/XRP/ADA/DOGE 等）\n5. 市场关键指标（总市值、24h成交量、恐慌贪婪指数、BTC占比）\n6. 合约数据（全网持仓量、24h爆仓金额、资金费率）\n7. 链上数据（BTC活跃地址、ETH Gas费、稳定币流入流出）\n篇幅下限2000字。不需要免责声明等形式内容。"
}

# ========== 晚报（每天 9:00 PM）==========

task_news_evening() {
  create_issue "$NEWS_CEO" \
    "[晚报] ${DATE} 全球热点新闻晚报" \
    "整理今天白天（早报之后）的最新新闻，与早报内容不得重叠。聚焦当天新发生的事件，清单体，精炼信息。篇幅下限1000字。不需要免责声明。"
}

task_tech_evening() {
  create_issue "$NEWS_CEO" \
    "[晚报] ${DATE} 科技领域晚报" \
    "整理今天白天（早报之后）的最新科技动态，与早报内容不得重叠。聚焦当天新发生的事件。篇幅下限1000字。不需要免责声明。"
}

task_crypto_evening() {
  create_issue "$CRYPTO_CEO" \
    "[晚报] ${DATE} 加密货币晚报" \
    "整理今天白天（早报之后）的最新加密货币动态和最新数据，与早报不得重叠。更新最新的涨跌幅榜、关键指标。篇幅下限1000字。不需要免责声明。"
}

# ========== 孙宇晨舆情（每天 7:00 PM）==========

task_justin_sentiment() {
  create_issue "$SENTIMENT_CEO" \
    "[舆情日报] ${DATE} 孙宇晨舆情简报" \
    "站在舆情角度整理过去24小时内波场创始人孙宇晨（Justin Sun）的舆情动态：\n1. 全球主流媒体报道（Bloomberg、Reuters、CoinDesk、The Block 等）\n2. 中文媒体报道（财新、第一财经、金色财经、律动等）\n3. X/Twitter 平台讨论热度和关键观点\n4. 小红书平台相关内容\n5. 微博平台讨论\n6. Reddit/Telegram 社区讨论\n7. 舆情情感分析（正面/中性/负面占比）\n8. 关键风险提示（如有负面舆情需重点标注）\n注意：必须是24小时内的新内容，不要堆砌老新闻。篇幅下限2000字。不需要免责声明。"
}

# ========== 周报 ==========

task_sentiment() {
  create_issue "$SENTIMENT_CEO" \
    "[周报] ${DATE} 品牌舆情周报" \
    "采集过去一周与 BitWorld 集团相关的社媒讨论、行业舆情、品牌提及，分析舆情趋势和潜在风险，生成舆情周报，通过 Telegram 回报董事长。篇幅下限4000字。不需要免责声明。"
}

task_research() {
  create_issue "$RESEARCH_CEO" \
    "[周报] ${DATE} 行业研究周报" \
    "研究并整理过去一周加密货币、AI、金融科技三大领域的重要趋势和事件，生成行业研究周报，通过 Telegram 回报董事长。篇幅下限4000字。不需要免责声明。"
}

task_cho() {
  create_issue "$CHO" \
    "[周报] ${DATE} 集团人力效能周报" \
    "统计本周全部 Agent 的工作量、活跃度、完成事项数，分析人力效能趋势，给出优化建议，通过 Telegram 回报董事长。"
}

task_cfo() {
  create_issue "$CFO" \
    "[周报] ${DATE} 集团成本效益周报" \
    "统计本周 Token 消耗、任务成本效益比、异常消耗检测，分析成本趋势，给出降本增效建议，通过 Telegram 回报董事长。"
}

# ========== GitHub + AI 周刊（周五）==========

task_github_ai() {
  create_issue "$NEWS_CEO" \
    "[周报] ${DATE} GitHub 热门项目 + AI 周刊" \
    "整理本周 GitHub 热门新项目和 AI 领域大事件：\n\n第一部分：本周概要\n3-5句话总结本周 GitHub 趋势和 AI 领域最重要的事\n\n第二部分：GitHub 热门项目清单\n搜索本周 GitHub Trending，筛选 10-15 个值得关注的新项目或快速增长项目，每个项目格式：\n- 项目名（语言）⭐ star数 | 本周新增 star\n  一句话说明：这个项目是做什么的\n  亮点：为什么值得关注\n  链接：https://github.com/...\n重点关注类别：AI/LLM工具、开发者效率工具、Web3/加密、新框架\n\n第三部分：AI 领域大事件\n整理本周 AI 领域 5-10 个重要事件，清单体\n\n第四部分：趋势观察\n3-5句话总结本周技术趋势走向和下周关注点\n\n篇幅 2000-3500 字。不需要免责声明。"
}

# ========== 董秘日报 ==========

task_secretary() {
  curl -s -X POST "$API/api/agents/$SECRETARY/heartbeat/invoke" \
    -H "Content-Type: application/json" \
    -d '{"source": "cron-daily-report"}' > /dev/null
  echo "[$(date +%H:%M:%S)] ✅ 董秘日报已触发"
}

# ========== 命令路由 ==========

case "${1:-help}" in
  news-morning)      task_news_morning ;;
  tech-morning)      task_tech_morning ;;
  crypto-morning)    task_crypto_morning ;;
  news-evening)      task_news_evening ;;
  tech-evening)      task_tech_evening ;;
  crypto-evening)    task_crypto_evening ;;
  justin-sentiment)  task_justin_sentiment ;;
  sentiment)         task_sentiment ;;
  research)          task_research ;;
  cho)               task_cho ;;
  cfo)               task_cfo ;;
  github-ai)         task_github_ai ;;
  secretary)         task_secretary ;;
  all-morning)
    task_news_morning
    sleep 5
    task_tech_morning
    sleep 5
    task_crypto_morning
    ;;
  all-evening)
    task_news_evening
    sleep 5
    task_tech_evening
    sleep 5
    task_crypto_evening
    ;;
  all)
    task_news_morning
    task_tech_morning
    task_crypto_morning
    task_justin_sentiment
    task_sentiment
    task_research
    task_cho
    task_cfo
    ;;
  *)
    echo "BitWorld 定时任务脚本"
    echo "用法: $0 <command>"
    echo ""
    echo "早报（每天 8:00）:"
    echo "  news-morning      全球热点新闻日报"
    echo "  tech-morning      科技领域日报"
    echo "  crypto-morning    加密货币日报"
    echo "  all-morning       触发全部3个早报"
    echo ""
    echo "晚报（每天 21:00）:"
    echo "  news-evening      全球新闻晚报"
    echo "  tech-evening      科技领域晚报"
    echo "  crypto-evening    加密货币晚报"
    echo "  all-evening       触发全部3个晚报"
    echo ""
    echo "舆情（每天 19:00）:"
    echo "  justin-sentiment  孙宇晨舆情日报"
    echo ""
    echo "周报（周一/周五）:"
    echo "  sentiment         品牌舆情周报"
    echo "  research          行业研究周报"
    echo "  cho               人力效能周报"
    echo "  cfo               成本效益周报"
    echo ""
    echo "其他:"
    echo "  secretary         触发董秘日报"
    echo "  all               触发全部任务"
    exit 1
    ;;
esac

echo "[$(date +%H:%M:%S)] 定时任务完成"
