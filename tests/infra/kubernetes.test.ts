import { describe, it, expect } from "vitest";

import {
  mapDeploymentStatus,
  mapStatefulSetStatus,
  mapDaemonSetStatus,
  mapPodStatus,
  mapJobStatus,
  mapCronJobStatus,
  mapServiceStatus,
  mapIngressStatus,
  mapConditions,
  mapContainerStatus,
  parseLogLine,
  resolveK8sConfig,
  resolveNamespace,
  resolveLabelSelector,
  KubernetesAdapter,
  detectInfrastructure,
  getInfraAdapters,
  getInfraAdapter,
  computeInfraHealthSummary,
} from "@opcom/core";

import type { ProjectConfig, StackInfo, InfraResource } from "@opcom/types";

// =============================================================================
// Helpers
// =============================================================================

const emptyStack: StackInfo = {
  languages: [],
  frameworks: [],
  packageManagers: [],
  infrastructure: [],
  versionManagers: [],
};

const k8sStack: StackInfo = {
  languages: [],
  frameworks: [],
  packageManagers: [],
  infrastructure: [{ name: "kubernetes", sourceFile: "k8s/deployment.yaml" }],
  versionManagers: [],
};

function makeProject(overrides: Partial<ProjectConfig> = {}): ProjectConfig {
  return {
    id: "test-project",
    name: "test-project",
    path: "/tmp/test-project",
    stack: emptyStack,
    git: null,
    workSystem: null,
    docs: {},
    services: [],
    environments: [],
    testing: null,
    linting: [],
    subProjects: [],
    cloudServices: [],
    lastScannedAt: new Date().toISOString(),
    ...overrides,
  };
}

// =============================================================================
// Deployment status mapping
// =============================================================================

describe("mapDeploymentStatus", () => {
  it("returns healthy when all replicas are ready", () => {
    expect(
      mapDeploymentStatus({
        metadata: { name: "api" },
        spec: { replicas: 3 },
        status: {
          replicas: 3,
          readyReplicas: 3,
          availableReplicas: 3,
        },
      }),
    ).toBe("healthy");
  });

  it("returns degraded when some replicas are ready", () => {
    expect(
      mapDeploymentStatus({
        metadata: { name: "api" },
        spec: { replicas: 3 },
        status: {
          replicas: 3,
          readyReplicas: 1,
          availableReplicas: 1,
          unavailableReplicas: 2,
        },
      }),
    ).toBe("degraded");
  });

  it("returns unhealthy when no replicas are ready", () => {
    expect(
      mapDeploymentStatus({
        metadata: { name: "api" },
        spec: { replicas: 3 },
        status: {
          replicas: 3,
          readyReplicas: 0,
          availableReplicas: 0,
          unavailableReplicas: 3,
        },
      }),
    ).toBe("unhealthy");
  });

  it("returns progressing during rollout", () => {
    expect(
      mapDeploymentStatus({
        metadata: { name: "api" },
        spec: { replicas: 3 },
        status: {
          replicas: 3,
          readyReplicas: 1,
          availableReplicas: 1,
          conditions: [
            {
              type: "Progressing",
              status: "True",
              reason: "NewReplicaSetAvailable",
            },
          ],
        },
      }),
    ).toBe("progressing");
  });

  it("returns suspended when replicas scaled to 0", () => {
    expect(
      mapDeploymentStatus({
        metadata: { name: "api" },
        spec: { replicas: 0 },
        status: {},
      }),
    ).toBe("suspended");
  });

  it("returns suspended when paused", () => {
    expect(
      mapDeploymentStatus({
        metadata: { name: "api" },
        spec: { replicas: 3, paused: true },
        status: {},
      }),
    ).toBe("suspended");
  });

  it("defaults to 1 replica when spec.replicas is undefined", () => {
    expect(
      mapDeploymentStatus({
        metadata: { name: "api" },
        spec: {},
        status: {
          readyReplicas: 1,
          availableReplicas: 1,
        },
      }),
    ).toBe("healthy");
  });
});

// =============================================================================
// StatefulSet status mapping
// =============================================================================

