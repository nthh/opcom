---
id: flatten-ticket-directory
title: "Flatten ticket directory: remove impl/ subdirectory"
status: open
type: chore
priority: 3
deps: []
links:
  - docs/spec/config.md#ticket-directory-structure
---

## Goal

Migrate ticket storage from `.tickets/impl/<id>/README.md` to `.tickets/<id>/README.md`. The `impl/` subdirectory is unnecessary — the `type` field in each ticket's frontmatter already handles categorization. This simplifies the directory layout and removes a layer of nesting.

## Tasks

- [ ] Update ticket scanner to read from `.tickets/<id>/README.md` as the primary location
- [ ] Add backwards-compat fallback: if `.tickets/impl/` exists, scan it as a secondary source
- [ ] In interactive mode (TUI), prompt the user to migrate tickets from `impl/` to the flat structure
- [ ] In agent mode, suggest migration but do not auto-migrate
- [ ] Update `opcom init` and ticket creation to write to `.tickets/<id>/` instead of `.tickets/impl/<id>/`
- [ ] Migrate all existing tickets from `.tickets/impl/` to `.tickets/`
- [ ] Update config spec `ticket-directory-structure` section to reflect the new layout
- [ ] Update any hardcoded `.tickets/impl/` references in code and docs

## Acceptance Criteria

- Tickets are created at `.tickets/<id>/README.md` by default
- Detection falls back to `.tickets/impl/` for repos that haven't migrated yet
- Interactive scan prompts to migrate old-layout tickets; agent mode suggests but does not auto-migrate
- Config spec `ticket-directory-structure` section documents the flat layout
- All existing tests pass with the new directory structure
