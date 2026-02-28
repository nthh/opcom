---
id: phase-4-tui-foundation
title: "TUI Foundation: Framework + Layout Engine"
status: closed
type: feature
priority: 0
created: 2026-02-27
milestone: phase-4
deps:
  - phase-3-server
links:
  - docs/spec/tui.md
---

# TUI Foundation: Framework + Layout Engine

## Goal

Core TUI infrastructure: framework selection, layout engine, WebSocket client, keybinding system.

## Tasks

- [ ] Evaluate and select framework (Ink vs blessed vs terminal-kit)
- [ ] Layout engine: split panels, resizable, responsive to terminal size
- [ ] WebSocket client: connect to station daemon, handle reconnection
- [ ] Fallback mode: direct file reads if no daemon running
- [ ] Keybinding system: configurable, vim-style, command palette
- [ ] Color theme: ANSI 256 colors, respect terminal capabilities
- [ ] Status bar: bottom bar with available keybindings per context
- [ ] Loading states: skeleton screens while data loads
- [ ] Error handling: connection lost, daemon not running, etc.
- [ ] `opcom tui` command (or just `opcom` with no args when daemon is running)

## Acceptance Criteria

- TUI launches, connects to daemon, renders layout
- Panels resize correctly on terminal resize
- Keybindings work, status bar updates per context
- Graceful degradation when daemon is unavailable
