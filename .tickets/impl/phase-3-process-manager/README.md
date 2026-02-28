---
id: phase-3-process-manager
title: "Process Manager: Dev Services"
status: closed
type: feature
priority: 2
created: 2026-02-27
milestone: phase-3
deps:
  - phase-3-server
links: []
---

# Process Manager: Dev Services

## Goal

Start/stop project services (dev servers, databases, watchers) from opcom. Uses ServiceDefinition from detection.

## Tasks

- [ ] `opcom dev <project>` — start all detected services for a project
- [ ] `opcom dev <project> <service>` — start specific service
- [ ] Process tracking: PID, port, stdout/stderr capture
- [ ] Health checks: verify services are listening on expected ports
- [ ] Auto-restart on crash (configurable)
- [ ] Show running processes in `opcom status`
- [ ] Stop all processes on `opcom dev stop <project>`
- [ ] Service dependency ordering (postgres before api)
- [ ] Log streaming to TUI

## Acceptance Criteria

- `opcom dev folia` starts postgres, orchestrator, tiles services
- Processes tracked and visible in status dashboard
- Clean shutdown stops all child processes
