import { execFile, spawn, type ChildProcess } from "node:child_process";
import { promisify } from "node:util";
import type {
  InfraAdapter,
  InfraProvider,
  InfraResource,
  InfraEvent,
  InfraLogLine,
  InfraLogOptions,
  PodDetail,
  ContainerStatus,
  ReplicaStatus,
  ResourceCondition,
  ResourceEndpoint,
  ResourceKind,
  ResourceStatus,
  KubernetesConfig,
  Disposable,
  ProjectConfig,
} from "@opcom/types";

const execFileAsync = promisify(execFile);

// --- kubectl helpers ---

interface KubectlOptions {
  context?: string;
  namespace?: string;
  timeout?: number;
}

async function kubectl(
  args: string[],
  opts: KubectlOptions = {},
): Promise<string> {
  const fullArgs = [...args];
  if (opts.context) {
    fullArgs.unshift("--context", opts.context);
  }
  if (opts.namespace) {
    fullArgs.push("-n", opts.namespace);
  }
  const { stdout } = await execFileAsync("kubectl", fullArgs, {
    timeout: opts.timeout ?? 15_000,
  });
  return stdout;
}

async function kubectlJson<T>(
  args: string[],
  opts: KubectlOptions = {},
): Promise<T> {
  const stdout = await kubectl([...args, "-o", "json"], opts);
  return JSON.parse(stdout) as T;
}

// --- K8s API types (subset we parse) ---

interface K8sMetadata {
  name: string;
  namespace?: string;
  creationTimestamp?: string;
  labels?: Record<string, string>;
  uid?: string;
}

interface K8sCondition {
  type: string;
  status: "True" | "False" | "Unknown";
  reason?: string;
  message?: string;
  lastTransitionTime?: string;
}

interface K8sDeploymentStatus {
  replicas?: number;
  readyReplicas?: number;
  availableReplicas?: number;
  unavailableReplicas?: number;
  conditions?: K8sCondition[];
}

interface K8sDeploymentSpec {
  replicas?: number;
  paused?: boolean;
}

interface K8sDeployment {
  metadata: K8sMetadata;
  spec: K8sDeploymentSpec;
  status: K8sDeploymentStatus;
}

interface K8sServiceSpec {
  type?: string;
  clusterIP?: string;
  ports?: Array<{
    port: number;
    protocol?: string;
    nodePort?: number;
  }>;
  selector?: Record<string, string>;
}

interface K8sService {
  metadata: K8sMetadata;
  spec: K8sServiceSpec;
  status: {
    loadBalancer?: {
      ingress?: Array<{ ip?: string; hostname?: string }>;
    };
  };
}

interface K8sContainerStateRunning {
  startedAt?: string;
}

interface K8sContainerStateWaiting {
  reason?: string;
  message?: string;
}

interface K8sContainerStateTerminated {
  reason?: string;
  exitCode?: number;
  finishedAt?: string;
}

interface K8sContainerStatus {
  name: string;
  image: string;
  ready: boolean;
  restartCount: number;
  state?: {
    running?: K8sContainerStateRunning;
    waiting?: K8sContainerStateWaiting;
    terminated?: K8sContainerStateTerminated;
  };
  lastState?: {
    terminated?: K8sContainerStateTerminated;
  };
}

interface K8sPodSpec {
  nodeName?: string;
  containers?: Array<{ name: string; image: string }>;
}

interface K8sPodStatus {
  phase?: string;
  containerStatuses?: K8sContainerStatus[];
  conditions?: K8sCondition[];
}

interface K8sPod {
  metadata: K8sMetadata;
  spec: K8sPodSpec;
  status: K8sPodStatus;
}

interface K8sIngressSpec {
  rules?: Array<{
    host?: string;
    http?: {
      paths?: Array<{
        path?: string;
        backend?: {
          service?: { name: string; port?: { number: number } };
        };
      }>;
    };
  }>;
}

interface K8sIngress {
  metadata: K8sMetadata;
  spec: K8sIngressSpec;
  status: {
    loadBalancer?: {
      ingress?: Array<{ ip?: string; hostname?: string }>;
    };
  };
}

