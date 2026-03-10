---
id: ticket-subtask-scanning
title: "Scan sibling .md files as sub-tickets within ticket directories"
status: closed
type: feature
priority: 1
deps: []
links:
  - docs/spec/orchestrator.md
services:
  - core
---

# Scan Sibling .md Files as Sub-Tickets

## Problem

`scanTickets` only reads `README.md` from each `.tickets/impl/<id>/` directory. But projects like Folia use sibling `.md` files as sub-tasks:

```
.tickets/impl/pipeline-v2/
  README.md              ← parent ticket (152 task checkboxes)
  argo-executor.md       ← sub-ticket with own frontmatter
  cost-estimation.md     ← sub-ticket with deps, status, priority
  scheduling.md          ← ...
  cloud-batch.md
```

Each sub-task file has full frontmatter (id, deps, status, priority) and a `dir:` field pointing to the parent. opcom ignores all of them — it sees `pipeline-v2` as a single plan step even though it contains 24 independently schedulable sub-tickets.

This means the planner creates 1-step tracks for massive epics instead of decomposing them into a proper DAG.

## Goal

`scanTickets` reads `*.md` sibling files inside ticket directories as child WorkItems. The planner then treats the parent as an epic (excluded from steps) and schedules children independently, with their own deps, tracks, and stages.

## Design

In `scanTickets` (`packages/core/src/detection/tickets.ts`):

1. For each ticket directory, after reading `README.md`, also scan for `*.md` files (excluding `README.md`)
2. Parse each sibling file with `parseTicketFile` — they already have valid frontmatter
3. Infer `parent` from either:
   - The `dir:` frontmatter field (Folia convention), or
   - The containing directory name (fallback)
4. Return both parent and child WorkItems

The planner already handles parent/child correctly:
- `findParentTicketIds` identifies parents that have children in scope
- Parents are excluded from plan steps (line 122: `if (parentIds.has(ticketId)) continue`)
- Children become the actual steps with their own `blockedBy` from `deps:`

## Tasks

- [ ] Update `scanTickets` to glob `*.md` (not just `README.md`) in each ticket directory
- [ ] Parse sibling `.md` files as WorkItems with `parent` inferred from directory name or `dir:` field
- [ ] Ensure `parseTicketFile` handles both `README.md` and named `.md` files (use filename stem as fallback `id`)
- [ ] Skip non-ticket `.md` files gracefully (e.g. no frontmatter → skip)
- [ ] Tests: directory with siblings produces parent + children, parent excluded from plan steps, children have correct deps and parent ref
- [ ] Verify with Folia's `pipeline-v2/` directory (24 sub-tickets) — plan should produce 24 steps instead of 1

## Acceptance Criteria

- `scanTickets` returns sub-tickets from sibling `.md` files
- Parent ticket with children is excluded from plan steps
- Child tickets are independently scheduled with their own deps/priority
- Existing projects with only `README.md` per directory are unaffected
- Folia plan for `pipeline-v2` produces a multi-step track instead of a single step
