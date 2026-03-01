---
id: executor-test-gate
title: "Executor: Run Tests as Completion Gate"
status: open
type: feature
priority: 1
deps:
  - orchestrator-executor
links:
  - docs/spec/verification.md
services:
  - core
---

# Executor: Run Tests as Completion Gate

## Goal

After an agent completes a step, run the project's test suite before marking the step as "done." This catches broken code that the agent didn't notice — currently the executor only checks write counts, which is unreliable.

## Tasks

- [ ] Add `TestGateResult` type to `packages/types/src/plan.ts`
  - `{ passed, testCommand, totalTests, passedTests, failedTests, output, durationMs }`
- [ ] Create `packages/core/src/orchestrator/test-gate.ts`:
  - [ ] `runTestGate(projectPath, testCommand?)` — exec test command, parse exit code, capture output
  - [ ] Use `project.testing.command` or fall back to `npm test`
  - [ ] Capture last 200 lines of output for event store
  - [ ] Parse test count from vitest/jest output if possible (regex on "X passed")
- [ ] Add `verification` config to `OrchestratorConfig`:
  - `{ runTests: boolean, runOracle: boolean, oracleModel?: string }`
  - Default: `runTests: true, runOracle: false`
- [ ] Wire into executor `agent_completed` handler:
  - After auto-commit, before marking step done
  - If tests fail: step.status = "failed", step.error includes test output summary
  - Store `TestGateResult` in plan_events as `step_test_gate` event
- [ ] If `pauseOnFailure` is true and tests fail, pause the plan
- [ ] Tests: mock test command execution, verify gate behavior on pass/fail

## Acceptance Criteria

- Steps are only marked "done" if project tests pass after agent work
- Test failures produce a clear error message with which tests failed
- Test results are stored in the event store for analytics
- Test gate can be disabled via `config.verification.runTests = false`