interface K8sStatefulSetStatus {
  replicas?: number;
  readyReplicas?: number;
  availableReplicas?: number;
  currentReplicas?: number;
  conditions?: K8sCondition[];
}

interface K8sStatefulSet {
  metadata: K8sMetadata;
  spec: { replicas?: number };
  status: K8sStatefulSetStatus;
}

interface K8sDaemonSetStatus {
  desiredNumberScheduled?: number;
  numberReady?: number;
  numberAvailable?: number;
  numberUnavailable?: number;
  conditions?: K8sCondition[];
}

interface K8sDaemonSet {
  metadata: K8sMetadata;
  status: K8sDaemonSetStatus;
}

interface K8sJobStatus {
  succeeded?: number;
  failed?: number;
  active?: number;
  conditions?: K8sCondition[];
  startTime?: string;
  completionTime?: string;
}

interface K8sJob {
  metadata: K8sMetadata;
  spec: { completions?: number };
  status: K8sJobStatus;
}

interface K8sCronJob {
  metadata: K8sMetadata;
  spec: {
    schedule?: string;
    suspend?: boolean;
  };
  status: {
    lastScheduleTime?: string;
    active?: Array<{ name: string }>;
  };
}

interface K8sList<T> {
  items: T[];
}

// --- Mapping functions (exported for testing) ---

export function mapDeploymentStatus(deployment: K8sDeployment): ResourceStatus {
  const spec = deployment.spec;
  const status = deployment.status;
  const desired = spec.replicas ?? 1;

  if (desired === 0 || spec.paused) return "suspended";

  const available = status.availableReplicas ?? 0;
  const ready = status.readyReplicas ?? 0;

  // Check for progressing condition
  const progressing = status.conditions?.find((c) => c.type === "Progressing");
  if (
    progressing?.status === "True" &&
    progressing.reason === "NewReplicaSetAvailable"
  ) {
    if (ready < desired) return "progressing";
  }
  if (progressing?.status === "True" && ready < desired) return "progressing";

  if (available >= desired && ready >= desired) return "healthy";
  if (available > 0 || ready > 0) return "degraded";
  return "unhealthy";
}

export function mapStatefulSetStatus(sts: K8sStatefulSet): ResourceStatus {
  const desired = sts.spec.replicas ?? 1;
  if (desired === 0) return "suspended";

  const ready = sts.status.readyReplicas ?? 0;
  const current = sts.status.currentReplicas ?? 0;

  if (ready >= desired) return "healthy";
  if (current !== desired && ready > 0) return "progressing";
  if (ready > 0) return "degraded";
  return "unhealthy";
}

export function mapDaemonSetStatus(ds: K8sDaemonSet): ResourceStatus {
  const desired = ds.status.desiredNumberScheduled ?? 0;
  if (desired === 0) return "suspended";

  const ready = ds.status.numberReady ?? 0;
  const available = ds.status.numberAvailable ?? 0;

  if (ready >= desired && available >= desired) return "healthy";
  if (ready > 0) return "degraded";
  return "unhealthy";
}

export function mapPodStatus(pod: K8sPod): ResourceStatus {
  const phase = pod.status.phase;
  if (phase === "Succeeded") return "healthy";
  if (phase === "Failed") return "unhealthy";
  if (phase === "Pending") return "progressing";

  const containers = pod.status.containerStatuses ?? [];

  // Check for crash states
  for (const c of containers) {
    if (c.state?.waiting?.reason === "CrashLoopBackOff") return "unhealthy";
    if (c.state?.waiting?.reason === "OOMKilled") return "unhealthy";
    if (c.lastState?.terminated?.reason === "OOMKilled") return "unhealthy";
  }

  const allReady = containers.length > 0 && containers.every((c) => c.ready);
  if (phase === "Running" && allReady) return "healthy";
  if (phase === "Running") return "degraded";

  return "unknown";
}

export function mapJobStatus(job: K8sJob): ResourceStatus {
  const completions = job.spec.completions ?? 1;
  const succeeded = job.status.succeeded ?? 0;
  const failed = job.status.failed ?? 0;
  const active = job.status.active ?? 0;

  if (succeeded >= completions) return "healthy";
  if (failed > 0 && active === 0) return "unhealthy";
  if (active > 0) return "progressing";
  return "unknown";
}

