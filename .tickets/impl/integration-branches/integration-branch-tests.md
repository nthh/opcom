---
id: integration-branch-tests
title: "Integration branch end-to-end tests"
status: closed
type: test
priority: 2
created: 2026-03-15
parent: integration-branches
deps:
  - integration-branch-executor
links:
  - docs/spec/orchestrator.md#integration-branches
---

# Integration Branch End-to-End Tests

## Context Packet

**Goal:** Comprehensive test coverage for the integration branch feature — planner detection, executor lifecycle, merge topology, rebase handling, and edge cases.

**Non-Goals:** Unit tests for individual methods (those are covered in the prior tickets' task lists). This ticket focuses on integration and end-to-end scenarios.

**Constraints:**
- Tests must use real git repos (not mocks) for worktree/merge/rebase scenarios
- Must cover the full lifecycle: plan → create integration branch → children execute → merges → final gate → merge to main
- Must verify non-integration paths are unaffected

**Repo Anchors:**
- `tests/orchestrator/planner.test.ts` — existing planner tests, add integration branch detection cases
- `tests/orchestrator/executor.test.ts` — existing executor tests, add integration branch lifecycle cases
- `tests/orchestrator/worktree.test.ts` — existing worktree tests, add bare-branch method cases

**Prior Art:** Existing worktree tests in `tests/orchestrator/worktree.test.ts` use temporary git repos with `execFileAsync`. Follow the same pattern for integration branch tests.

**Oracle (Done When):**
- [ ] Test: parent with 3 child tickets → planner sets `integrationBranch` on all 3 child steps
- [ ] Test: standalone ticket → no `integrationBranch` set
- [ ] Test: `worktree: false` → no `integrationBranch` set even for children
- [ ] Test: child worktree branches from integration branch (verify git log shows integration branch as base)
- [ ] Test: child merge targets integration branch (verify commit is on integration branch, not main)
- [ ] Test: dependency ordering — child B's worktree includes child A's merged code
- [ ] Test: final gate runs when all children complete, merges integration branch to main
- [ ] Test: main has single merge commit containing all children's work
- [ ] Test: integration branch is deleted after successful merge to main
- [ ] Test: child→integration rebase conflict triggers auto-rebase (not child→main)
- [ ] Test: integration→main rebase conflict at final merge triggers `needs-rebase`
- [ ] Test: plan cancellation deletes integration branch
- [ ] Test: mixed plan (some tickets have parents, some don't) — only parent children use integration branches

**Risks:** Test setup complexity — need to simulate a full parent/child ticket structure with real git repos. Mitigate by extracting test helpers for creating ticket hierarchies.

## Tasks

- [ ] Planner integration branch detection tests
- [ ] Executor integration branch lifecycle tests (deps: planner-integration-branch-detection-tests)
- [ ] Rebase and conflict handling tests (deps: executor-integration-branch-lifecycle-tests)
- [ ] Edge case and mixed-plan tests (deps: executor-integration-branch-lifecycle-tests)
