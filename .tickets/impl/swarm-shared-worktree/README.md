---
id: swarm-shared-worktree
title: "Swarm subtasks share one worktree with oracle-only intermediate verification"
status: open
type: feature
priority: 2
created: 2026-03-10
deps:
  - plan-strategy
links:
  - docs/spec/orchestrator.md#swarm-execution
services:
  - core
---

# Swarm Shared Worktree

## Problem

The current plan-strategy implementation gives each swarm subtask its own worktree and runs the full verification pipeline (test gate + oracle) per subtask. This has two issues:

1. **Separate worktrees fragment one feature.** Subtasks of a single ticket are building one coherent feature. They need to see each other's changes. Separate worktrees mean each agent starts from main, not from the evolving feature branch. Merging N worktree branches at the end is complex and conflict-prone.

2. **Test gate on partial features is noise.** A feature isn't testable until all its pieces are in place. Running the full test suite after subtask 2 of 6 will either pass trivially (nothing wired up yet) or fail because the feature is incomplete. Either way, it's not useful signal.

## Goal

Change swarm execution so subtasks of one parent share a single worktree branch. Per-subtask verification uses oracle only (no test gate). The full test gate runs once after the final subtask completes, on the complete diff.

## Design

### Shared Worktree

When the executor starts the first subtask of a swarm parent:
1. Create one worktree on branch `work/<parent-ticket-id>`
2. Store the worktree path on all subtask steps: `step.worktreePath`, `step.worktreeBranch`
3. Subsequent subtask agents run in the same worktree — they see previous agents' commits on the branch

File-overlap scheduling handles concurrency safety:
- Parallel subtasks that don't touch the same files can run concurrently in the shared worktree
- Subtasks that overlap on files are serialized (existing `startReadySteps()` logic)
- Each agent commits to the shared branch before exiting

### Verification Changes

Current per-step verification flow:
```
agent exits → auto-commit → test gate → oracle → done/retry
```

New flow for swarm subtask steps:
```
agent exits → auto-commit → oracle only → done/retry
```

New flow for final swarm subtask:
```
agent exits → auto-commit → oracle → test gate (full diff main..branch) → done/retry
```

Implementation:

```typescript
// In executor, when determining verification for a step:
function getStepVerificationMode(step: PlanStep, plan: Plan): {
  runTests: boolean;
  runOracle: boolean;
} {
  if (!step.parentTicketId) {
    // Regular step — use plan config as-is
    return { runTests: plan.config.verification.runTests, runOracle: plan.config.verification.runOracle };
  }

  // Swarm subtask — check if this is the last one
  const siblingSteps = plan.steps.filter(s => s.parentTicketId === step.parentTicketId);
  const isLast = siblingSteps
    .filter(s => s.ticketId !== step.ticketId)
    .every(s => s.status === "done" || s.status === "skipped");

  if (isLast) {
    // Final subtask — full verification
    return { runTests: true, runOracle: true };
  }

  // Intermediate subtask — oracle only
  return { runTests: false, runOracle: true };
}
```

### Context Continuity

Since subtask agents share the worktree, they naturally see sibling work:
- Previous agents' commits are on the branch
- The codebase reflects all completed subtask work
- No explicit diff injection needed — just `git log` shows what happened

The context packet still includes:
- Full parent ticket body
- The specific subtask description
- Plan context (which subtasks are done, which are next)

### Worktree Lifecycle

1. **Create**: when first subtask of a parent starts
2. **Reuse**: all subsequent subtasks of same parent
3. **Merge**: after final subtask passes full verification → merge branch to main
4. **Cleanup**: delete worktree after successful merge

If any subtask fails and exhausts retries, the worktree stays for manual inspection (existing behavior for failed steps).

### Executor Changes

In `startStep()`:
```typescript
// Check if another subtask of the same parent already has a worktree
if (step.parentTicketId) {
  const siblingWithWorktree = this.plan.steps.find(
    s => s.parentTicketId === step.parentTicketId && s.worktreePath
  );
  if (siblingWithWorktree) {
    step.worktreePath = siblingWithWorktree.worktreePath;
    step.worktreeBranch = siblingWithWorktree.worktreeBranch;
    // Skip worktree creation — reuse existing
  }
}
```

In `runVerification()`:
```typescript
const { runTests, runOracle } = getStepVerificationMode(step, this.plan);
// Pass these flags to the verification pipeline instead of always using plan config
```

## Tasks

- [ ] Implement `getStepVerificationMode()` — oracle-only for intermediate subtasks, full verification for final
- [ ] Update `startStep()` to reuse worktree from sibling subtask steps
- [ ] Update `runVerification()` to accept per-step test/oracle flags
- [ ] Ensure auto-commit runs for each subtask (agents commit to shared branch)
- [ ] Update worktree cleanup to only delete after final subtask merge
- [ ] Ensure file-overlap scheduling works within shared worktree (serializes conflicting subtasks)
- [ ] Tests: shared worktree reuse across subtasks, oracle-only on intermediate, full verification on final, worktree cleanup after merge, file-overlap serialization

## Acceptance Criteria

- All subtask steps of one parent share a single worktree branch
- Intermediate subtask verification = oracle only (no test gate)
- Final subtask verification = oracle + test gate on complete diff
- Each subtask agent sees previous agents' commits on the shared branch
- File-overlap scheduling serializes subtasks that touch same files
- Worktree is created once and cleaned up after final merge
- Regular (non-swarm) steps are unaffected
