---
id: integration-smoke-tests
title: "Integration Smoke Tests: Build + Full Test Suite After Plan Completion"
status: closed
type: feature
priority: 3
deps:
  - executor-test-gate
links:
  - docs/spec/verification.md
services:
  - core
---

# Integration Smoke Tests

## Goal

Individual step tests verify each agent's work in isolation. But concurrent agents can create cross-step conflicts — two agents editing the same file, incompatible type changes, import breakage. Run a full build + test suite after plan completion (or after each batch of concurrent steps) to catch these.

## Tasks

- [ ] Add `IntegrationTestResult` type:
  - `{ passed, buildPassed, testsPassed, buildOutput, testOutput, durationMs }`
- [ ] Create `packages/core/src/orchestrator/smoke-test.ts`:
  - [ ] `runSmoke(projectPath)` — run `npm run build && npm test`
  - [ ] Capture output, parse results
  - [ ] Non-fatal: stores result but doesn't block plan status
- [ ] Wire into executor at two points:
  - [ ] After each concurrent batch completes (all in-progress steps done, before next batch)
  - [ ] After plan completion (final smoke test)
- [ ] Store results in plan_events as `smoke_test` event
- [ ] If smoke fails after batch: pause plan, report which batch broke the build
- [ ] TUI: show smoke test status in plan completion summary
- [ ] Tests: mock build/test commands, verify smoke runs at correct points

## Acceptance Criteria

- Full build + test suite runs after each batch of concurrent agents
- Build failures after a batch pause the plan with clear error
- Plan completion summary includes final smoke test result
- Smoke test results are stored in event store
