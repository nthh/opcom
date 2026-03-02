---
id: tui-agent-sorting
title: "TUI: Sort Agent List by Plan Activity"
status: in-progress
type: feature
priority: 1
deps: []
links:
  - docs/spec/tui.md
services:
  - cli
---

# TUI: Sort Agent List by Plan Activity

## Problem

Agent list sorts active-before-stopped but doesn't prioritize plan-active agents. When 3+ agents are running plan steps, they're mixed in with idle/unrelated agents. The current sort in `renderAgentsPanel()` (`packages/cli/src/tui/views/dashboard.ts`, lines 321-326) only distinguishes active vs stopped.

## Tasks

- [x] Update `renderAgentsPanel()` sort in `packages/cli/src/tui/views/dashboard.ts` to use four tiers:
  1. Plan-active (agent running a plan step) — highest
  2. Other-active (running but not on a plan step)
  3. Idle (connected but not running)
  4. Stopped — lowest
- [x] Show plan step ticket ID prominently in the agent row when an agent is executing a plan step
- [x] Tests: verify sort order with mixed agent states

## Acceptance Criteria

- Agents actively executing plan steps always appear at the top of the list
- Each plan-active agent row shows which ticket/step it's working on
- Idle agents sort below active ones but above stopped
- Sort is stable within each tier (preserves creation order)
