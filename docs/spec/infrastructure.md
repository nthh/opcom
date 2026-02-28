# Infrastructure Monitoring Specification

## Overview

Infrastructure monitoring tracks the runtime state of deployed services — pods, deployments, and services in Kubernetes, with the adapter interface designed to support other runtimes later (ECS, Fly.io, bare metal). This is the "is it actually running in prod?" counterpart to the dev environment spec's "is it running locally?"

Detection already identifies infrastructure in `StackInfo` (docker, kubernetes, firebase, cloudflare-workers). This spec adds runtime status queries against live clusters.

## Architecture

```
kubectl / K8s API ──→ InfraAdapter ──→ NormalizedResource ──→ Station ──→ TUI/Web
                                                                │
Fly.io API ─────────→ InfraAdapter ──┘                         ▼
                                                          WebSocket events
```

## Normalized Types

```typescript
interface InfraResource {
  id: string;                      // namespace/name or provider-specific ID
  projectId: string;
  provider: InfraProvider;
  kind: ResourceKind;
  name: string;
  namespace?: string;              // K8s namespace
  status: ResourceStatus;
  replicas?: ReplicaStatus;
  endpoints?: ResourceEndpoint[];
  conditions?: ResourceCondition[];
  age: string;                     // ISO timestamp of creation
  labels?: Record<string, string>;
}

type InfraProvider = "kubernetes" | "ecs" | "fly" | "cloudflare-workers";

type ResourceKind =
  | "deployment"
  | "statefulset"
  | "daemonset"
  | "pod"
  | "service"
  | "ingress"
  | "job"
  | "cronjob";

type ResourceStatus =
  | "healthy"          // all replicas ready, no error conditions
  | "degraded"         // some replicas ready, or warning conditions
  | "unhealthy"        // no replicas ready, or error conditions
  | "progressing"      // rollout in progress
  | "suspended"        // scaled to 0 or paused
  | "unknown";

interface ReplicaStatus {
  desired: number;
  ready: number;
  available: number;
  unavailable: number;
}

interface ResourceEndpoint {
  type: "ClusterIP" | "NodePort" | "LoadBalancer" | "Ingress";
  address: string;                 // IP or hostname
  port: number;
  protocol: "TCP" | "UDP" | "HTTP" | "HTTPS";
}

interface ResourceCondition {
  type: string;                    // "Available", "Progressing", "Ready", etc.
  status: boolean;
  reason?: string;
  message?: string;
  lastTransition: string;
}
```

## Pod Detail

Pods get additional detail since they're the most commonly inspected resource:

```typescript
interface PodDetail extends InfraResource {
  kind: "pod";
  containers: ContainerStatus[];
  node?: string;
  restarts: number;
  phase: "Pending" | "Running" | "Succeeded" | "Failed" | "Unknown";
}

interface ContainerStatus {
  name: string;
  image: string;
  ready: boolean;
  state: "running" | "waiting" | "terminated";
  restarts: number;
  reason?: string;                 // "CrashLoopBackOff", "OOMKilled", etc.
  lastTerminatedAt?: string;
}
```

## Infrastructure Adapter Interface

```typescript
interface InfraAdapter {
  provider: InfraProvider;

  // Check if this adapter applies to a project
  detect(project: ProjectConfig): Promise<boolean>;

  // List resources associated with this project
  listResources(project: ProjectConfig, opts?: {
    kinds?: ResourceKind[];
    namespace?: string;
  }): Promise<InfraResource[]>;

  // Get detailed status for a specific resource
  getResource(project: ProjectConfig, resourceId: string): Promise<InfraResource>;

  // Stream logs from a pod/container
  streamLogs(project: ProjectConfig, resourceId: string, opts?: {
    container?: string;
    follow?: boolean;
    tailLines?: number;            // default 100
    since?: string;                // duration like "5m" or ISO timestamp
  }): AsyncIterable<LogLine>;

  // Watch for resource changes
  watch(project: ProjectConfig, callback: (event: InfraEvent) => void): Disposable;
}

interface LogLine {
  timestamp: string;
  container?: string;
  text: string;
}

type InfraEvent =
  | { type: "resource_updated"; resource: InfraResource }
  | { type: "resource_deleted"; resourceId: string }
  | { type: "pod_crash"; pod: PodDetail; container: string; reason: string };
```

## Kubernetes Implementation

### Detection

A project has K8s infrastructure if:
- `StackInfo.infrastructure` includes `kubernetes` (from `k8s/` or `kubernetes/` dirs)
- Or: a kubeconfig context matches the project name

### Project-to-Resource Mapping

K8s resources are matched to opcom projects by:

1. **Label matching** (preferred): `app.kubernetes.io/name` or `app` label matches project name
2. **Namespace matching**: namespace matches project name
3. **User-configured**: explicit mapping in project config

```yaml
# ~/.opcom/projects/folia.yaml
overrides:
  infrastructure:
    kubernetes:
      context: production-cluster    # kubeconfig context
      namespace: folia-prod          # namespace to watch
      labelSelector: "app=folia"     # or explicit label selector
```

### kubectl Execution

Use `kubectl` CLI rather than direct K8s API client — simpler, respects user's kubeconfig, handles auth (including cloud provider plugins like `gke-gcloud-auth-plugin`).

