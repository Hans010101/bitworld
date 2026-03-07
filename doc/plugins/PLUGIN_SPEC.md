# Paperclip Plugin System Specification

Status: proposed complete spec for the post-V1 plugin system

This document is the complete specification for Paperclip's plugin and extension architecture.
It expands the brief plugin notes in [doc/SPEC.md](../SPEC.md) and should be read alongside the comparative analysis in [doc/plugins/ideas-from-opencode.md](./ideas-from-opencode.md).

This is not part of the V1 implementation contract in [doc/SPEC-implementation.md](../SPEC-implementation.md).
It is the full target architecture for the plugin system that should follow V1.

## 1. Scope

This spec covers:

- plugin packaging and installation
- runtime model
- trust model
- capability system
- UI extension surfaces
- event, job, and webhook surfaces
- workspace-oriented extension surfaces
- Postgres persistence for extensions
- operator workflows
- compatibility and upgrade rules

This spec does not cover:

- a public marketplace
- cloud/SaaS multi-tenancy
- arbitrary third-party schema migrations in the first plugin version
- arbitrary frontend bundle injection in the first plugin version

## 2. Core Assumptions

Paperclip plugin design is based on the following assumptions:

1. Paperclip is single-tenant and self-hosted.
2. Plugin installation is global to the instance.
3. "Companies" remain core Paperclip business objects, but they are not plugin trust boundaries.
4. Board governance, approval gates, budget hard-stops, and core task invariants remain owned by Paperclip core.
5. Projects already have a real workspace model via `project_workspaces`, and local/runtime plugins should build on that instead of inventing a separate workspace abstraction.

## 3. Goals

The plugin system must:

1. Let operators install global instance-wide plugins.
2. Let plugins add major capabilities without editing Paperclip core.
3. Keep core governance and auditing intact.
4. Support both local/runtime plugins and external SaaS connectors.
5. Support future plugin categories such as:
   - new agent adapters
   - revenue tracking
   - knowledge base
   - issue tracker sync
   - metrics/dashboards
   - file/project tooling
6. Use simple, explicit, typed contracts.
7. Keep failures isolated so one plugin does not crash the entire instance.

## 4. Non-Goals

The first plugin system must not:

1. Allow arbitrary plugins to override core routes or core invariants.
2. Allow arbitrary plugins to mutate approval, auth, issue checkout, or budget enforcement logic.
3. Allow arbitrary third-party plugins to run free-form DB migrations.
4. Depend on project-local plugin folders such as `.paperclip/plugins`.
5. Depend on automatic install-and-execute behavior at server startup from arbitrary config files.

## 5. Terminology

### 5.1 Instance

The single Paperclip deployment an operator installs and controls.

### 5.2 Company

A first-class Paperclip business object inside the instance.

### 5.3 Project Workspace

A workspace attached to a project through `project_workspaces`.
This is the primary local runtime anchor for file, terminal, git, and process tooling.

### 5.4 Platform Module

A trusted in-process extension loaded directly by Paperclip core.

Examples:

- agent adapters
- storage providers
- secret providers
- run-log backends

### 5.5 Plugin

An installable instance-wide extension package loaded through the Paperclip plugin runtime.

Examples:

- Linear sync
- GitHub Issues sync
- Grafana widgets
- Stripe revenue sync
- file browser
- terminal
- git workflow

### 5.6 Plugin Worker

The runtime process used for a plugin.
In this spec, third-party plugins run out-of-process by default.

### 5.7 Capability

A named permission the host grants to a plugin.
Plugins may only call host APIs that are covered by granted capabilities.

## 6. Extension Classes

Paperclip has two extension classes.

## 6.1 Platform Modules

Platform modules are:

- trusted
- in-process
- host-integrated
- low-level

They use explicit registries, not the general plugin worker protocol.

Platform module surfaces:

- `registerAgentAdapter()`
- `registerStorageProvider()`
- `registerSecretProvider()`
- `registerRunLogStore()`
- future `registerWorkspaceRuntime()` if needed

Platform modules are the right place for:

- new agent adapter packages
- new storage backends
- new secret backends
- other host-internal systems that need direct process or DB integration

## 6.2 Plugins

Plugins are:

- globally installed per instance
- loaded through the plugin runtime
- additive
- capability-gated
- isolated from core via a stable SDK and host protocol

Plugin categories:

- `connector`
- `workspace`
- `automation`
- `ui`

A plugin may declare more than one category.

## 7. Project Workspaces Are The Local Tooling Anchor

