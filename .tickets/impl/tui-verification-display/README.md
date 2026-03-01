---
id: tui-verification-display
title: "TUI: Display Verification and Test Gate Results"
status: open
type: feature
priority: 2
deps:
  - executor-test-gate
links:
  - docs/spec/tui.md
  - docs/spec/verification.md
services:
  - types
  - core
  - cli
---

# TUI: Display Verification and Test Gate Results

## Problem

Test gate results and oracle per-criterion pass/fail have nowhere to appear in the TUI. The types exist (`TestGateResult`, `VerificationResult` in `packages/types/src/plan.ts`) but nothing renders them.

## Tasks

- [ ] Add `verification?: VerificationResult` field to `PlanStep` in `packages/types/src/plan.ts`
- [ ] Show verification status inline in plan panel step rows:
  - Checkmark after step icon when verification passed
  - X mark when verification failed
  - No indicator when verification hasn't run yet
- [ ] Show verification detail in agent focus view:
  - Test counts (passed/failed/total)
  - Oracle criteria with individual pass/fail
  - Duration
- [ ] Emit `step_test_gate` and `step_oracle` events from the executor that the TUI can consume
- [ ] TUI subscribes to verification events and updates plan step display in real time
- [ ] Tests: verify rendering of pass/fail states, verify event consumption

## Acceptance Criteria

- Plan step rows show pass/fail indicator after verification runs
- Agent focus view shows full test gate results (counts, failures)
- Agent focus view shows oracle criteria with per-criterion pass/fail
- Verification results update in real time as events arrive
