---
id: cloud-tui-integration
title: "TUI Cloud Service Sections: L1 Health, L2 Detail, L3 Drill-down"
status: open
type: feature
priority: 2
deps:
  - cloud-database-adapters
  - cloud-serverless-adapters
  - phase-4-tui-foundation
links:
  - docs/spec/cloud-services.md
  - docs/spec/tui.md
services:
  - cli
---

# TUI Cloud Service Sections

## Goal

Surface cloud service status throughout the TUI's three-level navigation. L1 gets health dots, L2 gets DATABASES/STORAGE/SERVERLESS/HOSTING/MOBILE sections, L3 gets service detail + log streaming.

## Tasks

- [ ] L1 Dashboard: Add `Cloud: ●●●` health indicator per project
  - [ ] Roll up all cloud services into per-project health dots
  - [ ] Color: green (healthy), yellow (degraded), red (unreachable)
  - [ ] Only show if project has cloud services
- [ ] L2 Project Detail: Add conditional cloud sections
  - [ ] DATABASES section: name, provider, size, migration status
  - [ ] STORAGE section: bucket name, size
  - [ ] SERVERLESS section: function name, trigger type, routes, last deploy
  - [ ] HOSTING section: domains, deployed ref, last deploy
  - [ ] MOBILE section: version, channel, last published
  - [ ] Sections only render if project has that kind of cloud service
- [ ] L3 Cloud Service Detail view:
  - [ ] Database: full status, migration history, recent activity
  - [ ] Serverless: routes, log streaming (follow mode), deploy action
  - [ ] Hosting: domains, SSL, deploy action
  - [ ] Mobile: version history, publish action
- [ ] Keybindings: `v` (focus cloud), `M` (migrate), `D` (deploy), `P` (publish), `f` (follow logs)
- [ ] WebSocket subscription for cloud_service_updated events
- [ ] Section visibility: only show sections that have data (no empty sections)

## Acceptance Criteria

- TUI L1 shows cloud health dots for Folia (3 dots: Turso, Neon, R2) and Mtnmap (7 dots)
- TUI L2 for Mtnmap shows SERVERLESS (3 functions), DATABASES (2), STORAGE (2), HOSTING (1), MOBILE (1)
- Drilling into CF Workers shows routes + live log tail
- Drilling into database shows size, migration status, connection info
- Pressing `M` on a database with pending migrations triggers migration
