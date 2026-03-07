---
id: verification-pipeline-visibility
title: "Verification Pipeline: Zero-Commit Oracle Arbitration and Live Progress Visibility"
status: open
type: feature
priority: 2
deps:
  - oracle-verification-gate
  - tui-verification-display
links:
  - docs/spec/verification.md
services:
  - types
  - core
  - cli
---

# Verification Pipeline: Zero-Commit Oracle Arbitration and Live Progress Visibility

## Problem

Two gaps in the verification pipeline:

1. **Zero-commit hard failure is too aggressive.** When an agent exits without commits, the executor immediately fails the step. But the work may already be done (previous step implemented it, ticket describes existing behavior). Now that oracle is on by default, it should arbitrate this case — run against current state with no diff, and if acceptance criteria are met, mark the step done.

2. **Verification is opaque while running.** The step shows `◎ verifying` with no indication of what's happening inside. The user can't tell if tests are running, if the oracle LLM call is in progress, or how long it's been. Tests are a shell subprocess; oracle is an LLM call to Claude — these are meaningfully different operations that deserve distinct visibility.

## Tasks

### Zero-Commit Oracle Arbitration (executor)

- [ ] In `handleWorktreeCompletion()`, when `!hasWork` and oracle is enabled:
  - Set step to `verifying` instead of immediate failure
  - Run oracle only (skip tests — no changes means test results are unchanged)
  - If oracle passes: mark step `done` with verification result, no merge needed
  - If oracle fails: fail step with structured oracle feedback (same as normal failure)
  - If oracle disabled: preserve current behavior (immediate failure)
- [ ] Handle retry loop for zero-commit oracle failure (agent gets oracle feedback, tries again)
- [ ] Log `step_verified` event with `{ zeroCommit: true }` for analytics

### Verification Sub-Phase Tracking (types + executor)

- [ ] Add `verifyingPhase?: "testing" | "oracle"` to `PlanStep` in `packages/types/src/plan.ts`
- [ ] Executor sets `step.verifyingPhase = "testing"` before `runTestGate()`
- [ ] Executor sets `step.verifyingPhase = "oracle"` before `runOracle()`
- [ ] Executor clears `step.verifyingPhase` after verification completes
- [ ] Emit `step_verify_phase` event: `{ stepTicketId, phase, startedAt }`

### TUI Verification Progress (cli)

- [ ] Dashboard plan panel: show sub-phase in step row
  - `◎ testing...` when test gate is running
  - `◎ oracle...` when oracle LLM call is running
- [ ] Plan step focus view: when step is `verifying`, show:
  - Current sub-phase with elapsed time (`Testing... (12s)`)
  - If test gate done and oracle running: show test results above oracle status
  - Oracle model name from config
- [ ] Subscribe to `step_verify_phase` events for real-time updates

### Tests

- [ ] Executor: zero-commit + oracle pass -> step done
- [ ] Executor: zero-commit + oracle fail -> step failed with feedback
- [ ] Executor: zero-commit + oracle disabled -> immediate failure (current behavior)
- [ ] Executor: zero-commit oracle failure enters retry loop
- [ ] Executor: verifyingPhase set/cleared correctly during pipeline
- [ ] TUI: renders testing/oracle sub-phases correctly

## Acceptance Criteria

- Agent exiting with 0 commits does not auto-fail when oracle is enabled
- Oracle evaluates acceptance criteria against current codebase state (empty diff)
- If criteria are already met, step completes without any commits
- TUI shows distinct sub-phases during verification (`testing` vs `oracle`)
- Plan step focus view shows elapsed time and oracle model during verification
- All verification sub-phase transitions emit events for real-time TUI updates
