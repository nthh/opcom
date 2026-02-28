---
id: event-store
title: "SQLite Event Store + Analytics"
status: closed
type: feature
priority: 1
deps:
  - phase-2-session-manager
links:
  - docs/spec/cloud-services.md
services:
  - core
  - cli
---

# SQLite Event Store + Analytics

## Goal

Persist agent events (tool calls, messages, errors) in SQLite so they survive TUI restarts. Users see full session history with text and tool output when they reopen the TUI. Also provides queryable analytics (tool usage frequency, success rates, session durations).

## Approach

better-sqlite3 with createRequire wrapper for ESM compat. Single EventStore class in core. DB at ~/.opcom/events.db. Coexists with YAML session files.

## Tasks

- [x] Create `packages/core/src/agents/event-store.ts` — EventStore class
  - [x] WAL mode + synchronous=NORMAL
  - [x] Schema migration on open
  - [x] insertEvent(), upsertSession(), updateSessionState()
  - [x] loadSessionEvents(), loadAllSessions()
  - [x] Analytics: toolUsageStats(), toolSuccessRates(), sessionStats(), dailyActivity()
  - [x] tool_name correlation from preceding tool_start to tool_end
- [x] Create `tests/agents/event-store.test.ts` — :memory: DB tests (20 tests)
- [x] Add better-sqlite3 dep to core, @types to root
- [x] Export EventStore + analytics types from core/index.ts
- [x] Wire into SessionManager (optional EventStore, insertEvent on agent_event)
- [x] Wire into TUI client (load historical events for agent focus)
- [x] Wire into TUI app (load from DB when agentEvents empty)
- [x] Create `opcom analytics` CLI command (tools, sessions, daily)
- [x] Historical import: import existing YAML sessions into DB on first run
- [ ] Cloud service check history table (for future use by cloud adapters)

## Acceptance Criteria

- Start TUI, run agent, quit, reopen — full agent history visible
- `opcom analytics tools` shows tool usage frequency and success rates
- `opcom analytics sessions` shows session durations and event counts
- All existing tests still pass
