---
id: dev-environments
title: "Dev Environment Management & Port Registry"
status: closed
type: feature
priority: 2
deps:
  - phase-3-process-manager
links:
  - docs/spec/environments.md
services:
  - core
  - cli
---

# Dev Environment Management & Port Registry

## Goal

Track the runtime state of project services across the workspace — which services are running, on which ports, whether they're healthy — and prevent port collisions when multiple projects run simultaneously.

Builds on the existing `ServiceDefinition` type and the Phase 3 process manager. Adds the runtime layer: `ServiceInstance` state, health checks, a workspace-wide port registry, and service dependency ordering.

## Tasks

- [ ] Implement `PortRegistry` — workspace-scoped port allocation with persistence in `~/.opcom/ports.yaml`
- [ ] Port conflict detection: check registry before binding, warn on collision
- [ ] Auto-offset strategy: apply project-index offset when ports collide
- [ ] Implement `ServiceInstance` type with state machine (starting → running → unhealthy → stopped → crashed → restarting)
- [ ] Health check system: TCP (connect to port), HTTP (GET path), and command strategies
- [ ] Default health check selection: TCP for services with ports, none for portless services
- [ ] Startup grace period: ignore health check failures during configurable window after start
- [ ] Service dependency ordering: topological sort on `dependsOn`, wait for health before starting dependents
- [ ] `EnvironmentStatus` aggregation: roll up service instances into project-level summary (all-up / partial / degraded / all-down)
- [ ] REST endpoints: `/projects/:id/environment`, `/projects/:id/services/:name/start|stop`, `/ports`
- [ ] WebSocket events: `service_status`, `port_conflict`, `environment_status`
- [ ] TUI L1: service health indicator dots per project (●●○)
- [ ] TUI L2: live service status in SERVICES section with state, port, uptime
- [ ] User-configurable health checks and port overrides in project config

## Acceptance Criteria

- `opcom dev folia` starts services in dependency order, waiting for postgres health before starting api
- Port conflicts between projects are detected and reported before binding
- Service health is visible in both `opcom status` CLI output and TUI dashboard
- Unhealthy services trigger visible indicators in TUI (not just silent failure)
- Port registry persists across daemon restarts
