---
id: global-dashboard-workitem-wrapper
title: "Global Dashboard: DashboardWorkItem Wrapper + Project-Aware Aggregation"
status: closed
type: feature
priority: 1
deps:
  - phase-4-tui-foundation
links:
  - docs/spec/global-dashboard.md
services:
  - cli
---

# Global Dashboard: DashboardWorkItem Wrapper + Project-Aware Aggregation

## Goal

Work items in the TUI dashboard currently lose their project association during aggregation. This adds a `DashboardWorkItem` wrapper that carries `projectId` and `projectName` alongside each `WorkItem`, eliminating fragile reverse-lookups when starting agents.

## Tasks

- [ ] Define `DashboardWorkItem` interface in `packages/cli/src/tui/views/dashboard.ts`
  - `{ item: WorkItem; projectId: string; projectName: string }`
- [ ] Update `DashboardState.workItems` type from `WorkItem[]` to `DashboardWorkItem[]`
- [ ] Update `syncData()` in `app.ts:159-168` to build `DashboardWorkItem[]` with project association
- [ ] Remove reverse-lookups in `startAgentFromDashboard()` (`app.ts:559-565`) — use `dw.projectId` directly
- [ ] Remove reverse-lookups in `startAgentFromTicket()` — same
- [ ] Update `getFilteredWorkItems()` to work with `DashboardWorkItem`
- [ ] Update `formatWorkItemLine()` to accept `DashboardWorkItem`
- [ ] Update `getPanelItemCount()` for new type
- [ ] Add project labels: show `[projectName]` prefix on work items in unfiltered view
- [ ] Tests for `DashboardWorkItem` aggregation and rendering

## Acceptance Criteria

- TUI work queue shows `[projectName]` next to each work item
- Pressing `w` on a work item starts agent for the correct project without reverse-lookup
- No regressions in existing TUI behavior
