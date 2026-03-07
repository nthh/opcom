---
id: tui-project-specs
title: "TUI: project detail specs section"
status: closed
type: feature
priority: 2
created: 2026-03-07
deps: []
links:
  - docs/spec/tui.md#traceability--health
---

# TUI: project detail specs section

## Goal

Add a SPECS section to the L2 project detail view showing which specs cover this project and their coverage status.

## Tasks

- [ ] T1: Compute which specs are referenced by this project's tickets
- [ ] T2: Render SPECS section alongside STACK in L2 view
- [ ] T3: Show coverage status per spec (covered/partial/missing)
- [ ] T4: Enter on a spec drills into section-level coverage

## Acceptance Criteria

- L2 project detail shows relevant specs with ticket counts
- Coverage status visible at a glance (covered/partial/missing indicators)
