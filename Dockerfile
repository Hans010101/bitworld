# ========================================
# BitWorld Production Dockerfile
# Simplified, reliable build for Cloud Run
# ========================================

FROM node:20-slim AS base
RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates curl git \
  && rm -rf /var/lib/apt/lists/*
RUN corepack enable

# --- Stage 1: Install dependencies ---
FROM base AS deps
WORKDIR /app

# Copy ALL package.json files for workspace resolution
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml .npmrc ./
COPY server/package.json server/
COPY ui/package.json ui/
COPY cli/package.json cli/
COPY packages/shared/package.json packages/shared/
COPY packages/db/package.json packages/db/
COPY packages/adapter-utils/package.json packages/adapter-utils/
COPY packages/adapters/claude-local/package.json packages/adapters/claude-local/
COPY packages/adapters/codex-local/package.json packages/adapters/codex-local/
COPY packages/adapters/cursor-local/package.json packages/adapters/cursor-local/
COPY packages/adapters/gemini-local/package.json packages/adapters/gemini-local/
COPY packages/adapters/openclaw-gateway/package.json packages/adapters/openclaw-gateway/
COPY packages/adapters/opencode-local/package.json packages/adapters/opencode-local/
COPY packages/adapters/pi-local/package.json packages/adapters/pi-local/
COPY packages/plugins/sdk/package.json packages/plugins/sdk/
COPY packages/plugins/create-paperclip-plugin/package.json packages/plugins/create-paperclip-plugin/
COPY packages/plugins/examples/plugin-hello-world-example/package.json packages/plugins/examples/plugin-hello-world-example/
COPY packages/plugins/examples/plugin-file-browser-example/package.json packages/plugins/examples/plugin-file-browser-example/
COPY packages/plugins/examples/plugin-authoring-smoke-example/package.json packages/plugins/examples/plugin-authoring-smoke-example/
COPY packages/plugins/examples/plugin-kitchen-sink-example/package.json packages/plugins/examples/plugin-kitchen-sink-example/

RUN pnpm install --frozen-lockfile

# --- Stage 2: Build ---
FROM base AS build
WORKDIR /app
COPY --from=deps /app /app
COPY . .

# Force skipLibCheck in all tsconfigs to prevent type-only build failures
RUN node -e " \
  const fs = require('fs'); \
  for (const f of ['server/tsconfig.json','packages/plugins/sdk/tsconfig.json']) { \
    try { \
      const c = JSON.parse(fs.readFileSync(f)); \
      c.compilerOptions = c.compilerOptions || {}; \
      c.compilerOptions.skipLibCheck = true; \
      fs.writeFileSync(f, JSON.stringify(c, null, 2)); \
      console.log('patched', f); \
    } catch(e) { console.log('skip', f, e.message); } \
  }"

# Build all packages in dependency order
RUN pnpm -r build

# Verify critical outputs
RUN test -f server/dist/index.js || (echo "ERROR: server/dist/index.js missing" && exit 1)
RUN test -f packages/plugins/sdk/dist/index.js || echo "WARN: plugin-sdk dist missing (non-fatal)"

# --- Stage 3: Production runtime ---
FROM node:20-slim AS production
WORKDIR /app

RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates curl \
  && rm -rf /var/lib/apt/lists/* \
  && mkdir -p /bitworld/instances/default/data/backups \
  && chown -R node:node /bitworld

COPY --chown=node:node --from=build /app /app

ENV NODE_ENV=production \
  HOME=/bitworld \
  HOST=0.0.0.0 \
  PORT=8080 \
  TZ=Asia/Shanghai \
  SERVE_UI=true \
  PAPERCLIP_HOME=/bitworld \
  PAPERCLIP_INSTANCE_ID=default \
  PAPERCLIP_CONFIG=/bitworld/instances/default/config.json \
  PAPERCLIP_DEPLOYMENT_MODE=authenticated \
  PAPERCLIP_DEPLOYMENT_EXPOSURE=private \
  PAPERCLIP_MIGRATION_AUTO_APPLY=true \
  PAPERCLIP_MIGRATION_PROMPT=never \
  PAPERCLIP_ALLOWED_HOSTNAMES=bitworld-568423242189.asia-northeast1.run.app,localhost

EXPOSE 8080

# Cloud Run ignores Docker HEALTHCHECK; this is for local testing only
HEALTHCHECK --interval=30s --timeout=5s --start-period=60s --retries=3 \
  CMD curl -sf http://localhost:${PORT}/api/health || exit 1

USER node
CMD ["node", "--import", "./server/node_modules/tsx/dist/loader.mjs", "server/dist/index.js"]
