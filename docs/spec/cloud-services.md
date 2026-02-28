# Cloud Services Specification

## Overview

opcom's existing specs cover compute infrastructure (K8s), CI/CD pipelines (GitHub Actions), and local dev environments (port registry + health checks). But real projects span more — databases, object storage, serverless functions, hosted frontends, and mobile deployments. This spec adds the adapter layer that covers the rest.

Benchmarked against five real projects:

| Project | Databases | Storage | Serverless | Hosting | Mobile | K8s | CI/CD |
|---------|-----------|---------|------------|---------|--------|-----|-------|
| **Folia** | Turso, Neon Postgres | R2 | — | — | — | Vultr (3 svc) | GH Actions |
| **Remolt** | — | — | — | — | — | Vultr | GH Actions |
| **Costli** | Postgres + Prisma | — | Firebase Functions | — | — | — | — |
| **Conversi** | — | — | — | — | — | — | — |
| **Mtnmap** | Neon Postgres, SQLite (sync) | R2, GCS | CF Workers, Firebase Functions | Firebase Hosting | iOS OTA | — | — |

The existing `InfraAdapter` handles K8s. The existing `CICDAdapter` handles GitHub Actions. This spec adds `CloudServiceAdapter` for everything else.

## Architecture

```
Turso API ──────────┐
Neon API ───────────┤
R2 API ─────────────┤
GCS / gsutil ───────┼──→ CloudServiceAdapter ──→ CloudServiceStatus ──→ Station ──→ TUI/Web
wrangler CLI ───────┤                                                      │
firebase CLI ───────┤                                                      ▼
EAS CLI ────────────┘                                              WebSocket events
```

Cloud service adapters are peers to `InfraAdapter` and `CICDAdapter` — they normalize provider-specific APIs into common types. A project can have multiple cloud services (e.g., Mtnmap has 7).

## Normalized Types

```typescript
type CloudProvider =
  // Databases
  | "turso"
  | "neon"
  | "planetscale"
  | "supabase"
  // Object storage
  | "cloudflare-r2"
  | "gcs"
  | "s3"
  // Serverless
  | "cloudflare-workers"
  | "firebase-functions"
  // Hosting
  | "firebase-hosting"
  | "vercel"
  | "netlify"
  | "cloudflare-pages"
  // Mobile
  | "expo-eas"
  | "firebase-app-distribution";

type CloudServiceKind =
  | "database"
  | "storage"
  | "serverless"
  | "hosting"
  | "mobile";

interface CloudService {
  id: string;                        // provider:name (e.g. "turso:folia-prod")
  projectId: string;
  provider: CloudProvider;
  kind: CloudServiceKind;
  name: string;                      // human label
  status: CloudServiceHealth;
  detail: CloudServiceDetail;        // kind-specific data
  capabilities: CloudCapability[];   // what actions this service supports
  lastCheckedAt: string;
  url?: string;                      // dashboard/console URL
}

type CloudServiceHealth =
  | "healthy"       // reachable, no issues
  | "degraded"      // reachable but warnings (high latency, nearing limits)
  | "unreachable"   // cannot connect or API error
  | "unknown";      // not yet checked

type CloudCapability =
  | "logs"          // can stream/fetch logs
  | "deploy"        // can trigger deployment
  | "migrate"       // can run database migrations
  | "metrics"       // can fetch usage metrics
  | "restart";      // can restart service
```

### Kind-Specific Detail Types

