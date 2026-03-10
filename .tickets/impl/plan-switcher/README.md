---
id: plan-switcher
title: "TUI: Plan switcher for multi-plan support"
status: closed
type: feature
priority: 2
deps:
  - plan-lifecycle
links:
  - docs/spec/orchestrator.md
  - docs/spec/tui.md
services:
  - core
  - cli
---

# TUI: Plan Switcher for Multi-Plan Support

## Problem

The TUI only shows one plan at a time — whichever `loadActivePlan()` picks. If you have plans across multiple projects (opcom executing, folia draft), there's no way to switch between them. The station supports multiple concurrent executors (`this.executors` is a Map), but the TUI has no interface to leverage this.

## Goal

Users can see and switch between plans from the dashboard, so running plans are never hidden.

## Tasks

- [ ] Add `list_plans` command to `ClientCommand` — returns all plans (or filter by status)
- [ ] Wire `list_plans` handler in station — reads from persistence, returns summary list
- [ ] Add plan list/picker to dashboard — either a dropdown on the plan panel header or a separate mini-panel
- [ ] Show plan status badges (executing, paused, done, cancelled) in the list
- [ ] Keybinding to cycle through plans (e.g. `[` / `]` or a plan picker popup)
- [ ] Selecting a plan updates the dashboard plan panel to show that plan's steps
- [ ] Tests: plan list rendering, switching updates panel, status badges

## Acceptance Criteria

- Dashboard shows which plan is active and how many total plans exist
- User can switch between plans without leaving the dashboard
- Running plans are always discoverable — never hidden behind a cancelled/draft plan
- Plan status is visible at a glance (executing, paused, done)
