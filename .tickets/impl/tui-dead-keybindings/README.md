---
id: tui-dead-keybindings
title: "TUI: Remove dead keybindings (g, m) and reserve d for dev services"
status: open
type: bug
priority: 2
deps: []
links:
  - docs/spec/tui.md
services:
  - cli
---

# TUI: Dead Keybindings

## Problem

Three keybindings are wired in the TUI input handler with placeholder comments and no implementation:

- **`d`** (L2 Project Detail) — "Dev services — would need implementation"
- **`g`** (L2 Project Detail) — "Git log — would need implementation"
- **`m`** (L3 Agent Focus) — "Merge — placeholder for future implementation"

Users who press these keys get no feedback. The help view documents `d` and `g` as if they work.

## Decision

- **`d`** — Reserve for dev services (see `tui-dev-environments`). Remove the placeholder comment, replace with a "not yet wired" no-op or a brief status line message until dev environments are wired into TUI.
- **`g`** — Remove. Git log is not a core TUI workflow.
- **`m`** — Remove. Merging agent worktrees is handled by the orchestrator, not manual user action.

## Tasks

- [ ] Remove `g` case branch from L2 input handler
- [ ] Remove `m` case branch from L3 agent focus input handler
- [ ] Update `d` placeholder to indicate it's reserved for dev services
- [ ] Remove `g` from help view text
- [ ] Tests: verify removed keys are no-ops

## Acceptance Criteria

- No keybinding exists in the input handler with a "would need implementation" placeholder
- Help view only documents keys that actually work
- `d` is reserved for dev services wiring (not removed)