```typescript
// Discriminated union on `kind`
type CloudServiceDetail =
  | DatabaseDetail
  | StorageDetail
  | ServerlessDetail
  | HostingDetail
  | MobileDetail;

interface DatabaseDetail {
  kind: "database";
  engine: "sqlite" | "postgres" | "mysql";
  connectionUrl?: string;            // masked: postgres://***@neon.tech/mydb
  sizeBytes?: number;
  tableCount?: number;
  migration?: MigrationStatus;
  replicas?: number;
  region?: string;
}

interface MigrationStatus {
  tool: "prisma" | "drizzle" | "knex" | "raw";
  applied: number;
  pending: number;
  lastAppliedAt?: string;
  lastMigrationName?: string;
}

interface StorageDetail {
  kind: "storage";
  buckets: BucketInfo[];
}

interface BucketInfo {
  name: string;
  sizeBytes?: number;
  objectCount?: number;
  region?: string;
  publicAccess: boolean;
}

interface ServerlessDetail {
  kind: "serverless";
  functions: FunctionInfo[];
  runtime?: string;                  // "node20", "workers"
}

interface FunctionInfo {
  name: string;
  status: "deployed" | "failed" | "draft";
  trigger: "http" | "schedule" | "event" | "queue";
  route?: string;                    // HTTP route or cron expression
  lastDeployedAt?: string;
  region?: string;
}

interface HostingDetail {
  kind: "hosting";
  domains: DomainInfo[];
  lastDeployedAt?: string;
  deployedRef?: string;              // branch/tag/sha
  framework?: string;                // "react", "next", "vite"
}

interface DomainInfo {
  hostname: string;
  ssl: boolean;
  primary: boolean;
}

interface MobileDetail {
  kind: "mobile";
  platform: "ios" | "android" | "both";
  currentVersion?: string;
  lastPublishedAt?: string;
  updateChannel?: string;            // "production", "preview"
  distribution: "ota" | "store" | "ad-hoc";
}
```

## Cloud Service Adapter Interface

```typescript
interface CloudServiceAdapter {
  readonly provider: CloudProvider;
  readonly kind: CloudServiceKind;

  // Detect if this service is used by a project (from project files)
  detect(projectPath: string, stack: StackInfo): Promise<CloudServiceConfig | null>;

  // Get current status
  status(config: CloudServiceConfig): Promise<CloudService>;

  // Optional capabilities — check `capabilities` array before calling

  // Stream or fetch logs
  logs?(config: CloudServiceConfig, opts: LogOptions): AsyncIterable<LogLine>;

  // Trigger deployment
  deploy?(config: CloudServiceConfig, opts?: DeployOptions): Promise<DeployResult>;

  // Run database migrations
  migrate?(config: CloudServiceConfig, direction: "up" | "status"): Promise<MigrateResult>;

  // Fetch usage metrics
  metrics?(config: CloudServiceConfig, range: TimeRange): Promise<MetricsResult>;
}

// What the adapter discovers during detection
interface CloudServiceConfig {
  provider: CloudProvider;
  kind: CloudServiceKind;
  name: string;                      // auto-detected or user-configured
  // Provider-specific connection info
  [key: string]: unknown;
}

interface LogOptions {
  follow?: boolean;
  tailLines?: number;
  since?: string;
  functionName?: string;             // for serverless
}

interface DeployOptions {
  ref?: string;                      // branch/tag/sha to deploy
  environment?: string;              // "production", "staging", "preview"
}

interface DeployResult {
  success: boolean;
  deploymentId?: string;
  url?: string;
  error?: string;
}

interface MigrateResult {
  applied: string[];                 // migration names applied
  pending: string[];                 // migrations still pending
  error?: string;
}

interface MetricsResult {
  requests?: number;
  errors?: number;
  latencyP50Ms?: number;
  latencyP99Ms?: number;
  storageBytes?: number;
  computeMs?: number;
  period: TimeRange;
}

interface TimeRange {
  start: string;                     // ISO
  end: string;
}
```

## Provider Implementations

### Databases

#### Turso

Detection:
- `drizzle.config.ts` with `libsql` driver
- `.env` / `.env.local` containing `TURSO_DATABASE_URL` or `LIBSQL_URL`
- `turso.toml` in project root
- `package.json` dependencies: `@libsql/client`, `libsql`

Status via:
- `turso db show <name> --json` — size, region, replicas, URL
- `turso db list --json` — enumerate databases in org
- Falls back to TCP connect on database URL if CLI not available

Capabilities: `["logs", "metrics"]`

Auth: `turso auth token` or `TURSO_AUTH_TOKEN` env var

