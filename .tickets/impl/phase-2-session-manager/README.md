---
id: phase-2-session-manager
title: "Session Manager"
status: closed
type: feature
priority: 0
created: 2026-02-27
milestone: phase-2
deps:
  - phase-2-agent-adapters
links:
  - docs/spec/adapters.md
---

# Session Manager

## Goal

Track running agent sessions, link them to projects and work items, persist session state across restarts.

## Tasks

- [ ] SessionManager class: create, list, get, stop sessions
- [ ] Link sessions to projectId + optional workItemId
- [ ] Persist session descriptors to ~/.opcom/sessions/
- [ ] Session state machine: idle → streaming → waiting → error → stopped
- [ ] Resume sessions on daemon restart (reconnect to running processes)
- [ ] Session event log: append NormalizedEvents to JSONL per session
- [ ] Agent memory files: ~/.opcom/memory/<sessionId>.md, auto-loaded on resume
- [ ] Clean up stale sessions (process died but state says streaming)
- [ ] Emit lifecycle events (session_created, session_stopped, state_change)

## Acceptance Criteria

- Can track multiple concurrent sessions across different projects
- Session state survives daemon restart
- Memory files persist across sessions for the same agent
- Stale sessions detected and cleaned up within 30s
