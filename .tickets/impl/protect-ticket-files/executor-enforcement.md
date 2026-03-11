---
id: executor-enforcement
title: "Enforce denyPaths in executor write interception"
status: closed
type: feature
priority: 1
parent: protect-ticket-files
deps:
  - deny-paths-type-and-config
links:
  - docs/spec/roles.md
---

# Enforce denyPaths in executor

## Context Packet

**Goal:** Before an agent writes to a file, check the path against the role's `denyPaths` globs. Reject with a clear error and emit a `denied_write` event.

**Non-Goals:** Blocking executor-initiated writes (like `updateTicketStatus`) — those bypass role restrictions.

**Constraints:** Must use glob matching (minimatch or similar). Must not add latency to non-denied writes.

**Repo Anchors:**
- `packages/core/src/orchestrator/executor.ts` — write interception, `updateTicketStatusSafe()`
- `packages/core/src/config/roles.ts` — resolved role config with denyPaths

**Oracle (Done When):**
- [ ] Agent write to `.tickets/` path is rejected with clear error message
- [ ] `denied_write` event emitted with file path and role info
- [ ] `updateTicketStatus()` (executor-initiated) is NOT affected
- [ ] Planner role can still write to `.tickets/`

## Tasks

- [ ] Add path check against denyPaths globs before agent write operations
- [ ] Return clear error: "Cannot modify .tickets/ — ticket files are read-only during execution"
- [ ] Emit `denied_write` event for TUI/logging
- [ ] Ensure executor's own status updates bypass the check