Paperclip already has a concrete workspace model:

- projects expose `workspaces`
- projects expose `primaryWorkspace`
- the database contains `project_workspaces`
- project routes already manage workspaces
- heartbeat resolution already prefers project workspaces before falling back to task-session or agent-home workspaces

Therefore:

1. File plugins should browse project workspaces first.
2. Terminal sessions should launch against project workspaces by default.
3. Git plugins should treat the selected project workspace as the repo root anchor.
4. Process/server tracking should attach to project workspaces whenever possible.
5. Issue and agent views may deep-link into project workspace context.

Project workspaces may exist in two modes:

- local directory mode: `cwd` is present
- repo-only mode: `repoUrl` and optional `repoRef` exist, but there is no local `cwd`

Plugins must handle repo-only workspaces explicitly:

- they may show metadata
- they may show sync state
- they may not assume local file/PTY/git access until a real `cwd` exists

## 8. Installation Model

Plugin installation is global and operator-driven.

There is no per-company install table and no per-company enable/disable switch.

If a plugin needs business-object-specific mappings, those are stored as plugin configuration or plugin state.

Examples:

- one global Linear plugin install
- mappings from company A to Linear team X and company B to Linear team Y
- one global git plugin install
- per-project workspace state stored under `project_workspace`

## 8.1 On-Disk Layout

Plugins live under the Paperclip instance directory.

Suggested layout:

- `~/.paperclip/instances/default/plugins/package.json`
- `~/.paperclip/instances/default/plugins/node_modules/`
- `~/.paperclip/instances/default/plugins/.cache/`
- `~/.paperclip/instances/default/data/plugins/<plugin-id>/`

The package install directory and the plugin data directory are separate.

## 8.2 Operator Commands

Paperclip should add CLI commands:

- `pnpm paperclipai plugin list`
- `pnpm paperclipai plugin install <package[@version]>`
- `pnpm paperclipai plugin uninstall <plugin-id>`
- `pnpm paperclipai plugin upgrade <plugin-id> [version]`
- `pnpm paperclipai plugin doctor <plugin-id>`

These commands are instance-level operations.

## 8.3 Install Process

The install process is:

1. Resolve npm package and version.
2. Install into the instance plugin directory.
3. Read and validate plugin manifest.
4. Reject incompatible plugin API versions.
5. Display requested capabilities to the operator.
6. Persist install record in Postgres.
7. Start plugin worker and run health/validation.
8. Mark plugin `ready` or `error`.

## 9. Load Order And Precedence

Load order must be deterministic.

1. core platform modules
2. built-in first-party plugins
3. installed plugins sorted by:
   - explicit operator-configured order if present
   - otherwise manifest `id`

Rules:

- plugin contributions are additive by default
- plugins may not override core routes or core actions by name collision
- if two plugins contribute the same route slug or UI slot id, the host must reject startup or force the operator to resolve the collision explicitly

## 10. Package Contract

Each plugin package must export a manifest and a worker entrypoint.

Suggested package layout:

- `dist/manifest.js`
- `dist/worker.js`

Suggested `package.json` keys:

```json
{
  "name": "@paperclip/plugin-linear",
  "version": "0.1.0",
  "paperclipPlugin": {
    "manifest": "./dist/manifest.js",
    "worker": "./dist/worker.js"
  }
}
```

## 10.1 Manifest Shape

Normative manifest shape:

```ts
export interface PaperclipPluginManifestV1 {
  id: string;
  apiVersion: 1;
  version: string;
  displayName: string;
  description: string;
  categories: Array<"connector" | "workspace" | "automation" | "ui">;
  minimumPaperclipVersion?: string;
  capabilities: string[];
  entrypoints: {
    worker: string;
  };
  instanceConfigSchema?: JsonSchema;
  jobs?: PluginJobDeclaration[];
  webhooks?: PluginWebhookDeclaration[];
  ui?: PluginUiDeclaration;
}
```

Rules:

- `id` must be globally unique
- `id` should normally equal the npm package name
- `apiVersion` must match the host-supported plugin API version
- `capabilities` must be static and install-time visible
- config schema must be JSON Schema compatible

## 11. Runtime Model

## 11.1 Process Model

Third-party plugins run out-of-process by default.

Default runtime:

- Paperclip server starts one worker process per installed plugin
- the worker process is a Node process
- host and worker communicate over JSON-RPC on stdio

This design provides:

