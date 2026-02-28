---
id: phase-7-scheduling
title: "Cron Scheduling + Heartbeats"
status: closed
type: feature
priority: 3
created: 2026-02-27
milestone: phase-7
deps:
  - phase-3-server
links: []
---

# Cron Scheduling + Heartbeats

## Goal

Automate recurring tasks: scheduled scans, health checks, agent restarts. Run opcom as a background service that keeps projects healthy.

## Tasks

- [ ] Cron scheduler service: per-workspace scheduled tasks
- [ ] Schedule format: cron expressions with timezone support
- [ ] Built-in schedules: periodic project rescan, git state refresh
- [ ] Custom schedules: user-defined (e.g., "run triage every morning")
- [ ] Agent heartbeats: detect stuck/crashed agents, auto-restart
- [ ] Health monitoring: verify services are responding on expected ports
- [ ] Schedule persistence: ~/.opcom/schedules.yaml
- [ ] `opcom schedule list/add/remove` CLI commands
- [ ] Schedule management in TUI settings view

## Acceptance Criteria

- Scheduled tasks execute reliably at configured times
- Crashed agents detected and restarted within 60s
- Schedules persist across daemon restarts
