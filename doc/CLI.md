# CLI Reference

Paperclip CLI now supports both:

- instance setup/diagnostics (`onboard`, `doctor`, `configure`, `env`, `allowed-hostname`)
- control-plane client operations (issues, approvals, agents, activity, dashboard)

## Base Usage

Use repo script in development:

```sh
pnpm paperclip --help
```

First-time local bootstrap + run:

```sh
pnpm paperclip run
```

Choose local instance:

```sh
pnpm paperclip run --instance dev
```

## Deployment Modes

Mode taxonomy and design intent are documented in `doc/DEPLOYMENT-MODES.md`.

Current CLI behavior:

- `paperclip onboard` and `paperclip configure --section server` set deployment mode in config
- runtime can override mode with `PAPERCLIP_DEPLOYMENT_MODE`
- `paperclip run` and `paperclip doctor` do not yet expose a direct `--mode` flag

Target behavior (planned) is documented in `doc/DEPLOYMENT-MODES.md` section 5.

Allow an authenticated/private hostname (for example custom Tailscale DNS):

```sh
pnpm paperclip allowed-hostname dotta-macbook-pro
```

All client commands support:

- `--data-dir <path>`
- `--api-base <url>`
- `--api-key <token>`
- `--context <path>`
- `--profile <name>`
- `--json`

Company-scoped commands also support `--company-id <id>`.

Use `--data-dir` on any CLI command to isolate all default local state (config/context/db/logs/storage/secrets) away from `~/.paperclip`:

```sh
pnpm paperclip run --data-dir ./tmp/paperclip-dev
pnpm paperclip issue list --data-dir ./tmp/paperclip-dev
```

## Context Profiles

Store local defaults in `~/.paperclip/context.json`:

```sh
pnpm paperclip context set --api-base http://localhost:3100 --company-id <company-id>
pnpm paperclip context show
pnpm paperclip context list
pnpm paperclip context use default
```

To avoid storing secrets in context, set `apiKeyEnvVarName` and keep the key in env:

```sh
pnpm paperclip context set --api-key-env-var-name PAPERCLIP_API_KEY
export PAPERCLIP_API_KEY=...
```

## Company Commands

```sh
pnpm paperclip company list
pnpm paperclip company get <company-id>
```

## Issue Commands

```sh
pnpm paperclip issue list --company-id <company-id> [--status todo,in_progress] [--assignee-agent-id <agent-id>] [--match text]
pnpm paperclip issue get <issue-id-or-identifier>
pnpm paperclip issue create --company-id <company-id> --title "..." [--description "..."] [--status todo] [--priority high]
pnpm paperclip issue update <issue-id> [--status in_progress] [--comment "..."]
pnpm paperclip issue comment <issue-id> --body "..." [--reopen]
pnpm paperclip issue checkout <issue-id> --agent-id <agent-id> [--expected-statuses todo,backlog,blocked]
pnpm paperclip issue release <issue-id>
```

## Agent Commands

```sh
pnpm paperclip agent list --company-id <company-id>
pnpm paperclip agent get <agent-id>
```

## Approval Commands

```sh
pnpm paperclip approval list --company-id <company-id> [--status pending]
pnpm paperclip approval get <approval-id>
pnpm paperclip approval create --company-id <company-id> --type hire_agent --payload '{"name":"..."}' [--issue-ids <id1,id2>]
pnpm paperclip approval approve <approval-id> [--decision-note "..."]
pnpm paperclip approval reject <approval-id> [--decision-note "..."]
pnpm paperclip approval request-revision <approval-id> [--decision-note "..."]
pnpm paperclip approval resubmit <approval-id> [--payload '{"...":"..."}']
pnpm paperclip approval comment <approval-id> --body "..."
```

## Activity Commands

```sh
pnpm paperclip activity list --company-id <company-id> [--agent-id <agent-id>] [--entity-type issue] [--entity-id <id>]
```

## Dashboard Commands

```sh
pnpm paperclip dashboard get --company-id <company-id>
```

## Heartbeat Command

`heartbeat run` now also supports context/api-key options and uses the shared client stack:

```sh
pnpm paperclip heartbeat run --agent-id <agent-id> [--api-base http://localhost:3100] [--api-key <token>]
```

## Local Storage Defaults

Default local instance root is `~/.paperclip/instances/default`:

- config: `~/.paperclip/instances/default/config.json`
- embedded db: `~/.paperclip/instances/default/db`
- logs: `~/.paperclip/instances/default/logs`
- storage: `~/.paperclip/instances/default/data/storage`
- secrets key: `~/.paperclip/instances/default/secrets/master.key`

Override base home or instance with env vars:

```sh
PAPERCLIP_HOME=/custom/home PAPERCLIP_INSTANCE_ID=dev pnpm paperclip run
```

## Storage Configuration

Configure storage provider and settings:

```sh
pnpm paperclip configure --section storage
```

Supported providers:

- `local_disk` (default; local single-user installs)
- `s3` (S3-compatible object storage)
