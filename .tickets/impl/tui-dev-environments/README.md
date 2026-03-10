---
id: tui-dev-environments
title: "TUI: Wire dev environment management into station and TUI"
status: open
type: feature
priority: 2
deps:
  - dev-environments
links:
  - docs/spec/environments.md
  - docs/spec/tui.md
services:
  - core
  - cli
---

# TUI: Dev Environment Management

## Problem

The core dev environment layer is fully implemented — `EnvironmentManager`, `PortRegistry`, `ProcessManager`, `HealthChecker` all exist in `@opcom/core`. The `opcom dev` CLI command starts services. But none of this is wired into the station daemon or TUI:

- Station doesn't instantiate `EnvironmentManager`
- No WebSocket events for service status changes
- No REST endpoints for environment/services/ports
- TUI L2 stack panel shows services statically (name + port from config), not runtime state
- No keybinding to start/stop services from TUI
- No service health indicators on L1 dashboard

The core is done. This ticket is purely the server + TUI wiring layer.

## Design

### Station Wiring

- Instantiate `EnvironmentManager` per project in station daemon
- Forward `service_status`, `port_conflict`, `environment_status` events over WebSocket
- Add station commands: `start_services`, `stop_services`, `restart_service`

### L1 Dashboard

Add service health dots to each project row:

```
  folia          ●●○  3 services    2 up, 1 stopped
  remolt         ●●●  2 services    all healthy
```

### L2 Project Detail

Replace static service listing in stack panel with live status:

```
  Services
    ● api         :3000  running   2m ago
    ● web         :5173  running   2m ago
    ○ worker      :8080  stopped
```

Or add a dedicated services section/panel.

### Keybindings

- `d` (L2) — Start all services for focused project
- `D` (L2) — Stop all services
- Enter on a service → service detail focus view (logs, health checks, restart)

### Service Detail Focus View (L3)

```
  api (running) — port 3000 — pid 12345
  ──────────────────────────────────────
  Health: ● HTTP GET /health → 200 (12ms)
  Uptime: 45m
  Restarts: 0

  Recent output:
    [api] Server listening on :3000
    [api] Connected to database
    ...

  Keys: r=restart  s=stop  f=follow logs
```

## Tasks

- [ ] Instantiate `EnvironmentManager` in station daemon per registered project
- [ ] Add `start_services`, `stop_services`, `restart_service` to `ClientCommand`
- [ ] Forward environment events over WebSocket to TUI clients
- [ ] Add service health indicators to L1 dashboard project rows
- [ ] Replace static service listing in L2 with live runtime status
- [ ] Wire `d` keybinding to start services, `D` to stop
- [ ] Add service detail focus view (L3) with logs, health, restart
- [ ] Add Enter drill-down on service items in L2
- [ ] Tests: station environment commands, TUI service rendering, health indicators

## Acceptance Criteria

- Services can be started and stopped from the TUI without leaving to CLI
- L1 dashboard shows at-a-glance service health per project
- L2 shows live service status (running/stopped/unhealthy) with ports
- Service detail view shows logs, health check results, and restart controls
- Port conflicts are surfaced in the TUI when detected
- `d`/`D` keybindings work on L2 project detail
