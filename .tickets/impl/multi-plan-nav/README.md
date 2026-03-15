---
id: multi-plan-nav
title: "TUI: Multi-plan navigation tied to project selection"
status: closed
type: feature
priority: 2
created: 2026-03-15
deps:
  - plan-switcher
links:
  - docs/spec/tui.md#multi-plan-nav
  - docs/spec/orchestrator.md
services:
  - cli
  - core
---

# TUI: Multi-Plan Navigation Tied to Project Selection

## Problem

The station supports multiple concurrent plan executors (`Map<string, Executor>`), and the plan-switcher ticket added `]`/`[` cycling and `list_plans`. But the TUI still picks one global "active plan" via `loadActivePlan()` — there's no visual connection between a project and its plans. If mtnmap has 2 plans and opcom has 1, you can't tell from the dashboard which plans belong to where, and cycling is across all plans globally rather than scoped to a project.

## Goal

Plan display follows project selection: moving the cursor in the Projects panel shows that project's plans. Plans are discoverable at a glance via project row badges, and cycling with `]`/`[` is scoped to the selected project.

## Design

See [tui.md § Multi-Plan Navigation](../../docs/spec/tui.md#multi-plan-nav) for the full spec.

**Key changes:**
- Project rows show `▸ N plans` badge when N > 0 (non-terminal plans only)
- Plan panel updates when project selection changes (master-detail)
- Plan panel header shows `PLAN 1/2 · projectName` with context
- `]`/`[` cycle plans within the selected project (not globally)
- L2 project detail gains a PLANS section in the right column
- `loadActivePlan()` replaced with per-project plan list (`plansByProject`)

## Tasks

- [ ] Add `plansByProject` state — group plans by project ID, maintain per-project selected index
- [ ] Replace global `loadActivePlan()` with project-scoped plan resolution
- [ ] Render plan count badge on project rows (`▸ N plans`, cyan, non-terminal only)
- [ ] Plan panel follows project selection — update on cursor move in projects panel
- [ ] Plan panel header shows project context and plan position (`PLAN 1/2 · name`)
- [ ] Scope `]`/`[` cycling to selected project's plans (wrap around)
- [ ] Default to highest-priority plan per project (executing > paused > failed > planning > done)
- [ ] Fall back to WORK QUEUE when selected project has no plans
- [ ] Add PLANS section to L2 project detail right column (between Agents and Specs)
- [ ] L2 plan list: Enter drills to Plan Overview (L3), shows status icons
- [ ] Tests: plan badge rendering, project-scoped cycling, plan panel follows selection, L2 plan list

## Acceptance Criteria

- Moving cursor in Projects panel updates the plan panel to show that project's plans
- Project rows show plan count badge when plans exist
- `]`/`[` cycle through plans for the selected project only
- L2 project detail shows a PLANS section with all plans for that project
- Selecting a project with no plans shows the work queue (existing behavior)
- Plan display priority: executing > paused > failed > planning > done
