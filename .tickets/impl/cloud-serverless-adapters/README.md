---
id: cloud-serverless-adapters
title: "Cloud Serverless Adapters: Cloudflare Workers, Firebase Functions"
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

# Cloud Serverless Adapters: Cloudflare Workers, Firebase Functions

## Goal

Track deployment status, routes/triggers, and logs for Cloudflare Workers and Firebase Functions. Users see which functions are deployed, when they were last updated, and can tail logs or trigger deploys from the TUI/CLI.

Benchmarked against: Mtnmap (CF Workers for API + Firebase Functions for cron/migrations), Costli (Firebase Functions backend).

## Tasks

- [ ] Implement `CloudflareWorkersAdapter`:
  - [ ] Detection: `wrangler.toml` with triggers/routes, `wrangler.json`
  - [ ] Status: `wrangler deployments list --json`, Cloudflare API for routes
  - [ ] Logs: `wrangler tail --format=json` for real-time log streaming
  - [ ] Deploy: `wrangler deploy` action
  - [ ] Auth: `wrangler whoami` or `CLOUDFLARE_API_TOKEN`
- [ ] Implement `FirebaseFunctionsAdapter`:
  - [ ] Detection: `firebase.json` with `functions` config + `functions/` directory
  - [ ] Status: `firebase functions:list --json` or `gcloud functions list`
  - [ ] Logs: `firebase functions:log --only=<name>` or `gcloud functions logs read`
  - [ ] Deploy: `firebase deploy --only functions` or specific function
  - [ ] Detect scheduled functions (cron triggers) from source annotations
  - [ ] Auth: `firebase login`
- [ ] Define `ServerlessDetail`, `FunctionInfo` types in `packages/types/`
- [ ] REST endpoints for serverless services
- [ ] WebSocket events for deployment status changes
- [ ] CLI: `opcom deploy <project> [service]` — trigger serverless deployment
- [ ] CLI: `opcom cloud <project> <service> logs [--follow]` — tail function logs
- [ ] Polling: 30s active, 5m idle

## Acceptance Criteria

- `opcom cloud mtnmap` shows CF Workers (3 routes) and Firebase Functions (2 scheduled, 1 migration runner)
- `opcom cloud mtnmap api logs --follow` streams Cloudflare Worker logs in real-time
- `opcom deploy mtnmap api` triggers wrangler deploy and shows result
- Serverless health dots in TUI L1 Cloud indicator
- L2 SERVERLESS section shows function names, trigger types, last deploy time
