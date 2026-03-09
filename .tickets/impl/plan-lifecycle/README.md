---
id: plan-lifecycle
title: "Plan lifecycle: cancel, delete, and cleanup"
status: open
type: bug
priority: 1
deps: []
links:
  - docs/spec/orchestrator.md
  - docs/spec/tui.md
services:
  - core
  - types
  - cli
---

# Plan Lifecycle: Cancel, Delete, and Cleanup

## Problem

When you create a plan (e.g. for folia) and then cancel from the plan overview screen, the plan file persists on disk. The TUI's `loadActivePlan()` then picks up this abandoned plan as the active one (it falls back to the most recently created plan), hiding the actually-executing plan from the dashboard.

`deletePlan()` exists in `packages/core/src/orchestrator/persistence.ts` but is not exposed through the WebSocket API or TUI.

## Goal

Plans have a proper lifecycle: cancel cleans up, delete is available, and abandoned plans don't shadow running ones.

## Tasks

- [ ] Add `cancelled` to `PlanStatus` type
- [ ] Add `delete_plan` and `cancel_plan` commands to `ClientCommand`
- [ ] Wire `delete_plan` handler in station — calls `deletePlan()` from persistence
- [ ] Wire `cancel_plan` handler in station — sets status to `cancelled`, stops executor if running
- [ ] When user cancels from plan overview (before execution), either delete the plan or mark it `cancelled`
- [ ] Update `loadActivePlan()` to skip `cancelled` plans when finding the active plan
- [ ] Add `d` keybinding on plan panel to delete a non-executing plan
- [ ] Tests: cancel sets status, delete removes file, loadActivePlan skips cancelled

## Acceptance Criteria

- Cancelling a plan from the overview screen no longer leaves a ghost plan in the dashboard
- The running plan is always visible in the plan panel when one exists
- Users can delete old/abandoned plans
- `deletePlan` is callable from TUI and WebSocket API
