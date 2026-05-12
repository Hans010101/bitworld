# BitWorld GitHub Actions Diagnose Workflow

## 一次性配置(Hans 做,约 30 分钟)

### 1. 创建 GCP Service Account

```bash
gcloud iam service-accounts create claude-automation \
  --display-name="Claude Code Automation" \
  --project=bitworld-491702
```

### 2. 授权(只读)

```bash
SA_EMAIL="claude-automation@bitworld-491702.iam.gserviceaccount.com"

gcloud projects add-iam-policy-binding bitworld-491702 \
  --member="serviceAccount:$SA_EMAIL" \
  --role="roles/logging.viewer"

gcloud projects add-iam-policy-binding bitworld-491702 \
  --member="serviceAccount:$SA_EMAIL" \
  --role="roles/run.viewer"

gcloud projects add-iam-policy-binding bitworld-491702 \
  --member="serviceAccount:$SA_EMAIL" \
  --role="roles/cloudbuild.builds.viewer"
```

### 3. 下载 SA Key

```bash
gcloud iam service-accounts keys create ~/claude-sa-key.json \
  --iam-account=$SA_EMAIL
```

### 4. 把 JSON 内容存到 GitHub Secrets

打开:https://github.com/Hans010101/bitworld/settings/secrets/actions

点 **New repository secret**:
- Name: `GCP_SA_KEY`
- Value: `cat ~/claude-sa-key.json` 复制粘贴整个 JSON 内容

### 5. 清理本地 JSON(安全)

```bash
rm ~/claude-sa-key.json
```

## Code 通过 GitHub API 触发

```bash
# Code 在 Web 沙箱用 GitHub PAT(已有)触发 workflow
GH_TOKEN=$GITHUB_TOKEN gh workflow run diagnose-cloud-run.yml \
  --repo Hans010101/bitworld \
  -f revision=latest \
  -f severity=ANY \
  -f hours=1

# 等 1-2 分钟 workflow 跑完
gh run list --repo Hans010101/bitworld --workflow=diagnose-cloud-run.yml --limit=1

# 下载 artifact
RUN_ID=$(gh run list --repo Hans010101/bitworld --workflow=diagnose-cloud-run.yml --limit=1 --json databaseId --jq '.[0].databaseId')
gh run download $RUN_ID --repo Hans010101/bitworld --dir /tmp/diagnose-output

# 分析 /tmp/diagnose-output/cloud-run-diagnose-*/cloud-run-logs.json
```

## 后续 Hans 0 操作

任何 Cloud Run / Cloud Build 诊断需求,Code 自动:
1. 触发 workflow_dispatch
2. 等 ~1-2 分钟
3. 拉 artifact
4. 分析 logs JSON
5. 出修补长指令
