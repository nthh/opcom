---
id: plan-overview-screen
title: "TUI: Plan overview screen on creation"
status: open
type: feature
priority: 2
created: 2026-03-06
deps:
  - orchestrator-plan-engine
links:
  - docs/spec/orchestrator.md
  - docs/spec/tui.md
---

# TUI: Plan overview screen on creation

## Goal

When a new plan is created, show a summary screen before execution starts. The user should see at a glance what's about to happen — how many steps, which tracks, concurrency settings, estimated duration — and confirm before agents start.

## Tasks

- [ ] T1: Plan summary view — step count, track count, track layout (which tickets in each track)
- [ ] T2: Show plan settings — maxConcurrentAgents, worktree mode, autoCommit, verification config
- [ ] T3: Per-step estimates — estimate duration based on ticket size/type and historical data from completed steps
- [ ] T4: Total estimated duration factoring in parallelism and track dependencies
- [ ] T5: Blocked/ready breakdown — how many steps are immediately runnable vs. waiting on deps
- [ ] T6: Confirm/cancel prompt before execution begins
- [ ] T7: `opcom plan show <id>` CLI command — same summary without TUI
- [ ] T8: Tests for summary computation and rendering

## Acceptance Criteria

- Creating a plan shows the overview before any agents start
- User can review tracks, step count, settings, and estimates
- User confirms to start execution or cancels
- Plan overview is also accessible later via the plan detail view
- Time estimates improve over time as more steps complete and provide historical data
