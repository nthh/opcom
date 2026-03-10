---
id: file-ticket-traceability
title: "Hybrid file-ticket traceability: SQLite live index + frontmatter on close"
status: closed
type: feature
priority: 2
created: 2026-03-10
milestone: phase-5
deps:
  - agent-changeset-tracking
links:
  - docs/spec/orchestrator.md#file-ticket-traceability
---

# Hybrid file-ticket traceability

## Context Packet

**Goal:** Know which tickets changed a file (reverse lookup) and which files a ticket changed (forward lookup), with SQLite for live queries and ticket frontmatter for durable git-tracked records.

**Non-Goals:** Replacing `opcom trace`'s existing spec/test coverage — this adds a "changed by" dimension alongside it. Not building a full code-ownership system.

**Constraints:**
- Changeset data already exists in `events.db` — build on it, don't duplicate
- Frontmatter writes happen in the executor (not agent-initiated) so `protect-ticket-files` doesn't block
- File paths in frontmatter must be relative to project root
- No new runtime dependencies

**Repo Anchors:**
- `packages/core/src/agents/event-store.ts` — changeset insert/query, add `file_ticket_map` table
- `packages/core/src/orchestrator/executor.ts` — `updateTicketStatusSafe()` hook for stamping frontmatter
- `packages/core/src/orchestrator/git-ops.ts` — `captureChangeset()` already extracts file changes
- `packages/types/src/changeset.ts` — `Changeset`, `FileChange` types
- `packages/cli/src/commands/traceability.ts` — `runTrace()` to enhance with changeset data
- `docs/spec/orchestrator.md#file-ticket-traceability` — spec section

**Prior Art:** Folia uses `trk close -c <code> -t <tests>` to manually stamp file paths. This automates it from changeset data.

**Oracle (Done When):**
- [ ] `opcom trace <file>` shows "Tickets (changed this file)" section with ticket IDs and dates
- [ ] Closing a ticket writes `files:` and `commits:` to its YAML frontmatter
- [ ] `file_ticket_map` table is populated automatically when changesets are inserted
- [ ] Reopened and re-closed tickets get fresh file lists from new changesets
- [ ] Works for both worktree and non-worktree execution modes

**Risks:** Large tickets could produce very long `files:` lists in frontmatter. Mitigate by capping at top N files by change size or filtering out test files if list exceeds threshold.

## Tasks

- [x] Add `file_ticket_map` table to EventStore schema and migration (deps: none)
- [x] Populate `file_ticket_map` when `insertChangeset()` is called — extract file paths from changeset
- [x] Add `queryFileTickets(filePath)` method to EventStore — returns ticket IDs that changed a file
- [x] Add `queryTicketFiles(ticketId)` method to EventStore — aggregated file list across all changesets
- [x] Stamp `files:` and `commits:` into ticket frontmatter on close in `updateTicketStatusSafe()` (deps: queryTicketFiles)
- [x] Enhance `opcom trace` to include "changed by" section from `file_ticket_map` (deps: queryFileTickets)
- [x] Tests: file_ticket_map population, frontmatter stamping, trace output with changeset data

## Notes

- The `changesets` table already has `files_json` with full `FileChange[]` — `file_ticket_map` is a denormalized index for fast reverse lookups
- Context graph can later ingest `file_ticket_map` as `changed_by` edges for richer graph queries
- File-overlap scheduling can use `file_ticket_map` to predict which steps will conflict
