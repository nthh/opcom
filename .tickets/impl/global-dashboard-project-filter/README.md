---
id: global-dashboard-project-filter
title: "Global Dashboard: Project Filter + f/F Keybindings"
status: open
type: feature
priority: 2
deps:
  - global-dashboard-workitem-wrapper
links:
  - docs/spec/global-dashboard.md
services:
  - cli
---

# Global Dashboard: Project Filter + f/F Keybindings

## Goal

Add project-level filtering to the TUI work queue. Users press `f` to cycle through projects, `F` to clear. When filtered, project labels are hidden (redundant) and the panel title shows the active filter.

## Tasks

- [ ] Add `projectFilter: string | null` to `DashboardState`
- [ ] Initialize to `null` in `createDashboardState()`
- [ ] Add project filter logic to `getFilteredWorkItems()`
- [ ] `f` keybinding: cycle projectFilter through `null → project1 → project2 → ... → null`
- [ ] `F` keybinding: clear projectFilter to `null`
- [ ] Update panel title to show active filter: `Work Queue (5) [mtnmap]`
- [ ] Combined filter display: `Work Queue (3) [life] P1` when both project + priority active
- [ ] Hide `[projectName]` prefix when project filter is active (redundant)
- [ ] Search filter matches project name too (`w.projectName.toLowerCase().includes(q)`)
- [ ] Reset selectedIndex and scrollOffset when filter changes

## Acceptance Criteria

- `f` cycles through projects in dashboard order, wrapping to "all"
- `F` clears to show all projects
- Panel title updates to reflect active filter
- Project labels hidden when single project is filtered
- Search query matches against project name