```typescript
// Internal implementation approach
async function listResources(namespace: string, kind: string): Promise<InfraResource[]> {
  // kubectl get deployments -n folia-prod -o json
  const result = await exec(`kubectl get ${kind} -n ${namespace} -o json`);
  const list = JSON.parse(result.stdout);
  return list.items.map(mapKubeResourceToInfraResource);
}
```

### Status Mapping

| K8s Condition | `ResourceStatus` |
|---|---|
| Deployment: all replicas available | `healthy` |
| Deployment: some replicas available | `degraded` |
| Deployment: 0 replicas available | `unhealthy` |
| Deployment: `Progressing=True` reason `NewReplicaSetAvailable` | `progressing` |
| Replicas scaled to 0 | `suspended` |
| Pod: `CrashLoopBackOff` | `unhealthy` |
| Pod: `OOMKilled` | `unhealthy` |
| Pod: `Running` + all containers ready | `healthy` |

### Watch Strategy

- **kubectl watch**: `kubectl get pods -n <ns> --watch -o json` for real-time updates
- **Polling fallback**: every 30s if watch stream drops
- Watch is preferred — Kubernetes watch is efficient (server-side filtering, HTTP streaming)

## Server API Extensions

### REST

```
GET  /projects/:id/infrastructure              → InfraResource[]
GET  /projects/:id/infrastructure/:resourceId   → InfraResource | PodDetail
GET  /projects/:id/infrastructure/:resourceId/logs?tail=100&since=5m → LogLine[]
POST /projects/:id/infrastructure/:resourceId/restart → void (rollout restart)
```

### WebSocket Events

```typescript
type ServerEvent =
  // ... existing events ...
  | { type: "infra_resource_updated"; projectId: string; resource: InfraResource }
  | { type: "infra_resource_deleted"; projectId: string; resourceId: string }
  | { type: "pod_crash"; projectId: string; pod: PodDetail; container: string; reason: string }
```

## TUI Integration

### Dashboard (L1)

Infrastructure health indicator per project:

```
  folia        main  ✓  ✔ CI  ●●○ K8s
```

Where dots show deployment health: `●` = healthy, `◐` = progressing, `○` = unhealthy.

### Project Detail (L2)

New INFRASTRUCTURE section:

```
INFRASTRUCTURE (kubernetes: production-cluster)
  Deployments
    ● api           3/3 ready   2d
    ● worker        2/2 ready   2d
    ◐ tiles         1/3 ready   5m   (rolling update)
  Services
    api             ClusterIP   10.0.0.12:8000
    tiles           LoadBalancer  34.12.0.5:443
  Pods
    ● api-7f8b9-abc     Running   0 restarts   2d
    ● api-7f8b9-def     Running   0 restarts   2d
    ● api-7f8b9-ghi     Running   0 restarts   2d
    ● worker-5c4d-jkl   Running   0 restarts   2d
    ◐ tiles-9e2f-mno    Running   0 restarts   5m
    ○ tiles-8d1e-pqr    CrashLoop 4 restarts   12m
```

### Pod Detail (L3)

Drill into a pod for container status and logs:

```
┌─ folia ── tiles-8d1e-pqr ── CrashLoopBackOff ────────────────────────────┐
│                                                                           │
│  Pod: tiles-8d1e-pqr    Phase: Running    Node: gke-pool-1-abc           │
│  Restarts: 4            Age: 12m          Namespace: folia-prod          │
│                                                                           │
│  CONTAINERS                                                               │
│    ○ tiles     ghcr.io/folia/tiles:v2.4.2   CrashLoopBackOff  4 restarts │
│    ● sidecar   istio/proxyv2:1.20           Running            0 restarts │
│                                                                           │
│  ─── LOGS (tiles) ───────────────────────────────────────────────────── │
│                                                                           │
│  2026-02-28T14:23:01Z  Starting tile server on :8766                     │
│  2026-02-28T14:23:01Z  Connecting to PostGIS at postgres:5432            │
│  2026-02-28T14:23:02Z  ERROR: connection refused: postgres:5432          │
│  2026-02-28T14:23:02Z  Fatal: cannot start without database connection   │
│                                                                           │
├───────────────────────────────────────────────────────────────────────────┤
│ esc:back  f:follow logs  c:switch container  R:restart  o:open  ?:help   │
└───────────────────────────────────────────────────────────────────────────┘
```

### Keybindings

| Key | Context | Action |
|---|---|---|
| `i` | L2 Project Detail | Focus infrastructure section |
| `Enter` | L2 on a resource | Drill into resource/pod detail (L3) |
| `f` | L3 Pod Detail | Toggle log follow mode |
| `c` | L3 Pod Detail | Switch container (for multi-container pods) |
| `R` | L2 on a deployment | Trigger rollout restart |
| `o` | L3 Pod Detail | Open in cloud console (if URL known) |

## CLI

```
opcom infra [project]                      # show infrastructure status
opcom infra <project> pods                 # list pods
opcom infra <project> logs <pod>           # tail logs
opcom infra <project> logs <pod> --follow  # stream logs
opcom infra <project> restart <deployment> # rollout restart
```

## Alerts and Agent Integration

Infrastructure events can trigger agent actions or user notifications:

- **Pod crash** → notify user in TUI, optionally trigger agent to investigate logs
- **Deployment rollout stuck** → surface in work queue as an auto-generated work item
- **All replicas unhealthy** → urgent notification via configured channels (Phase 7)

These feed into the existing notification infrastructure from Phase 7.
