---
id: tui-use-cases-view
title: "TUI: use cases view (U key)"
status: closed
type: feature
priority: 2
created: 2026-03-07
deps:
  - traceability-uc
links:
  - docs/spec/tui.md#traceability--health
---

# TUI: use cases view (U key)

## Goal

Show use-case readiness in the TUI. Press U from the dashboard to see which use cases are ready, which are blocked, and what's missing.

## Tasks

- [ ] T1: U key opens use cases list view with readiness %
- [ ] T2: Enter drills into use case detail with per-requirement status
- [ ] T3: g key shows gaps only for selected use case
- [ ] T4: Tests for use case view rendering

## Acceptance Criteria

- U from dashboard shows all use cases with done/total counts
- Enter shows per-category requirement status (specs, features, tickets)
- Gaps view filters to only unmet requirements