export function mapCronJobStatus(cj: K8sCronJob): ResourceStatus {
  if (cj.spec.suspend) return "suspended";
  const active = cj.status.active ?? [];
  if (active.length > 0) return "progressing";
  return "healthy";
}

export function mapServiceStatus(_svc: K8sService): ResourceStatus {
  // Services don't have a meaningful "status" — they're healthy if they exist
  return "healthy";
}

export function mapIngressStatus(ing: K8sIngress): ResourceStatus {
  const lbIngress = ing.status?.loadBalancer?.ingress;
  if (lbIngress && lbIngress.length > 0) return "healthy";
  return "progressing";
}

export function mapConditions(conditions?: K8sCondition[]): ResourceCondition[] {
  if (!conditions) return [];
  return conditions.map((c) => ({
    type: c.type,
    status: c.status === "True",
    reason: c.reason,
    message: c.message,
    lastTransition: c.lastTransitionTime ?? new Date().toISOString(),
  }));
}

export function mapContainerStatus(cs: K8sContainerStatus): ContainerStatus {
  let state: ContainerStatus["state"] = "waiting";
  let reason: string | undefined;
  let lastTerminatedAt: string | undefined;

  if (cs.state?.running) {
    state = "running";
  } else if (cs.state?.terminated) {
    state = "terminated";
    reason = cs.state.terminated.reason;
    lastTerminatedAt = cs.state.terminated.finishedAt;
  } else if (cs.state?.waiting) {
    state = "waiting";
    reason = cs.state.waiting.reason;
  }

  if (cs.lastState?.terminated?.finishedAt) {
    lastTerminatedAt = cs.lastState.terminated.finishedAt;
  }

  return {
    name: cs.name,
    image: cs.image,
    ready: cs.ready,
    state,
    restarts: cs.restartCount,
    reason,
    lastTerminatedAt,
  };
}

function makeResourceId(meta: K8sMetadata): string {
  const ns = meta.namespace ?? "default";
  return `${ns}/${meta.name}`;
}

function mapDeployment(d: K8sDeployment, projectId: string): InfraResource {
  const desired = d.spec.replicas ?? 1;
  return {
    id: makeResourceId(d.metadata),
    projectId,
    provider: "kubernetes",
    kind: "deployment",
    name: d.metadata.name,
    namespace: d.metadata.namespace,
    status: mapDeploymentStatus(d),
    replicas: {
      desired,
      ready: d.status.readyReplicas ?? 0,
      available: d.status.availableReplicas ?? 0,
      unavailable: d.status.unavailableReplicas ?? 0,
    },
    conditions: mapConditions(d.status.conditions),
    age: d.metadata.creationTimestamp ?? new Date().toISOString(),
    labels: d.metadata.labels,
  };
}

function mapStatefulSet(sts: K8sStatefulSet, projectId: string): InfraResource {
  const desired = sts.spec.replicas ?? 1;
  return {
    id: makeResourceId(sts.metadata),
    projectId,
    provider: "kubernetes",
    kind: "statefulset",
    name: sts.metadata.name,
    namespace: sts.metadata.namespace,
    status: mapStatefulSetStatus(sts),
    replicas: {
      desired,
      ready: sts.status.readyReplicas ?? 0,
      available: sts.status.availableReplicas ?? 0,
      unavailable: Math.max(0, desired - (sts.status.readyReplicas ?? 0)),
    },
    conditions: mapConditions(sts.status.conditions),
    age: sts.metadata.creationTimestamp ?? new Date().toISOString(),
    labels: sts.metadata.labels,
  };
}

function mapDaemonSet(ds: K8sDaemonSet, projectId: string): InfraResource {
  const desired = ds.status.desiredNumberScheduled ?? 0;
  return {
    id: makeResourceId(ds.metadata),
    projectId,
    provider: "kubernetes",
    kind: "daemonset",
    name: ds.metadata.name,
    namespace: ds.metadata.namespace,
    status: mapDaemonSetStatus(ds),
    replicas: {
      desired,
      ready: ds.status.numberReady ?? 0,
      available: ds.status.numberAvailable ?? 0,
      unavailable: ds.status.numberUnavailable ?? 0,
    },
    conditions: mapConditions(ds.status.conditions),
    age: ds.metadata.creationTimestamp ?? new Date().toISOString(),
    labels: ds.metadata.labels,
  };
}

