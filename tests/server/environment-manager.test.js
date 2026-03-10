"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const promises_1 = require("node:fs/promises");
const node_os_1 = require("node:os");
const node_path_1 = require("node:path");
const core_1 = require("@opcom/core");
function makeProject(overrides) {
    return {
        id: "test-project",
        name: "test-project",
        path: "/tmp",
        stack: {
            languages: [],
            frameworks: [],
            packageManagers: [],
            infrastructure: [],
            versionManagers: [],
        },
        git: null,
        workSystem: null,
        docs: {},
        services: [],
        environments: [],
        testing: null,
        linting: [],
        subProjects: [],
        cloudServices: [],
        lastScannedAt: "2026-01-01T00:00:00Z",
        ...overrides,
    };
}
(0, vitest_1.describe)("topologicalSort", () => {
    (0, vitest_1.it)("returns services in dependency order", () => {
        const services = [
            { name: "api", command: "node api.js", port: 8000, dependsOn: ["postgres"] },
            { name: "postgres", command: "pg_start", port: 5432 },
            { name: "worker", command: "node worker.js", dependsOn: ["api"] },
        ];
        const sorted = (0, core_1.topologicalSort)(services);
        const names = sorted.map((s) => s.name);
        (0, vitest_1.expect)(names.indexOf("postgres")).toBeLessThan(names.indexOf("api"));
        (0, vitest_1.expect)(names.indexOf("api")).toBeLessThan(names.indexOf("worker"));
    });
    (0, vitest_1.it)("handles services with no dependencies", () => {
        const services = [
            { name: "web", command: "npm start", port: 3000 },
            { name: "api", command: "npm run api", port: 8000 },
        ];
        const sorted = (0, core_1.topologicalSort)(services);
        (0, vitest_1.expect)(sorted).toHaveLength(2);
    });
    (0, vitest_1.it)("throws on circular dependencies", () => {
        const services = [
            { name: "a", command: "start-a", dependsOn: ["b"] },
            { name: "b", command: "start-b", dependsOn: ["a"] },
        ];
        (0, vitest_1.expect)(() => (0, core_1.topologicalSort)(services)).toThrow(/[Cc]ircular/);
    });
    (0, vitest_1.it)("handles diamond dependencies", () => {
        const services = [
            { name: "d", command: "d", dependsOn: ["b", "c"] },
            { name: "b", command: "b", dependsOn: ["a"] },
            { name: "c", command: "c", dependsOn: ["a"] },
            { name: "a", command: "a" },
        ];
        const sorted = (0, core_1.topologicalSort)(services);
        const names = sorted.map((s) => s.name);
        (0, vitest_1.expect)(names.indexOf("a")).toBeLessThan(names.indexOf("b"));
        (0, vitest_1.expect)(names.indexOf("a")).toBeLessThan(names.indexOf("c"));
        (0, vitest_1.expect)(names.indexOf("b")).toBeLessThan(names.indexOf("d"));
        (0, vitest_1.expect)(names.indexOf("c")).toBeLessThan(names.indexOf("d"));
    });
});
(0, vitest_1.describe)("EnvironmentManager", () => {
    let em;
    let tempDir;
    let origHome;
    (0, vitest_1.beforeEach)(async () => {
        tempDir = await (0, promises_1.mkdtemp)((0, node_path_1.join)((0, node_os_1.tmpdir)(), "opcom-env-"));
        origHome = process.env.HOME;
        process.env.HOME = tempDir;
        em = new core_1.EnvironmentManager();
    });
    (0, vitest_1.afterEach)(async () => {
        if (em)
            await em.shutdown();
        process.env.HOME = origHome;
        await (0, promises_1.rm)(tempDir, { recursive: true });
    });
    (0, vitest_1.it)("starts a simple service and tracks its instance", async () => {
        const project = makeProject();
        const instance = await em.startService(project, {
            name: "echo-svc",
            command: "echo hello",
        });
        (0, vitest_1.expect)(instance.serviceName).toBe("echo-svc");
        (0, vitest_1.expect)(instance.projectId).toBe("test-project");
        (0, vitest_1.expect)(instance.pid).toBeGreaterThan(0);
        // No port, no health check → immediately "running"
        (0, vitest_1.expect)(instance.state).toBe("running");
    });
    (0, vitest_1.it)("lists instances by project", async () => {
        const project = makeProject();
        await em.startService(project, { name: "svc-a", command: "sleep 60" });
        await em.startService(project, { name: "svc-b", command: "sleep 60" });
        const instances = em.listInstances("test-project");
        (0, vitest_1.expect)(instances).toHaveLength(2);
        (0, vitest_1.expect)(em.listInstances("other-project")).toHaveLength(0);
    });
    (0, vitest_1.it)("stops a service and updates instance state", async () => {
        const project = makeProject();
        await em.startService(project, { name: "stop-me", command: "sleep 60" });
        await em.stopService("test-project", "stop-me");
        const instance = em.getInstance("test-project", "stop-me");
        (0, vitest_1.expect)(instance?.state).toBe("stopped");
    });
    (0, vitest_1.it)("computes environment status", async () => {
        const project = makeProject();
        await em.startService(project, { name: "svc-a", command: "sleep 60" });
        await em.startService(project, { name: "svc-b", command: "sleep 60" });
        const status = em.getEnvironmentStatus("test-project");
        (0, vitest_1.expect)(status.projectId).toBe("test-project");
        (0, vitest_1.expect)(status.services).toHaveLength(2);
        // Both running (no port = immediate running)
        (0, vitest_1.expect)(status.state).toBe("all-up");
    });
    (0, vitest_1.it)("returns all-down when no services running", () => {
        const status = em.getEnvironmentStatus("nonexistent");
        (0, vitest_1.expect)(status.state).toBe("all-down");
        (0, vitest_1.expect)(status.services).toHaveLength(0);
    });
    (0, vitest_1.it)("allocates ports and persists to registry", async () => {
        const project = makeProject();
        const instance = await em.startService(project, {
            name: "web",
            command: "sleep 60",
            port: 3000,
        });
        (0, vitest_1.expect)(instance.port).toBe(3000);
        const registry = await em.getPortRegistry();
        (0, vitest_1.expect)(registry.allocations.some((a) => a.port === 3000 && a.serviceName === "web")).toBe(true);
    });
    (0, vitest_1.it)("releases ports on service stop", async () => {
        const project = makeProject();
        await em.startService(project, { name: "web", command: "sleep 60", port: 3000 });
        await em.stopService("test-project", "web");
        const registry = await em.getPortRegistry();
        (0, vitest_1.expect)(registry.allocations.some((a) => a.serviceName === "web")).toBe(false);
    });
    (0, vitest_1.it)("emits events on service state changes", async () => {
        const events = [];
        em.onEvent((e) => events.push(e.type));
        const project = makeProject();
        await em.startService(project, { name: "evt-svc", command: "echo hi" });
        // Should emit service_status and environment_status
        (0, vitest_1.expect)(events).toContain("service_status");
        (0, vitest_1.expect)(events).toContain("environment_status");
    });
    (0, vitest_1.it)("detects port conflicts and emits event", async () => {
        const events = [];
        em.onEvent((e) => {
            if (e.type === "port_conflict")
                events.push(e);
        });
        const projA = makeProject({ id: "proj-a", name: "proj-a" });
        const projB = makeProject({ id: "proj-b", name: "proj-b" });
        await em.startService(projA, { name: "web", command: "sleep 60", port: 3000 });
        await em.startService(projB, { name: "web", command: "sleep 60", port: 3000 });
        (0, vitest_1.expect)(events).toHaveLength(1);
        (0, vitest_1.expect)(events[0].port).toBe(3000);
    });
    (0, vitest_1.it)("auto-offsets conflicting ports", async () => {
        const projA = makeProject({ id: "proj-a", name: "proj-a" });
        const projB = makeProject({ id: "proj-b", name: "proj-b" });
        await em.startService(projA, { name: "web", command: "sleep 60", port: 3000 });
        const instanceB = await em.startService(projB, { name: "web", command: "sleep 60", port: 3000 });
        // Should get an offset port
        (0, vitest_1.expect)(instanceB.port).toBe(3100);
    });
    (0, vitest_1.it)("stops all services for a project", async () => {
        const project = makeProject();
        await em.startService(project, { name: "svc-a", command: "sleep 60" });
        await em.startService(project, { name: "svc-b", command: "sleep 60" });
        await em.stopAllServices("test-project");
        const instances = em.listInstances("test-project");
        (0, vitest_1.expect)(instances.every((i) => i.state === "stopped")).toBe(true);
    });
});
//# sourceMappingURL=environment-manager.test.js.map