---
id: "006"
title: Integration branches for parent tickets
status: proposed
date: 2026-03-15
spec: docs/spec/orchestrator.md
---

# ADR-006: Integration Branches for Parent Tickets

## Context

When a parent ticket has multiple child tickets (e.g., `data-export/` with `export-framework.md`, `export-driver-vector.md`, etc.), each child currently gets its own worktree branched from `main` and merges directly back to `main` after verification. This works but has drawbacks:

1. **No atomic delivery** — the feature lands on main in 7 separate merges. Can't revert as a unit.
2. **Children can't build on each other's work naturally** — `export-driver-vector` needs framework code, but framework must merge to main first before vector's worktree can see it.
3. **Doesn't match how teams work** — feature branches → PR → merge is the standard workflow.

Swarm mode exists but solves a different problem: it's for inline subtasks (`## Tasks` checkboxes) that share a single worktree with sequential (locked) execution. It doesn't work with separate child `.md` ticket files and doesn't support parallel execution within the shared worktree.

## Decision

Parent tickets with child ticket files automatically create an **integration branch** (`work/<parent-id>`). Child ticket worktrees branch from and merge back to the integration branch instead of `main`. The full DAG still controls scheduling — children run in parallel when their deps allow it, each in their own worktree. Only the merge target changes.

### How it works

```
main ───────────────────────────────────────────────●──
                                                    ↑ (one merge after final gate)
work/data-export ──●────●──●──●────●──●────●────────
                   ↑    ↑  ↑  ↑    ↑  ↑    ↑
                  fw  vec ras tab  cli api batch
                  (each child's worktree branches from HERE)
```

1. **Integration worktree creation**: When the planner detects a parent ticket with child `.md` files, it marks the parent as an integration step. The executor creates a long-lived worktree + branch (`work/<parent-id>`) before any children start.

2. **Child worktrees branch from integration branch**: `WorktreeManager.create()` already accepts a `baseBranch` parameter. For children of an integration parent, `baseBranch` is set to `work/<parent-id>` instead of `HEAD`.

3. **Child merges target integration branch**: `WorktreeManager.merge()` already accepts a `targetBranch` parameter. For children, `targetBranch` is `work/<parent-id>`.

4. **DAG ordering is unchanged**: Children still respect `deps` and `blockedBy`. When `export-framework` merges to the integration branch, the DAG unblocks the driver steps. Their worktrees are created from the integration branch's current HEAD — which now includes framework code.

5. **Dependency-driven branching**: When a child step is unblocked and its worktree is created, it branches from the integration branch at its current HEAD. Since deps ensure ordering, all prerequisite work is already on the integration branch.

6. **Two-tier verification**:
   - **Per-child merge to integration branch**: Run modular tests (tests matching changed files). Fast feedback, catches obvious breaks.
   - **Final merge to main**: Full test suite + oracle on the integration branch. Catches cross-cutting issues.

7. **Final merge**: When all children are done/skipped, the integration branch is verified against main (full suite + oracle), then merged to main with `--no-ff`. The integration worktree is cleaned up.

8. **Rebase handling**: Auto-rebase for child→integration conflicts works the same as today's child→main conflicts. The integration branch itself only rebases onto main at the final merge — not during execution.

### Detection

A parent ticket is an "integration parent" when:
- It has a directory with child `.md` ticket files (existing parent detection)
- `worktree: true` is enabled in the plan config

No new frontmatter field is needed — the behavior is inferred from the existing parent/child relationship.

### What doesn't change

- DAG computation, dependency resolution, track assignment
- `maxConcurrentAgents` and file-overlap scheduling
- Worktree creation/removal lifecycle (per-child)
- Lock file management
- Agent context packets
- Non-parent tickets still merge directly to main

## Consequences

- **Atomic feature delivery** — main gets one merge commit for the entire feature. Easy to revert.
- **Natural code sharing** — children see each other's merged work via the integration branch without waiting for main.
- **Abandonment** — delete the integration branch, main is untouched.
- **Drift risk** — the integration branch may drift from main during long-running plans. Mitigated by rebasing onto main at the final merge (same conflict resolution as today).
- **Two-tier testing** — modular tests per-child are faster than full suite, but the full suite at the end catches integration issues. This is a net improvement: same total coverage, faster inner loop.
- **No new merge topology complexity** — the same merge/rebase logic is reused, just with a different target. No three-level nesting.