function mapPod(pod: K8sPod, projectId: string): PodDetail {
  const containers = (pod.status.containerStatuses ?? []).map(mapContainerStatus);
  const totalRestarts = containers.reduce((sum, c) => sum + c.restarts, 0);
  return {
    id: makeResourceId(pod.metadata),
    projectId,
    provider: "kubernetes",
    kind: "pod",
    name: pod.metadata.name,
    namespace: pod.metadata.namespace,
    status: mapPodStatus(pod),
    containers,
    node: pod.spec.nodeName,
    restarts: totalRestarts,
    phase: (pod.status.phase as PodDetail["phase"]) ?? "Unknown",
    conditions: mapConditions(pod.status.conditions),
    age: pod.metadata.creationTimestamp ?? new Date().toISOString(),
    labels: pod.metadata.labels,
  };
}

function mapK8sService(svc: K8sService, projectId: string): InfraResource {
  const endpoints: ResourceEndpoint[] = [];
  const svcType = (svc.spec.type ?? "ClusterIP") as ResourceEndpoint["type"];

  for (const port of svc.spec.ports ?? []) {
    let address = svc.spec.clusterIP ?? "";

    // For LoadBalancer, use the external address if available
    if (svcType === "LoadBalancer") {
      const lbIngress = svc.status?.loadBalancer?.ingress?.[0];
      if (lbIngress) {
        address = lbIngress.ip ?? lbIngress.hostname ?? address;
      }
    }

    endpoints.push({
      type: svcType,
      address,
      port: port.port,
      protocol: (port.protocol ?? "TCP") as ResourceEndpoint["protocol"],
    });
  }

  return {
    id: makeResourceId(svc.metadata),
    projectId,
    provider: "kubernetes",
    kind: "service",
    name: svc.metadata.name,
    namespace: svc.metadata.namespace,
    status: mapServiceStatus(svc),
    endpoints,
    age: svc.metadata.creationTimestamp ?? new Date().toISOString(),
    labels: svc.metadata.labels,
  };
}

function mapIngress(ing: K8sIngress, projectId: string): InfraResource {
  const endpoints: ResourceEndpoint[] = [];
  const lbIngress = ing.status?.loadBalancer?.ingress ?? [];

  for (const rule of ing.spec.rules ?? []) {
    const host = rule.host ?? "*";
    for (const lb of lbIngress) {
      endpoints.push({
        type: "Ingress",
        address: lb.ip ?? lb.hostname ?? host,
        port: 443,
        protocol: "HTTPS",
      });
    }
  }

  return {
    id: makeResourceId(ing.metadata),
    projectId,
    provider: "kubernetes",
    kind: "ingress",
    name: ing.metadata.name,
    namespace: ing.metadata.namespace,
    status: mapIngressStatus(ing),
    endpoints,
    age: ing.metadata.creationTimestamp ?? new Date().toISOString(),
    labels: ing.metadata.labels,
  };
}

function mapJob(job: K8sJob, projectId: string): InfraResource {
  const completions = job.spec.completions ?? 1;
  return {
    id: makeResourceId(job.metadata),
    projectId,
    provider: "kubernetes",
    kind: "job",
    name: job.metadata.name,
    namespace: job.metadata.namespace,
    status: mapJobStatus(job),
    replicas: {
      desired: completions,
      ready: job.status.succeeded ?? 0,
      available: job.status.succeeded ?? 0,
      unavailable: completions - (job.status.succeeded ?? 0),
    },
    conditions: mapConditions(job.status.conditions),
    age: job.metadata.creationTimestamp ?? new Date().toISOString(),
    labels: job.metadata.labels,
  };
}

function mapCronJob(cj: K8sCronJob, projectId: string): InfraResource {
  return {
    id: makeResourceId(cj.metadata),
    projectId,
    provider: "kubernetes",
    kind: "cronjob",
    name: cj.metadata.name,
    namespace: cj.metadata.namespace,
    status: mapCronJobStatus(cj),
    age: cj.metadata.creationTimestamp ?? new Date().toISOString(),
    labels: cj.metadata.labels,
  };
}

