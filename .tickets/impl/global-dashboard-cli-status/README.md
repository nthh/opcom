---
id: global-dashboard-cli-status
title: "Global Dashboard: CLI Status Enhancements"
status: open
type: feature
priority: 3
deps:
  - global-dashboard-workitem-wrapper
links:
  - docs/spec/global-dashboard.md
services:
  - cli
---

# Global Dashboard: CLI Status Enhancements

## Goal

Enhance `opcom status` CLI output with project filtering and a global work queue summary that mirrors the TUI.

## Tasks

- [ ] Add `--project` flag to `opcom status` command
  - Filter `statuses` array to matching project
  - Show full ticket list (not just counts) for single-project view
- [ ] Add global work queue summary after projects list
  - Priority-sorted work items across all projects
  - Show project name and agent icon per item
  - Same format as TUI work queue but in text output
- [ ] Update `formatStatusDashboard()` in `packages/cli/src/ui/format.ts`

## Acceptance Criteria

- `opcom status --project life` shows only the life project with full ticket list
- `opcom status` includes a WORK QUEUE section with cross-project items
- Output format matches TUI visual layout
