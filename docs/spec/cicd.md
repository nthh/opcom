# CI/CD Specification

## Overview

CI/CD integration lets opcom track pipeline status for each project — from git push through workflow execution to deployment. The first implementation targets GitHub Actions, with the adapter interface designed to support other CI systems later.

This spec defines the adapter interface, normalized types, and how pipeline status flows through the station daemon to TUI/web clients. The existing `github-deployments-pane` ticket covers the TUI presentation; this spec covers the underlying infrastructure.

## Architecture

```
GitHub Actions API ──→ CICDAdapter ──→ NormalizedPipeline ──→ Station ──→ TUI/Web
                                                                │
GitLab CI API ───────→ CICDAdapter ──┘                         ▼
                                                          WebSocket events
```

CI/CD adapters are peers to agent adapters and project adapters — they normalize a backend-specific API into common types.

## Normalized Types

```typescript
interface Pipeline {
  id: string;
  projectId: string;               // opcom project this belongs to
  provider: CICDProvider;
  name: string;                    // workflow name
  ref: string;                     // branch or tag
  commitSha: string;
  commitMessage?: string;
  triggeredBy?: string;            // user or "push" / "schedule" / "pr"
  status: PipelineStatus;
  startedAt?: string;
  completedAt?: string;
  durationMs?: number;
  url: string;                     // link to workflow run in browser
  jobs: PipelineJob[];
}

type CICDProvider = "github-actions" | "gitlab-ci" | "circleci" | "buildkite";

type PipelineStatus =
  | "queued"
  | "in_progress"
  | "success"
  | "failure"
  | "cancelled"
  | "timed_out"
  | "skipped";

interface PipelineJob {
  id: string;
  name: string;
  status: PipelineStatus;
  startedAt?: string;
  completedAt?: string;
  durationMs?: number;
  steps?: PipelineStep[];
  runner?: string;                 // runner label or name
  url?: string;
}

interface PipelineStep {
  name: string;
  status: PipelineStatus;
  durationMs?: number;
}
```

## Deployment Status

Separate from pipeline runs — tracks where code is actually deployed.

```typescript
interface DeploymentStatus {
  id: string;
  projectId: string;
  provider: CICDProvider;
  environment: string;             // "production", "staging", "preview"
  ref: string;                     // branch/tag/sha deployed
  status: DeploymentState;
  url?: string;                    // deployed URL (e.g. preview deploy URL)
  createdAt: string;
  updatedAt: string;
}

type DeploymentState =
  | "pending"
  | "in_progress"
  | "active"                       // successfully deployed and live
  | "inactive"                     // superseded by newer deployment
  | "failed"
  | "error";
```

## CICD Adapter Interface

```typescript
interface CICDAdapter {
  provider: CICDProvider;

  // Check if this adapter applies to a project
  detect(project: ProjectConfig): Promise<boolean>;

  // Fetch recent pipeline runs
  listPipelines(project: ProjectConfig, opts?: {
    branch?: string;
    limit?: number;                // default 10
  }): Promise<Pipeline[]>;

  // Fetch a specific pipeline run with full job/step detail
  getPipeline(project: ProjectConfig, pipelineId: string): Promise<Pipeline>;

  // Fetch deployment status per environment
  listDeployments(project: ProjectConfig): Promise<DeploymentStatus[]>;

  // Start watching for changes (polling or webhook-based)
  watch(project: ProjectConfig, callback: (event: CICDEvent) => void): Disposable;
}

type CICDEvent =
  | { type: "pipeline_updated"; pipeline: Pipeline }
  | { type: "deployment_updated"; deployment: DeploymentStatus };

interface Disposable {
  dispose(): void;
}
```

## GitHub Actions Implementation

### Detection

A project has GitHub Actions if:
- `git.remote` points to a GitHub repo (github.com or GHE)
- `.github/workflows/` directory exists with `.yml` or `.yaml` files

### API Mapping

| GitHub API | opcom Type |
|---|---|
| `GET /repos/{owner}/{repo}/actions/runs` | `Pipeline[]` |
| `GET /repos/{owner}/{repo}/actions/runs/{id}` | `Pipeline` (with jobs) |
| `GET /repos/{owner}/{repo}/actions/runs/{id}/jobs` | `PipelineJob[]` |
| `GET /repos/{owner}/{repo}/deployments` | `DeploymentStatus[]` |
| `GET /repos/{owner}/{repo}/deployments/{id}/statuses` | `DeploymentState` |

### Status Mapping

| GitHub `workflow_run.status` | `PipelineStatus` |
|---|---|
| `queued` | `queued` |
| `in_progress` | `in_progress` |
| `completed` + `conclusion: success` | `success` |
| `completed` + `conclusion: failure` | `failure` |
| `completed` + `conclusion: cancelled` | `cancelled` |
| `completed` + `conclusion: timed_out` | `timed_out` |
| `completed` + `conclusion: skipped` | `skipped` |

### Polling Strategy

- **Active polling**: every 30s when a pipeline is `queued` or `in_progress`
- **Idle polling**: every 5m when all pipelines are terminal (success/failure/cancelled)
- **Event-driven**: if station daemon receives webhook events, skip polling entirely

### Authentication

```yaml
# ~/.opcom/config.yaml
github:
  token: ghp_xxx                   # PAT with repo + actions scope
  # OR
  tokenCommand: "gh auth token"    # shell command that prints a token
```

Prefer `tokenCommand` with `gh auth token` — reuses the user's existing `gh` auth, no extra token management.

## Webhook Ingestion (Optional Upgrade)

For real-time updates, the station daemon can receive GitHub webhooks:

```
POST /webhooks/github
  X-GitHub-Event: workflow_run | deployment_status | check_suite
  X-Hub-Signature-256: sha256=...
```

