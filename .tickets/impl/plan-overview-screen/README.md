---
id: plan-overview-screen
title: "TUI: Plan overview screen on creation"
status: closed
type: feature
priority: 1
created: 2026-03-06
deps:
  - orchestrator-plan-engine
links:
  - docs/spec/orchestrator.md#plan-overview-screen
  - docs/spec/tui.md
---

# TUI: Plan overview screen on creation

## Goal

When a new plan is created, show a summary screen before execution starts. The user should see at a glance what's about to happen — how many steps, which tracks, concurrency settings, estimated duration — and confirm before agents start.

## Tasks

- [ ] T1: Plan summary view — step count, track count, track layout (which tickets in each track)
- [ ] T2: Show plan settings — maxConcurrentAgents, worktree mode, autoCommit, verification config
- [ ] T3: Blocked/ready breakdown — how many steps are immediately runnable vs. waiting on deps
- [ ] T4: Dependency visualization — critical path, which steps gate others
- [ ] T5: Confirm/cancel prompt before execution begins
- [ ] T6: `opcom plan show <id>` CLI command — same summary without TUI
- [ ] T7: Tests for summary computation and rendering

## Acceptance Criteria

- Creating a plan shows the overview before any agents start
- User can review tracks, step count, settings, and dependency structure
- User confirms to start execution or cancels
- Plan overview is also accessible later via the plan detail view

## Future (not in initial implementation)

- Per-step and total duration estimates based on historical event store data
