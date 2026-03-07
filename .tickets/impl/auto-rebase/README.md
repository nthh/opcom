---
id: auto-rebase
title: "Auto-rebase on merge conflict with agent-assisted resolution"
status: open
type: feature
priority: 1
created: 2026-03-06
deps: []
links:
  - docs/spec/verification.md
---

# Auto-rebase on merge conflict with agent-assisted resolution

## Goal

When a worktree merge fails with a conflict, automatically attempt resolution instead of dead-ending at `needs-rebase`. Three tiers: clean rebase → agent-assisted conflict resolution → hard fail.

## Tasks

### WorktreeManager
- [ ] Add `attemptRebase(stepId)` method — runs `git rebase <main>` in the worktree, returns `RebaseResult`
- [ ] Parse conflict file list from rebase error output
- [ ] Abort rebase on conflict (`git rebase --abort`)

### Executor integration
- [ ] On merge conflict, call `attemptRebase()` before marking `needs-rebase`
- [ ] If clean rebase succeeds: re-run verification pipeline, then merge
- [ ] If rebase has conflicts: set `step.rebaseConflict`, transition step to `ready` for agent resolution
- [ ] In `startStep()`, detect `rebaseConflict` and build conflict-resolution context packet instead of normal ticket context
- [ ] Clear `rebaseConflict` after agent completes
- [ ] If agent resolution fails or post-rebase verification fails: fall through to `needs-rebase`

### Types
- [ ] Add `RebaseResult` interface to plan types
- [ ] Add `rebaseConflict?` field to `PlanStep`
- [ ] Add `autoRebase` boolean to `VerificationConfig` (default true)

### Context builder
- [ ] Build conflict-resolution context packet with conflicting file list, rebase instructions, and focused agent guidelines

### Configuration
- [ ] Add `autoRebase` to `VerificationConfig` default (true)
- [ ] Add `orchestrator.autoRebase` to settings definitions
- [ ] `autoRebase: false` preserves current behavior (immediate needs-rebase)

### Event store
- [ ] Emit `step_rebase_attempted`, `step_rebase_agent_started`, `step_rebase_resolved`, `step_rebase_failed` events

### TUI
- [ ] Add `⟳` (rebasing) status icon in dashboard and plan-step-focus views
- [ ] Show conflict files in step detail view during agent resolution

### Tests
- [ ] Clean rebase succeeds → verification re-runs → merge completes → step done
- [ ] Clean rebase fails with conflict → agent started with conflict context
- [ ] Agent resolves conflict → verification passes → merge → step done
- [ ] Agent fails to resolve → step marked needs-rebase
- [ ] `autoRebase: false` → immediate needs-rebase (existing behavior preserved)
- [ ] Post-rebase verification failure enters retry loop

## Acceptance Criteria

- Merge conflicts are automatically resolved when possible (clean rebase)
- When clean rebase fails, an agent is started with conflict context to resolve
- If all resolution attempts fail, step falls back to `needs-rebase` for manual intervention
- `autoRebase: false` config preserves current behavior
- Event store records the full resolution chain
- TUI shows distinct icon for rebasing-in-progress vs. needs-manual-rebase
