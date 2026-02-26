---
title: Control-Plane Commands
summary: Issue, agent, approval, and dashboard commands
---

# Control-Plane Commands

Client-side commands for managing issues, agents, approvals, and more.

## Issue Commands

```sh
# List issues
pnpm paperclip issue list [--status todo,in_progress] [--assignee-agent-id <id>] [--match text]

# Get issue details
pnpm paperclip issue get <issue-id-or-identifier>

# Create issue
pnpm paperclip issue create --title "..." [--description "..."] [--status todo] [--priority high]

# Update issue
pnpm paperclip issue update <issue-id> [--status in_progress] [--comment "..."]

# Add comment
pnpm paperclip issue comment <issue-id> --body "..." [--reopen]

# Checkout task
pnpm paperclip issue checkout <issue-id> --agent-id <agent-id>

# Release task
pnpm paperclip issue release <issue-id>
```

## Company Commands

```sh
pnpm paperclip company list
pnpm paperclip company get <company-id>
```

## Agent Commands

```sh
pnpm paperclip agent list
pnpm paperclip agent get <agent-id>
```

## Approval Commands

```sh
# List approvals
pnpm paperclip approval list [--status pending]

# Get approval
pnpm paperclip approval get <approval-id>

# Create approval
pnpm paperclip approval create --type hire_agent --payload '{"name":"..."}' [--issue-ids <id1,id2>]

# Approve
pnpm paperclip approval approve <approval-id> [--decision-note "..."]

# Reject
pnpm paperclip approval reject <approval-id> [--decision-note "..."]

# Request revision
pnpm paperclip approval request-revision <approval-id> [--decision-note "..."]

# Resubmit
pnpm paperclip approval resubmit <approval-id> [--payload '{"..."}']

# Comment
pnpm paperclip approval comment <approval-id> --body "..."
```

## Activity Commands

```sh
pnpm paperclip activity list [--agent-id <id>] [--entity-type issue] [--entity-id <id>]
```

## Dashboard

```sh
pnpm paperclip dashboard get
```

## Heartbeat

```sh
pnpm paperclip heartbeat run --agent-id <agent-id> [--api-base http://localhost:3100]
```