- failure isolation
- clearer logging boundaries
- easier resource limits
- a cleaner trust boundary than arbitrary in-process execution

## 11.2 Host Responsibilities

The host is responsible for:

- package install
- manifest validation
- capability enforcement
- process supervision
- job scheduling
- webhook routing
- activity log writes
- secret resolution
- workspace service enforcement
- UI route registration

## 11.3 Worker Responsibilities

The plugin worker is responsible for:

- validating its own config
- handling domain events
- handling scheduled jobs
- handling webhooks
- producing UI view models
- invoking host services through the SDK
- reporting health information

## 11.4 Failure Policy

If a worker fails:

- mark plugin status `error`
- surface error in plugin health UI
- keep the rest of the instance running
- retry start with bounded backoff
- do not drop other plugins or core services

## 12. Host-Worker Protocol

The host must support the following worker RPC methods.

Required methods:

- `initialize(input)`
- `health()`
- `shutdown()`

Optional methods:

- `validateConfig(input)`
- `onEvent(input)`
- `runJob(input)`
- `handleWebhook(input)`
- `getPageModel(input)`
- `getWidgetModel(input)`
- `getDetailTabModel(input)`
- `performAction(input)`

### 12.1 `initialize`

Called once on worker startup.

Input includes:

- plugin manifest
- resolved plugin config
- instance info
- host API version

### 12.2 `health`

Returns:

- status
- current error if any
- optional plugin-reported diagnostics

### 12.3 `validateConfig`

Runs after config changes and startup.

Returns:

- `ok`
- warnings
- errors

### 12.4 `onEvent`

Receives one typed Paperclip domain event.

Delivery semantics:

- at least once
- plugin must be idempotent
- no global ordering guarantee across all event types
- per-entity ordering is best effort but not guaranteed after retries

### 12.5 `runJob`

Runs a declared scheduled job.

The host provides:

- job key
- trigger source
- run id
- schedule metadata

### 12.6 `handleWebhook`

Receives inbound webhook payload routed by the host.

The host provides:

- endpoint key
- headers
- raw body
- parsed body if applicable
- request id

### 12.7 `getPageModel`

Returns a schema-driven view model for the plugin's main page.

### 12.8 `getWidgetModel`

Returns a schema-driven view model for a dashboard widget.

### 12.9 `getDetailTabModel`

Returns a schema-driven view model for a project, issue, agent, goal, or run detail tab.

### 12.10 `performAction`

Runs an explicit plugin action initiated by the board UI.

Examples:

- "resync now"
- "link GitHub issue"
- "create branch from issue"
- "restart process"

## 13. SDK Surface

Plugins do not talk to the DB directly.
Plugins do not read raw secret material from persisted config.
Plugins do not touch the filesystem directly outside the host services.

The SDK exposed to workers must provide typed host clients.

Required SDK clients:

- `ctx.config`
- `ctx.events`
- `ctx.jobs`
- `ctx.http`
- `ctx.secrets`
- `ctx.assets`
- `ctx.activity`
- `ctx.state`
- `ctx.entities`
- `ctx.projects`
- `ctx.issues`
- `ctx.agents`
- `ctx.goals`
- `ctx.workspace`
- `ctx.logger`

## 13.1 Example SDK Shape

```ts
export interface PluginContext {
  manifest: PaperclipPluginManifestV1;
  config: {
    get(): Promise<Record<string, unknown>>;
  };
  events: {
    on(name: string, fn: (event: unknown) => Promise<void>): void;
  };
  jobs: {
    register(key: string, input: { cron: string }, fn: (job: PluginJobContext) => Promise<void>): void;
  };
  state: {
    get(input: ScopeKey): Promise<unknown | null>;
    set(input: ScopeKey, value: unknown): Promise<void>;
    delete(input: ScopeKey): Promise<void>;
  };
  entities: {
    upsert(input: PluginEntityUpsert): Promise<void>;
    list(input: PluginEntityQuery): Promise<PluginEntityRecord[]>;
  };
  workspace: WorkspacePluginApi;
}
```

## 14. Capability Model

Capabilities are mandatory and static.
Every plugin declares them up front.

The host enforces capabilities in the SDK layer and refuses calls outside the granted set.

## 14.1 Capability Categories

### Data Read

- `companies.read`
- `projects.read`
- `project.workspaces.read`
- `issues.read`
- `issue.comments.read`
- `agents.read`
- `goals.read`
- `activity.read`
- `costs.read`

### Data Write

