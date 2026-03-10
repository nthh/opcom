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

Task lines are parsed by the planner. Default is parallel — only add deps when ordering matters.

- [ ] Task description
- [ ] Task description (deps: task-description)
- [ ] Task description (sequential)

Folia-style IDs also supported:
- [ ] T001 [P] Task description
- [ ] T002 Task description (deps: t001)

## Notes

Additional context, links, or open questions.
