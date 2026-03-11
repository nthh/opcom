---
id: protect-tests
title: "Tests for ticket file protection"
status: closed
type: feature
priority: 1
parent: protect-ticket-files
deps:
  - executor-enforcement
links:
  - docs/spec/roles.md
---

# Tests for ticket file protection

## Context Packet

**Goal:** Verify the full protection pipeline: engineer denied, planner allowed, executor unaffected.

**Repo Anchors:**
- `tests/orchestrator/` — executor test patterns
- `tests/config/` — role config tests

**Oracle (Done When):**
- [ ] Test: engineer role write to `.tickets/foo.md` is rejected
- [ ] Test: planner role write to `.tickets/foo.md` is allowed
- [ ] Test: executor `updateTicketStatus()` succeeds (not agent-initiated)
- [ ] Test: denied write emits event with correct details
- [ ] Test: non-ticket paths are unaffected by denyPaths

## Tasks

- [ ] Write tests for denyPaths enforcement in executor
- [ ] Write tests for role config with denyPaths
- [ ] Write test for executor status update bypass
