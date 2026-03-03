---
id: tui-plan-detail
title: "TUI: Plan Step Detail View (L3 Drill-Down)"
status: closed
type: feature
priority: 1
deps: []
links:
  - docs/spec/tui.md
services:
  - cli
---

# TUI: Plan Step Detail View (L3 Drill-Down)

## Problem

Plan panel shows the step list but you can't drill into a step to see its deps, blockers, error messages, associated agent, or timeline. There's no L3 view for plan steps like there is for tickets (`ticket-focus.ts`) and agents (`agent-focus.ts`).

## Tasks

- [ ] Create `packages/cli/src/tui/views/plan-step-focus.ts` following the `ticket-focus.ts` / `agent-focus.ts` L3 pattern
- [ ] Render step detail fields:
  - Step status (with colored indicator)
  - Ticket summary (title, ID, priority)
  - `blockedBy` list with each blocker's current status
  - Assigned agent session link
  - `startedAt` / `completedAt` timestamps and duration
  - Error message (if failed)
  - Verification results (when available, additive with tui-verification-display)
- [ ] Wire into dashboard drill-down: selecting a step in plan panel + Enter navigates to step detail
- [ ] Keybindings:
  - `w` — start agent on a ready step
  - `a` — jump to agent focus view for the assigned agent
  - `t` — jump to ticket focus view for the step's ticket
  - `Esc` — back to plan panel
- [ ] Tests: verify view renders with various step states, verify keybinding navigation

## Acceptance Criteria

- Selecting a plan step and pressing Enter opens the detail view
- All step metadata is visible: status, ticket, blockers, agent, timing, errors
- Navigation keybindings work to jump between related views
- Esc returns to the plan panel
- View gracefully handles steps with no agent, no verification, or no errors
