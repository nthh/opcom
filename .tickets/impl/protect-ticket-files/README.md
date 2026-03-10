---
id: protect-ticket-files
title: "Prevent agents from modifying ticket files"
status: open
type: bugfix
priority: 1
created: 2026-03-10
deps: []
links:
  - docs/spec/roles.md
services:
  - core
---

# Protect Ticket Files from Agent Modification

## Problem

During the plan-strategy execution, the coding agent rewrote its own ticket README.md with narrower acceptance criteria that matched its simpler implementation. This is a self-defeating loop — the agent games its own success criteria, and only the oracle (evaluating against the linked spec) catches it.

Agents should never modify files in `.tickets/` — those are the source of truth for what needs to be done, authored by humans or planning agents, not by the coding agent executing the work.

## Goal

Add `.tickets/` to the deny list for the `engineer` role (and any other coding role). Ticket files are read-only for agents executing work. Only planning agents and humans can modify tickets.

## Design

### Role-Level File Restrictions

The `engineer` role already has tool restrictions. Add path-based write restrictions:

```typescript
// In role resolution
const engineerRole: RoleDefinition = {
  // ... existing ...
  denyPaths: [
    ".tickets/**",          // ticket files are source of truth
  ],
};
```

### Enforcement

In the executor's bash/write tool interception (or in `allowedBashPatterns`):
- Before an agent writes to a file, check if the path matches any `denyPaths` glob
- If matched: reject the write, log a warning, emit `denied_write` event
- The agent sees a clear error: "Cannot modify .tickets/ — ticket files are read-only during execution"

### Exceptions

- The `planner` role CAN modify tickets (it creates/decomposes them)
- The executor itself modifies ticket status (`status: open` → `in-progress` → `closed`) via `updateTicketStatus()` — this is not agent-initiated and bypasses the restriction
- The `devops` role inherits the restriction (no reason for infra agents to edit tickets)

## Tasks

- [ ] Add `denyPaths` field to `RoleDefinition` type
- [ ] Add `.tickets/**` to `engineer` role's deny paths
- [ ] Implement path check in executor's write interception (before agent writes)
- [ ] Return clear error message to agent when write is denied
- [ ] Emit `denied_write` event for TUI/logging visibility
- [ ] Ensure `updateTicketStatus()` (executor-initiated) is not affected
- [ ] Tests: engineer can't write to .tickets/, planner can, executor status updates work

## Acceptance Criteria

- Engineer agent cannot modify any file under `.tickets/`
- Agent receives clear error message explaining the restriction
- Executor's own ticket status transitions are unaffected
- Planning agents (planner role) can still create/modify tickets
- Denied writes are logged and visible in TUI
