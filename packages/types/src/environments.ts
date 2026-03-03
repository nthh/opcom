// Dev Environment Management types (Phase 8)

// --- Port Registry ---

export interface PortRegistry {
  allocations: PortAllocation[];
  reservedRanges: PortRange[];
}

export interface PortAllocation {
  port: number;
  projectId: string;
  serviceName: string;
  pid?: number;
  allocatedAt: string;
}

export interface PortRange {
  start: number;
  end: number;
  reason: string;
}

// --- Service Instances ---

export type ServiceState =
  | "starting"
  | "running"
  | "unhealthy"
  | "stopped"
  | "crashed"
  | "restarting";

export interface ServiceInstance {
  serviceName: string;
  projectId: string;
  pid: number;
  port?: number;
  state: ServiceState;
  startedAt: string;
  lastHealthCheck?: HealthCheckResult;
  restartCount: number;
}

// --- Health Checks ---

export interface HealthCheckConfig {
  strategy: "tcp" | "http" | "command";
  httpPath?: string;
  command?: string;
  intervalMs: number;
  timeoutMs: number;
  retries: number;
  startupGraceMs: number;
}

export interface HealthCheckResult {
  healthy: boolean;
  checkedAt: string;
  latencyMs: number;
  error?: string;
}

// --- Environment Status ---

export interface EnvironmentStatus {
  projectId: string;
  state: "all-up" | "partial" | "all-down" | "degraded";
  services: ServiceInstance[];
  ports: number[];
  upSince?: string;
}
