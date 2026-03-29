#!/bin/bash
# BitWorld 自动清理脚本 — 删除超过 30 天的产出文件
export TZ='Asia/Shanghai'
OUTPUT_DIR="/Users/hans.pan/bitworld-output"
DAYS=30
LOG_FILE="/tmp/bitworld-cleanup.log"

echo "$(date '+%Y-%m-%d %H:%M:%S') [清理开始] 清理 $DAYS 天前的文件" >> "$LOG_FILE"

# 统计待清理文件数
MD_COUNT=$(find "$OUTPUT_DIR" -name "*.md" -type f -mtime +$DAYS 2>/dev/null | wc -l | tr -d ' ')
PDF_COUNT=$(find "$OUTPUT_DIR" -name "*.pdf" -type f -mtime +$DAYS 2>/dev/null | wc -l | tr -d ' ')
echo "$(date '+%Y-%m-%d %H:%M:%S') 待清理: $MD_COUNT 个 .md 文件, $PDF_COUNT 个 .pdf 文件" >> "$LOG_FILE"

# 删除超过 30 天的 .md 文件
find "$OUTPUT_DIR" -name "*.md" -type f -mtime +$DAYS -delete 2>/dev/null

# 删除超过 30 天的 .pdf 文件
find "$OUTPUT_DIR" -name "*.pdf" -type f -mtime +$DAYS -delete 2>/dev/null

# 删除超过 30 天的空文件夹（从最深层开始）
find "$OUTPUT_DIR" -mindepth 2 -type d -empty -mtime +$DAYS -delete 2>/dev/null

# 删除超过 30 天的日期文件夹（格式 YYYY-MM-DD，且为空）
find "$OUTPUT_DIR" -maxdepth 1 -type d -name "20*" -empty -delete 2>/dev/null

# 统计清理后状态
REMAINING=$(find "$OUTPUT_DIR" -type f \( -name "*.md" -o -name "*.pdf" \) 2>/dev/null | wc -l | tr -d ' ')
echo "$(date '+%Y-%m-%d %H:%M:%S') [清理完成] 已删除 md:$MD_COUNT pdf:$PDF_COUNT，剩余文件: $REMAINING" >> "$LOG_FILE"
