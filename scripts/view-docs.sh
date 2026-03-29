#!/usr/bin/env bash
# ─────────────────────────────────────────────
# BitWord 文档查阅工具
# 用法: ./scripts/view-docs.sh [选项]
# ─────────────────────────────────────────────

set -euo pipefail

WORKSPACE="/Users/hans.pan/bitword-workspace"
INDEX="/Users/hans.pan/bitworld/docs/INDEX.md"

# 颜色
CYAN='\033[0;36m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BOLD='\033[1m'
RESET='\033[0m'

usage() {
  cat <<'EOF'
BitWord 文档查阅工具

用法:
  view-docs.sh                       列出所有文档
  view-docs.sh -a <agent>            按 Agent 筛选 (luna|marco|sage|nova|echo|pixel)
  view-docs.sh -m <module>           按模块搜索 (marketing|content|tech|sentiment|ops)
  view-docs.sh -r <文件名关键词>     阅读指定文档 (模糊匹配)
  view-docs.sh -s <关键词>           全文搜索
  view-docs.sh -i                    显示文档索引 (INDEX.md)
  view-docs.sh -h                    显示帮助

示例:
  view-docs.sh -a echo               查看 Echo 的所有文档
  view-docs.sh -r tron               阅读包含 "tron" 的文档
  view-docs.sh -s "稳定币"           在所有文档中搜索 "稳定币"
  view-docs.sh -m content            查看内容生产相关文档
EOF
}

list_all() {
  echo -e "${BOLD}📚 BitWord 文档列表${RESET}"
  echo "─────────────────────────────────────────────────"
  local count=0
  while IFS= read -r file; do
    local agent=$(echo "$file" | sed "s|$WORKSPACE/||" | cut -d'/' -f1)
    local relpath=$(echo "$file" | sed "s|$WORKSPACE/||")
    local size=$(du -h "$file" | cut -f1 | xargs)
    printf "${CYAN}%-8s${RESET} ${GREEN}%-6s${RESET} %s\n" "[$agent]" "$size" "$relpath"
    ((count++))
  done < <(find "$WORKSPACE" -name "*.md" -type f | sort)
  echo "─────────────────────────────────────────────────"
  echo -e "共 ${BOLD}${count}${RESET} 篇文档"
}

filter_agent() {
  local agent="$1"
  local dir="$WORKSPACE/$agent"
  if [[ ! -d "$dir" ]]; then
    echo "❌ Agent '$agent' 不存在。可选: luna marco sage nova echo pixel"
    exit 1
  fi
  echo -e "${BOLD}📂 Agent: $agent${RESET}"
  echo "─────────────────────────────────────────────────"
  local count=0
  while IFS= read -r file; do
    local relpath=$(echo "$file" | sed "s|$WORKSPACE/$agent/||")
    local size=$(du -h "$file" | cut -f1 | xargs)
    local lines=$(wc -l < "$file" | xargs)
    printf "  ${GREEN}%-6s${RESET} ${YELLOW}%4s 行${RESET}  %s\n" "$size" "$lines" "$relpath"
    ((count++))
  done < <(find "$dir" -name "*.md" -type f | sort)
  echo "─────────────────────────────────────────────────"
  echo -e "共 ${BOLD}${count}${RESET} 篇文档"
}

filter_module() {
  local module="$1"
  local patterns=""
  case "$module" in
    marketing|品牌|营销)   patterns="marco" ;;
    content|内容)          patterns="sage pixel" ;;
    tech|技术)             patterns="nova" ;;
    sentiment|舆情)        patterns="echo" ;;
    ops|运营)              patterns="luna" ;;
    *)
      echo "❌ 未知模块: $module"
      echo "可选: marketing(品牌营销) content(内容生产) tech(技术) sentiment(舆情) ops(运营)"
      exit 1
      ;;
  esac
  echo -e "${BOLD}📁 模块: $module${RESET}"
  echo "─────────────────────────────────────────────────"
  for agent in $patterns; do
    filter_agent "$agent"
  done
}

read_doc() {
  local keyword="$1"
  local matches
  matches=$(find "$WORKSPACE" -name "*.md" -type f | grep -i "$keyword" || true)
  local count=$(echo "$matches" | grep -c . 2>/dev/null || echo 0)

  if [[ "$count" -eq 0 || -z "$matches" ]]; then
    echo "❌ 未找到包含 '$keyword' 的文档"
    exit 1
  elif [[ "$count" -eq 1 ]]; then
    local file="$matches"
    local relpath=$(echo "$file" | sed "s|$WORKSPACE/||")
    echo -e "${BOLD}📄 $relpath${RESET}"
    echo "═══════════════════════════════════════════════════"
    cat "$file"
  else
    echo -e "${BOLD}找到 ${count} 个匹配文档:${RESET}"
    local i=1
    while IFS= read -r file; do
      local relpath=$(echo "$file" | sed "s|$WORKSPACE/||")
      echo "  [$i] $relpath"
      ((i++))
    done <<< "$matches"
    echo ""
    read -p "请输入序号查看 (1-${count}): " choice
    local target=$(echo "$matches" | sed -n "${choice}p")
    if [[ -n "$target" ]]; then
      local relpath=$(echo "$target" | sed "s|$WORKSPACE/||")
      echo -e "\n${BOLD}📄 $relpath${RESET}"
      echo "═══════════════════════════════════════════════════"
      cat "$target"
    fi
  fi
}

search_content() {
  local keyword="$1"
  echo -e "${BOLD}🔍 搜索: \"$keyword\"${RESET}"
  echo "─────────────────────────────────────────────────"
  local found=0
  while IFS= read -r file; do
    local relpath=$(echo "$file" | sed "s|$WORKSPACE/||")
    local hits=$(grep -c "$keyword" "$file" 2>/dev/null || echo 0)
    if [[ "$hits" -gt 0 ]]; then
      echo -e "\n${CYAN}📄 $relpath${RESET} (${hits} 处匹配)"
      grep -n --color=always "$keyword" "$file" | head -5
      if [[ "$hits" -gt 5 ]]; then
        echo "  ... 还有 $((hits - 5)) 处匹配"
      fi
      ((found++))
    fi
  done < <(find "$WORKSPACE" -name "*.md" -type f | sort)
  echo ""
  echo "─────────────────────────────────────────────────"
  echo -e "在 ${BOLD}${found}${RESET} 篇文档中找到匹配"
}

show_index() {
  if [[ -f "$INDEX" ]]; then
    cat "$INDEX"
  else
    echo "❌ 索引文件不存在: $INDEX"
    exit 1
  fi
}

# ─── 主逻辑 ───
if [[ $# -eq 0 ]]; then
  list_all
  exit 0
fi

while getopts "a:m:r:s:ih" opt; do
  case $opt in
    a) filter_agent "$OPTARG" ;;
    m) filter_module "$OPTARG" ;;
    r) read_doc "$OPTARG" ;;
    s) search_content "$OPTARG" ;;
    i) show_index ;;
    h) usage ;;
    *) usage; exit 1 ;;
  esac
done
