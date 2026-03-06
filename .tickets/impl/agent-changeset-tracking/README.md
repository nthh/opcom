---
id: agent-changeset-tracking
title: "Track and view file changes per agent/ticket"
status: closed
type: feature
priority: 2
created: 2026-03-03
milestone: phase-4
deps: []
links: []
---

# Track and view file changes per agent/ticket

## Goal

Give users visibility into exactly what files were changed by a given agent session or ticket, with full diffs. Right now there's no way to answer "what did the agent actually change for ticket X?" without manually spelunking git history.

## Context

The executor already auto-commits with messages like `opcom: complete <ticketId>`, and worktree isolation creates per-ticket branches. The pieces exist — they just need to be surfaced.

## Tasks

- [x] Record changeset metadata when agent sessions complete (files changed, insertions, deletions, commit SHAs)
- [x] Store changesets in EventStore events (e.g. `agent.changeset` event type)
- [x] Add `opcom diff <ticket-id>` CLI command — shows combined diff of all changes for a ticket
- [x] Add `opcom changes <ticket-id>` CLI command — shows file list with stats (like `git diff --stat`)
- [x] TUI: add a "Changes" tab/section to the ticket detail (L3) view showing files + diff
- [x] Support filtering by agent session ID when multiple agents worked on the same ticket
- [x] Tests for changeset capture and retrieval

## Acceptance Criteria

- After an agent completes work on a ticket, `opcom changes <ticket-id>` shows all modified files with line counts
- `opcom diff <ticket-id>` shows the full unified diff of all changes attributed to that ticket
- TUI ticket detail view has a section showing changed files
- Works with both worktree-isolated and shared-branch execution modes
- Changeset data persists across opcom restarts (stored in EventStore)
