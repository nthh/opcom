---
id: traceability-trace
title: "opcom trace: reverse file-to-spec lookup"
status: closed
type: feature
priority: 2
created: 2026-03-07
links:
  - docs/spec/context-graph.md#traceability
---

# opcom trace: reverse file-to-spec lookup

## Goal

`opcom trace <file-path>` shows what specs, tickets, and tests cover a given file. Answers "what spec does this code implement?"

## Tasks

- [x] T1: Find tickets whose links reference the target path
- [x] T2: Find specs connected via ticket links
- [x] T3: Find colocated and conventionally-named test files
- [x] T4: Wire into CLI as `opcom trace`

## Acceptance Criteria

- Shows covering specs, tickets (with status), and test files
- Works without context-graph (file/ticket scanning)
- Future: enhanced results when graph is built (edge walking)