// --- Resource-to-Kind mapping ---

const RESOURCE_KIND_MAP: Record<ResourceKind, string> = {
  deployment: "deployments",
  statefulset: "statefulsets",
  daemonset: "daemonsets",
  pod: "pods",
  service: "services",
  ingress: "ingresses",
  job: "jobs",
  cronjob: "cronjobs",
};

const DEFAULT_KINDS: ResourceKind[] = [
  "deployment",
  "statefulset",
  "daemonset",
  "pod",
  "service",
  "ingress",
  "job",
  "cronjob",
];

// --- Config resolution ---

export function resolveK8sConfig(project: ProjectConfig): KubernetesConfig {
  return project.overrides?.infrastructure?.kubernetes ?? {};
}

export function resolveNamespace(project: ProjectConfig): string {
  const config = resolveK8sConfig(project);
  return config.namespace ?? project.name;
}

export function resolveLabelSelector(project: ProjectConfig): string | undefined {
  const config = resolveK8sConfig(project);
  return config.labelSelector;
}

function kubectlOpts(project: ProjectConfig): KubectlOptions {
  const config = resolveK8sConfig(project);
  return {
    context: config.context,
    namespace: resolveNamespace(project),
  };
}

// --- Kubernetes Adapter ---

export class KubernetesAdapter implements InfraAdapter {
  readonly provider: InfraProvider = "kubernetes";

  async detect(project: ProjectConfig): Promise<boolean> {
    // Check if the project's detected infrastructure includes kubernetes
    const hasK8sInfra = project.stack.infrastructure.some(
      (infra) => infra.name === "kubernetes",
    );
    if (hasK8sInfra) return true;

    // Check if user explicitly configured K8s infrastructure
    const config = resolveK8sConfig(project);
    if (config.namespace || config.context || config.labelSelector) return true;

    // Check if a kubeconfig context matches the project name
    try {
      const stdout = await kubectl(["config", "get-contexts", "-o", "name"]);
      const contexts = stdout.trim().split("\n").filter(Boolean);
      return contexts.some((c) => c.includes(project.name));
    } catch {
      return false;
    }
  }

  async listResources(
    project: ProjectConfig,
    opts?: { kinds?: ResourceKind[]; namespace?: string },
  ): Promise<InfraResource[]> {
    const kinds = opts?.kinds ?? DEFAULT_KINDS;
    const kOpts = kubectlOpts(project);
    if (opts?.namespace) {
      kOpts.namespace = opts.namespace;
    }

    const labelSelector = resolveLabelSelector(project);
    const resources: InfraResource[] = [];

    // Fetch all requested kinds in parallel
    const fetches = kinds.map(async (kind) => {
      try {
        const args = ["get", RESOURCE_KIND_MAP[kind]];
        if (labelSelector) {
          args.push("-l", labelSelector);
        }
        const list = await kubectlJson<K8sList<unknown>>(args, kOpts);
        return { kind, items: list.items };
      } catch {
        return { kind, items: [] };
      }
    });

    const results = await Promise.all(fetches);

    for (const { kind, items } of results) {
      for (const item of items) {
        const mapped = this.mapResource(kind, item, project.id);
        if (mapped) resources.push(mapped);
      }
    }

    return resources;
  }

  async getResource(
    project: ProjectConfig,
    resourceId: string,
  ): Promise<InfraResource> {
    // resourceId is "namespace/name" — we need to figure out the kind
    // Try each kind until we find it
    const [ns, name] = resourceId.includes("/")
      ? resourceId.split("/", 2)
      : ["default", resourceId];

    const kOpts = { ...kubectlOpts(project), namespace: ns };

    for (const kind of DEFAULT_KINDS) {
      try {
        const item = await kubectlJson<unknown>(
          ["get", RESOURCE_KIND_MAP[kind], name],
          kOpts,
        );
        const mapped = this.mapResource(kind, item, project.id);
        if (mapped) return mapped;
      } catch {
        continue;
      }
    }

    throw new Error(`Resource not found: ${resourceId}`);
  }

