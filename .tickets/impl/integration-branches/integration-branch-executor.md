---
id: integration-branch-executor
title: "Executor integration branch lifecycle"
status: open
type: feature
priority: 2
created: 2026-03-15
parent: integration-branches
deps:
  - integration-branch-planner
links:
  - docs/spec/orchestrator.md#integration-branches
---

# Executor Integration Branch Lifecycle

## Context Packet

**Goal:** Wire the executor to create integration branches before children start, route child worktree creation and merges through the integration branch, run a final gate when all children complete, and merge the integration branch to main.

**Non-Goals:** Planner detection (done in prior ticket). New WorktreeManager methods (done in types ticket). TUI display changes for integration branch status.

**Constraints:**
- Must not change behavior for non-integration steps (standalone tickets, swarm subtasks)
- Integration branch is created lazily — only when the first child step is about to start
- Final gate uses full test suite + oracle (not modular)
- Auto-rebase for children targets the integration branch, not main
- Integration branch is NOT rebased onto main during execution — only at final merge
- On plan cancellation, integration branch must be cleaned up

**Repo Anchors:**
- `packages/core/src/orchestrator/executor.ts` — `startStep()`, `handleWorktreeCompletion()`, merge logic, rebase logic, plan completion
- `packages/core/src/orchestrator/worktree.ts` — `create()` baseBranch, `merge()` targetBranch, new bare-branch methods
- `packages/core/src/orchestrator/planner.ts` — `integrationBranch` field on steps (set by prior ticket)

**Prior Art:**
- `WorktreeManager.create()` already accepts `baseBranch` — just pass the integration branch
- `WorktreeManager.merge()` already accepts `targetBranch` — just pass the integration branch
- Swarm final-subtask logic (`isFinalSwarmSubtask()` → merge all accumulated work) is analogous to the final gate pattern
- `hasCommits()` comparison base needs to use integration branch HEAD instead of main HEAD for children

**Oracle (Done When):**
- [ ] Integration branch (`work/<parent-id>`) is created before the first child step starts
- [ ] Child worktrees branch from the integration branch (not main)
- [ ] Child merges target the integration branch (not main)
- [ ] `hasCommits()` for child steps compares against integration branch HEAD, not main HEAD
- [ ] Auto-rebase for children targets the integration branch
- [ ] When all children are done/skipped, full verification runs on the integration branch
- [ ] After final gate passes, integration branch merges to main with `--no-ff`
- [ ] Integration branch and its worktree refs are cleaned up after merge to main
- [ ] On plan cancellation or parent skip, integration branch is deleted
- [ ] Non-integration steps (standalone, swarm) behave exactly as before
- [ ] Existing executor tests pass, no regressions

**Risks:**
- `hasCommits()` currently compares against main HEAD — needs to compare against integration branch HEAD for children. If missed, children will always appear to have commits (since the integration branch diverges from main).
- Race condition: two children unblock simultaneously, both try to create integration branch. Mitigation: check if branch exists before creating, or create lazily on first child start with a guard.
- Long-running plans with many children may accumulate significant drift from main. The final rebase could be large. Mitigation: same auto-rebase + `needs-rebase` flow as today.

## Tasks

- [ ] Create integration branch lazily before first child step starts
- [ ] Route child worktree creation through integration branch as baseBranch (deps: create-integration-branch-lazily-before-first-child-step-starts)
- [ ] Route child merges through integration branch as targetBranch (deps: route-child-worktree-creation-through-integration-branch-as-basebranch)
- [ ] Update hasCommits to compare against integration branch HEAD for child steps (deps: route-child-merges-through-integration-branch-as-targetbranch)
- [ ] Route child auto-rebase to target integration branch (deps: update-hascommits-to-compare-against-integration-branch-head-for-child-steps)
- [ ] Implement final gate: detect all-children-done, run full verification, merge to main (deps: route-child-auto-rebase-to-target-integration-branch)
- [ ] Cleanup integration branch on plan cancellation or parent skip (deps: implement-final-gate-detect-all-children-done-run-full-verification-merge-to-main)