The daemon validates the signature, extracts the event, maps it to a `CICDEvent`, and pushes to subscribed clients. This replaces polling entirely for repos that have webhooks configured.

### Setup Flow

```
opcom cicd setup <project>
  → Detects GitHub repo
  → Creates webhook via GitHub API (needs admin:repo_hook scope)
  → Stores webhook secret in ~/.opcom/config.yaml
  → Falls back to polling if webhook creation fails
```

## Server API Extensions

### REST

```
GET  /projects/:id/pipelines                → Pipeline[]
GET  /projects/:id/pipelines/:runId         → Pipeline (with jobs + steps)
GET  /projects/:id/deployments              → DeploymentStatus[]
POST /projects/:id/pipelines/:runId/rerun   → Pipeline (trigger re-run)
POST /projects/:id/pipelines/:runId/cancel  → void
```

### WebSocket Events

```typescript
type ServerEvent =
  // ... existing events ...
  | { type: "pipeline_updated"; projectId: string; pipeline: Pipeline }
  | { type: "deployment_updated"; projectId: string; deployment: DeploymentStatus }
```

## TUI Integration

### Dashboard (L1)

Add CI and deploy status indicators per project, next to git state:

```
  mtnmap       main  ✓  ✔ CI     ● staging
  folia        main  ✓  ✖ CI     ● production
  conversi     main  ✓  ◌ CI     —
```

Where `✔` = last pipeline passed, `✖` = failed, `◌` = in progress, `—` = no CI.

### Dashboard Deploy Column (L1) {#dashboard-deploy-column-l1}

When projects have deployment data, the dashboard gains a deploy status column showing the most relevant deployment per project:

```
 Project          Stack           Deploy              Tickets
 folia            TS/K8s/Vue      ✓ prod 2m ago       3 open
 remolt           TS/K8s          ✗ prod failing       1 open
 mtnmap           TS/Firebase     ✓ prod 1h ago       —
 costli           TS/CF Workers   ● deploying...       2 open
```

#### Deploy Status Aggregation

Each project's deploy column shows one line — the "most important" deployment status, selected by:

1. Any actively failing deployment (highest priority — show the fire)
2. Any in-progress deployment (something is happening right now)
3. The most recent successful deployment to the highest environment (production > staging > preview)

```typescript
interface DashboardDeployStatus {
  projectId: string;
  environment: string;            // "prod", "staging", "preview"
  state: "healthy" | "failing" | "deploying" | "unknown";
  relativeTime: string;           // "2m ago", "1h ago"
  commitSha?: string;             // what's deployed
}

function aggregateDeployStatus(
  deployments: DeploymentStatus[],
): DashboardDeployStatus | null {
  // 1. Any failing? Show that.
  // 2. Any in_progress? Show that.
  // 3. Most recent active in highest environment? Show that.
  // 4. No deployments? Return null (hide column for this project).
}
```

#### Pending Changes Detection

The dashboard can indicate when local commits haven't been deployed yet:

```
 folia            TS/K8s/Vue      ✓ prod 2m ago  +3   3 open
```

The `+3` means 3 commits on the default branch are ahead of the deployed commit SHA. This is computed by comparing `git rev-list <deployed-sha>..HEAD | wc -l`.

#### Visibility Rules

- Projects without CI/CD configured show no deploy column (not "unknown")
- The deploy column only appears on the dashboard if at least one project has deployment data
- If all deployments are healthy and recent, the column stays compact (just the checkmark and relative time)

### Project Detail (L2)

New PIPELINES section:

```
PIPELINES
  ✔ Deploy to staging     main   2m ago    45s
  ✖ Run tests             main   15m ago   2m 12s
  ✔ Lint + typecheck      main   15m ago   38s

DEPLOYMENTS
  ● production    v2.4.1   3d ago
  ● staging       main     2m ago
  ○ preview       —        —
```

### Pipeline Detail (L3)

Drill into a pipeline run to see jobs and steps:

```
┌─ folia ── Run tests ── ✖ failure ── main@a3f2b1c ────────────────────────┐
│                                                                           │
│  JOBS                                                                     │
│                                                                           │
│  ✔ lint         12s                                                       │
│  ✔ typecheck    18s                                                       │
│  ✖ test-unit    1m 42s                                                    │
│    ├─ ✔ Setup        3s                                                   │
│    ├─ ✔ Install      12s                                                  │
│    ├─ ✖ Run tests    1m 24s                                               │
│    └─ ✔ Cleanup      3s                                                   │
│  ○ test-e2e     skipped (depends on test-unit)                            │
│  ○ deploy       skipped                                                   │
│                                                                           │
│  Triggered by: push (nathan)                                              │
│  Commit: a3f2b1c "Fix tile caching logic"                                 │
│  Duration: 2m 12s                                                         │
│  URL: https://github.com/...                                              │
│                                                                           │
├───────────────────────────────────────────────────────────────────────────┤
│ esc:back  R:rerun  o:open in browser  ?:help                              │
└───────────────────────────────────────────────────────────────────────────┘
```

### Keybindings

| Key | Context | Action |
|---|---|---|
| `c` | L2 Project Detail | Focus pipelines section |
| `Enter` | L2 on a pipeline | Drill into pipeline detail (L3) |
| `R` | L3 Pipeline Detail | Trigger re-run |
| `o` | L3 Pipeline Detail | Open in browser |

## CLI

```
opcom ci [project]                 # show recent pipelines for project (or all)
opcom ci <project> --watch         # tail pipeline status with live updates
opcom ci setup <project>           # configure webhook for real-time updates
```

## Relationship to Existing Tickets

The `github-deployments-pane` ticket focuses on the TUI rendering. This spec defines the underlying adapter, types, polling infrastructure, and server API that the pane depends on.
