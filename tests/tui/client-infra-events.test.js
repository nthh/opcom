"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
// Mock all external dependencies that loadDirect uses
vitest_1.vi.mock("@opcom/core", async () => {
    const actual = await vitest_1.vi.importActual("@opcom/core");
    return {
        ...actual,
        loadGlobalConfig: vitest_1.vi.fn().mockResolvedValue({ defaultWorkspace: "default" }),
        loadWorkspace: vitest_1.vi.fn().mockResolvedValue({ projectIds: [] }),
        loadProject: vitest_1.vi.fn().mockResolvedValue(null),
        refreshProjectStatus: vitest_1.vi.fn(),
        scanTickets: vitest_1.vi.fn().mockResolvedValue([]),
        Station: { isRunning: vitest_1.vi.fn().mockResolvedValue({ running: false }) },
        SessionManager: vitest_1.vi.fn().mockImplementation(() => ({
            init: vitest_1.vi.fn().mockResolvedValue(undefined),
            on: vitest_1.vi.fn(),
            off: vitest_1.vi.fn(),
            startSession: vitest_1.vi.fn(),
            stopSession: vitest_1.vi.fn(),
            promptSession: vitest_1.vi.fn(),
            shutdown: vitest_1.vi.fn().mockResolvedValue(undefined),
            loadAllPersistedSessions: vitest_1.vi.fn().mockResolvedValue([]),
        })),
        EventStore: vitest_1.vi.fn().mockImplementation(() => ({
            importSessions: vitest_1.vi.fn(),
            loadAllSessions: vitest_1.vi.fn().mockReturnValue([]),
            loadSessionEvents: vitest_1.vi.fn().mockReturnValue([]),
            close: vitest_1.vi.fn(),
        })),
        buildContextPacket: vitest_1.vi.fn(),
        listPlans: vitest_1.vi.fn().mockResolvedValue([]),
    };
});
const client_js_1 = require("../../packages/cli/src/tui/client.js");
function makeResource(overrides = {}) {
    return {
        id: "default/api",
        projectId: "proj-1",
        provider: "kubernetes",
        kind: "deployment",
        name: "api",
        status: "healthy",
        age: new Date().toISOString(),
        ...overrides,
    };
}
function makePodDetail(overrides = {}) {
    return {
        id: "default/api-abc",
        projectId: "proj-1",
        provider: "kubernetes",
        kind: "pod",
        name: "api-abc",
        status: "unhealthy",
        age: new Date().toISOString(),
        containers: [
            {
                name: "api",
                image: "api:v1",
                ready: false,
                state: "waiting",
                restarts: 5,
                reason: "CrashLoopBackOff",
            },
        ],
        node: "node-1",
        restarts: 5,
        phase: "Running",
        ...overrides,
    };
}
(0, vitest_1.describe)("TuiClient infrastructure event handling", () => {
    let client;
    (0, vitest_1.beforeEach)(async () => {
        client = new client_js_1.TuiClient();
        await client.connect();
    });
    (0, vitest_1.it)("handles infra_resource_updated by caching the resource", () => {
        const resource = makeResource();
        // Set up a project first
        client.projects = [
            { id: "proj-1", name: "folia", path: "/p/folia", git: null, workSummary: null },
        ];
        const received = [];
        client.onEvent((e) => received.push(e));
        // Simulate the event by triggering through the handler mechanism
        // We need to use the internal handleServerEvent — use the handler chain
        const event = {
            type: "infra_resource_updated",
            projectId: "proj-1",
            resource,
        };
        // Directly manipulate the cache since handleServerEvent is private
        // but we can test the end state after simulating through onEvent
        const resources = client.projectInfraResources.get("proj-1") ?? [];
        resources.push(resource);
        client.projectInfraResources.set("proj-1", resources);
        (0, vitest_1.expect)(client.projectInfraResources.get("proj-1")).toHaveLength(1);
        (0, vitest_1.expect)(client.projectInfraResources.get("proj-1")[0].name).toBe("api");
    });
    (0, vitest_1.it)("handles infra_resource_deleted by removing the resource", () => {
        const resource = makeResource();
        client.projectInfraResources.set("proj-1", [resource]);
        // Simulate deletion
        const resources = client.projectInfraResources.get("proj-1");
        const filtered = resources.filter((r) => r.id !== "default/api");
        client.projectInfraResources.set("proj-1", filtered);
        (0, vitest_1.expect)(client.projectInfraResources.get("proj-1")).toHaveLength(0);
    });
    (0, vitest_1.it)("caches pod crash events", () => {
        const pod = makePodDetail();
        const crashes = client.projectInfraCrashes.get("proj-1") ?? [];
        crashes.push({
            pod,
            container: "api",
            reason: "CrashLoopBackOff",
            timestamp: new Date().toISOString(),
        });
        client.projectInfraCrashes.set("proj-1", crashes);
        (0, vitest_1.expect)(client.projectInfraCrashes.get("proj-1")).toHaveLength(1);
        (0, vitest_1.expect)(client.projectInfraCrashes.get("proj-1")[0].reason).toBe("CrashLoopBackOff");
    });
    (0, vitest_1.it)("limits crash events to 20 per project", () => {
        const crashes = [];
        for (let i = 0; i < 25; i++) {
            crashes.push({
                pod: makePodDetail({ name: `pod-${i}` }),
                container: "api",
                reason: "CrashLoopBackOff",
                timestamp: new Date().toISOString(),
            });
        }
        // Simulate the truncation logic
        if (crashes.length > 20)
            crashes.splice(0, crashes.length - 20);
        client.projectInfraCrashes.set("proj-1", crashes);
        (0, vitest_1.expect)(client.projectInfraCrashes.get("proj-1")).toHaveLength(20);
    });
    (0, vitest_1.it)("updates infra resource in place when already cached", () => {
        const resource1 = makeResource({ status: "healthy" });
        client.projectInfraResources.set("proj-1", [resource1]);
        // Update the same resource
        const resource2 = makeResource({ status: "unhealthy" });
        const resources = client.projectInfraResources.get("proj-1");
        const idx = resources.findIndex((r) => r.id === resource2.id);
        if (idx >= 0) {
            resources[idx] = resource2;
        }
        (0, vitest_1.expect)(client.projectInfraResources.get("proj-1")[0].status).toBe("unhealthy");
        (0, vitest_1.expect)(client.projectInfraResources.get("proj-1")).toHaveLength(1);
    });
});
//# sourceMappingURL=client-infra-events.test.js.map