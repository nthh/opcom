---
id: verifying-step-status
title: "Add 'verifying' step status to plan execution"
status: closed
type: feature
priority: 1
created: 2026-03-06
deps: []
links:
  - docs/spec/orchestrator.md
  - docs/spec/verification.md
---

# Add 'verifying' step status to plan execution

## Goal

Make the verification pipeline visible in the TUI. When an agent exits and the test suite / oracle is running, the step should show `verifying` (orange ◎) instead of staying `in-progress`.

## Tasks

- [x] Add `"verifying"` to `StepStatus` type union
- [x] Executor sets `step.status = "verifying"` before running verification pipeline
- [x] `verifying` treated as sticky in planner recomputation
- [x] `verifying` counts as an occupied slot in `startReadySteps()`
- [x] `verifying` treated as active for worktree cleanup
- [x] TUI dashboard: `◎` icon in orange for verifying status
- [x] TUI plan-step-focus: `◎` icon in orange for verifying status
- [x] Add `ANSI.orange` (256-color 208) to renderer
- [x] Update orchestrator spec step status table

## Acceptance Criteria

- Steps transition from `in-progress` → `verifying` → `done`/`failed` visibly in the TUI
- Verifying steps are orange, distinct from yellow in-progress
- Verifying steps count toward concurrency limits
- All existing tests pass
