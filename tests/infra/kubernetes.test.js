"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
// Mock child_process to prevent real kubectl calls in tests.
// vi.hoisted ensures the mock fn is available when vi.mock factory runs.
const { mockExecFileAsync } = vitest_1.vi.hoisted(() => ({
    mockExecFileAsync: vitest_1.vi.fn(),
}));
vitest_1.vi.mock("node:child_process", () => {
    const mockExecFile = vitest_1.vi.fn();
    mockExecFile[Symbol.for("nodejs.util.promisify.custom")] = mockExecFileAsync;
    return {
        execFile: mockExecFile,
        spawn: vitest_1.vi.fn(() => ({
            stdout: { on: vitest_1.vi.fn() },
            stderr: { on: vitest_1.vi.fn() },
            on: vitest_1.vi.fn(),
            kill: vitest_1.vi.fn(),
        })),
    };
});
const core_1 = require("@opcom/core");
// Default: kubectl calls reject immediately (no real cluster in tests)
(0, vitest_1.beforeEach)(() => {
    mockExecFileAsync.mockReset();
    mockExecFileAsync.mockRejectedValue(new Error("kubectl not available in test"));
});
// =============================================================================
// Helpers
// =============================================================================
const emptyStack = {
    languages: [],
    frameworks: [],
    packageManagers: [],
    infrastructure: [],
    versionManagers: [],
};
const k8sStack = {
    languages: [],
    frameworks: [],
    packageManagers: [],
    infrastructure: [{ name: "kubernetes", sourceFile: "k8s/deployment.yaml" }],
    versionManagers: [],
};
function makeProject(overrides = {}) {
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
(0, vitest_1.describe)("mapDeploymentStatus", () => {
    (0, vitest_1.it)("returns healthy when all replicas are ready", () => {
        (0, vitest_1.expect)((0, core_1.mapDeploymentStatus)({
            metadata: { name: "api" },
            spec: { replicas: 3 },
            status: {
                replicas: 3,
                readyReplicas: 3,
                availableReplicas: 3,
            },
        })).toBe("healthy");
    });
    (0, vitest_1.it)("returns degraded when some replicas are ready", () => {
        (0, vitest_1.expect)((0, core_1.mapDeploymentStatus)({
            metadata: { name: "api" },
            spec: { replicas: 3 },
            status: {
                replicas: 3,
                readyReplicas: 1,
                availableReplicas: 1,
                unavailableReplicas: 2,
            },
        })).toBe("degraded");
    });
    (0, vitest_1.it)("returns unhealthy when no replicas are ready", () => {
        (0, vitest_1.expect)((0, core_1.mapDeploymentStatus)({
            metadata: { name: "api" },
            spec: { replicas: 3 },
            status: {
                replicas: 3,
                readyReplicas: 0,
                availableReplicas: 0,
                unavailableReplicas: 3,
            },
        })).toBe("unhealthy");
    });
    (0, vitest_1.it)("returns progressing during rollout", () => {
        (0, vitest_1.expect)((0, core_1.mapDeploymentStatus)({
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
        })).toBe("progressing");
    });
    (0, vitest_1.it)("returns suspended when replicas scaled to 0", () => {
        (0, vitest_1.expect)((0, core_1.mapDeploymentStatus)({
            metadata: { name: "api" },
            spec: { replicas: 0 },
            status: {},
        })).toBe("suspended");
    });
    (0, vitest_1.it)("returns suspended when paused", () => {
        (0, vitest_1.expect)((0, core_1.mapDeploymentStatus)({
            metadata: { name: "api" },
            spec: { replicas: 3, paused: true },
            status: {},
        })).toBe("suspended");
    });
    (0, vitest_1.it)("defaults to 1 replica when spec.replicas is undefined", () => {
        (0, vitest_1.expect)((0, core_1.mapDeploymentStatus)({
            metadata: { name: "api" },
            spec: {},
            status: {
                readyReplicas: 1,
                availableReplicas: 1,
            },
        })).toBe("healthy");
    });
});
// =============================================================================
// StatefulSet status mapping
// =============================================================================
(0, vitest_1.describe)("mapStatefulSetStatus", () => {
    (0, vitest_1.it)("returns healthy when all replicas are ready", () => {
        (0, vitest_1.expect)((0, core_1.mapStatefulSetStatus)({
            metadata: { name: "db" },
            spec: { replicas: 3 },
            status: { readyReplicas: 3 },
        })).toBe("healthy");
    });
    (0, vitest_1.it)("returns progressing during scale up", () => {
        (0, vitest_1.expect)((0, core_1.mapStatefulSetStatus)({
            metadata: { name: "db" },
            spec: { replicas: 3 },
            status: { readyReplicas: 1, currentReplicas: 2 },
        })).toBe("progressing");
    });
    (0, vitest_1.it)("returns unhealthy when no replicas are ready", () => {
        (0, vitest_1.expect)((0, core_1.mapStatefulSetStatus)({
            metadata: { name: "db" },
            spec: { replicas: 3 },
            status: { readyReplicas: 0 },
        })).toBe("unhealthy");
    });
    (0, vitest_1.it)("returns suspended when scaled to 0", () => {
        (0, vitest_1.expect)((0, core_1.mapStatefulSetStatus)({
            metadata: { name: "db" },
            spec: { replicas: 0 },
            status: {},
        })).toBe("suspended");
    });
});
// =============================================================================
// DaemonSet status mapping
// =============================================================================
(0, vitest_1.describe)("mapDaemonSetStatus", () => {
    (0, vitest_1.it)("returns healthy when all nodes are ready", () => {
        (0, vitest_1.expect)((0, core_1.mapDaemonSetStatus)({
            metadata: { name: "logger" },
            status: {
                desiredNumberScheduled: 3,
                numberReady: 3,
                numberAvailable: 3,
            },
        })).toBe("healthy");
    });
    (0, vitest_1.it)("returns degraded when some nodes are ready", () => {
        (0, vitest_1.expect)((0, core_1.mapDaemonSetStatus)({
            metadata: { name: "logger" },
            status: {
                desiredNumberScheduled: 3,
                numberReady: 2,
                numberAvailable: 1,
            },
        })).toBe("degraded");
    });
    (0, vitest_1.it)("returns unhealthy when no nodes are ready", () => {
        (0, vitest_1.expect)((0, core_1.mapDaemonSetStatus)({
            metadata: { name: "logger" },
            status: {
                desiredNumberScheduled: 3,
                numberReady: 0,
            },
        })).toBe("unhealthy");
    });
    (0, vitest_1.it)("returns suspended when desired is 0", () => {
        (0, vitest_1.expect)((0, core_1.mapDaemonSetStatus)({
            metadata: { name: "logger" },
            status: {
                desiredNumberScheduled: 0,
            },
        })).toBe("suspended");
    });
});
// =============================================================================
// Pod status mapping
// =============================================================================
(0, vitest_1.describe)("mapPodStatus", () => {
    (0, vitest_1.it)("returns healthy for running pod with all containers ready", () => {
        (0, vitest_1.expect)((0, core_1.mapPodStatus)({
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
        })).toBe("healthy");
    });
    (0, vitest_1.it)("returns unhealthy for CrashLoopBackOff", () => {
        (0, vitest_1.expect)((0, core_1.mapPodStatus)({
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
        })).toBe("unhealthy");
    });
    (0, vitest_1.it)("returns unhealthy for OOMKilled", () => {
        (0, vitest_1.expect)((0, core_1.mapPodStatus)({
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
        })).toBe("unhealthy");
    });
    (0, vitest_1.it)("returns unhealthy for OOMKilled in last terminated state", () => {
        (0, vitest_1.expect)((0, core_1.mapPodStatus)({
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
        })).toBe("unhealthy");
    });
    (0, vitest_1.it)("returns progressing for pending pod", () => {
        (0, vitest_1.expect)((0, core_1.mapPodStatus)({
            metadata: { name: "api-abc" },
            spec: {},
            status: { phase: "Pending" },
        })).toBe("progressing");
    });
    (0, vitest_1.it)("returns healthy for succeeded pod", () => {
        (0, vitest_1.expect)((0, core_1.mapPodStatus)({
            metadata: { name: "job-abc" },
            spec: {},
            status: { phase: "Succeeded" },
        })).toBe("healthy");
    });
    (0, vitest_1.it)("returns unhealthy for failed pod", () => {
        (0, vitest_1.expect)((0, core_1.mapPodStatus)({
            metadata: { name: "job-abc" },
            spec: {},
            status: { phase: "Failed" },
        })).toBe("unhealthy");
    });
    (0, vitest_1.it)("returns degraded for running pod with not-all-ready containers", () => {
        (0, vitest_1.expect)((0, core_1.mapPodStatus)({
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
        })).toBe("degraded");
    });
});
// =============================================================================
// Job status mapping
// =============================================================================
(0, vitest_1.describe)("mapJobStatus", () => {
    (0, vitest_1.it)("returns healthy when all completions succeeded", () => {
        (0, vitest_1.expect)((0, core_1.mapJobStatus)({
            metadata: { name: "migrate" },
            spec: { completions: 1 },
            status: { succeeded: 1 },
        })).toBe("healthy");
    });
    (0, vitest_1.it)("returns progressing when active", () => {
        (0, vitest_1.expect)((0, core_1.mapJobStatus)({
            metadata: { name: "migrate" },
            spec: { completions: 1 },
            status: { active: 1 },
        })).toBe("progressing");
    });
    (0, vitest_1.it)("returns unhealthy when failed with no active", () => {
        (0, vitest_1.expect)((0, core_1.mapJobStatus)({
            metadata: { name: "migrate" },
            spec: { completions: 1 },
            status: { failed: 1, active: 0 },
        })).toBe("unhealthy");
    });
    (0, vitest_1.it)("returns unknown when no status", () => {
        (0, vitest_1.expect)((0, core_1.mapJobStatus)({
            metadata: { name: "migrate" },
            spec: {},
            status: {},
        })).toBe("unknown");
    });
});
// =============================================================================
// CronJob status mapping
// =============================================================================
(0, vitest_1.describe)("mapCronJobStatus", () => {
    (0, vitest_1.it)("returns healthy for idle cronjob", () => {
        (0, vitest_1.expect)((0, core_1.mapCronJobStatus)({
            metadata: { name: "backup" },
            spec: { schedule: "0 2 * * *" },
            status: {},
        })).toBe("healthy");
    });
    (0, vitest_1.it)("returns progressing when active jobs exist", () => {
        (0, vitest_1.expect)((0, core_1.mapCronJobStatus)({
            metadata: { name: "backup" },
            spec: { schedule: "0 2 * * *" },
            status: { active: [{ name: "backup-12345" }] },
        })).toBe("progressing");
    });
    (0, vitest_1.it)("returns suspended when suspended", () => {
        (0, vitest_1.expect)((0, core_1.mapCronJobStatus)({
            metadata: { name: "backup" },
            spec: { schedule: "0 2 * * *", suspend: true },
            status: {},
        })).toBe("suspended");
    });
});
// =============================================================================
// Service status mapping
// =============================================================================
(0, vitest_1.describe)("mapServiceStatus", () => {
    (0, vitest_1.it)("returns healthy for any service", () => {
        (0, vitest_1.expect)((0, core_1.mapServiceStatus)({
            metadata: { name: "api" },
            spec: {},
            status: {},
        })).toBe("healthy");
    });
});
// =============================================================================
// Ingress status mapping
// =============================================================================
(0, vitest_1.describe)("mapIngressStatus", () => {
    (0, vitest_1.it)("returns healthy when load balancer has ingress", () => {
        (0, vitest_1.expect)((0, core_1.mapIngressStatus)({
            metadata: { name: "main" },
            spec: {},
            status: {
                loadBalancer: {
                    ingress: [{ ip: "34.12.0.5" }],
                },
            },
        })).toBe("healthy");
    });
    (0, vitest_1.it)("returns progressing when no load balancer ingress", () => {
        (0, vitest_1.expect)((0, core_1.mapIngressStatus)({
            metadata: { name: "main" },
            spec: {},
            status: {},
        })).toBe("progressing");
    });
});
// =============================================================================
// Condition mapping
// =============================================================================
(0, vitest_1.describe)("mapConditions", () => {
    (0, vitest_1.it)("maps K8s conditions to ResourceConditions", () => {
        const result = (0, core_1.mapConditions)([
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
        (0, vitest_1.expect)(result).toHaveLength(2);
        (0, vitest_1.expect)(result[0]).toEqual({
            type: "Available",
            status: true,
            reason: "MinimumReplicasAvailable",
            message: "Deployment has minimum availability",
            lastTransition: "2026-02-28T10:00:00Z",
        });
        (0, vitest_1.expect)(result[1].status).toBe(false);
    });
    (0, vitest_1.it)("returns empty array for undefined conditions", () => {
        (0, vitest_1.expect)((0, core_1.mapConditions)(undefined)).toEqual([]);
    });
});
// =============================================================================
// Container status mapping
// =============================================================================
(0, vitest_1.describe)("mapContainerStatus", () => {
    (0, vitest_1.it)("maps running container", () => {
        const result = (0, core_1.mapContainerStatus)({
            name: "api",
            image: "ghcr.io/myapp/api:v1.0",
            ready: true,
            restartCount: 0,
            state: { running: { startedAt: "2026-02-28T10:00:00Z" } },
        });
        (0, vitest_1.expect)(result).toEqual({
            name: "api",
            image: "ghcr.io/myapp/api:v1.0",
            ready: true,
            state: "running",
            restarts: 0,
            reason: undefined,
            lastTerminatedAt: undefined,
        });
    });
    (0, vitest_1.it)("maps waiting container with reason", () => {
        const result = (0, core_1.mapContainerStatus)({
            name: "api",
            image: "api:v1",
            ready: false,
            restartCount: 5,
            state: {
                waiting: { reason: "CrashLoopBackOff", message: "back-off 5m0s" },
            },
        });
        (0, vitest_1.expect)(result.state).toBe("waiting");
        (0, vitest_1.expect)(result.reason).toBe("CrashLoopBackOff");
        (0, vitest_1.expect)(result.restarts).toBe(5);
    });
    (0, vitest_1.it)("maps terminated container with last terminated time", () => {
        const result = (0, core_1.mapContainerStatus)({
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
        (0, vitest_1.expect)(result.state).toBe("terminated");
        (0, vitest_1.expect)(result.reason).toBe("Completed");
        (0, vitest_1.expect)(result.lastTerminatedAt).toBe("2026-02-28T10:05:00Z");
    });
    (0, vitest_1.it)("uses lastState terminated time as fallback", () => {
        const result = (0, core_1.mapContainerStatus)({
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
        (0, vitest_1.expect)(result.state).toBe("running");
        (0, vitest_1.expect)(result.lastTerminatedAt).toBe("2026-02-28T09:55:00Z");
    });
});
// =============================================================================
// Log line parsing
// =============================================================================
(0, vitest_1.describe)("parseLogLine", () => {
    (0, vitest_1.it)("parses timestamped log line", () => {
        const result = (0, core_1.parseLogLine)("2026-02-28T14:23:01.000000000Z Starting tile server on :8766", "tiles");
        (0, vitest_1.expect)(result).toEqual({
            timestamp: "2026-02-28T14:23:01.000000000Z",
            container: "tiles",
            text: "Starting tile server on :8766",
        });
    });
    (0, vitest_1.it)("handles line without timestamp", () => {
        const result = (0, core_1.parseLogLine)("raw log output", "api");
        (0, vitest_1.expect)(result.text).toBe("raw log output");
        (0, vitest_1.expect)(result.container).toBe("api");
        (0, vitest_1.expect)(result.timestamp).toBeDefined();
    });
    (0, vitest_1.it)("handles undefined container", () => {
        const result = (0, core_1.parseLogLine)("2026-02-28T14:23:01Z some text");
        (0, vitest_1.expect)(result.container).toBeUndefined();
        (0, vitest_1.expect)(result.text).toBe("some text");
    });
});
// =============================================================================
// Config resolution
// =============================================================================
(0, vitest_1.describe)("resolveK8sConfig", () => {
    (0, vitest_1.it)("returns empty config when no overrides", () => {
        const project = makeProject();
        (0, vitest_1.expect)((0, core_1.resolveK8sConfig)(project)).toEqual({});
    });
    (0, vitest_1.it)("returns kubernetes config from overrides", () => {
        const project = makeProject({
            overrides: {
                infrastructure: {
                    kubernetes: {
                        context: "production",
                        namespace: "myapp-prod",
                        labelSelector: "app=myapp",
                    },
                },
            },
        });
        const config = (0, core_1.resolveK8sConfig)(project);
        (0, vitest_1.expect)(config.context).toBe("production");
        (0, vitest_1.expect)(config.namespace).toBe("myapp-prod");
        (0, vitest_1.expect)(config.labelSelector).toBe("app=myapp");
    });
});
(0, vitest_1.describe)("resolveNamespace", () => {
    (0, vitest_1.it)("defaults to project name", () => {
        const project = makeProject({ name: "folia" });
        (0, vitest_1.expect)((0, core_1.resolveNamespace)(project)).toBe("folia");
    });
    (0, vitest_1.it)("uses override namespace", () => {
        const project = makeProject({
            name: "folia",
            overrides: {
                infrastructure: {
                    kubernetes: { namespace: "folia-prod" },
                },
            },
        });
        (0, vitest_1.expect)((0, core_1.resolveNamespace)(project)).toBe("folia-prod");
    });
});
(0, vitest_1.describe)("resolveLabelSelector", () => {
    (0, vitest_1.it)("returns undefined when no selector configured", () => {
        const project = makeProject();
        (0, vitest_1.expect)((0, core_1.resolveLabelSelector)(project)).toBeUndefined();
    });
    (0, vitest_1.it)("returns configured label selector", () => {
        const project = makeProject({
            overrides: {
                infrastructure: {
                    kubernetes: { labelSelector: "app=folia" },
                },
            },
        });
        (0, vitest_1.expect)((0, core_1.resolveLabelSelector)(project)).toBe("app=folia");
    });
});
// =============================================================================
// KubernetesAdapter.detect
// =============================================================================
(0, vitest_1.describe)("KubernetesAdapter.detect", () => {
    const adapter = new core_1.KubernetesAdapter();
    (0, vitest_1.it)("detects kubernetes infrastructure", async () => {
        const project = makeProject({ stack: k8sStack });
        (0, vitest_1.expect)(await adapter.detect(project)).toBe(true);
    });
    (0, vitest_1.it)("does not detect when no kubernetes in infrastructure", async () => {
        const project = makeProject({ stack: emptyStack });
        (0, vitest_1.expect)(await adapter.detect(project)).toBe(false);
    });
    (0, vitest_1.it)("does not detect with other infrastructure only", async () => {
        const project = makeProject({
            stack: {
                ...emptyStack,
                infrastructure: [{ name: "docker", sourceFile: "Dockerfile" }],
            },
        });
        (0, vitest_1.expect)(await adapter.detect(project)).toBe(false);
    });
    (0, vitest_1.it)("detects when user configured kubernetes namespace", async () => {
        const project = makeProject({
            overrides: {
                infrastructure: {
                    kubernetes: { namespace: "my-namespace" },
                },
            },
        });
        (0, vitest_1.expect)(await adapter.detect(project)).toBe(true);
    });
    (0, vitest_1.it)("detects when user configured kubernetes context", async () => {
        const project = makeProject({
            overrides: {
                infrastructure: {
                    kubernetes: { context: "prod-cluster" },
                },
            },
        });
        (0, vitest_1.expect)(await adapter.detect(project)).toBe(true);
    });
    (0, vitest_1.it)("detects when user configured label selector", async () => {
        const project = makeProject({
            overrides: {
                infrastructure: {
                    kubernetes: { labelSelector: "app=myapp" },
                },
            },
        });
        (0, vitest_1.expect)(await adapter.detect(project)).toBe(true);
    });
});
// =============================================================================
// detectInfrastructure
// =============================================================================
(0, vitest_1.describe)("detectInfrastructure", () => {
    (0, vitest_1.it)("detects kubernetes for project with k8s infrastructure", async () => {
        const project = makeProject({ stack: k8sStack });
        const result = await (0, core_1.detectInfrastructure)(project);
        (0, vitest_1.expect)(result.adapters).toHaveLength(1);
        (0, vitest_1.expect)(result.adapters[0].provider).toBe("kubernetes");
        (0, vitest_1.expect)(result.evidence).toHaveLength(1);
        (0, vitest_1.expect)(result.evidence[0].detectedAs).toBe("infra:kubernetes");
    });
    (0, vitest_1.it)("returns empty for project without infrastructure", async () => {
        const project = makeProject({ stack: emptyStack });
        const result = await (0, core_1.detectInfrastructure)(project);
        (0, vitest_1.expect)(result.adapters).toHaveLength(0);
        (0, vitest_1.expect)(result.evidence).toHaveLength(0);
    });
});
// =============================================================================
// getInfraAdapters / getInfraAdapter
// =============================================================================
(0, vitest_1.describe)("getInfraAdapters", () => {
    (0, vitest_1.it)("returns at least one adapter", () => {
        const adapters = (0, core_1.getInfraAdapters)();
        (0, vitest_1.expect)(adapters.length).toBeGreaterThanOrEqual(1);
    });
    (0, vitest_1.it)("includes kubernetes adapter", () => {
        const adapters = (0, core_1.getInfraAdapters)();
        (0, vitest_1.expect)(adapters.some((a) => a.provider === "kubernetes")).toBe(true);
    });
    (0, vitest_1.it)("returns a copy (not the internal array)", () => {
        const a = (0, core_1.getInfraAdapters)();
        const b = (0, core_1.getInfraAdapters)();
        (0, vitest_1.expect)(a).not.toBe(b);
    });
});
(0, vitest_1.describe)("getInfraAdapter", () => {
    (0, vitest_1.it)("returns kubernetes adapter", () => {
        const adapter = (0, core_1.getInfraAdapter)("kubernetes");
        (0, vitest_1.expect)(adapter).toBeDefined();
        (0, vitest_1.expect)(adapter.provider).toBe("kubernetes");
    });
    (0, vitest_1.it)("returns undefined for unregistered provider", () => {
        (0, vitest_1.expect)((0, core_1.getInfraAdapter)("ecs")).toBeUndefined();
    });
});
// =============================================================================
// computeInfraHealthSummary
// =============================================================================
(0, vitest_1.describe)("computeInfraHealthSummary", () => {
    function makeResource(status) {
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
    (0, vitest_1.it)("counts resource statuses correctly", () => {
        const resources = [
            makeResource("healthy"),
            makeResource("healthy"),
            makeResource("degraded"),
            makeResource("unhealthy"),
            makeResource("progressing"),
            makeResource("suspended"),
            makeResource("unknown"),
        ];
        const summary = (0, core_1.computeInfraHealthSummary)(resources);
        (0, vitest_1.expect)(summary).toEqual({
            total: 7,
            healthy: 2,
            degraded: 1,
            unhealthy: 1,
            progressing: 1,
            suspended: 1,
            unknown: 1,
        });
    });
    (0, vitest_1.it)("returns all zeros for empty array", () => {
        const summary = (0, core_1.computeInfraHealthSummary)([]);
        (0, vitest_1.expect)(summary).toEqual({
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
//# sourceMappingURL=kubernetes.test.js.map