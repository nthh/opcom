---
id: cloud-storage-adapters
title: "Cloud Storage Adapters: R2, GCS"
status: closed
type: feature
priority: 3
deps:
  - cloud-database-adapters
links:
  - docs/spec/cloud-services.md
services:
  - core
  - cli
---

# Cloud Storage Adapters: R2, GCS

## Goal

Show object storage bucket status — which buckets exist, size, object count — in TUI and CLI. Lower priority than databases and serverless since storage is more of a "check occasionally" concern.

Benchmarked against: Folia (R2), Mtnmap (R2 + GCS).

## Tasks

- [ ] Implement `CloudflareR2Adapter`:
  - [ ] Detection: `wrangler.toml` with `[[r2_buckets]]`, `R2_*` env vars
  - [ ] Status: Cloudflare API `GET /accounts/{id}/r2/buckets`
  - [ ] Bucket info: name, region, public access flag
  - [ ] Auth: `wrangler whoami` or `CLOUDFLARE_API_TOKEN`
- [ ] Implement `GCSAdapter`:
  - [ ] Detection: `GOOGLE_CLOUD_PROJECT` env, `gsutil` in scripts, Firebase Storage config
  - [ ] Status: `gsutil du -s gs://bucket` for size, `gcloud storage buckets describe` for metadata
  - [ ] Auth: `gcloud auth print-access-token` or `GOOGLE_APPLICATION_CREDENTIALS`
- [ ] Define `StorageDetail`, `BucketInfo` types
- [ ] CLI: `opcom cloud <project>` shows storage buckets with size
- [ ] Polling: 5m active, 30m idle (storage changes slowly)

## Acceptance Criteria

- `opcom cloud folia` includes R2 bucket with name and size
- `opcom cloud mtnmap` shows both R2 and GCS buckets
- Storage dots appear in TUI Cloud health indicator