describe("mapStatefulSetStatus", () => {
  it("returns healthy when all replicas are ready", () => {
    expect(
      mapStatefulSetStatus({
        metadata: { name: "db" },
        spec: { replicas: 3 },
        status: { readyReplicas: 3 },
      }),
    ).toBe("healthy");
  });

  it("returns progressing during scale up", () => {
    expect(
      mapStatefulSetStatus({
        metadata: { name: "db" },
        spec: { replicas: 3 },
        status: { readyReplicas: 1, currentReplicas: 2 },
      }),
    ).toBe("progressing");
  });

  it("returns unhealthy when no replicas are ready", () => {
    expect(
      mapStatefulSetStatus({
        metadata: { name: "db" },
        spec: { replicas: 3 },
        status: { readyReplicas: 0 },
      }),
    ).toBe("unhealthy");
  });

  it("returns suspended when scaled to 0", () => {
    expect(
      mapStatefulSetStatus({
        metadata: { name: "db" },
        spec: { replicas: 0 },
        status: {},
      }),
    ).toBe("suspended");
  });
});

// =============================================================================
// DaemonSet status mapping
// =============================================================================

describe("mapDaemonSetStatus", () => {
  it("returns healthy when all nodes are ready", () => {
    expect(
      mapDaemonSetStatus({
        metadata: { name: "logger" },
        status: {
          desiredNumberScheduled: 3,
          numberReady: 3,
          numberAvailable: 3,
        },
      }),
    ).toBe("healthy");
  });

  it("returns degraded when some nodes are ready", () => {
    expect(
      mapDaemonSetStatus({
        metadata: { name: "logger" },
        status: {
          desiredNumberScheduled: 3,
          numberReady: 2,
          numberAvailable: 1,
        },
      }),
    ).toBe("degraded");
  });

  it("returns unhealthy when no nodes are ready", () => {
    expect(
      mapDaemonSetStatus({
        metadata: { name: "logger" },
        status: {
          desiredNumberScheduled: 3,
          numberReady: 0,
        },
      }),
    ).toBe("unhealthy");
  });

  it("returns suspended when desired is 0", () => {
    expect(
      mapDaemonSetStatus({
        metadata: { name: "logger" },
        status: {
          desiredNumberScheduled: 0,
        },
      }),
    ).toBe("suspended");
  });
});

// =============================================================================
// Pod status mapping
// =============================================================================

describe("mapPodStatus", () => {
  it("returns healthy for running pod with all containers ready", () => {
    expect(
      mapPodStatus({
        metadata: { name: "api-abc" },
        spec: {},
        status: {
          phase: "Running",
          containerStatuses: [
            {
              name: "api",
              image: "api:v1",
              ready: true,
              restartCount: 0,
              state: { running: {} },
            },
          ],
        },
      }),
    ).toBe("healthy");
  });

  it("returns unhealthy for CrashLoopBackOff", () => {
    expect(
      mapPodStatus({
        metadata: { name: "api-abc" },
        spec: {},
        status: {
          phase: "Running",
          containerStatuses: [
            {
              name: "api",
              image: "api:v1",
              ready: false,
              restartCount: 5,
              state: {
                waiting: { reason: "CrashLoopBackOff" },
              },
            },
          ],
        },
      }),
    ).toBe("unhealthy");
  });

  it("returns unhealthy for OOMKilled", () => {
    expect(
      mapPodStatus({
        metadata: { name: "api-abc" },
        spec: {},
        status: {
          phase: "Running",
          containerStatuses: [
            {
              name: "api",
              image: "api:v1",
              ready: false,
              restartCount: 2,
              state: {
                waiting: { reason: "OOMKilled" },
              },
            },
          ],
        },
      }),
    ).toBe("unhealthy");
  });

  it("returns unhealthy for OOMKilled in last terminated state", () => {
    expect(
      mapPodStatus({
        metadata: { name: "api-abc" },
        spec: {},
        status: {
          phase: "Running",
          containerStatuses: [
            {
              name: "api",
              image: "api:v1",
              ready: false,
              restartCount: 2,
              state: { running: {} },
              lastState: {
                terminated: { reason: "OOMKilled" },
              },
            },
          ],
        },
      }),
    ).toBe("unhealthy");
  });

  it("returns progressing for pending pod", () => {
    expect(
      mapPodStatus({
        metadata: { name: "api-abc" },
        spec: {},
        status: { phase: "Pending" },
      }),
    ).toBe("progressing");
  });

  it("returns healthy for succeeded pod", () => {
    expect(
      mapPodStatus({
        metadata: { name: "job-abc" },
        spec: {},
        status: { phase: "Succeeded" },
      }),
    ).toBe("healthy");
  });

  it("returns unhealthy for failed pod", () => {
    expect(
      mapPodStatus({
        metadata: { name: "job-abc" },
        spec: {},
        status: { phase: "Failed" },
      }),
    ).toBe("unhealthy");
  });

  it("returns degraded for running pod with not-all-ready containers", () => {
    expect(
      mapPodStatus({
        metadata: { name: "api-abc" },
        spec: {},
        status: {
          phase: "Running",
          containerStatuses: [
            {
              name: "api",
              image: "api:v1",
              ready: true,
              restartCount: 0,
              state: { running: {} },
            },
            {
              name: "sidecar",
              image: "sidecar:v1",
              ready: false,
              restartCount: 0,
              state: { waiting: { reason: "ContainerCreating" } },
            },
          ],
        },
      }),
    ).toBe("degraded");
  });
});

