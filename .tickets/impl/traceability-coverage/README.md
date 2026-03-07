---
id: traceability-coverage
title: "opcom coverage: spec-to-ticket coverage report"
status: closed
type: feature
priority: 2
created: 2026-03-07
links:
  - docs/spec/context-graph.md#traceability
---

# opcom coverage: spec-to-ticket coverage report

## Goal

`opcom coverage` shows which specs have implementing tickets and which have gaps. `opcom coverage <spec-file>` drills into section-level detail.

## Tasks

- [x] T1: Summary view — all specs with ticket counts and coverage status
- [x] T2: Section detail view — per-anchor coverage for a specific spec
- [x] T3: Wire into CLI as `opcom coverage`

## Acceptance Criteria

- Summary shows all specs with covered/partial/uncovered status
- Detail view shows each `{#anchor}` section with matching ticket
- Sections without tickets show as "missing"
