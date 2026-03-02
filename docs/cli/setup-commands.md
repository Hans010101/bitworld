---
title: Setup Commands
summary: Onboard, run, doctor, and configure
---

Instance setup and diagnostics commands.

## `paperclip run`

One-command bootstrap and start:

```sh
pnpm paperclip run
```

Does:

1. Auto-onboards if config is missing
2. Runs `paperclip doctor` with repair enabled
3. Starts the server when checks pass

Choose a specific instance:

```sh
pnpm paperclip run --instance dev
```

## `paperclip onboard`

Interactive first-time setup:

```sh
pnpm paperclip onboard
```

Prompts for:

1. Deployment mode (`local_trusted` or `authenticated`)
2. Exposure policy (if authenticated: `private` or `public`)
3. Public URL (if authenticated + public)
4. Database and secrets configuration

## `paperclip doctor`

Health checks with optional auto-repair:

```sh
pnpm paperclip doctor
pnpm paperclip doctor --repair
```

Validates:

- Server configuration
- Database connectivity
- Secrets adapter configuration
- Storage configuration
- Missing key files

## `paperclip configure`

Update configuration sections:

```sh
pnpm paperclip configure --section server
pnpm paperclip configure --section secrets
pnpm paperclip configure --section storage
```

## `paperclip env`

Show resolved environment configuration:

```sh
pnpm paperclip env
```

## `paperclip allowed-hostname`

Allow a private hostname for authenticated/private mode:

```sh
pnpm paperclip allowed-hostname my-tailscale-host
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
PAPERCLIP_HOME=/custom/home PAPERCLIP_INSTANCE_ID=dev pnpm paperclip run
```

Or pass `--data-dir` directly on any command:

```sh
pnpm paperclip run --data-dir ./tmp/paperclip-dev
pnpm paperclip doctor --data-dir ./tmp/paperclip-dev
```