// =============================================================================
// Job status mapping
// =============================================================================

describe("mapJobStatus", () => {
  it("returns healthy when all completions succeeded", () => {
    expect(
      mapJobStatus({
        metadata: { name: "migrate" },
        spec: { completions: 1 },
        status: { succeeded: 1 },
      }),
    ).toBe("healthy");
  });

  it("returns progressing when active", () => {
    expect(
      mapJobStatus({
        metadata: { name: "migrate" },
        spec: { completions: 1 },
        status: { active: 1 },
      }),
    ).toBe("progressing");
  });

  it("returns unhealthy when failed with no active", () => {
    expect(
      mapJobStatus({
        metadata: { name: "migrate" },
        spec: { completions: 1 },
        status: { failed: 1, active: 0 },
      }),
    ).toBe("unhealthy");
  });

  it("returns unknown when no status", () => {
    expect(
      mapJobStatus({
        metadata: { name: "migrate" },
        spec: {},
        status: {},
      }),
    ).toBe("unknown");
  });
});

// =============================================================================
// CronJob status mapping
// =============================================================================

describe("mapCronJobStatus", () => {
  it("returns healthy for idle cronjob", () => {
    expect(
      mapCronJobStatus({
        metadata: { name: "backup" },
        spec: { schedule: "0 2 * * *" },
        status: {},
      }),
    ).toBe("healthy");
  });

  it("returns progressing when active jobs exist", () => {
    expect(
      mapCronJobStatus({
        metadata: { name: "backup" },
        spec: { schedule: "0 2 * * *" },
        status: { active: [{ name: "backup-12345" }] },
      }),
    ).toBe("progressing");
  });

  it("returns suspended when suspended", () => {
    expect(
      mapCronJobStatus({
        metadata: { name: "backup" },
        spec: { schedule: "0 2 * * *", suspend: true },
        status: {},
      }),
    ).toBe("suspended");
  });
});

// =============================================================================
// Service status mapping
// =============================================================================

describe("mapServiceStatus", () => {
  it("returns healthy for any service", () => {
    expect(
      mapServiceStatus({
        metadata: { name: "api" },
        spec: {},
        status: {},
      }),
    ).toBe("healthy");
  });
});

// =============================================================================
// Ingress status mapping
// =============================================================================

describe("mapIngressStatus", () => {
  it("returns healthy when load balancer has ingress", () => {
    expect(
      mapIngressStatus({
        metadata: { name: "main" },
        spec: {},
        status: {
          loadBalancer: {
            ingress: [{ ip: "34.12.0.5" }],
          },
        },
      }),
    ).toBe("healthy");
  });

  it("returns progressing when no load balancer ingress", () => {
    expect(
      mapIngressStatus({
        metadata: { name: "main" },
        spec: {},
        status: {},
      }),
    ).toBe("progressing");
  });
});

// =============================================================================
// Condition mapping
// =============================================================================

describe("mapConditions", () => {
  it("maps K8s conditions to ResourceConditions", () => {
    const result = mapConditions([
      {
        type: "Available",
        status: "True",
        reason: "MinimumReplicasAvailable",
        message: "Deployment has minimum availability",
        lastTransitionTime: "2026-02-28T10:00:00Z",
      },
      {
        type: "Progressing",
        status: "False",
        lastTransitionTime: "2026-02-28T10:00:00Z",
      },
    ]);

    expect(result).toHaveLength(2);
    expect(result[0]).toEqual({
      type: "Available",
      status: true,
      reason: "MinimumReplicasAvailable",
      message: "Deployment has minimum availability",
      lastTransition: "2026-02-28T10:00:00Z",
    });
    expect(result[1].status).toBe(false);
  });

  it("returns empty array for undefined conditions", () => {
    expect(mapConditions(undefined)).toEqual([]);
  });
});

