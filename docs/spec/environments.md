# Dev Environments Specification

## Overview

Dev environment management tracks the runtime state of project services, manages port allocation across the workspace, and provides health/readiness signals to the TUI and agents. This builds on the existing `ServiceDefinition` and `EnvironmentConfig` types and the Phase 3 process manager.

The key insight: opcom already knows what services a project has (from detection). This spec adds the runtime layer — are they actually running, on which ports, and are they healthy.

## Entity Model

```
Workspace
  └── PortRegistry            # workspace-wide port allocation
  └── Project
       ├── ServiceDefinition   # what can run (from detection, exists today)
       ├── ServiceInstance      # what IS running (new)
       └── EnvironmentConfig   # local/staging/prod URLs (exists today)
```

## Port Registry

Workspace-scoped port allocation that prevents collisions when running multiple projects.

```typescript
interface PortRegistry {
  allocations: PortAllocation[];
  reservedRanges: PortRange[];     // user-configured exclusions
}

interface PortAllocation {
  port: number;
  projectId: string;
  serviceName: string;
  pid?: number;                    // process holding the port
  allocatedAt: string;
}

interface PortRange {
  start: number;
  end: number;
  reason: string;                  // "system", "user-reserved", etc.
}
```

### Port Conflict Resolution

When starting services, the process manager checks the port registry before binding:

1. Check if the desired port is already allocated to another project
2. If conflict: warn the user, suggest next available port, or auto-offset
3. Record allocation in registry on successful bind
4. Release allocation on service stop or process death

### Auto-Offset Strategy

When a port conflicts, apply a project-index offset:

```
base_port + (project_index * 100)

Example: two projects both want :3000
  project-a → :3000  (first, gets original)
  project-b → :3100  (offset by 100)
```

Users can override with explicit port mappings in project config overrides.

### Persistence

```yaml
# ~/.opcom/ports.yaml
allocations:
  - port: 3000
    projectId: mtnmap
    serviceName: web
  - port: 5432
    projectId: folia
    serviceName: postgres
  - port: 8000
    projectId: folia
    serviceName: api

reservedRanges:
  - start: 1
    end: 1023
    reason: system
```

## Service Instances

Runtime state for a running service. Extends the static `ServiceDefinition` with live data.

```typescript
interface ServiceInstance {
  serviceName: string;             // matches ServiceDefinition.name
  projectId: string;
  pid: number;
  port?: number;                   // actual bound port (may differ from definition)
  state: ServiceState;
  startedAt: string;
  lastHealthCheck?: HealthCheckResult;
  restartCount: number;
  logs: LogBuffer;                 // ring buffer of recent stdout/stderr
}

type ServiceState =
  | "starting"       // process spawned, not yet healthy
  | "running"        // healthy and responding
  | "unhealthy"      // process alive but health check failing
  | "stopped"        // clean shutdown
  | "crashed"        // unexpected exit
  | "restarting";    // auto-restart in progress
```

## Health Checks

Three strategies, tried in order:

```typescript
interface HealthCheckConfig {
  strategy: "tcp" | "http" | "command";

  // tcp: try to connect to the port
  // http: GET a URL, expect 2xx
  // command: run a shell command, expect exit 0

  httpPath?: string;               // for http strategy, default "/"
  command?: string;                 // for command strategy
  intervalMs: number;              // default 5000
  timeoutMs: number;               // default 3000
  retries: number;                 // failures before "unhealthy", default 3
  startupGraceMs: number;          // ignore failures for this long after start, default 10000
}

interface HealthCheckResult {
  healthy: boolean;
  checkedAt: string;
  latencyMs: number;
  error?: string;
}
```

### Default Strategy Selection

If no health check is explicitly configured:

| Service has port? | Strategy |
|---|---|
| Yes | `tcp` — try connecting to the port |
| No | None — assume healthy if process is alive |

Users can override per-service in project config.

## Service Dependencies

Services within a project start in dependency order. Dependencies come from two sources:

1. **docker-compose.yml `depends_on`** — already parsed by detection
2. **User-configured** — in project config overrides

```typescript
interface ServiceDefinition {
  name: string;
  command?: string;
  port?: number;
  cwd?: string;
  dependsOn?: string[];            // other service names in this project
  healthCheck?: HealthCheckConfig;
  env?: Record<string, string>;    // environment variables
  readyPattern?: string;           // regex to match in stdout indicating readiness
}
```

