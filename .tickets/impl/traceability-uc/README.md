---
id: traceability-uc
title: "opcom uc: use-case readiness tracking"
status: closed
type: feature
priority: 2
created: 2026-03-07
links:
  - docs/spec/context-graph.md#traceability
---

# opcom uc: use-case readiness tracking

## Goal

`opcom uc` commands list use cases from `docs/use-cases/`, validate `requires:` blocks, and compute readiness percentages.

## Tasks

- [x] T1: Parse use-case YAML frontmatter with nested `requires:` blocks
- [x] T2: Requirement checkers — specs (file exists), tickets (status closed), features
- [x] T3: `opcom uc ls` — list use cases with readiness %
- [x] T4: `opcom uc show <id>` — detail view with per-requirement status
- [x] T5: `opcom uc gaps <id>` — show only unmet requirements
- [x] T6: Wire into CLI

## Acceptance Criteria

- `opcom uc ls` shows all use cases with done/total counts
- `opcom uc show UC-001` shows per-category requirement status
- `opcom uc gaps UC-001` shows only failing requirements
- Spec requirements validate against `docs/spec/` file existence
- Ticket requirements validate against ticket closure status
