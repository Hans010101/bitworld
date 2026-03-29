#!/bin/bash
# 清理指定天数之前的产出文件
# 用法：./cleanup-output.sh 30  （清理30天前的文件）

DAYS=${1:-30}
OUTPUT_DIR="/Users/hans.pan/bitworld-output"

echo "将清理 ${DAYS} 天前的文件..."

find "$OUTPUT_DIR" -maxdepth 1 -type d -name "20*" | while read dir; do
  dir_date=$(basename "$dir")
  if [[ $(date -j -f "%Y-%m-%d" "$dir_date" +%s 2>/dev/null) ]]; then
    cutoff=$(date -j -v-${DAYS}d +%Y-%m-%d)
    if [[ "$dir_date" < "$cutoff" ]]; then
      echo "删除: $dir"
      rm -rf "$dir"
    fi
  fi
done

echo "清理完成"
