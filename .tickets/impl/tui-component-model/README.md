---
id: tui-component-model
title: "TUI: Extract Reusable Component Model"
status: closed
type: refactor
priority: 1
created: 2026-03-08
deps: []
links:
  - docs/spec/tui.md#component-model
services:
  - cli
---

# TUI: Extract Reusable Component Model

## Problem

TUI panels are monolithic — each view owns its panel rendering as private functions tightly coupled to view-specific state. Panels can't be reused across views. For example, `renderAgentsPanel()` exists in both `dashboard.ts` and `project-detail.ts` with slightly different signatures. Adding a new panel (like chat) to multiple views means duplicating rendering logic.

## Goal

Introduce a `TuiComponent` interface so panels are self-contained units that can be composed into any view. This is the foundation for the chat panel and future panel reuse.

## Tasks

- [ ] Define `TuiComponent<S>` interface in `packages/cli/src/tui/components/types.ts`
  - `id: string`
  - `init(): S` — default state
  - `render(buf, panel, state, focused): void`
  - `handleKey(key, state): { handled, state }`
- [ ] Implement focus management in `app.ts` — track focused component per view, dispatch keys to focused component first
- [ ] Extract `AgentsListComponent` as the first migrated component (it already appears in both dashboard and project-detail)
- [ ] Wire `AgentsListComponent` into dashboard view (replacing inline `renderAgentsPanel`)
- [ ] Wire `AgentsListComponent` into project-detail view
- [ ] Ensure legacy monolithic panels still work alongside components (incremental migration)
- [ ] Tests: component focus cycling, key dispatch, render isolation

## Acceptance Criteria

- `TuiComponent` interface exists and is documented
- `AgentsListComponent` renders identically to the current inline agents panel
- Dashboard and project-detail both use the shared `AgentsListComponent`
- Focus management routes keys to the focused component
- Existing non-migrated panels continue to work unchanged
- No visual regressions in dashboard or project-detail views