- `issues.create`
- `issues.update`
- `issue.comments.create`
- `assets.write`
- `assets.read`
- `activity.log.write`
- `metrics.write`

### Runtime / Integration

- `events.subscribe`
- `jobs.schedule`
- `webhooks.receive`
- `http.outbound`
- `secrets.read-ref`

### UI

- `instance.settings.register`
- `ui.sidebar.register`
- `ui.page.register`
- `ui.detailTab.register`
- `ui.dashboardWidget.register`
- `ui.action.register`

### Workspace

- `workspace.fs.read`
- `workspace.fs.write`
- `workspace.fs.stat`
- `workspace.fs.search`
- `workspace.pty.open`
- `workspace.pty.input`
- `workspace.pty.resize`
- `workspace.pty.terminate`
- `workspace.pty.subscribe`
- `workspace.git.status`
- `workspace.git.diff`
- `workspace.git.log`
- `workspace.git.branch.create`
- `workspace.git.commit`
- `workspace.git.worktree.create`
- `workspace.git.push`
- `workspace.process.register`
- `workspace.process.list`
- `workspace.process.read`
- `workspace.process.terminate`
- `workspace.process.restart`
- `workspace.process.logs.read`
- `workspace.http.probe`

## 14.2 Forbidden Capabilities

The host must not expose capabilities for:

- approval decisions
- budget override
- auth bypass
- issue checkout lock override
- direct DB access
- direct filesystem access outside approved workspace services

## 14.3 Upgrade Rules

If a plugin upgrade adds capabilities:

1. the host must mark the plugin `upgrade_pending`
2. the operator must explicitly approve the new capability set
3. the new version does not become `ready` until approval completes

## 15. Event System

The host must emit typed domain events that plugins may subscribe to.

Minimum event set:

- `company.created`
- `company.updated`
- `project.created`
- `project.updated`
- `project.workspace_created`
- `project.workspace_updated`
- `project.workspace_deleted`
- `issue.created`
- `issue.updated`
- `issue.comment.created`
- `agent.created`
- `agent.updated`
- `agent.status_changed`
- `agent.run.started`
- `agent.run.finished`
- `agent.run.failed`
- `agent.run.cancelled`
- `approval.created`
- `approval.decided`
- `cost_event.created`
- `activity.logged`

Each event must include:

- event id
- event type
- occurred at
- actor metadata when applicable
- primary entity metadata
- typed payload

## 16. Scheduled Jobs

Plugins may declare scheduled jobs in their manifest.

Job rules:

1. Each job has a stable `job_key`.
2. The host is the scheduler of record.
3. The host prevents overlapping execution of the same plugin/job combination unless explicitly allowed later.
4. Every job run is recorded in Postgres.
5. Failed jobs are retryable.

## 17. Webhooks

Plugins may declare webhook endpoints in their manifest.

Webhook route shape:

- `POST /api/plugins/:pluginId/webhooks/:endpointKey`

Rules:

1. The host owns the public route.
2. The worker receives the request body through `handleWebhook`.
3. Signature verification happens in plugin code using secret refs resolved by the host.
4. Every delivery is recorded.
5. Webhook handling must be idempotent.

## 18. UI Extension Model

The first plugin UI system is schema-driven.

The host renders plugin data using built-in UI components.
Plugins return view models, not arbitrary React bundles.

## 18.1 Global Operator Routes

- `/settings/plugins`
- `/settings/plugins/:pluginId`

These routes are instance-level.

## 18.2 Company-Context Routes

- `/:companyPrefix/plugins/:pluginId`

These routes exist because the board UI is organized around companies even though plugin installation is global.

## 18.3 Detail Tabs

Plugins may add tabs to:

- project detail
- issue detail
- agent detail
- goal detail
- run detail

Recommended route pattern:

- `/:companyPrefix/<entity>/:id?tab=<plugin-tab-id>`

## 18.4 Dashboard Widgets

Plugins may add cards or sections to the dashboard.

## 18.5 Sidebar Entries

Plugins may add sidebar links to:

- global plugin settings
- company-context plugin pages

## 18.6 Allowed View Model Types

The host should support a limited set of schema-rendered components:

- metric cards
- status lists
- tables
- timeseries charts
- markdown text
- key/value blocks
- action bars
- log views
- JSON/debug views

Arbitrary frontend bundle injection is explicitly out of scope for the first plugin system.

## 19. Workspace Service APIs

Workspace service APIs are the foundation for local tooling plugins.

All workspace APIs must route through the host and validate against known project workspace roots.

