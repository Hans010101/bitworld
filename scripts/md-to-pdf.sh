#!/bin/bash
# MD → PDF 转换脚本（支持中文，A4 页面）
INPUT="$1"
OUTPUT="${2:-${INPUT%.md}.pdf}"
STYLE="/Users/hans.pan/paperclip/scripts/pdf-style.css"

if [ ! -f "$INPUT" ]; then
  echo "错误：文件不存在 $INPUT"
  exit 1
fi

md-to-pdf "$INPUT" \
  --pdf-options '{"format":"A4","margin":{"top":"20mm","bottom":"20mm","left":"15mm","right":"15mm"}}' \
  --stylesheet "$STYLE" \
  2>/dev/null

# md-to-pdf outputs to same dir with .pdf extension by default
DEFAULT_OUT="${INPUT%.md}.pdf"
if [ "$OUTPUT" != "$DEFAULT_OUT" ] && [ -f "$DEFAULT_OUT" ]; then
  mv "$DEFAULT_OUT" "$OUTPUT"
fi

if [ -f "$OUTPUT" ]; then
  echo "✅ PDF 已生成：$OUTPUT"
else
  echo "❌ PDF 生成失败"
  exit 1
fi
