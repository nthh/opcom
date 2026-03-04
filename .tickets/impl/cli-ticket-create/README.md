---
id: cli-ticket-create
title: "CLI ticket creation command"
status: open
type: feature
priority: 2
created: 2026-03-03
milestone: phase-2
deps: []
links: []
---

# CLI ticket creation command

## Goal

Add an `opcom ticket create` CLI command so users can create new tickets without needing the TUI. Ticket creation currently works in the TUI (press `c` on the dashboard/project view), but there's no CLI equivalent for quick scripting or use outside the TUI.

## Context

The core already exports `buildTicketCreationPrompt()` which generates a system prompt for an agent to scaffold a new ticket. The TUI client uses this in its `create_ticket` handler. The CLI should expose the same capability directly.

## Tasks

- [ ] Add `opcom ticket create <project> "<description>"` CLI command
- [ ] Reuse existing `buildTicketCreationPrompt()` from core
- [ ] Spawn a claude-code agent (same as TUI path) to generate the ticket
- [ ] Auto-rescan tickets after agent completes
- [ ] Add `opcom ticket list [project]` to show work items from CLI
- [ ] Tests for the new commands

## Acceptance Criteria

- `opcom ticket create myproject "Add retry logic to API calls"` creates a valid ticket in `.tickets/impl/`
- Created ticket follows TEMPLATE.md format with proper YAML frontmatter
- Ticket appears in subsequent `opcom status` output
- Works without the TUI running