## 19.1 Project Workspace APIs

Required host APIs:

- list project workspaces
- get project primary workspace
- resolve project workspace from issue
- resolve current workspace from agent/run when available

## 19.2 File APIs

- read file
- write file
- stat path
- search path or filename
- list directory

All file APIs take a resolved workspace anchor plus a relative path.

## 19.3 PTY APIs

- open terminal session
- send input
- resize
- terminate
- subscribe to output

PTY sessions should default to the selected project workspace when one exists.

## 19.4 Git APIs

- status
- diff
- log
- branch create
- worktree create
- commit
- push

Git APIs require a local `cwd`.
If the workspace is repo-only, the host must reject local git operations until a local checkout exists.

## 19.5 Process APIs

- register process
- list processes
- read process metadata
- terminate
- restart
- read logs
- probe health endpoint

Process tracking should attach to `project_workspace` when possible.

## 20. Persistence And Postgres

## 20.1 Database Principles

1. Core Paperclip data stays in first-party tables.
2. Most plugin-owned data starts in generic extension tables.
3. Plugin data should scope to existing Paperclip objects before new tables are introduced.
4. Arbitrary third-party schema migrations are out of scope for the first plugin system.

## 20.2 Core Table Reuse

If data becomes part of the actual Paperclip product model, it should become a first-party table.

Examples:

- `project_workspaces` is already first-party
- if Paperclip later decides git state is core product data, it should become a first-party table too

## 20.3 Required Tables

### `plugins`

- `id` uuid pk
- `plugin_key` text unique not null
- `package_name` text not null
- `version` text not null
- `api_version` int not null
- `categories` text[] not null
- `manifest_json` jsonb not null
- `status` enum: `installed | ready | error | upgrade_pending`
- `install_order` int null
- `installed_at` timestamptz not null
- `updated_at` timestamptz not null
- `last_error` text null

Indexes:

- unique `plugin_key`
- `status`

### `plugin_config`

- `id` uuid pk
- `plugin_id` uuid fk `plugins.id` unique not null
- `config_json` jsonb not null
- `installed_at` timestamptz not null
- `updated_at` timestamptz not null
- `last_error` text null

### `plugin_state`

- `id` uuid pk
- `plugin_id` uuid fk `plugins.id` not null
- `scope_kind` enum: `instance | company | project | project_workspace | agent | issue | goal | run`
- `scope_id` uuid/text null
- `namespace` text not null
- `state_key` text not null
- `value_json` jsonb not null
- `updated_at` timestamptz not null

Constraints:

- unique `(plugin_id, scope_kind, scope_id, namespace, state_key)`

Examples:

- Linear external IDs keyed by `issue`
- GitHub sync cursors keyed by `project`
- file browser preferences keyed by `project_workspace`
- git branch metadata keyed by `project_workspace`
- process metadata keyed by `project_workspace` or `run`

### `plugin_jobs`

- `id` uuid pk
- `plugin_id` uuid fk `plugins.id` not null
- `scope_kind` enum nullable
- `scope_id` uuid/text null
- `job_key` text not null
- `schedule` text null
- `status` enum: `idle | queued | running | error`
- `next_run_at` timestamptz null
- `last_started_at` timestamptz null
- `last_finished_at` timestamptz null
- `last_succeeded_at` timestamptz null
- `last_error` text null

Constraints:

- unique `(plugin_id, scope_kind, scope_id, job_key)`

### `plugin_job_runs`

- `id` uuid pk
- `plugin_job_id` uuid fk `plugin_jobs.id` not null
- `plugin_id` uuid fk `plugins.id` not null
- `status` enum: `queued | running | succeeded | failed | cancelled`
- `trigger` enum: `schedule | manual | retry`
- `started_at` timestamptz null
- `finished_at` timestamptz null
- `error` text null
- `details_json` jsonb null

Indexes:

- `(plugin_id, started_at desc)`
- `(plugin_job_id, started_at desc)`

### `plugin_webhook_deliveries`

- `id` uuid pk
- `plugin_id` uuid fk `plugins.id` not null
- `scope_kind` enum nullable
- `scope_id` uuid/text null
- `endpoint_key` text not null
- `status` enum: `received | processed | failed | ignored`
- `request_id` text null
- `headers_json` jsonb null
- `body_json` jsonb null
- `received_at` timestamptz not null
- `handled_at` timestamptz null
- `response_code` int null
- `error` text null

Indexes:

