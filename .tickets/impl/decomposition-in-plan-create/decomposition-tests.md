---
id: decomposition-tests
title: "Tests for decomposition in plan creation"
status: open
type: feature
priority: 1
parent: decomposition-in-plan-create
deps:
  - cli-assessment-wiring
links:
  - docs/spec/orchestrator.md#ticket-decomposition
---

# Tests for decomposition in plan creation

## Context Packet

**Goal:** Verify the full decomposition flow: assessment triggers warnings, decompose creates sub-tickets, skip preserves original, already-decomposed tickets are skipped.

**Repo Anchors:**
- `packages/core/src/orchestrator/decomposition.test.ts` — existing decomposition tests
- `tests/orchestrator/` — planner/executor test patterns

**Oracle (Done When):**
- [ ] Test: oversized ticket triggers decomposition warning
- [ ] Test: decompose action creates sub-ticket files on disk
- [ ] Test: skip preserves original ticket unchanged
- [ ] Test: already-decomposed tickets (with children) are not flagged
- [ ] Test: --decompose flag auto-decomposes without prompt
- [ ] Test: --no-decompose flag skips assessment entirely

## Tasks

- [ ] Write tests for assessment triggering in plan create flow
- [ ] Write tests for decompose/skip/abort behavior
- [ ] Write tests for CLI flags