// =============================================================================
// Container status mapping
// =============================================================================

describe("mapContainerStatus", () => {
  it("maps running container", () => {
    const result = mapContainerStatus({
      name: "api",
      image: "ghcr.io/myapp/api:v1.0",
      ready: true,
      restartCount: 0,
      state: { running: { startedAt: "2026-02-28T10:00:00Z" } },
    });

    expect(result).toEqual({
      name: "api",
      image: "ghcr.io/myapp/api:v1.0",
      ready: true,
      state: "running",
      restarts: 0,
      reason: undefined,
      lastTerminatedAt: undefined,
    });
  });

  it("maps waiting container with reason", () => {
    const result = mapContainerStatus({
      name: "api",
      image: "api:v1",
      ready: false,
      restartCount: 5,
      state: {
        waiting: { reason: "CrashLoopBackOff", message: "back-off 5m0s" },
      },
    });

    expect(result.state).toBe("waiting");
    expect(result.reason).toBe("CrashLoopBackOff");
    expect(result.restarts).toBe(5);
  });

  it("maps terminated container with last terminated time", () => {
    const result = mapContainerStatus({
      name: "init",
      image: "init:v1",
      ready: false,
      restartCount: 1,
      state: {
        terminated: {
          reason: "Completed",
          exitCode: 0,
          finishedAt: "2026-02-28T10:05:00Z",
        },
      },
    });

    expect(result.state).toBe("terminated");
    expect(result.reason).toBe("Completed");
    expect(result.lastTerminatedAt).toBe("2026-02-28T10:05:00Z");
  });

  it("uses lastState terminated time as fallback", () => {
    const result = mapContainerStatus({
      name: "api",
      image: "api:v1",
      ready: true,
      restartCount: 1,
      state: { running: {} },
      lastState: {
        terminated: {
          reason: "OOMKilled",
          finishedAt: "2026-02-28T09:55:00Z",
        },
      },
    });

    expect(result.state).toBe("running");
    expect(result.lastTerminatedAt).toBe("2026-02-28T09:55:00Z");
  });
});

// =============================================================================
// Log line parsing
// =============================================================================

describe("parseLogLine", () => {
  it("parses timestamped log line", () => {
    const result = parseLogLine(
      "2026-02-28T14:23:01.000000000Z Starting tile server on :8766",
      "tiles",
    );

    expect(result).toEqual({
      timestamp: "2026-02-28T14:23:01.000000000Z",
      container: "tiles",
      text: "Starting tile server on :8766",
    });
  });

  it("handles line without timestamp", () => {
    const result = parseLogLine("raw log output", "api");

    expect(result.text).toBe("raw log output");
    expect(result.container).toBe("api");
    expect(result.timestamp).toBeDefined();
  });

  it("handles undefined container", () => {
    const result = parseLogLine("2026-02-28T14:23:01Z some text");

    expect(result.container).toBeUndefined();
    expect(result.text).toBe("some text");
  });
});

// =============================================================================
// Config resolution
// =============================================================================

describe("resolveK8sConfig", () => {
  it("returns empty config when no overrides", () => {
    const project = makeProject();
    expect(resolveK8sConfig(project)).toEqual({});
  });

  it("returns kubernetes config from overrides", () => {
    const project = makeProject({
      overrides: {
        infrastructure: {
          kubernetes: {
            context: "production",
            namespace: "myapp-prod",
            labelSelector: "app=myapp",
          },
        },
      } as ProjectConfig["overrides"],
    });

    const config = resolveK8sConfig(project);
    expect(config.context).toBe("production");
    expect(config.namespace).toBe("myapp-prod");
    expect(config.labelSelector).toBe("app=myapp");
  });
});

describe("resolveNamespace", () => {
  it("defaults to project name", () => {
    const project = makeProject({ name: "folia" });
    expect(resolveNamespace(project)).toBe("folia");
  });

  it("uses override namespace", () => {
    const project = makeProject({
      name: "folia",
      overrides: {
        infrastructure: {
          kubernetes: { namespace: "folia-prod" },
        },
      } as ProjectConfig["overrides"],
    });

    expect(resolveNamespace(project)).toBe("folia-prod");
  });
});

