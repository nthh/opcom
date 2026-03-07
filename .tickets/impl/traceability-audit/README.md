---
id: traceability-audit
title: "opcom audit: traceability health report"
status: closed
type: feature
priority: 1
created: 2026-03-07
links:
  - docs/spec/context-graph.md#traceability
---

# opcom audit: traceability health report

## Goal

`opcom audit` reports spec coverage, ticket health, and link validation across the workspace. Answers "are we following spec-driven development?"

## Tasks

- [x] T1: Scan spec files and count which have implementing tickets
- [x] T2: Scan tickets and report which have/lack spec links
- [x] T3: Validate all ticket links (file exists, anchor exists)
- [x] T4: `--verbose` flag for detailed output
- [x] T5: Wire into CLI as `opcom audit`

## Acceptance Criteria

- Reports spec coverage % (specs with tickets)
- Reports ticket health (tickets with/without spec links)
- Validates links and reports broken ones
- Works without context-graph (pure file scanning)
