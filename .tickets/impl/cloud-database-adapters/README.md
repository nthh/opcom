---
id: cloud-database-adapters
title: "Cloud Database Adapters: Turso, Neon, Prisma Migrations"
status: closed
type: feature
priority: 2
deps:
  - phase-3-server
links:
  - docs/spec/cloud-services.md
services:
  - types
  - core
  - cli
---

# Cloud Database Adapters: Turso, Neon, Prisma Migrations

## Goal

Track database health, connection status, size, and migration state for Turso (SQLite edge) and Neon (Postgres). Prisma migration status overlays on top of any database adapter. Users see "is my DB reachable, how big is it, and are there pending migrations?" in the TUI and CLI.

Benchmarked against: Folia (Turso + Neon), Costli (Postgres + Prisma), Mtnmap (Neon + Prisma + SQLite sync).

## Tasks

- [ ] Define `CloudServiceAdapter` interface in `packages/types/`
- [ ] Define `CloudService`, `DatabaseDetail`, `MigrationStatus` types
- [ ] Implement `TursoAdapter`:
  - [ ] Detection: `drizzle.config.ts` with libsql, `.env` with `TURSO_DATABASE_URL`
  - [ ] Status: `turso db show <name> --json` for size, region, replicas
  - [ ] Auth: `turso auth token` or `TURSO_AUTH_TOKEN` env var
- [ ] Implement `NeonAdapter`:
  - [ ] Detection: `.env` with `*.neon.tech` in DATABASE_URL
  - [ ] Status: Neon API for branch/compute status, or TCP probe
  - [ ] Auth: `NEON_API_KEY` or `~/.neon/credentials.json`
- [ ] Implement `PrismaMigrationOverlay`:
  - [ ] Detection: `prisma/schema.prisma` exists or `prisma` in package.json deps
  - [ ] Status: `npx prisma migrate status` → parse applied/pending count
  - [ ] Action: `npx prisma migrate deploy` for running pending migrations
- [ ] Add `cloudServices: CloudServiceConfig[]` to `ProjectConfig`
- [ ] Cloud service detection in detection pipeline (Tier 4)
- [ ] REST endpoints: `/projects/:id/cloud-services` (filtered to databases)
- [ ] WebSocket events: `cloud_service_updated`
- [ ] CLI: `opcom db [project]` — show database status + migration state
- [ ] CLI: `opcom db <project> migrate` — run pending migrations
- [ ] Polling: 60s active, 5m idle for database status checks

## Acceptance Criteria

- `opcom db folia` shows Turso (size, tables, region) and Neon (size, connection status, Prisma migrations)
- `opcom db mtnmap migrate` runs pending Prisma migrations
- Database health dots appear in TUI L1 as part of Cloud indicator
- Detection auto-discovers databases from `.env` and config files without manual setup
