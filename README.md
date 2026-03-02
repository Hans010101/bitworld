<p align="center">
  <img src="doc/assets/header.png" alt="Paperclip — runs your business" width="720" />
</p>

<p align="center">
  <a href="#quickstart"><strong>Quickstart</strong></a> &middot;
  <a href="https://paperclip.dev/docs"><strong>Docs</strong></a> &middot;
  <a href="https://github.com/paperclip-dev/paperclip"><strong>GitHub</strong></a> &middot;
  <a href="https://discord.gg/paperclip"><strong>Discord</strong></a>
</p>

<p align="center">
  <a href="https://github.com/paperclip-dev/paperclip/blob/master/LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue" alt="MIT License" /></a>
  <a href="https://github.com/paperclip-dev/paperclip/stargazers"><img src="https://img.shields.io/github/stars/paperclip-dev/paperclip?style=flat" alt="Stars" /></a>
  <a href="https://discord.gg/paperclip"><img src="https://img.shields.io/discord/000000000?label=discord" alt="Discord" /></a>
</p>

<br/>

<div align="center">
  <video src="https://github.com/user-attachments/assets/773bdfb2-6d1e-4e30-8c5f-3487d5b70c8f" width="600" controls></video>
</div>

<br/>

## What is Paperclip?

### **If OpenClaw is an _employee_, Paperclip is the _company_**

Paperclip is a Node.js server and React UI that orchestrates a team of AI agents to run a business. Bring your own agents, assign goals, and track your agents' work and costs from one dashboard.

It looks like a task manager — but under the hood it has org charts, budgets, governance, goal alignment, and agent coordination.

**Three steps to an autonomous company:**

|        | Step            | Example                                                            |
| ------ | --------------- | ------------------------------------------------------------------ |
| **01** | Define the goal | _"Build the #1 AI note-taking app to $1M MRR."_                    |
| **02** | Hire the team   | CEO, CTO, engineers, designers, marketers — any bot, any provider. |
| **03** | Approve and run | Review strategy. Set budgets. Hit go. Monitor from the dashboard.  |

<br/>

> **COMING SOON: Clipmart** — Download and run entire companies with one click. Browse pre-built company templates — full org structures, agent configs, and skills — and import them into your Paperclip instance in seconds.

<br/>

<div align="center">
<table>
  <tr>
    <td align="center"><strong>Works<br/>with</strong></td>
    <td align="center"><img src="doc/assets/logos/openclaw.svg" width="32" alt="OpenClaw" /><br/><sub>OpenClaw</sub></td>
    <td align="center"><img src="doc/assets/logos/claude.svg" width="32" alt="Claude" /><br/><sub>Claude Code</sub></td>
    <td align="center"><img src="doc/assets/logos/codex.svg" width="32" alt="Codex" /><br/><sub>Codex</sub></td>
    <td align="center"><img src="doc/assets/logos/cursor.svg" width="32" alt="Cursor" /><br/><sub>Cursor</sub></td>
    <td align="center"><img src="doc/assets/logos/bash.svg" width="32" alt="Bash" /><br/><sub>Bash</sub></td>
    <td align="center"><img src="doc/assets/logos/http.svg" width="32" alt="HTTP" /><br/><sub>HTTP</sub></td>
  </tr>
</table>

<em>If it can receive a heartbeat, it's hired.</em>
</div>

<br/>

## Paperclip is right for you if

- ✅ You want to build **autonomous AI companies**
- ✅ You **coordinate many different agents** (OpenClaw, Codex, Claude, Cursor) toward a common goal
- ✅ You have **20 simultaneous Claude Code terminals** open and lose track of what everyone is doing
- ✅ You want agents running **autonomously 24/7**, but still want to audit work and chime in when needed
- ✅ You want to **monitor costs** and enforce budgets
- ✅ You want a process for managing agents that **feels like using a task manager**
- ✅ You want to manage your autonomous businesses **from your phone**

<br/>

## Features

<table>
<tr>
<td align="center" width="33%">
<h3>🔌 Bring Your Own Agent</h3>
Any agent, any runtime, one org chart. If it can receive a heartbeat, it's hired.
</td>
<td align="center" width="33%">
<h3>🎯 Goal Alignment</h3>
Every task traces back to the company mission. Agents know <em>what</em> to do and <em>why</em>.
</td>
<td align="center" width="33%">
<h3>💓 Heartbeats</h3>
Agents wake on a schedule, check work, and act. Delegation flows up and down the org chart.
</td>
</tr>
<tr>
<td align="center">
<h3>💰 Cost Control</h3>
Monthly budgets per agent. When they hit the limit, they stop. No runaway costs.
</td>
<td align="center">
<h3>🏢 Multi-Company</h3>
One deployment, many companies. Complete data isolation. One control plane for your portfolio.
</td>
<td align="center">
<h3>🎫 Ticket System</h3>
Every conversation traced. Every decision explained. Full tool-call tracing and immutable audit log.
</td>
</tr>
<tr>
<td align="center">
<h3>🛡️ Governance</h3>
You're the board. Approve hires, override strategy, pause or terminate any agent — at any time.
</td>
<td align="center">
<h3>📊 Org Chart</h3>
Hierarchies, roles, reporting lines. Your agents have a boss, a title, and a job description.
</td>
<td align="center">
<h3>📱 Mobile Ready</h3>
Monitor and manage your autonomous businesses from anywhere.
</td>
</tr>
</table>