describe("resolveLabelSelector", () => {
  it("returns undefined when no selector configured", () => {
    const project = makeProject();
    expect(resolveLabelSelector(project)).toBeUndefined();
  });

  it("returns configured label selector", () => {
    const project = makeProject({
      overrides: {
        infrastructure: {
          kubernetes: { labelSelector: "app=folia" },
        },
      } as ProjectConfig["overrides"],
    });

    expect(resolveLabelSelector(project)).toBe("app=folia");
  });
});

// =============================================================================
// KubernetesAdapter.detect
// =============================================================================

describe("KubernetesAdapter.detect", () => {
  const adapter = new KubernetesAdapter();

  it("detects kubernetes infrastructure", async () => {
    const project = makeProject({ stack: k8sStack });
    expect(await adapter.detect(project)).toBe(true);
  });

  it("does not detect when no kubernetes in infrastructure", async () => {
    const project = makeProject({ stack: emptyStack });
    expect(await adapter.detect(project)).toBe(false);
  });

  it("does not detect with other infrastructure only", async () => {
    const project = makeProject({
      stack: {
        ...emptyStack,
        infrastructure: [{ name: "docker", sourceFile: "Dockerfile" }],
      },
    });
    expect(await adapter.detect(project)).toBe(false);
  });
});

// =============================================================================
// detectInfrastructure
// =============================================================================

describe("detectInfrastructure", () => {
  it("detects kubernetes for project with k8s infrastructure", async () => {
    const project = makeProject({ stack: k8sStack });
    const result = await detectInfrastructure(project);

    expect(result.adapters).toHaveLength(1);
    expect(result.adapters[0].provider).toBe("kubernetes");
    expect(result.evidence).toHaveLength(1);
    expect(result.evidence[0].detectedAs).toBe("infra:kubernetes");
  });

  it("returns empty for project without infrastructure", async () => {
    const project = makeProject({ stack: emptyStack });
    const result = await detectInfrastructure(project);

    expect(result.adapters).toHaveLength(0);
    expect(result.evidence).toHaveLength(0);
  });
});

// =============================================================================
// getInfraAdapters / getInfraAdapter
// =============================================================================

describe("getInfraAdapters", () => {
  it("returns at least one adapter", () => {
    const adapters = getInfraAdapters();
    expect(adapters.length).toBeGreaterThanOrEqual(1);
  });

  it("includes kubernetes adapter", () => {
    const adapters = getInfraAdapters();
    expect(adapters.some((a) => a.provider === "kubernetes")).toBe(true);
  });

  it("returns a copy (not the internal array)", () => {
    const a = getInfraAdapters();
    const b = getInfraAdapters();
    expect(a).not.toBe(b);
  });
});

describe("getInfraAdapter", () => {
  it("returns kubernetes adapter", () => {
    const adapter = getInfraAdapter("kubernetes");
    expect(adapter).toBeDefined();
    expect(adapter!.provider).toBe("kubernetes");
  });

  it("returns undefined for unregistered provider", () => {
    expect(getInfraAdapter("ecs")).toBeUndefined();
  });
});

// =============================================================================
// computeInfraHealthSummary
// =============================================================================

describe("computeInfraHealthSummary", () => {
  function makeResource(status: InfraResource["status"]): InfraResource {
    return {
      id: "default/test",
      projectId: "test",
      provider: "kubernetes",
      kind: "deployment",
      name: "test",
      status,
      age: new Date().toISOString(),
    };
  }

  it("counts resource statuses correctly", () => {
    const resources: InfraResource[] = [
      makeResource("healthy"),
      makeResource("healthy"),
      makeResource("degraded"),
      makeResource("unhealthy"),
      makeResource("progressing"),
      makeResource("suspended"),
      makeResource("unknown"),
    ];

    const summary = computeInfraHealthSummary(resources);
    expect(summary).toEqual({
      total: 7,
      healthy: 2,
      degraded: 1,
      unhealthy: 1,
      progressing: 1,
      suspended: 1,
      unknown: 1,
    });
  });

  it("returns all zeros for empty array", () => {
    const summary = computeInfraHealthSummary([]);
    expect(summary).toEqual({
      total: 0,
      healthy: 0,
      degraded: 0,
      unhealthy: 0,
      progressing: 0,
      suspended: 0,
      unknown: 0,
    });
  });
});
