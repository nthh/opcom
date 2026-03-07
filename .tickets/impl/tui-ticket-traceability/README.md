---
id: tui-ticket-traceability
title: "TUI: ticket focus traceability enhancements"
status: closed
type: feature
priority: 2
created: 2026-03-07
deps: []
links:
  - docs/spec/tui.md#traceability--health
---

# TUI: ticket focus traceability enhancements

## Goal

Enhance the L3 ticket focus view with traceability data — spec link status, related tickets implementing the same spec, and covering test files.

## Tasks

- [x] T1: Show spec link indicator (green check if linked, red warning if not)
- [x] T2: Show related tickets — other tickets implementing the same spec section
- [x] T3: Show covering test files (from trace data)
- [x] T4: Tests for traceability data in ticket view

## Acceptance Criteria

- Ticket focus view shows whether the ticket links to a spec
- Related tickets from the same spec section are visible
- Test files covering the spec section are listed
