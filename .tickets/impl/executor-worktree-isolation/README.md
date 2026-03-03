---
id: executor-worktree-isolation
title: "Executor: Run Each Agent in an Isolated Git Worktree"
status: closed
type: feature
priority: 1
deps:
  - orchestrator-executor
links:
  - docs/spec/verification.md
services:
  - core
---

# Executor: Run Each Agent in an Isolated Git Worktree

## Problem

When the executor runs multiple agents concurrently, they all edit the same working tree. This causes:

1. **Type breakage** — one agent adds a required field, breaking another agent's test mocks mid-edit
2. **False failures** — the write-tracking gate sees a jumbled mix of changes and can't attribute them
3. **Untangleable diffs** — uncommitted changes from 3 tickets end up interleaved, impossible to commit cleanly
4. **No rollback** — if one agent's work is bad, you can't revert it without losing the others

This was observed in practice: 3 agents (cicd-integration, cloud-database-adapters, executor-test-gate) ran concurrently, all marked "failed" despite doing real work, because they stomped on each other's types and the executor couldn't track writes correctly.

## Design

### Lifecycle

1. **Step starts** — executor creates a worktree:
   ```
   git worktree add .opcom/worktrees/<step-id> -b work/<ticket-id>
   ```
2. **Agent runs** — `AgentStartConfig.cwd` points to the worktree, not the main tree. Agent makes commits on its own branch.
3. **Step completes** — test gate runs inside the worktree (isolated build + test). Write tracking counts commits on the branch instead of tool events.
4. **Merge** — executor merges the branch into main (fast-forward or merge commit), then removes the worktree:
   ```
   git merge work/<ticket-id>
   git worktree remove .opcom/worktrees/<step-id>
   ```
5. **Conflict** — if merge conflicts with main (another step merged first), mark step as `needs-rebase` and either auto-rebase or flag for manual resolution.

### Setup Cost

Each worktree needs `npm install` before the agent can build/test (~10s). This is acceptable given agent runs are 5-15 minutes.

### Write Tracking

Replace the current `tool_end` event counting (which was broken — toolName wasn't propagated) with branch-based detection:
- After agent exits, check `git log main..work/<ticket-id> --oneline` in the worktree
- If no commits on the branch, step failed (agent made no changes)
- If commits exist, proceed to test gate

This is more reliable than event-based counting since it survives stream parsing bugs.

## Tasks

- [ ] Add `WorktreeManager` to `packages/core/src/orchestrator/worktree.ts`:
  - `create(stepId, ticketId, baseBranch?)` — creates worktree + branch
  - `remove(stepId)` — cleans up worktree
  - `merge(stepId, targetBranch)` — merges branch, handles conflicts
  - `hasCommits(stepId)` — checks if agent made any commits
  - `runInWorktree(stepId, command)` — exec helper for test gate
- [ ] Update `Executor.startStep()` to create worktree before starting agent
- [ ] Pass worktree path as `cwd` in `AgentStartConfig`
- [ ] Update completion check: use `hasCommits()` instead of `sessionWrites` counter
- [ ] Run test gate inside worktree directory
- [ ] Merge worktree branch on step success, before starting dependent steps
- [ ] Handle merge conflicts: mark step `needs-rebase`, pause plan if `pauseOnFailure`
- [ ] Add `npm install` step during worktree creation (or share node_modules via symlink)
- [ ] Add `worktree: true` to `PlanConfig` (default: true for new plans)
- [ ] Clean up orphaned worktrees on executor startup (from crashed runs)
- [ ] Tests: mock git operations, verify lifecycle, verify conflict handling

## Acceptance Criteria

- Each agent runs in its own worktree with its own branch
- Agents cannot see or interfere with each other's uncommitted changes
- Test gate runs in isolation (build + test in worktree)
- Successful steps are merged into main before dependent steps start
- Merge conflicts are detected and surfaced (not silently lost)
- Orphaned worktrees from crashed runs are cleaned up on next start
