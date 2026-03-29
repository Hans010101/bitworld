#!/bin/bash
# 创建当天所有 Agent 的输出文件夹
export TZ='Asia/Shanghai'
DATE=$(date +%Y-%m-%d)
BASE="/Users/hans.pan/bitworld-output/$DATE"

# 防重复
if [ -d "$BASE/总部-CEO" ]; then
  echo "$DATE 文件夹已存在，跳过"
  exit 0
fi

# 总部
mkdir -p "$BASE/总部-CEO"
mkdir -p "$BASE/总部-CTO"
mkdir -p "$BASE/总部-董秘"

# 市场研究
mkdir -p "$BASE/研究-CEO"
mkdir -p "$BASE/研究-主编"
mkdir -p "$BASE/研究-写手"
mkdir -p "$BASE/研究-数据"

# 舆情应对
mkdir -p "$BASE/舆情-CEO"
mkdir -p "$BASE/舆情-分析师"
mkdir -p "$BASE/舆情-采集"
mkdir -p "$BASE/舆情-报告"

# 加密交易
mkdir -p "$BASE/加密-CEO"
mkdir -p "$BASE/加密-策略"
mkdir -p "$BASE/加密-风控"
mkdir -p "$BASE/加密-开发"
mkdir -p "$BASE/加密-数据"

# 新闻雷达
mkdir -p "$BASE/新闻-CEO"
mkdir -p "$BASE/新闻-采集"
mkdir -p "$BASE/新闻-分析"
mkdir -p "$BASE/新闻-编译"
mkdir -p "$BASE/新闻-简报"

echo "✅ 已创建 $DATE 的 21 个 Agent 输出文件夹"