#### Neon Postgres

Detection:
- `.env` containing `DATABASE_URL` pointing to `*.neon.tech`
- `prisma/schema.prisma` with `provider = "postgresql"` + neon-ish URL
- `drizzle.config.ts` with neon connection

Status via:
- Neon API: `GET /projects/{id}/branches` — branch status, compute endpoints
- Or: `psql` connection test to the URL (TCP probe)
- Prisma migration status: `npx prisma migrate status` (if prisma detected)

Capabilities: `["migrate", "metrics"]` (migrate only if Prisma/Drizzle detected)

Auth: `NEON_API_KEY` env var or `~/.neon/credentials.json`

#### Prisma (migration overlay)

Not a standalone adapter — augments database adapters. When `prisma/schema.prisma` exists:
- `npx prisma migrate status` → `MigrationStatus`
- `npx prisma migrate deploy` → apply pending migrations
- Works for any Prisma-supported provider (Postgres, SQLite, MySQL)

Detection: `prisma/schema.prisma` file exists, or `prisma` in `package.json` dependencies

### Object Storage

#### Cloudflare R2

Detection:
- `wrangler.toml` with `[[r2_buckets]]` binding
- `.env` containing `R2_` prefixed variables
- `package.json` scripts referencing `wrangler r2`

Status via:
- `wrangler r2 object list <bucket> --json` — basic listing (R2 API doesn't expose bucket size natively)
- Cloudflare API: `GET /accounts/{id}/r2/buckets` — bucket list
- Bucket existence check as health probe

Capabilities: `["metrics"]`

Auth: `wrangler whoami` (checks existing auth) or `CLOUDFLARE_API_TOKEN`

#### Google Cloud Storage

Detection:
- `GOOGLE_CLOUD_PROJECT` or `GCS_BUCKET` env vars
- `gsutil` references in scripts or config
- `firebase.json` with storage rules (Firebase Storage uses GCS)
- Service account key files (`*-firebase-adminsdk-*.json`)

Status via:
- `gsutil du -s gs://bucket` — bucket size
- `gsutil ls gs://bucket` — object listing
- `gcloud storage buckets describe gs://bucket --format=json` — metadata

Capabilities: `["metrics"]`

Auth: `gcloud auth print-access-token` or `GOOGLE_APPLICATION_CREDENTIALS`

### Serverless

#### Cloudflare Workers

Detection:
- `wrangler.toml` with `[triggers]` or route bindings
- `wrangler.json` or `wrangler.jsonc`
- `package.json` scripts containing `wrangler deploy` or `wrangler dev`

Status via:
- `wrangler deployments list --json` — recent deployments
- Cloudflare API: `GET /accounts/{id}/workers/scripts` — worker list
- `GET /accounts/{id}/workers/scripts/{name}/schedules` — cron triggers
- Route configuration from `wrangler.toml`

Capabilities: `["logs", "deploy", "metrics"]`
- Logs: `wrangler tail --format=json` (real-time) or Cloudflare API logpush
- Deploy: `wrangler deploy`
- Metrics: Cloudflare analytics API — requests, errors, CPU time

Auth: `wrangler whoami` or `CLOUDFLARE_API_TOKEN`

#### Firebase Functions

Detection:
- `firebase.json` with `functions` config
- `functions/` directory with `package.json` or `src/index.ts`
- `package.json` dependencies: `firebase-functions`, `firebase-admin`

Status via:
- `firebase functions:list --json` — deployed functions with trigger types
- `gcloud functions list --project=<id> --format=json` — detailed status
- Firebase console API for invocation counts

Capabilities: `["logs", "deploy"]`
- Logs: `firebase functions:log --only=<name>` or `gcloud functions logs read <name>`
- Deploy: `firebase deploy --only functions` or `firebase deploy --only functions:<name>`

Auth: `firebase login` or `GOOGLE_APPLICATION_CREDENTIALS`

### Hosting

#### Firebase Hosting

Detection:
- `firebase.json` with `hosting` config (single or multi-site)
- `.firebaserc` with project aliases

Status via:
- `firebase hosting:channel:list --json` — preview channels + production
- Firebase Hosting API: `GET /sites/{siteId}/releases` — deployment history
- Domain verification from `firebase.json` hosting config

Capabilities: `["deploy"]`
- Deploy: `firebase deploy --only hosting` or `firebase deploy --only hosting:<target>`

Auth: `firebase login`

### Mobile

#### iOS OTA (npm publish pattern)

Detection:
- `app.json` or `app.config.ts` with `expo` config
- `eas.json` with build/submit profiles
- `package.json` with `expo` dependency
- Custom: `package.json` scripts containing OTA publish command

Status via:
- `eas update:list --json` — recent OTA updates
- `eas build:list --json` — recent builds
- Or: parse npm publish output / check package registry for version

Capabilities: `["deploy"]`
- Deploy: `npm run publish` (or whatever the configured publish command is)
- EAS: `eas update --auto`

Auth: `eas login` or `EXPO_TOKEN`

## Detection Integration

Cloud services are detected alongside existing stack detection. The detection pipeline becomes:

```
Tier 1: Manifests → StackInfo (languages, frameworks, infra) + CloudServiceConfig[]
Tier 2: Version files, configs → augment
Tier 3: Source globs → fallback
Tier 4: Cloud config files → CloudServiceConfig[] (new)
```

Tier 4 is additive — it scans for cloud service config files that aren't covered by the existing manifest tier:

| File | Cloud Service |
|------|--------------|
| `wrangler.toml` with `[[r2_buckets]]` | R2 storage |
| `wrangler.toml` with `[triggers]` | CF Workers |
| `firebase.json` with `hosting` | Firebase Hosting |
| `firebase.json` with `functions` | Firebase Functions |
| `prisma/schema.prisma` | Database + migration tool |
| `drizzle.config.ts` | Database + migration tool |
| `.env*` with `TURSO_*` | Turso database |
| `.env*` with `*neon.tech*` | Neon database |
| `eas.json` | Mobile (Expo/EAS) |
| `app.json` with `expo` | Mobile (Expo) |

Note: `wrangler.toml` and `firebase.json` are already detected in Tier 1 as infrastructure. Tier 4 extracts the _specific services_ (which R2 buckets, which functions, which hosting targets).

### ProjectConfig Extension

```typescript
interface ProjectConfig {
  // ... existing fields ...

  // New: detected cloud services for this project
  cloudServices: CloudServiceConfig[];
}
```

The `cloudServices` array is populated during detection and persisted in the project YAML. Users can override or add services manually:

```yaml
# ~/.opcom/projects/folia.yaml
cloudServices:
  # Auto-detected (from wrangler.toml, .env, etc.)
  - provider: turso
    kind: database
    name: folia-prod
    org: myorg
    database: folia-db
  - provider: neon
    kind: database
    name: platform-dm
    connectionUrl: postgres://***@ep-cool-bar-123.us-east-2.aws.neon.tech/platform_dm
  - provider: cloudflare-r2
    kind: storage
    name: assets
    bucket: folia-assets
    accountId: abc123

  # User-added (not auto-detectable)
  - provider: gcs
    kind: storage
    name: backups
    bucket: folia-backups
```

## Configuration

### Auth Resolution

Adapters resolve auth in priority order:

1. **CLI tool auth** (preferred) — reuses existing logins
   - `turso auth token`, `wrangler whoami`, `firebase login`, `gcloud auth`, `eas login`, `gh auth token`
2. **Environment variables** — `TURSO_AUTH_TOKEN`, `CLOUDFLARE_API_TOKEN`, `NEON_API_KEY`, etc.
3. **opcom config** — explicit tokens in `~/.opcom/auth.yaml`

```yaml
# ~/.opcom/auth.yaml (optional, CLI auth preferred)
cloudflare:
  apiToken: ${CLOUDFLARE_API_TOKEN}
  accountId: abc123
neon:
  apiKey: ${NEON_API_KEY}
turso:
  authToken: ${TURSO_AUTH_TOKEN}
firebase:
  # uses firebase login — no explicit config needed
gcloud:
  # uses gcloud auth — no explicit config needed
```

### Polling Strategy

| Service kind | Active interval | Idle interval | Watch available? |
|-------------|-----------------|---------------|------------------|
| Database | 60s | 5m | No (poll only) |
| Storage | 5m | 30m | No |
| Serverless | 30s | 5m | Yes (wrangler tail) |
| Hosting | 60s | 10m | No |
| Mobile | 5m | 30m | No |

Active = user is viewing the service in TUI. Idle = service exists but TUI is on a different view.

## Server API Extensions

### REST

```
GET  /projects/:id/cloud-services                    → CloudService[]
GET  /projects/:id/cloud-services/:serviceId         → CloudService
GET  /projects/:id/cloud-services/:serviceId/logs    → LogLine[]
POST /projects/:id/cloud-services/:serviceId/deploy  → DeployResult
POST /projects/:id/cloud-services/:serviceId/migrate → MigrateResult
GET  /projects/:id/cloud-services/:serviceId/metrics → MetricsResult
```

### WebSocket Events

```typescript
type ServerEvent =
  // ... existing events ...
  | { type: "cloud_service_updated"; projectId: string; service: CloudService }
  | { type: "cloud_service_alert"; projectId: string; serviceId: string; message: string }
```

## TUI Integration

### Dashboard (L1)

Cloud services roll up into a health indicator per project, alongside K8s and CI:

```
PROJECTS                         │  AGENTS
                                 │
▸ folia        main ✓            │  folia/tile-perf
  TS+React (tickets)             │    claude-code  streaming  3m
  CI: ✔  K8s: ●●●  Cloud: ●●●   │
  3 open  2h                     │
                                 │
  mtnmap       main ✓            │
  TS+Expo+CF (tickets)           │
  CI: ✔  Cloud: ●●●●●○          │
  5 open  4h                     │
                                 │
  costli       develop ✗         │
  React+Firebase                 │
  Cloud: ●●                      │
  1 open  3d                     │
```

Where `Cloud: ●●●` shows one dot per cloud service. `●` = healthy, `◐` = degraded, `○` = unreachable.

### Project Detail (L2)

New sections appear based on which cloud services the project has. Sections are only shown if relevant (no empty sections).

**Folia (L2):**

```
┌─ folia ── main ✓ ── TS+React ────────────────────────────────────────────┐
│                                                                           │
│  TICKETS (3 open)              │  AGENTS (1)                             │
│  P0 fix-login     feature  🤖  │  fix-login                              │
│  P1 add-auth      feature      │    claude-code  streaming  5m           │
│  P2 update-ui     chore        │                                         │
│                                │  STACK                                   │
│                                │    TypeScript, React, Node.js            │
│                                │    Docker, K8s                           │
│─────────────────────────────────────────────────────────────────────────  │
│                                                                           │
│  PIPELINES                     │  KUBERNETES (vultr)                      │
│  ✔ Deploy        main  2m ago  │  ● api       3/3 ready   2d            │
│  ✔ Tests         main  5m ago  │  ● worker    2/2 ready   2d            │
│                                │  ● web       1/1 ready   2d            │
│  DATABASES                     │                                         │
│  ● Turso (prod)     1.2 GB     │  STORAGE                               │
│    245 tables                  │  ● R2: assets    2.3 GB                 │
│  ● Neon (platform)  890 MB     │                                         │
│    12 tables  Prisma: 0 pending│                                         │
│                                │                                         │
│  SERVICES (dev)                │                                         │
│  ● app (flc)     :8081  5m     │                                         │
│                                │                                         │
├───────────────────────────────────────────────────────────────────────────┤
│ enter:detail  w:work  d:dev  c:ci  i:infra  v:cloud  esc:back  ?:help    │
└───────────────────────────────────────────────────────────────────────────┘
```

**Mtnmap (L2):**

```
┌─ mtnmap ── main ✓ ── TS+Expo+CF Workers ────────────────────────────────┐
│                                                                           │
│  TICKETS (5 open)              │  AGENTS (0)                             │
│  P0 sync-bug     bug           │                                         │
│  P1 offline      feature       │  STACK                                  │
│  P1 push-notif   feature       │    TypeScript, Swift                    │
│  P2 admin-ui     feature       │    Expo, CF Workers, Firebase           │
│  P2 analytics    feature       │    Prisma                               │
│                                │                                         │
│─────────────────────────────────────────────────────────────────────────  │
│                                                                           │
│  SERVERLESS                    │  HOSTING                                │
│  ● CF Workers: api    3 routes │  ● Firebase: prod                       │
│  ● CF Workers: cron   2 sched  │    mtnmap.app  ● SSL                   │
│  ● FB Func: migrate   2h ago   │    Deployed: main@a3f2  1d ago         │
│                                │                                         │
│  DATABASES                     │  STORAGE                                │
│  ● Neon (backend)    2.1 GB    │  ● R2: media      4.2 GB               │
│    Prisma: 0 pending           │  ● GCS: backup    1.8 GB               │
│  ● SQLite (frontend) synced    │                                         │
│                                │  MOBILE                                 │
│  SERVICES (dev)                │  iOS: v2.3.1 (OTA)                      │
│  ○ web      :5000   stopped    │    Published 1d ago                     │
│  ○ admin    :5173   stopped    │    Channel: production                  │
│  ○ workers  :8787   stopped    │                                         │
│                                │                                         │
├───────────────────────────────────────────────────────────────────────────┤
│ enter:detail  w:work  d:dev  v:cloud  M:migrate  P:publish  esc:back     │
└───────────────────────────────────────────────────────────────────────────┘
```

### Cloud Service Detail (L3)

Drill into a cloud service for detailed status and actions.

**Database detail:**

```
┌─ folia ── Turso: folia-prod ── ● healthy ────────────────────────────────┐
│                                                                           │
│  Provider: Turso                Engine: SQLite (edge)                     │
│  Region: us-east-1              Replicas: 3                              │
│  Size: 1.2 GB                   Tables: 245                              │
│  URL: libsql://folia-prod-myorg.turso.io                                │
│                                                                           │
│  MIGRATIONS (prisma)                                                      │
│    Applied: 47     Pending: 0    Last: 20260227_add_user_prefs           │
│                                                                           │
│  RECENT ACTIVITY                                                          │
│    2026-02-28 14:00  Size: 1.2 GB (+12 MB)                               │
│    2026-02-28 08:00  Size: 1.188 GB                                      │
│    2026-02-27 14:00  Migration applied: 20260227_add_user_prefs          │
│                                                                           │
├───────────────────────────────────────────────────────────────────────────┤
│ esc:back  M:run migrations  o:open console  ?:help                        │
└───────────────────────────────────────────────────────────────────────────┘
```

**Serverless detail:**

```
┌─ mtnmap ── CF Workers: api ── ● healthy ─────────────────────────────────┐
│                                                                           │
│  Provider: Cloudflare Workers   Runtime: workers (node compat)           │
│  Last deployed: 2026-02-27 18:42  Ref: main@b4e2c1                      │
│                                                                           │
│  ROUTES                                                                   │
│    GET  /api/maps/*         mtnmap.app/api/maps/*                        │
│    POST /api/sync           mtnmap.app/api/sync                          │
│    GET  /api/health         mtnmap.app/api/health                        │
│                                                                           │
│  ─── LOGS (tail) ────────────────────────────────────────────────────── │
│                                                                           │
│  14:23:01  GET  /api/maps/tile/12/3/4  200  18ms                         │
│  14:23:02  POST /api/sync              200  142ms                        │
│  14:23:03  GET  /api/health            200  2ms                          │
│  14:23:05  GET  /api/maps/tile/12/3/5  200  22ms                         │
│                                                                           │
├───────────────────────────────────────────────────────────────────────────┤
│ esc:back  f:follow logs  D:deploy  o:open console  ?:help                 │
└───────────────────────────────────────────────────────────────────────────┘
```

### Keybindings

| Key | Context | Action |
|-----|---------|--------|
| `v` | L2 Project Detail | Focus cloud services section |
| `Enter` | L2 on a cloud service | Drill into service detail (L3) |
| `M` | L2/L3 on a database | Run pending migrations |
| `D` | L3 on serverless/hosting | Trigger deployment |
| `P` | L2 on mobile service | Publish OTA update |
| `f` | L3 on serverless | Toggle log follow mode |
| `o` | L3 on any cloud service | Open provider console in browser |

### Section Visibility Rules

L2 only shows sections that have data. A project with no serverless functions doesn't get a SERVERLESS section. This keeps the TUI clean.

```typescript
// Which L2 sections to render
function cloudSections(services: CloudService[]): Section[] {
  const sections: Section[] = [];
  const byKind = groupBy(services, s => s.kind);

  if (byKind.database?.length)   sections.push({ title: "DATABASES", services: byKind.database });
  if (byKind.storage?.length)    sections.push({ title: "STORAGE", services: byKind.storage });
  if (byKind.serverless?.length) sections.push({ title: "SERVERLESS", services: byKind.serverless });
  if (byKind.hosting?.length)    sections.push({ title: "HOSTING", services: byKind.hosting });
  if (byKind.mobile?.length)     sections.push({ title: "MOBILE", services: byKind.mobile });

  return sections;
}
```

## CLI Commands

```
opcom cloud [project]                              # list all cloud services
opcom cloud <project> <service>                    # detailed service status
opcom cloud <project> <service> logs [--follow]    # stream logs (serverless)
opcom cloud <project> <service> deploy [--ref=X]   # trigger deployment
opcom cloud <project> <service> migrate            # run pending migrations
opcom cloud <project> <service> open               # open provider console

# Shortcuts for common actions
opcom db [project]                                 # list databases + migration status
opcom db <project> migrate                         # run pending migrations for all DBs
opcom deploy <project> [service]                   # deploy serverless/hosting
opcom publish <project>                            # publish mobile OTA update
```

## Dev Environment Integration

Cloud services interact with the dev-environments spec. Some services need local equivalents during development:

| Cloud Service | Local Dev Equivalent |
|---------------|---------------------|
| Turso | `turso dev` or local libsql |
| Neon Postgres | Local postgres (docker or native) |
| Firebase Functions | `firebase emulators:start --only functions` |
| Firebase Hosting | `firebase emulators:start --only hosting` or Vite |
| CF Workers | `wrangler dev` |
| R2 | `wrangler dev` (local R2 emulation) |

The `ServiceDefinition` for a project should reference these local dev commands. When running `opcom dev mtnmap`, opcom starts:

```yaml
# From detection + user config
services:
  - name: web
    command: "firebase emulators:start --only hosting"
    port: 5000
  - name: admin
    command: "npx vite --port 5173"
    port: 5173
  - name: workers
    command: "wrangler dev"
    port: 8787
  - name: functions-emulator
    command: "firebase emulators:start --only functions"
    port: 5001
```

The TUI SERVICES section shows these local instances alongside the CLOUD sections showing production state. This gives the full picture: "what's running locally" + "what's deployed".

## Agent Integration

Cloud service status enriches agent context packets:

```typescript
interface ContextPacket {
  // ... existing fields ...

  // New: cloud service summary for the project
  cloud?: {
    databases: Array<{
      name: string;
      provider: string;
      engine: string;
      migrationsPending: number;
    }>;
    serverless: Array<{
      name: string;
      provider: string;
      routes: string[];
    }>;
    // ... etc
  };
}
```

Agents can understand the deployment topology and suggest fixes that account for the real infrastructure. An agent working on Mtnmap knows there's a CF Worker at `/api/*` and Firebase Functions for cron, so it routes work correctly.

## Event Store Integration

Cloud service status checks can be recorded in the SQLite event store (the one being implemented) for historical tracking:

```sql
CREATE TABLE cloud_service_checks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id TEXT NOT NULL,
  service_id TEXT NOT NULL,          -- provider:name
  status TEXT NOT NULL,              -- healthy, degraded, unreachable
  detail_json TEXT,                  -- full CloudServiceDetail as JSON
  checked_at TEXT NOT NULL
);
-- Index on (project_id, service_id, checked_at)
```

This enables:
- Historical health graphs in the TUI
- Briefing skill integration ("Neon was unreachable for 2h yesterday")
- Triage skill integration ("Prisma has 3 pending migrations on costli")

## Project Mapping (Benchmark)

How each of Nathan's five projects maps to this system:

### Folia

```yaml
cloudServices:
  - provider: turso
    kind: database
    name: folia-prod
    # detected from: drizzle.config.ts or .env TURSO_DATABASE_URL
  - provider: neon
    kind: database
    name: platform-dm
    # detected from: .env DATABASE_URL with neon.tech host
  - provider: cloudflare-r2
    kind: storage
    name: assets
    # detected from: wrangler.toml [[r2_buckets]]

# Also has (covered by other specs):
# - K8s: 3 services on Vultr (infrastructure.md)
# - CI/CD: GitHub Actions (cicd.md)
# - Dev: flc dev start (environments.md, custom command)
```

### Remolt.dev

```yaml
cloudServices: []
# Pure K8s + CI/CD — no cloud services beyond compute

# Covered by other specs:
# - K8s on Vultr (infrastructure.md)
# - CI/CD: GitHub Actions (cicd.md)
# - Tests: Playwright
```

### Costli

```yaml
cloudServices:
  - provider: firebase-functions
    kind: serverless
    name: backend
    # detected from: firebase.json + functions/ directory
  - provider: neon  # or wherever the postgres is
    kind: database
    name: main
    # detected from: prisma/schema.prisma provider + .env DATABASE_URL
    migration:
      tool: prisma
```

### Conversi

```yaml
cloudServices: []  # TBD — stack unknown
```

### Mtnmap

```yaml
cloudServices:
  - provider: cloudflare-workers
    kind: serverless
    name: api
    # detected from: wrangler.toml routes
  - provider: firebase-functions
    kind: serverless
    name: cron
    # detected from: firebase.json functions config, scheduled triggers
  - provider: firebase-functions
    kind: serverless
    name: migrations
    # user-configured (not auto-detectable as separate from cron)
  - provider: neon
    kind: database
    name: backend
    # detected from: prisma/schema.prisma + .env
    migration:
      tool: prisma
  - provider: firebase-hosting
    kind: hosting
    name: web
    # detected from: firebase.json hosting config
  - provider: cloudflare-r2
    kind: storage
    name: media
    # detected from: wrangler.toml [[r2_buckets]]
  - provider: gcs
    kind: storage
    name: backup
    # user-configured or detected from service account key
  - provider: expo-eas
    kind: mobile
    name: ios
    # detected from: app.json/eas.json
    distribution: ota
```

## Relationship to Existing Specs

| Spec | Covers | This spec adds |
|------|--------|---------------|
| `infrastructure.md` | K8s pods, deployments, services | — (compute stays there) |
| `cicd.md` | GitHub Actions pipelines, deployments | — (CI/CD stays there) |
| `environments.md` | Local dev services, ports, health | Cloud services as production counterpart |
| `tui.md` | Three-level navigation | New L2 sections (DATABASES, STORAGE, SERVERLESS, HOSTING, MOBILE) |
| `adapters.md` | Agent + project adapters | CloudServiceAdapter as third adapter category |
| `detection.md` | Three-tier stack detection | Tier 4: cloud service config extraction |

## Implementation Priority

1. **Database adapters** (Turso, Neon + Prisma migrations) — most immediately useful, high signal
2. **Serverless adapters** (CF Workers, Firebase Functions) — deployment status + logs
3. **Storage adapters** (R2, GCS) — simple status checks
4. **Hosting adapters** (Firebase Hosting) — deployment tracking
5. **Mobile adapters** (Expo/EAS) — OTA version tracking