### Startup Sequence

1. Topologically sort services by `dependsOn`
2. Start services in order, waiting for each to become healthy before starting dependents
3. If a dependency fails health check, halt startup and report which service blocked

## Environment Status Aggregation

Roll up all service instances into a project-level environment summary:

```typescript
interface EnvironmentStatus {
  projectId: string;
  state: "all-up" | "partial" | "all-down" | "degraded";
  services: ServiceInstance[];
  ports: number[];                 // all bound ports
  upSince?: string;                // oldest running service start time
}
```

This is what the TUI displays in the project detail view and dashboard.

## Server API Extensions

### REST

```
GET  /projects/:id/environment          → EnvironmentStatus
GET  /projects/:id/services             → ServiceInstance[]
GET  /projects/:id/services/:name       → ServiceInstance
POST /projects/:id/services/:name/start → ServiceInstance
POST /projects/:id/services/:name/stop  → void
POST /projects/:id/services/start-all   → EnvironmentStatus
POST /projects/:id/services/stop-all    → void
GET  /ports                             → PortRegistry
```

### WebSocket Events

```typescript
type ServerEvent =
  // ... existing events ...
  | { type: "service_status"; projectId: string; service: ServiceInstance }
  | { type: "port_conflict"; projectId: string; serviceName: string; port: number; conflictsWith: PortAllocation }
  | { type: "environment_status"; projectId: string; status: EnvironmentStatus }
```

## TUI Integration

### Dashboard (L1)

Add service health indicator per project:

```
  mtnmap       main  ✓  ●●●○    3 services
```

Where `●` = running/healthy, `○` = stopped, `◐` = starting/unhealthy.

### Project Detail (L2)

The SERVICES section gains live status:

```
SERVICES
  ● postgres     :5432  running   12m
  ● api          :8000  running   12m
  ◐ worker       :8001  starting
  ○ tests        —      stopped
```

### Keybindings

| Key | Context | Action |
|---|---|---|
| `d` | L2 Project Detail | Start all services |
| `D` | L2 Project Detail | Stop all services |
| `Enter` | L2 on a service | Show service logs (L3) |

## Configuration

### User Overrides

```yaml
# ~/.opcom/projects/folia.yaml (overrides section)
overrides:
  services:
    - name: api
      port: 8000
      healthCheck:
        strategy: http
        httpPath: /health
      dependsOn:
        - postgres
    - name: postgres
      port: 5432
      healthCheck:
        strategy: tcp
  portOffset: 0                    # manual offset for this project (default 0)
```

### Workspace Port Config

```yaml
# ~/.opcom/config.yaml
ports:
  autoOffset: true                 # enable auto-offset on conflict
  offsetStep: 100                  # offset increment per project
  reservedRanges:
    - start: 1
      end: 1023
      reason: system
```

## Dev Startup on Init {#dev-startup-on-init}

The init pipeline can optionally start the dev environment after project configuration. This bridges the gap between "opcom knows your project" and "your dev environment is running."

### Dev Command Resolution

The dev startup command is resolved in order:

1. `profile.commands.dev` — user-configured or detected dev command
2. `services[]` — if services exist but no dev command, start all services via ProcessManager
3. None — no dev environment to start (skip silently)

### Interactive Mode

After project detection and profile confirmation, prompt:

```
  Dev command: flc dev start --only app    ← from package.json scripts

  Start dev environment now? [Y/n]:
```

If the user confirms, start the dev command via ProcessManager. The process runs in the background and its output streams to the TUI once it launches. If the user edits the dev command at the prompt, save the edited value to `profile.commands.dev`.

### Agent Mode

During `opcom init --auto` or non-TTY setup, the dev command is detected and printed in the command guide but **not auto-started** (agents shouldn't assume the user wants processes running):

```
  Dev command: flc dev start --only app
  Start dev: opcom dev folia
```

An agent can then run `opcom dev <project>` if it needs the dev environment, or relay the command to the user.

### Dev Command as Service

When `profile.commands.dev` is set but no matching `ServiceDefinition` exists, the init pipeline creates a synthetic service:

```typescript
{
  name: "dev",
  command: profile.commands.dev,  // e.g. "flc dev start --only app"
  cwd: project.path,
  // port, healthCheck, readyPattern inferred if possible
}
```

This lets `opcom dev <project>` work even when the dev command isn't a docker-compose service.
