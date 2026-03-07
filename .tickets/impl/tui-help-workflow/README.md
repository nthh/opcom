---
id: tui-help-workflow
title: "TUI: workflow guide in help overlay"
status: open
type: feature
priority: 1
created: 2026-03-07
deps: []
links:
  - docs/spec/tui.md#traceability--health
---

# TUI: workflow guide in help overlay

## Goal

The `?` help overlay should include a brief spec-driven workflow guide so the process is always one keystroke away. Users should never have to leave the TUI to remember the workflow.

## Tasks

- [ ] T1: Add WORKFLOW section to help overlay content
- [ ] T2: Show the 5-step flow: spec → scaffold → health → assign → track
- [ ] T3: Include key bindings (H, U) in the workflow section

## Acceptance Criteria

- Pressing `?` shows workflow steps alongside keybinding reference
- Workflow mentions spec-driven process and relevant commands
