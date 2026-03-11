---
id: ticket-id
title: "Ticket Title"
status: open
type: feature
priority: 1
created: 2026-XX-XX
milestone: phase-N
deps: []
links: []
---

# Ticket Title

## Context Packet

**Goal:** One sentence — the outcome, not the mechanism.

**Non-Goals:** What is explicitly out of scope.

**Constraints:** Invariants that must hold (e.g., no new deps, backwards compatible, p99 < Xms).

**Repo Anchors:** 3-10 files that define truth for this change.
- `path/to/file.ts` — why it matters
- `path/to/other.ts` — why it matters

**Prior Art:** What to copy from, what to avoid reinventing.

**Oracle (Done When):**
- [ ] Testable acceptance criterion 1
- [ ] Testable acceptance criterion 2

**Risks:** How could this fail? Rollback plan?

## Tasks

Task lines are parsed by the planner. **Default is parallel** — all tasks without explicit deps run concurrently in a shared worktree. Tasks that build on each other MUST have `(deps:)` or `(sequential)` markers, otherwise agents will conflict.

Common pattern: types → implementation → wiring → tests
- [ ] Define types and interfaces
- [ ] Implement core logic (deps: define-types-and-interfaces)
- [ ] Wire into CLI/TUI (deps: implement-core-logic)
- [ ] Tests (deps: wire-into-cli-tui)

Genuinely independent tasks need no markers (they run in parallel):
- [ ] Add R2 adapter (deps: define-types-and-interfaces)
- [ ] Add GCS adapter (deps: define-types-and-interfaces)
- [ ] Add S3 adapter (deps: define-types-and-interfaces)

Other markers:
- `(sequential)` — depends on the previous task in the list
- `(parallel)` or `[P]` — explicit parallel (same as default, documents intent)
- Folia-style: `T001 [P]` prefix sets the task ID explicitly

## Notes

Additional context, links, or open questions.
