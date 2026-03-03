---
title: Quickstart
summary: Get Paperclip running in minutes
---

Get Paperclip running locally in under 5 minutes.

## Option 1: Docker Compose (Recommended)

The fastest way to start. No Node.js install needed.

```sh
docker compose -f docker-compose.quickstart.yml up --build
```

Open [http://localhost:3100](http://localhost:3100). That's it.

The Docker image includes Claude Code CLI and Codex CLI pre-installed for local adapter runs. Pass API keys to enable them:

```sh
ANTHROPIC_API_KEY=sk-... OPENAI_API_KEY=sk-... \
  docker compose -f docker-compose.quickstart.yml up --build
```

## Option 2: Local Development

Prerequisites: Node.js 20+ and pnpm 9+.

```sh
pnpm install
pnpm dev
```

This starts the API server and UI at [http://localhost:3100](http://localhost:3100).

No Docker or external database required — Paperclip uses an embedded PostgreSQL instance by default.

## Option 3: One-Command Bootstrap

```sh
pnpm paperclipai run
```

This auto-onboards if config is missing, runs health checks with auto-repair, and starts the server.

## What's Next

Once Paperclip is running:

1. Create your first company in the web UI
2. Define a company goal
3. Create a CEO agent and configure its adapter
4. Build out the org chart with more agents
5. Set budgets and assign initial tasks
6. Hit go — agents start their heartbeats and the company runs

<Card title="Core Concepts" href="/start/core-concepts">
  Learn the key concepts behind Paperclip
</Card>
