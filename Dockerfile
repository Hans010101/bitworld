# ========================================
# BitWorld Production Dockerfile
# Based on upstream Paperclip Dockerfile, customized for cloud deployment
# ========================================

FROM node:lts-trixie-slim AS base
RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates curl git \
  && rm -rf /var/lib/apt/lists/*
RUN corepack enable

# --- Stage 1: Install dependencies ---
FROM base AS deps
WORKDIR /app
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml .npmrc ./
COPY cli/package.json cli/
COPY server/package.json server/
COPY ui/package.json ui/
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

# --- Stage 2: Build all packages in dependency order ---
FROM base AS build
WORKDIR /app
COPY --from=deps /app /app
COPY . .
# Build shared packages first (plugin-sdk depends on shared, server depends on plugin-sdk)
RUN pnpm --filter @paperclipai/shared build \
  && pnpm --filter @paperclipai/adapter-utils build \
  && pnpm --filter @paperclipai/db build \
  && pnpm --filter @paperclipai/plugin-sdk build \
  && pnpm --filter @paperclipai/adapter-claude-local build \
  && pnpm --filter @paperclipai/adapter-codex-local build \
  && pnpm --filter @paperclipai/adapter-cursor-local build \
  && pnpm --filter @paperclipai/adapter-gemini-local build \
  && pnpm --filter @paperclipai/adapter-openclaw-gateway build \
  && pnpm --filter @paperclipai/adapter-opencode-local build \
  && pnpm --filter @paperclipai/adapter-pi-local build \
  && pnpm --filter @paperclipai/ui build \
  && pnpm --filter @paperclipai/server build
RUN test -f server/dist/index.js || (echo "ERROR: server build output missing" && exit 1)

# --- Stage 3: Production ---
FROM base AS production
WORKDIR /app
COPY --chown=node:node --from=build /app /app

# Install Claude Code CLI for agent execution
RUN npm install --global --omit=dev @anthropic-ai/claude-code@latest \
  && mkdir -p /bitworld \
  && chown node:node /bitworld

# Copy BitWorld custom scripts and configs
COPY --chown=node:node scripts/ /app/scripts/
COPY --chown=node:node agents/ /app/agents/
COPY --chown=node:node skills/ /app/skills/

ENV NODE_ENV=production \
  HOME=/bitworld \
  HOST=0.0.0.0 \
  PORT=3100 \
  TZ=Asia/Shanghai \
  SERVE_UI=true \
  PAPERCLIP_HOME=/bitworld \
  PAPERCLIP_INSTANCE_ID=default \
  PAPERCLIP_CONFIG=/bitworld/instances/default/config.json \
  PAPERCLIP_DEPLOYMENT_MODE=authenticated \
  PAPERCLIP_DEPLOYMENT_EXPOSURE=private \
  PAPERCLIP_MIGRATION_AUTO_APPLY=true

VOLUME ["/bitworld"]
EXPOSE 3100

HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD curl -sf http://localhost:3100/api/health || exit 1

USER node
CMD ["node", "--import", "./server/node_modules/tsx/dist/loader.mjs", "server/dist/index.js"]