  async *streamLogs(
    project: ProjectConfig,
    resourceId: string,
    opts?: InfraLogOptions,
  ): AsyncIterable<InfraLogLine> {
    const [ns, name] = resourceId.includes("/")
      ? resourceId.split("/", 2)
      : ["default", resourceId];

    const config = resolveK8sConfig(project);
    const args = ["logs", name, "-n", ns, "--timestamps"];

    if (config.context) {
      args.unshift("--context", config.context);
    }
    if (opts?.container) {
      args.push("-c", opts.container);
    }
    if (opts?.follow) {
      args.push("-f");
    }
    if (opts?.tailLines !== undefined) {
      args.push("--tail", String(opts.tailLines));
    } else {
      args.push("--tail", "100");
    }
    if (opts?.since) {
      args.push("--since", opts.since);
    }

    if (opts?.follow) {
      // Streaming mode — use spawn
      yield* this.streamLogProcess(args, opts?.container);
    } else {
      // One-shot — use exec
      try {
        const { stdout } = await execFileAsync("kubectl", args, {
          timeout: 15_000,
        });
        for (const line of stdout.split("\n")) {
          if (!line.trim()) continue;
          yield parseLogLine(line, opts?.container);
        }
      } catch {
        // No logs available
      }
    }
  }

  private async *streamLogProcess(
    args: string[],
    container?: string,
  ): AsyncIterable<InfraLogLine> {
    const child = spawn("kubectl", args);
    const reader = child.stdout;
    if (!reader) return;

    let buffer = "";
    const lines: string[] = [];
    let resolve: (() => void) | null = null;
    let done = false;

    reader.on("data", (chunk: Buffer) => {
      buffer += chunk.toString();
      const parts = buffer.split("\n");
      buffer = parts.pop() ?? "";
      for (const part of parts) {
        if (part.trim()) {
          lines.push(part);
          if (resolve) {
            resolve();
            resolve = null;
          }
        }
      }
    });

    reader.on("end", () => {
      done = true;
      if (resolve) {
        resolve();
        resolve = null;
      }
    });

    child.on("error", () => {
      done = true;
      if (resolve) {
        resolve();
        resolve = null;
      }
    });

    while (!done || lines.length > 0) {
      if (lines.length > 0) {
        yield parseLogLine(lines.shift()!, container);
      } else if (!done) {
        await new Promise<void>((r) => {
          resolve = r;
        });
      }
    }
  }