- `(plugin_id, received_at desc)`
- `(plugin_id, endpoint_key, received_at desc)`

### `plugin_entities` (optional but recommended)

- `id` uuid pk
- `plugin_id` uuid fk `plugins.id` not null
- `entity_type` text not null
- `scope_kind` enum not null
- `scope_id` uuid/text null
- `external_id` text null
- `title` text null
- `status` text null
- `data_json` jsonb not null
- `created_at` timestamptz not null
- `updated_at` timestamptz not null

Indexes:

- `(plugin_id, entity_type, external_id)` unique when `external_id` is not null
- `(plugin_id, scope_kind, scope_id, entity_type)`

Use cases:

- imported Linear issues
- imported GitHub issues
- plugin-owned process records
- plugin-owned external metric bindings

## 20.4 Activity Log Changes

The activity log should extend `actor_type` to include `plugin`.

New actor enum:

- `agent`
- `user`
- `system`
- `plugin`

Plugin-originated mutations should write:

- `actor_type = plugin`
- `actor_id = <plugin-id>`

## 20.5 Plugin Migrations

The first plugin system does not allow arbitrary third-party migrations.

Later, if custom tables become necessary, the system may add a trusted-module-only migration path.

## 21. Secrets

Plugin config must never persist raw secret values.

Rules:

1. Plugin config stores secret refs only.
2. Secret refs resolve through the existing Paperclip secret provider system.
3. Plugin workers receive resolved secrets only at execution time.
4. Secret values must never be written to:
   - plugin config JSON
   - activity logs
   - webhook delivery rows
   - error messages

## 22. Auditing

All plugin-originated mutating actions must be auditable.

Minimum requirements:

- activity log entry for every mutation
- job run history
- webhook delivery history
- plugin health page
- install/upgrade history in `plugins`

## 23. Operator UX

## 23.1 Global Settings

Global plugin settings page must show:

- installed plugins
- versions
- status
- requested capabilities
- current errors
- install/upgrade/remove actions

## 23.2 Plugin Settings Page

Each plugin may expose:

- config form derived from `instanceConfigSchema`
- health details
- recent job history
- recent webhook history
- capability list

Route:

- `/settings/plugins/:pluginId`

## 23.3 Company-Context Plugin Page

Each plugin may expose a company-context main page:

- `/:companyPrefix/plugins/:pluginId`

This page is where board users do most day-to-day work.

## 24. Example Mappings

This spec directly supports the following plugin types:

- `@paperclip/plugin-workspace-files`
- `@paperclip/plugin-terminal`
- `@paperclip/plugin-git`
- `@paperclip/plugin-linear`
- `@paperclip/plugin-github-issues`
- `@paperclip/plugin-grafana`
- `@paperclip/plugin-runtime-processes`
- `@paperclip/plugin-stripe`

## 25. Compatibility And Versioning

Rules:

1. Host supports one or more explicit plugin API versions.
2. Plugin manifest declares exactly one `apiVersion`.
3. Host rejects unsupported versions at install time.
4. SDK packages are versioned with the host protocol.
5. Plugin upgrades are explicit operator actions.
6. Capability expansion requires explicit operator approval.

## 26. Recommended Delivery Order

## Phase 1

- plugin manifest
- install/list/remove/upgrade CLI
- global settings UI
- plugin process manager
- capability enforcement
- `plugins`, `plugin_config`, `plugin_state`, `plugin_jobs`, `plugin_job_runs`, `plugin_webhook_deliveries`
- event bus
- jobs
- webhooks
- settings page
- dashboard widget/page/tab schema rendering

This phase is enough for:

- Linear
- GitHub Issues
- Grafana
- Stripe

## Phase 2

- project workspace service built on `project_workspaces`
- file APIs
- PTY APIs
- git APIs
- process APIs
- project-context tabs for plugin pages

This phase is enough for:

- file browser
- terminal
- git workflow
- process/server tracking

## Phase 3

- optional `plugin_entities`
- richer action systems
- trusted-module migration path if truly needed
- optional richer frontend extension model
- plugin ecosystem/distribution work

## 27. Final Design Decision

Paperclip should not implement a generic in-process hook bag modeled directly after local coding tools.

Paperclip should implement:

- trusted platform modules for low-level host integration
- globally installed out-of-process plugins for additive instance-wide capabilities
- schema-driven UI contributions
- project workspace-based local tooling
- generic extension tables for most plugin state
- strict preservation of core governance and audit rules

That is the complete target design for the Paperclip plugin system.
