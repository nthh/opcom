---
id: integration-branch-types
title: "Integration branch types and WorktreeManager helpers"
status: closed
type: feature
priority: 2
created: 2026-03-15
parent: integration-branches
deps: []
links:
  - docs/spec/orchestrator.md#integration-branches
---

# Integration Branch Types and WorktreeManager Helpers

## Context Packet

**Goal:** Add the `integrationBranch` field to `PlanStep` and bare-branch management methods to `WorktreeManager` so the planner and executor can use integration branches.

**Non-Goals:** Planner detection logic, executor wiring, or final gate — those are separate tickets.

**Constraints:**
- No breaking changes to existing `PlanStep` consumers — field is optional
- Bare-branch methods must work without creating a worktree directory
- Branch naming must follow existing `work/<id>` convention

**Repo Anchors:**
- `packages/types/src/plan.ts` — PlanStep definition, add `integrationBranch` field
- `packages/core/src/orchestrator/worktree.ts` — WorktreeManager, add bare-branch methods

**Prior Art:** `WorktreeManager.create()` already accepts `baseBranch` parameter. `merge()` already accepts `targetBranch`. The new methods are simpler — just branch creation/deletion without worktree directories.

**Oracle (Done When):**
- [ ] `PlanStep` has `integrationBranch?: string` field
- [ ] `WorktreeManager.createBranch(projectPath, branchName, base?)` creates a git branch without a worktree directory
- [ ] `WorktreeManager.deleteBranch(projectPath, branchName)` deletes a branch
- [ ] `WorktreeManager.mergeIntegrationBranch(projectPath, branchName, targetBranch?)` merges an integration branch to target (default: current branch) with `--no-ff`
- [ ] Existing tests pass, no regressions

**Risks:** Minimal — additive changes only. No existing behavior is modified.

## Tasks

- [ ] Add `integrationBranch` field to PlanStep type
- [ ] Add `createBranch`, `deleteBranch`, `mergeIntegrationBranch` methods to WorktreeManager (deps: add-integrationbranch-field-to-planstep-type)
- [ ] Unit tests for new WorktreeManager methods (deps: add-createbranch-deletebranch-mergeintegrationbranch-methods-to-worktreemanager)
