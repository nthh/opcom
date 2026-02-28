---
id: phase-3-server
title: "Station Daemon: REST + WebSocket Server"
status: closed
type: feature
priority: 0
created: 2026-02-27
milestone: phase-3
deps:
  - phase-2-session-manager
  - phase-2-message-routing
links:
  - docs/spec/server-api.md
---

# Station Daemon: REST + WebSocket Server

## Goal

Persistent daemon that TUI and Web clients connect to. Tracks all state, streams agent events, handles commands.

## Tasks

- [ ] `opcom serve` — start daemon on configurable port (default ~/.opcom/station.sock or localhost:4700)
- [ ] REST API: workspace, project, agent, work-item endpoints per spec
- [ ] WebSocket: client command → server event protocol per spec
- [ ] Agent event streaming: multiplex NormalizedEvents to subscribed clients
- [ ] State snapshots on client connect (agents_snapshot, projects_snapshot)
- [ ] Client reconnection handling (re-sync state)
- [ ] Auto-start daemon on first `opcom work` if not running
- [ ] PID file for daemon lifecycle management
- [ ] Graceful shutdown: stop agents, close connections, clean up
- [ ] Health endpoint: GET /health

## Acceptance Criteria

- Daemon starts, persists, survives client disconnects
- Multiple TUI/Web clients can connect simultaneously
- Agent events stream in real-time to all connected clients
- REST API returns correct project and agent state
