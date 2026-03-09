---
id: tui-stage-management
title: "TUI: Stage visibility and manual control"
status: open
type: feature
priority: 2
deps:
  - plan-lifecycle
links:
  - docs/spec/orchestrator.md#plan-stages
  - docs/spec/tui.md
services:
  - core
  - cli
---

# TUI: Stage Visibility and Manual Control

## Problem

Stages gate plan execution — steps in stage N can't start until stage N-1 is fully terminal. But the TUI has no visibility into stages: you can't see which stage is current, what's in each stage, or why a ready step isn't starting (it's in a future stage). The backend supports `advance_stage` as an executor event and `buildExplicitStages` for user-defined stages, but neither is exposed.

This causes confusion when a step with satisfied deps won't start because it's gated behind an unrelated step in the same stage (e.g., `team-formation` waiting on `k8s-monitoring` rebase even though its only dep `skills-packages` is done).

## Goal

Users can see stage structure, understand why steps are waiting, and manually advance or rearrange stages when needed.

## Tasks

- [ ] Show current stage indicator on plan panel (e.g. "Stage 1/3")
- [ ] Show stage boundaries in the step list (separator or grouping between stages)
- [ ] Visual indicator on steps blocked by stage gating vs blocked by deps
- [ ] Add `advance_stage` command to `ClientCommand` — force-advance to next stage
- [ ] Wire `advance_stage` handler in station → executor
- [ ] Keybinding to advance stage from plan panel (e.g. `A` for advance)
- [ ] Plan detail view: show full stage breakdown with step lists per stage
- [ ] Tests: stage indicator rendering, advance command, stage boundary display

## Acceptance Criteria

- Plan panel shows which stage is executing and total stage count
- Steps are visually grouped by stage in the step list
- User can see that a "ready" step is in a future stage (not just mysteriously idle)
- User can force-advance to the next stage when current stage is stuck
- Stage advance is gated behind confirmation to prevent accidental skipping
