---
title: Setup Commands
summary: Onboard, run, doctor, and configure
---

Instance setup and diagnostics commands.

## `paperclipai run`

One-command bootstrap and start:

```sh
pnpm paperclipai run
```

Does:

1. Auto-onboards if config is missing
2. Runs `paperclipai doctor` with repair enabled
3. Starts the server when checks pass

Choose a specific instance:

```sh
pnpm paperclipai run --instance dev
```

## `paperclipai onboard`

Interactive first-time setup:

```sh
pnpm paperclipai onboard
```

Prompts for:

1. Deployment mode (`local_trusted` or `authenticated`)
2. Exposure policy (if authenticated: `private` or `public`)
3. Public URL (if authenticated + public)
4. Database and secrets configuration

## `paperclipai doctor`

Health checks with optional auto-repair:

```sh
pnpm paperclipai doctor
pnpm paperclipai doctor --repair
```

Validates:

- Server configuration
- Database connectivity
- Secrets adapter configuration
- Storage configuration
- Missing key files

## `paperclipai configure`

Update configuration sections:

```sh
pnpm paperclipai configure --section server
pnpm paperclipai configure --section secrets
pnpm paperclipai configure --section storage
```

## `paperclipai env`

Show resolved environment configuration:

```sh
pnpm paperclipai env
```

## `paperclipai allowed-hostname`

Allow a private hostname for authenticated/private mode:

```sh
pnpm paperclipai allowed-hostname my-tailscale-host
```

## Local Storage Paths

| Data | Default Path |
|------|-------------|
| Config | `~/.paperclip/instances/default/config.json` |
| Database | `~/.paperclip/instances/default/db` |
| Logs | `~/.paperclip/instances/default/logs` |
| Storage | `~/.paperclip/instances/default/data/storage` |
| Secrets key | `~/.paperclip/instances/default/secrets/master.key` |

Override with:

```sh
PAPERCLIP_HOME=/custom/home PAPERCLIP_INSTANCE_ID=dev pnpm paperclipai run
```

Or pass `--data-dir` directly on any command:

```sh
pnpm paperclipai run --data-dir ./tmp/paperclip-dev
pnpm paperclipai doctor --data-dir ./tmp/paperclip-dev
```
