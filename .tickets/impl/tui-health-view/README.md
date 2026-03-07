---
id: tui-health-view
title: "TUI: health bar + health view (H key)"
status: open
type: feature
priority: 1
created: 2026-03-07
deps:
  - traceability-audit
  - traceability-coverage
links:
  - docs/spec/tui.md#traceability--health
---

# TUI: health bar + health view (H key)

## Goal

Surface spec-driven development health in the TUI so the user doesn't need CLI commands to know if specs are covered and tickets are linked.

## Tasks

- [ ] T1: Health bar on L1 dashboard — spec coverage %, ticket link %, broken link count
- [ ] T2: Red indicator when broken links > 0 or unlinked tickets > 25%
- [ ] T3: H key opens full-screen health overlay (audit + coverage data)
- [ ] T4: Navigate spec list in health view with j/k
- [ ] T5: Enter on a spec drills into section-level coverage
- [ ] T6: Cache health data, refresh on ticket/spec changes
- [ ] T7: Tests for health data computation and rendering

## Acceptance Criteria

- Dashboard status bar shows spec coverage and ticket health at a glance
- H key opens detailed health view with spec list and coverage status
- Enter drills into section-level coverage for a specific spec
- Health data refreshes when tickets or specs change
