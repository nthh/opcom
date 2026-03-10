---
id: tui-help-accuracy
title: "TUI: Fix help view to match actual keybindings"
status: closed
type: bug
priority: 2
deps: []
links:
  - docs/spec/tui.md
services:
  - cli
---

# TUI: Help View Accuracy

## Problem

The help overlay (`?`) has drifted from actual TUI behavior:

### Documents keys that don't work:
- `d` — listed as "dev services" but is a placeholder with no implementation
- `g` — listed as "git log" but is a placeholder with no implementation

### Missing keys that do work:
- `C` (uppercase) — creates a new ticket from dashboard, project detail, or ticket focus
- `r` — refreshes data (global keybinding)
- `f`/`c` — follow mode and container switching in pod detail view

### Inaccurate descriptions:
- Help says L2 Enter drills to "ticket/agent/spec/cloud/cicd" but doesn't mention infra (pods)

## Tasks

- [ ] Audit all keybindings in app.ts input handlers against help view text
- [ ] Remove references to unimplemented keys (or implement them — see tui-dead-keybindings)
- [ ] Add missing keybindings to help text
- [ ] Fix drill-down description to include all L2 panels
- [ ] Add pod detail view keybindings (f, c) to help
- [ ] Tests: help text contains all implemented keybindings

## Acceptance Criteria

- Every keybinding listed in help has a working implementation
- Every implemented keybinding is listed in help
- Panel drill-down descriptions are complete