  watch(
    project: ProjectConfig,
    callback: (event: InfraEvent) => void,
  ): Disposable {
    let disposed = false;
    let watchChild: ChildProcess | null = null;
    let pollTimer: ReturnType<typeof setTimeout> | null = null;
    const lastResourceState = new Map<string, string>(); // id → JSON snapshot

    // --- Primary: kubectl --watch ---
    const startWatch = (): void => {
      if (disposed) return;
      const config = resolveK8sConfig(project);
      const ns = resolveNamespace(project);
      const args = ["get", "pods", "-n", ns, "--watch", "-o", "json"];

      if (config.context) {
        args.unshift("--context", config.context);
      }

      const labelSelector = resolveLabelSelector(project);
      if (labelSelector) {
        args.push("-l", labelSelector);
      }

      const child = spawn("kubectl", args);
      watchChild = child;
      let buffer = "";

      child.stdout?.on("data", (chunk: Buffer) => {
        if (disposed) return;
        buffer += chunk.toString();

        const parts = buffer.split("\n");
        buffer = parts.pop() ?? "";

        for (const part of parts) {
          if (!part.trim()) continue;
          try {
            const obj = JSON.parse(part) as K8sPod;
            const pod = mapPod(obj, project.id);
            lastResourceState.set(pod.id, JSON.stringify(pod));
            callback({ type: "resource_updated", resource: pod });

            // Detect crashes
            for (const container of pod.containers) {
              if (
                container.reason === "CrashLoopBackOff" ||
                container.reason === "OOMKilled"
              ) {
                callback({
                  type: "pod_crash",
                  pod,
                  container: container.name,
                  reason: container.reason,
                });
              }
            }
          } catch {
            // Incomplete JSON or parse error — skip
          }
        }
      });

      child.on("error", () => {
        // Watch failed — polling fallback will continue
        watchChild = null;
      });

      child.on("close", () => {
        // Watch stream ended — polling fallback handles updates
        watchChild = null;
      });
    };

    // --- Fallback: 30-second polling ---
    const poll = async (): Promise<void> => {
      if (disposed) return;
      try {
        const resources = await this.listResources(project);
        const currentIds = new Set<string>();

        for (const resource of resources) {
          currentIds.add(resource.id);
          const snapshot = JSON.stringify(resource);
          const prev = lastResourceState.get(resource.id);
          if (prev !== snapshot) {
            lastResourceState.set(resource.id, snapshot);
            callback({ type: "resource_updated", resource });

            // Detect crashes on pods
            if (resource.kind === "pod") {
              const pod = resource as PodDetail;
              for (const container of pod.containers) {
                if (
                  container.reason === "CrashLoopBackOff" ||
                  container.reason === "OOMKilled"
                ) {
                  callback({
                    type: "pod_crash",
                    pod,
                    container: container.name,
                    reason: container.reason,
                  });
                }
              }
            }
          }
        }

        // Detect deletions
        for (const id of lastResourceState.keys()) {
          if (!currentIds.has(id)) {
            lastResourceState.delete(id);
            callback({ type: "resource_deleted", resourceId: id });
          }
        }
      } catch {
        // Poll failed — will retry next interval
      }
      if (!disposed) {
        pollTimer = setTimeout(poll, 30_000);
      }
    };

    // Seed last-known state before starting polling
    this.listResources(project)
      .then((resources) => {
        for (const r of resources) {
          lastResourceState.set(r.id, JSON.stringify(r));
        }
      })
      .catch(() => {})
      .finally(() => {
        if (!disposed) {
          startWatch();
          pollTimer = setTimeout(poll, 30_000);
        }
      });

    return {
      dispose() {
        disposed = true;
        watchChild?.kill();
        if (pollTimer) clearTimeout(pollTimer);
      },
    };
  }

  /** Trigger a rollout restart for a deployment. */
  async rolloutRestart(
    project: ProjectConfig,
    resourceId: string,
  ): Promise<void> {
    const [ns, name] = resourceId.includes("/")
      ? resourceId.split("/", 2)
      : ["default", resourceId];

    const config = resolveK8sConfig(project);
    await kubectl(
      ["rollout", "restart", `deployment/${name}`],
      { context: config.context, namespace: ns },
    );
  }

  private mapResource(
    kind: ResourceKind,
    item: unknown,
    projectId: string,
  ): InfraResource | null {
    switch (kind) {
      case "deployment":
        return mapDeployment(item as K8sDeployment, projectId);
      case "statefulset":
        return mapStatefulSet(item as K8sStatefulSet, projectId);
      case "daemonset":
        return mapDaemonSet(item as K8sDaemonSet, projectId);
      case "pod":
        return mapPod(item as K8sPod, projectId);
      case "service":
        return mapK8sService(item as K8sService, projectId);
      case "ingress":
        return mapIngress(item as K8sIngress, projectId);
      case "job":
        return mapJob(item as K8sJob, projectId);
      case "cronjob":
        return mapCronJob(item as K8sCronJob, projectId);
      default:
        return null;
    }
  }
}

// --- Health summary ---

export function computeInfraHealthSummary(resources: InfraResource[]): import("@opcom/types").InfraHealthSummary {
  const summary = {
    total: resources.length,
    healthy: 0,
    degraded: 0,
    unhealthy: 0,
    progressing: 0,
    suspended: 0,
    unknown: 0,
  };

  for (const r of resources) {
    summary[r.status]++;
  }

  return summary;
}

// --- Log parsing ---

export function parseLogLine(line: string, container?: string): InfraLogLine {
  // kubectl --timestamps format: "2026-02-28T14:23:01.000000000Z log text here"
  const match = line.match(/^(\d{4}-\d{2}-\d{2}T[\d:.]+Z?)\s+(.*)/);
  if (match) {
    return {
      timestamp: match[1],
      container,
      text: match[2],
    };
  }
  return {
    timestamp: new Date().toISOString(),
    container,
    text: line,
  };
}
