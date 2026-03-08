// Infrastructure monitoring normalized types
// Adapter interface and types for runtime infrastructure status tracking.

import type { ProjectConfig } from "./project.js";
import type { Disposable } from "./cicd.js";

// --- Provider ---

export type InfraProvider = "kubernetes" | "ecs" | "fly" | "cloudflare-workers";

// --- Resource Kinds ---

export type ResourceKind =
  | "deployment"
  | "statefulset"
  | "daemonset"
  | "pod"
  | "service"
  | "ingress"
  | "job"
  | "cronjob";

// --- Status ---

export type ResourceStatus =
  | "healthy"        // all replicas ready, no error conditions
  | "degraded"       // some replicas ready, or warning conditions
  | "unhealthy"      // no replicas ready, or error conditions
  | "progressing"    // rollout in progress
  | "suspended"      // scaled to 0 or paused
  | "unknown";

// --- Sub-types ---

export interface ReplicaStatus {
  desired: number;
  ready: number;
  available: number;
  unavailable: number;
}

export interface ResourceEndpoint {
  type: "ClusterIP" | "NodePort" | "LoadBalancer" | "Ingress";
  address: string;
  port: number;
  protocol: "TCP" | "UDP" | "HTTP" | "HTTPS";
}

export interface ResourceCondition {
  type: string;              // "Available", "Progressing", "Ready", etc.
  status: boolean;
  reason?: string;
  message?: string;
  lastTransition: string;
}

// --- Resource ---

export interface InfraResource {
  id: string;                      // namespace/name or provider-specific ID
  projectId: string;
  provider: InfraProvider;
  kind: ResourceKind;
  name: string;
  namespace?: string;
  status: ResourceStatus;
  replicas?: ReplicaStatus;
  endpoints?: ResourceEndpoint[];
  conditions?: ResourceCondition[];
  age: string;                     // ISO timestamp of creation
  labels?: Record<string, string>;
}

// --- Pod Detail ---

export interface ContainerStatus {
  name: string;
  image: string;
  ready: boolean;
  state: "running" | "waiting" | "terminated";
  restarts: number;
  reason?: string;                 // "CrashLoopBackOff", "OOMKilled", etc.
  lastTerminatedAt?: string;
}

export interface PodDetail extends InfraResource {
  kind: "pod";
  containers: ContainerStatus[];
  node?: string;
  restarts: number;
  phase: "Pending" | "Running" | "Succeeded" | "Failed" | "Unknown";
}

// --- Log ---

export interface InfraLogLine {
  timestamp: string;
  container?: string;
  text: string;
}

// --- Events ---

export type InfraEvent =
  | { type: "resource_updated"; resource: InfraResource }
  | { type: "resource_deleted"; resourceId: string }
  | { type: "pod_crash"; pod: PodDetail; container: string; reason: string };

// --- Adapter Log Options ---

export interface InfraLogOptions {
  container?: string;
  follow?: boolean;
  tailLines?: number;              // default 100
  since?: string;                  // duration like "5m" or ISO timestamp
}

// --- Adapter Interface ---

export interface InfraAdapter {
  provider: InfraProvider;

  /** Check if this adapter applies to a project. */
  detect(project: ProjectConfig): Promise<boolean>;

  /** List resources associated with this project. */
  listResources(project: ProjectConfig, opts?: {
    kinds?: ResourceKind[];
    namespace?: string;
  }): Promise<InfraResource[]>;

  /** Get detailed status for a specific resource. */
  getResource(project: ProjectConfig, resourceId: string): Promise<InfraResource>;

  /** Stream logs from a pod/container. */
  streamLogs(project: ProjectConfig, resourceId: string, opts?: InfraLogOptions): AsyncIterable<InfraLogLine>;

  /** Watch for resource changes. */
  watch(project: ProjectConfig, callback: (event: InfraEvent) => void): Disposable;
}

// --- Configuration ---

export interface InfraConfig {
  kubernetes?: KubernetesConfig;
}

export interface KubernetesConfig {
  context?: string;               // kubeconfig context
  namespace?: string;             // namespace to watch
  labelSelector?: string;         // explicit label selector
}

// --- Health Summary ---

export interface InfraHealthSummary {
  total: number;
  healthy: number;
  degraded: number;
  unhealthy: number;
  progressing: number;
  suspended: number;
  unknown: number;
}
