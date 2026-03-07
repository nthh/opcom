---
id: plan-stages
title: "Plan stages: sequential rounds with approval gates"
status: open
type: feature
priority: 2
created: 2026-03-06
deps:
  - orchestrator-plan-engine
  - modular-integrations
links:
  - docs/spec/orchestrator.md#plan-stages
---

# Plan stages: sequential rounds with approval gates

## Goal

Break plan execution into stages (rounds). After each stage completes, pause execution and notify the user with a status summary. The user reviews results and approves the next stage before agents continue. This gives natural checkpoints for large plans without requiring constant monitoring.

## Design

Stages are computed from the DAG — each "wave" of steps that can run in parallel forms a stage. Alternatively, the user can define explicit stage boundaries.

```yaml
# Auto-staged (default): each dependency layer is a stage
# Stage 1: all steps with no deps (leaf nodes)
# Stage 2: steps whose deps were all in stage 1
# Stage 3: ...

# Or explicit:
plan:
  stages:
    - [ticket-a, ticket-b]        # stage 1: run these in parallel
    - [ticket-c]                   # stage 2: after stage 1 completes
    - [ticket-d, ticket-e]        # stage 3: after stage 2
```

## Tasks

- [ ] T1: Stage computation from DAG — group steps by dependency depth
- [ ] T2: Explicit stage definitions in plan config
- [ ] T3: Executor pauses between stages, emits `stage_completed` event
- [ ] T4: Stage summary — completed/failed/skipped counts, duration, test results
- [ ] T5: Notification on stage completion — Slack, terminal bell, or push notification
- [ ] T6: Approval gate — user confirms next stage via TUI, CLI (`opcom plan continue`), or Slack reply
- [ ] T7: TUI plan view shows stage boundaries and current stage progress
- [ ] T8: Auto-continue option — skip approval gates for trusted plans
- [ ] T9: Stage-level rollback — if a stage fails, option to revert all its merges
- [ ] T10: Tests for stage computation, pause/resume, notifications

## Acceptance Criteria

- Plans with 3+ dependency layers automatically break into stages
- After each stage, execution pauses and the user gets a summary notification
- User can approve next stage from TUI, CLI, or Slack
- Stage progress is visible in the plan detail view
- `auto-continue: true` in plan config skips approval gates
- Failed stages show which steps failed and why before asking to continue
