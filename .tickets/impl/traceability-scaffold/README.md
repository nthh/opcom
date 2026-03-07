---
id: traceability-scaffold
title: "opcom scaffold: generate tickets from spec sections"
status: closed
type: feature
priority: 1
created: 2026-03-07
links:
  - docs/spec/context-graph.md#traceability
---

# opcom scaffold: generate tickets from spec sections

## Goal

`opcom scaffold <spec-file>` parses a spec for `## Title {#anchor}` sections and creates one ticket per section in `.tickets/impl/`. Enforces specs-before-tickets mechanically.

## Tasks

- [x] T1: Spec section extraction (`## Title {#anchor}` pattern matching)
- [x] T2: Skip non-actionable sections (overview, summary, non-goals, etc.)
- [x] T3: Check for existing tickets (skip if section already has a linked ticket)
- [x] T4: Generate ticket directory with README.md and proper frontmatter
- [x] T5: `--dry-run` flag to preview without writing
- [x] T6: `--all` flag to scaffold all spec files at once
- [x] T7: Wire into CLI as `opcom scaffold`

## Acceptance Criteria

- `opcom scaffold docs/spec/context-graph.md` creates tickets for unlinked sections
- `--dry-run` shows what would be created without writing files
- Existing tickets are not duplicated
- Generated tickets link back to spec#anchor