<br/>

## What Paperclip is not

|                              |                                                                                                                      |
| ---------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| **Not a chatbot.**           | Agents have jobs, not chat windows.                                                                                  |
| **Not an agent framework.**  | We don't tell you how to build agents. We tell you how to run a company made of them.                                |
| **Not a workflow builder.**  | No drag-and-drop pipelines. Paperclip models companies — with org charts, goals, budgets, and governance.            |
| **Not a prompt manager.**    | Agents bring their own prompts, models, and runtimes. Paperclip manages the organization they work in.               |
| **Not a single-agent tool.** | This is for teams. If you have one agent, you probably don't need Paperclip. If you have twenty — you definitely do. |

<br/>

## Quickstart

Open source. Self-hosted. No Paperclip account required.

```bash
npx paperclip onboard
```

Or manually:

```bash
git clone https://github.com/paperclip-dev/paperclip.git
cd paperclip
pnpm install
pnpm dev
```

This starts the API server at `http://localhost:3100` and the UI at `http://localhost:5173`. An embedded PostgreSQL database is created automatically — no setup required.

### With Docker

```bash
docker compose up --build
```

> **Requirements:** Node.js 20+, pnpm 9.15+

<br/>

## Architecture

```
┌──────────────────────────────────────────────────────┐
│                    You (the board)                    │
├──────────────────────────────────────────────────────┤
│                  Paperclip (control plane)            │
│                                                      │
│   Dashboard · Org Chart · Tasks · Goals · Budgets    │
│   Approvals · Activity Log · Cost Tracking           │
├──────────────────────────────────────────────────────┤
│                    Adapters                           │
│                                                      │
│   Claude  ·  OpenClaw  ·  Codex  ·  Cursor  ·  HTTP │
└──────────────────────────────────────────────────────┘
```

Paperclip is the **control plane**, not the execution plane. Agents run wherever they run and phone home. Adapters connect Paperclip to any execution environment.

**Stack:** TypeScript &middot; Express &middot; React 19 &middot; PostgreSQL &middot; Drizzle ORM &middot; TailwindCSS

<br/>

## FAQ

**How is Paperclip different from agents like OpenClaw or Claude Code?**
Paperclip _uses_ those agents. It orchestrates them into a company — with org charts, budgets, goals, governance, and accountability.

**Can I use my existing agents?**
Yes. Paperclip is unopinionated about agent runtimes. Your agents can be Claude Code sessions, OpenClaw bots, Python scripts, shell commands, HTTP webhooks — anything that can receive a heartbeat signal. Adapters connect Paperclip to whatever execution environment you use.

**What happens when an agent hits its budget limit?**
The agent auto-pauses and new tasks are blocked. You get a soft warning at 80%. As the board, you can override the limit at any time.

**Do agents run continuously?**
By default, agents run on scheduled heartbeats and event-based triggers (task assignment, @-mentions). You can also hook in continuous agents like OpenClaw.

**Can I run multiple companies?**
Yes. A single deployment can run dozens of companies with complete data isolation. Useful for separate ventures, testing strategies in parallel, or templating org configs for reuse.

**What does a typical setup look like?**
Locally, a single Node.js process manages an embedded Postgres and local file storage. For production, point it at your own Postgres and deploy however you like. Configure projects, agents, and goals — the agents take care of the rest.

<br/>

## Comparison

|                            | Paperclip | Agent frameworks (LangChain, CrewAI) | Single-agent tools (Claude Code, Cursor) |
| -------------------------- | --------- | ------------------------------------ | ---------------------------------------- |
| Multi-agent orchestration  | Yes       | Partial                              | No                                       |
| Org structure & hierarchy  | Yes       | No                                   | No                                       |
| Cost control & budgets     | Yes       | No                                   | No                                       |
| Goal alignment             | Yes       | No                                   | No                                       |
| Governance & approvals     | Yes       | No                                   | No                                       |
| Multi-company              | Yes       | No                                   | No                                       |
| Agent-agnostic             | Yes       | Framework-locked                     | Single provider                          |
| Ticket-based work tracking | Yes       | No                                   | No                                       |

<br/>

## Development

```bash
pnpm dev              # Full dev (API + UI)
pnpm dev:server       # Server only
pnpm dev:ui           # UI only
pnpm build            # Build all
pnpm typecheck        # Type checking
pnpm test:run         # Run tests
pnpm db:generate      # Generate DB migration
pnpm db:migrate       # Apply migrations
```

See [doc/DEVELOPING.md](doc/DEVELOPING.md) for the full development guide.

<br/>

## Contributing

We welcome contributions. See the [contributing guide](CONTRIBUTING.md) for details.

<!-- TODO: add CONTRIBUTING.md -->

<br/>

## Community

- [Discord](https://discord.gg/paperclip) — chat, questions, show & tell
- [GitHub Issues](https://github.com/paperclip-dev/paperclip/issues) — bugs and feature requests
- [GitHub Discussions](https://github.com/paperclip-dev/paperclip/discussions) — ideas and RFC

<br/>

## License

MIT &copy; 2026 Paperclip

<br/>

---

<p align="center">
  <sub>Open source under MIT. Built for people who want to run companies, not babysit agents.</sub>
</p>
