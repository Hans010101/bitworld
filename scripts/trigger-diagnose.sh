#!/bin/bash
# Code 用此脚本通过 GitHub API 触发 diagnose workflow + 拉 artifact
# Hans 不需要跑此脚本,Code 自动调用

set -e

REVISION="${1:-latest}"
SEVERITY="${2:-ANY}"
HOURS="${3:-1}"

REPO="Hans010101/bitworld"
WORKFLOW="diagnose-cloud-run.yml"

echo "Triggering diagnose workflow: revision=$REVISION severity=$SEVERITY hours=$HOURS"

# 触发 workflow
gh workflow run "$WORKFLOW" \
  --repo "$REPO" \
  -f revision="$REVISION" \
  -f severity="$SEVERITY" \
  -f hours="$HOURS"

# 等 workflow 启动(GitHub Actions 启动延迟约 10-30s)
echo "Waiting for workflow to start..."
sleep 20

# 拿最新 run ID
RUN_ID=$(gh run list --repo "$REPO" --workflow="$WORKFLOW" --limit=1 --json databaseId --jq '.[0].databaseId')
echo "Run ID: $RUN_ID"

# 等 workflow 完成(最多 5 分钟)
gh run watch "$RUN_ID" --repo "$REPO" --exit-status

# 下载 artifact
OUTPUT_DIR="/tmp/diagnose-$RUN_ID"
mkdir -p "$OUTPUT_DIR"
gh run download "$RUN_ID" --repo "$REPO" --dir "$OUTPUT_DIR"

echo ""
echo "✅ Artifact downloaded to: $OUTPUT_DIR"
ls -lh "$OUTPUT_DIR"/*/
