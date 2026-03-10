"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const promises_1 = require("node:fs/promises");
const node_path_1 = require("node:path");
const node_os_1 = require("node:os");
// We need to mock the opcom root for tests
// Use dynamic imports after setting env
(0, vitest_1.describe)("config roundtrip", () => {
    let tempDir;
    let originalHome;
    (0, vitest_1.beforeEach)(async () => {
        tempDir = await (0, promises_1.mkdtemp)((0, node_path_1.join)((0, node_os_1.tmpdir)(), "opcom-test-"));
        originalHome = process.env.HOME;
        process.env.HOME = tempDir;
    });
    (0, vitest_1.afterEach)(async () => {
        process.env.HOME = originalHome;
        await (0, promises_1.rm)(tempDir, { recursive: true, force: true });
    });
    (0, vitest_1.it)("saves and loads workspace config", async () => {
        // Dynamic import so HOME is set before module loads
        const { ensureOpcomDirs, saveWorkspace, loadWorkspace } = await import("@opcom/core");
        await ensureOpcomDirs();
        const ws = {
            id: "test-ws",
            name: "Test Workspace",
            description: "For testing",
            projectIds: ["proj-1", "proj-2"],
            createdAt: "2026-02-27T00:00:00Z",
        };
        await saveWorkspace(ws);
        const loaded = await loadWorkspace("test-ws");
        (0, vitest_1.expect)(loaded).not.toBeNull();
        (0, vitest_1.expect)(loaded.id).toBe("test-ws");
        (0, vitest_1.expect)(loaded.name).toBe("Test Workspace");
        (0, vitest_1.expect)(loaded.projectIds).toEqual(["proj-1", "proj-2"]);
    });
    (0, vitest_1.it)("saves and loads project config", async () => {
        const { ensureOpcomDirs, saveProject, loadProject, emptyStack } = await import("@opcom/core");
        await ensureOpcomDirs();
        const proj = {
            id: "test-proj",
            name: "Test Project",
            path: "/tmp/test",
            stack: {
                ...emptyStack(),
                languages: [{ name: "typescript", version: "5.0", sourceFile: "package.json" }],
            },
            git: { branch: "main", clean: true, remote: null },
            workSystem: { type: "tickets-dir", ticketDir: ".tickets/impl" },
            docs: {},
            services: [{ name: "api", port: 3000 }],
            environments: [],
            testing: { framework: "vitest" },
            linting: [{ name: "eslint", sourceFile: "eslint.config.js" }],
            subProjects: [],
            cloudServices: [],
            lastScannedAt: "2026-02-27T00:00:00Z",
        };
        await saveProject(proj);
        const loaded = await loadProject("test-proj");
        (0, vitest_1.expect)(loaded).not.toBeNull();
        (0, vitest_1.expect)(loaded.id).toBe("test-proj");
        (0, vitest_1.expect)(loaded.name).toBe("Test Project");
        (0, vitest_1.expect)(loaded.stack.languages[0].name).toBe("typescript");
        (0, vitest_1.expect)(loaded.git?.branch).toBe("main");
        (0, vitest_1.expect)(loaded.workSystem?.type).toBe("tickets-dir");
        (0, vitest_1.expect)(loaded.services[0].port).toBe(3000);
        (0, vitest_1.expect)(loaded.testing?.framework).toBe("vitest");
    });
    (0, vitest_1.it)("lists workspaces and projects", async () => {
        const { ensureOpcomDirs, saveWorkspace, listWorkspaces, saveProject, listProjects, emptyStack } = await import("@opcom/core");
        await ensureOpcomDirs();
        await saveWorkspace({ id: "ws-1", name: "WS 1", projectIds: [], createdAt: "2026-01-01T00:00:00Z" });
        await saveWorkspace({ id: "ws-2", name: "WS 2", projectIds: [], createdAt: "2026-01-01T00:00:00Z" });
        const workspaces = await listWorkspaces();
        (0, vitest_1.expect)(workspaces).toHaveLength(2);
        await saveProject({ id: "p1", name: "P1", path: "/tmp/p1", stack: emptyStack(), git: null, workSystem: null, docs: {}, services: [], environments: [], testing: null, linting: [], subProjects: [], cloudServices: [], lastScannedAt: "2026-01-01T00:00:00Z" });
        const projects = await listProjects();
        (0, vitest_1.expect)(projects).toHaveLength(1);
    });
});
//# sourceMappingURL=loader.test.js.map