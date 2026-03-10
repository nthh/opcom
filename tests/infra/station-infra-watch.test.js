"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
// Mock child_process to prevent real kubectl calls
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
const station_js_1 = require("../../packages/core/src/server/station.js");
(0, vitest_1.beforeEach)(() => {
    mockExecFileAsync.mockReset();
    mockExecFileAsync.mockRejectedValue(new Error("kubectl not available in test"));
});
(0, vitest_1.describe)("Station infrastructure event types", () => {
    (0, vitest_1.it)("ServerEvent includes infra_resource_updated type", () => {
        const event = {
            type: "infra_resource_updated",
            projectId: "proj-1",
            resource: {
                id: "default/api",
                projectId: "proj-1",
                provider: "kubernetes",
                kind: "deployment",
                name: "api",
                status: "healthy",
                age: new Date().toISOString(),
            },
        };
        (0, vitest_1.expect)(event.type).toBe("infra_resource_updated");
        (0, vitest_1.expect)(event.projectId).toBe("proj-1");
    });
    (0, vitest_1.it)("ServerEvent includes infra_resource_deleted type", () => {
        const event = {
            type: "infra_resource_deleted",
            projectId: "proj-1",
            resourceId: "default/api",
        };
        (0, vitest_1.expect)(event.type).toBe("infra_resource_deleted");
        (0, vitest_1.expect)(event.resourceId).toBe("default/api");
    });
    (0, vitest_1.it)("ServerEvent includes pod_crash type", () => {
        const pod = {
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
        };
        const event = {
            type: "pod_crash",
            projectId: "proj-1",
            pod,
            container: "api",
            reason: "CrashLoopBackOff",
        };
        (0, vitest_1.expect)(event.type).toBe("pod_crash");
        (0, vitest_1.expect)(event.pod.name).toBe("api-abc");
        (0, vitest_1.expect)(event.container).toBe("api");
        (0, vitest_1.expect)(event.reason).toBe("CrashLoopBackOff");
    });
});
(0, vitest_1.describe)("Station constructor accepts skipInfra option", () => {
    (0, vitest_1.it)("creates station with skipInfra option", () => {
        const station = new station_js_1.Station(0, { skipCICD: true, skipReconcile: true, skipInfra: true });
        (0, vitest_1.expect)(station).toBeDefined();
    });
});
(0, vitest_1.describe)("Station start/stop with infra watchers disabled", () => {
    (0, vitest_1.it)("starts and stops cleanly with all watchers skipped", async () => {
        const station = new station_js_1.Station(0, { skipCICD: true, skipReconcile: true, skipInfra: true });
        await station.start();
        const port = station.getPort();
        (0, vitest_1.expect)(port).toBeDefined();
        await station.stop();
    });
});
//# sourceMappingURL=station-infra-watch.test.js.map