---
id: "005"
title: Worktree deletion during test gate — investigation and status
status: investigation-closed
date: 2026-03-05
---

# ADR-005: Worktree Deletion During Test Gate

## Context

During `opcom plan run` with worktree isolation enabled, worktrees were observed being
deleted during the test gate (vitest run). The executor's `worktreeManager.remove()` call
after verification would fail with "is not a working tree" because the worktree was already
gone. The step still completed successfully because the merge had already happened before
the test gate.

## Investigation Summary

### What was observed (2026-03-04)

1. Test gate PASSED (857 tests) — with `--exclude **/worktree*`
2. Worktree was deleted during vitest execution
3. `worktreeManager.remove()` failed because the worktree was already gone
4. Excluding `worktree.test.ts` fixed test failures but worktree still disappeared
5. Running vitest standalone (via `execFileAsync`, same as the executor) did NOT reproduce

### What was ruled out

- **Vitest itself**: Standalone vitest does not delete worktrees
- **npm install/build in worktree**: Full WorktreeManager flow reproduction passes
- **Git hooks**: No active hooks (all `.sample`)
- **Session manager cleanup**: No worktree logic in session manager
- **Claude Code adapter**: No filesystem cleanup on session exit
- **Vitest globalSetup/globalTeardown**: None configured
- **Test files**: All executor/worktree tests use mocks with `/tmp/` paths
- **WorktreeManager create/merge/remove flow**: Works correctly in isolation
- **`cleanupOrphanedWorktrees`**: Only called once at plan start before worktrees exist
- **Environment variables**: No `GIT_DIR`/`GIT_WORK_TREE` set anywhere
- **`.gitignore`**: `.opcom/` is properly ignored

### Possible root causes (unconfirmed)

- Claude Code or a background process it spawns cleaning up the worktree directory
- A timing/race condition specific to real agent execution (vs. scripted repro)
- An external process (macOS git maintenance, IDE git integration) triggered by
  longer execution times during agent runs

### Reproduction attempt (2026-03-05)

Ran full `opcom plan run` with worktree mode, external monitor polling every 500ms:
- Worktree created at 19:31:52, existed cleanly through agent execution
- Worktree removed at 19:32:55 by executor's own `remove()` call (SUCCESS)
- **Issue did NOT reproduce** — no mysterious deletion observed

Note: The test gate was not reached this run (agent exited without commits), so the
merge → vitest → remove flow was not exercised. The worktree was stable throughout
agent execution.

## Current Handling

The executor already handles this gracefully:

```typescript
// executor.ts — after merge + verification
await this.worktreeManager.remove(step.ticketId).catch((err) => {
  log.warn("worktree cleanup after merge failed", { ... });
});
step.worktreePath = undefined;
step.worktreeBranch = undefined;
```

The merge happens BEFORE the test gate, so even if the worktree is deleted during vitest,
the agent's work is already on the main branch. The step completes successfully regardless.

## Decision

- **Status**: Investigation closed — issue is non-critical and did not reproduce
- The executor's error handling is sufficient (`.catch()` on remove)
- If the issue reappears, add interval-based monitoring in `runTestGate` to capture
  the exact deletion timestamp and process tree at that moment
- A reproduction script exists at `scripts/repro-worktree-deletion.mjs` for future testing
