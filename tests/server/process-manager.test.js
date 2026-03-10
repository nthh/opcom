"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const core_1 = require("@opcom/core");
function makeProject() {
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
        lastScannedAt: "2026-02-27T00:00:00Z",
    };
}
(0, vitest_1.describe)("ProcessManager", () => {
    let pm;
    (0, vitest_1.afterEach)(async () => {
        if (pm)
            await pm.shutdown();
    });
    (0, vitest_1.it)("lists no processes initially", () => {
        pm = new core_1.ProcessManager();
        (0, vitest_1.expect)(pm.listProcesses()).toHaveLength(0);
    });
    (0, vitest_1.it)("starts a service that exits quickly", async () => {
        pm = new core_1.ProcessManager();
        const project = makeProject();
        const managed = await pm.startService(project, {
            name: "echo-test",
            command: "echo hello",
        });
        (0, vitest_1.expect)(managed.name).toBe("echo-test");
        (0, vitest_1.expect)(managed.projectId).toBe("test-project");
        (0, vitest_1.expect)(managed.pid).toBeGreaterThan(0);
        // State is "running" initially (no port to check)
        (0, vitest_1.expect)(managed.state).toBe("running");
    });
    (0, vitest_1.it)("stops a service", async () => {
        pm = new core_1.ProcessManager();
        const project = makeProject();
        await pm.startService(project, { name: "sleepy", command: "sleep 60" });
        (0, vitest_1.expect)(pm.listProcesses()).toHaveLength(1);
        await pm.stopService("test-project", "sleepy");
        (0, vitest_1.expect)(pm.getProcess("test-project", "sleepy")).toBeUndefined();
    });
    (0, vitest_1.it)("lists processes filtered by project", async () => {
        pm = new core_1.ProcessManager();
        const project = makeProject();
        await pm.startService(project, { name: "svc-a", command: "sleep 60" });
        const filtered = pm.listProcesses("test-project");
        (0, vitest_1.expect)(filtered.length).toBe(1);
        const other = pm.listProcesses("nonexistent");
        (0, vitest_1.expect)(other).toHaveLength(0);
    });
    (0, vitest_1.it)("captures stdout output", async () => {
        pm = new core_1.ProcessManager();
        const project = makeProject();
        const managed = await pm.startService(project, {
            name: "output-test",
            command: "echo captured-output",
        });
        // Wait for output to be captured
        await new Promise((r) => setTimeout(r, 200));
        (0, vitest_1.expect)(managed.stdout.join("")).toContain("captured-output");
    });
});
//# sourceMappingURL=process-manager.test.js.map