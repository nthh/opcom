"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const promises_1 = require("node:fs/promises");
const node_fs_1 = require("node:fs");
const node_path_1 = require("node:path");
const node_os_1 = require("node:os");
const promises_2 = require("node:fs/promises");
(0, vitest_1.describe)("opcom init <folder>", () => {
    let tempDir;
    let originalHome;
    (0, vitest_1.beforeEach)(async () => {
        tempDir = await (0, promises_1.mkdtemp)((0, node_path_1.join)((0, node_os_1.tmpdir)(), "opcom-init-folder-"));
        originalHome = process.env.HOME;
        process.env.HOME = tempDir;
    });
    (0, vitest_1.afterEach)(async () => {
        process.env.HOME = originalHome;
        await (0, promises_1.rm)(tempDir, { recursive: true, force: true });
    });
    (0, vitest_1.it)("creates a new empty project folder with scaffolding", async () => {
        const { ensureOpcomDirs } = await import("@opcom/core");
        const { runInitFolder } = await import("../../packages/cli/src/commands/init.js");
        await ensureOpcomDirs();
        const projectDir = (0, node_path_1.join)(tempDir, "japan-trip");
        await runInitFolder({
            folder: projectDir,
            promptFn: async (q) => {
                if (q.includes("Project name"))
                    return "";
                if (q.includes("What is this project about"))
                    return "Plan a two-week trip to Japan";
                return "";
            },
        });
        // Folder was created
        (0, vitest_1.expect)((0, node_fs_1.existsSync)(projectDir)).toBe(true);
        // .tickets/impl/ was created
        (0, vitest_1.expect)((0, node_fs_1.existsSync)((0, node_path_1.join)(projectDir, ".tickets/impl"))).toBe(true);
        // AGENTS.md was created with project name and description
        const agentsMd = await (0, promises_1.readFile)((0, node_path_1.join)(projectDir, "AGENTS.md"), "utf-8");
        (0, vitest_1.expect)(agentsMd).toContain("japan-trip");
        (0, vitest_1.expect)(agentsMd).toContain("Plan a two-week trip to Japan");
        // Project config was saved
        const { loadProject } = await import("@opcom/core");
        const config = await loadProject("japan-trip");
        (0, vitest_1.expect)(config).not.toBeNull();
        (0, vitest_1.expect)(config.id).toBe("japan-trip");
        (0, vitest_1.expect)(config.name).toBe("japan-trip");
        (0, vitest_1.expect)(config.path).toBe(projectDir);
        (0, vitest_1.expect)(config.description).toBe("Plan a two-week trip to Japan");
        (0, vitest_1.expect)(config.stack.languages).toHaveLength(0);
        (0, vitest_1.expect)(config.lastScannedAt).toBeTruthy();
    });
    (0, vitest_1.it)("initializes an existing folder with code detection", async () => {
        const { ensureOpcomDirs } = await import("@opcom/core");
        const { runInitFolder } = await import("../../packages/cli/src/commands/init.js");
        await ensureOpcomDirs();
        // Create an existing project with a package.json
        const projectDir = (0, node_path_1.join)(tempDir, "my-app");
        await (0, promises_2.mkdir)(projectDir, { recursive: true });
        await (0, promises_2.writeFile)((0, node_path_1.join)(projectDir, "package.json"), JSON.stringify({
            name: "my-app",
            dependencies: { react: "^18.0.0" },
            devDependencies: { typescript: "^5.0.0" },
        }), "utf-8");
        await runInitFolder({
            folder: projectDir,
            promptFn: async (q) => {
                if (q.includes("Project name"))
                    return "My App";
                if (q.includes("What is this project about"))
                    return "A React SPA for task management";
                return "";
            },
        });
        // Folder already existed — should still work
        (0, vitest_1.expect)((0, node_fs_1.existsSync)(projectDir)).toBe(true);
        // .tickets/impl/ was created
        (0, vitest_1.expect)((0, node_fs_1.existsSync)((0, node_path_1.join)(projectDir, ".tickets/impl"))).toBe(true);
        // AGENTS.md was created
        (0, vitest_1.expect)((0, node_fs_1.existsSync)((0, node_path_1.join)(projectDir, "AGENTS.md"))).toBe(true);
        // Project config has detection results + description
        const { loadProject } = await import("@opcom/core");
        const config = await loadProject("my-app");
        (0, vitest_1.expect)(config).not.toBeNull();
        (0, vitest_1.expect)(config.id).toBe("my-app");
        (0, vitest_1.expect)(config.name).toBe("My App");
        (0, vitest_1.expect)(config.description).toBe("A React SPA for task management");
        (0, vitest_1.expect)(config.stack.languages.map((l) => l.name)).toContain("typescript");
        (0, vitest_1.expect)(config.stack.frameworks.map((f) => f.name)).toContain("React");
    });
    (0, vitest_1.it)("adds project to default workspace", async () => {
        const { ensureOpcomDirs, saveGlobalConfig, saveWorkspace, loadWorkspace, defaultSettings } = await import("@opcom/core");
        const { runInitFolder } = await import("../../packages/cli/src/commands/init.js");
        await ensureOpcomDirs();
        await saveGlobalConfig({ defaultWorkspace: "personal", settings: defaultSettings() });
        await saveWorkspace({
            id: "personal",
            name: "personal",
            projectIds: [],
            createdAt: new Date().toISOString(),
        });
        const projectDir = (0, node_path_1.join)(tempDir, "new-proj");
        await runInitFolder({
            folder: projectDir,
            promptFn: async (q) => {
                if (q.includes("Project name"))
                    return "";
                if (q.includes("What is this project about"))
                    return "test project";
                return "";
            },
        });
        const ws = await loadWorkspace("personal");
        (0, vitest_1.expect)(ws).not.toBeNull();
        (0, vitest_1.expect)(ws.projectIds).toContain("new-proj");
    });
    (0, vitest_1.it)("uses custom project name for id", async () => {
        const { ensureOpcomDirs } = await import("@opcom/core");
        const { runInitFolder } = await import("../../packages/cli/src/commands/init.js");
        await ensureOpcomDirs();
        const projectDir = (0, node_path_1.join)(tempDir, "some-folder");
        await runInitFolder({
            folder: projectDir,
            promptFn: async (q) => {
                if (q.includes("Project name"))
                    return "Custom Name";
                if (q.includes("What is this project about"))
                    return "";
                return "";
            },
        });
        const { loadProject } = await import("@opcom/core");
        const config = await loadProject("custom-name");
        (0, vitest_1.expect)(config).not.toBeNull();
        (0, vitest_1.expect)(config.name).toBe("Custom Name");
        (0, vitest_1.expect)(config.id).toBe("custom-name");
        (0, vitest_1.expect)(config.description).toBeUndefined();
    });
    (0, vitest_1.it)("does not overwrite existing AGENTS.md", async () => {
        const { ensureOpcomDirs } = await import("@opcom/core");
        const { runInitFolder } = await import("../../packages/cli/src/commands/init.js");
        await ensureOpcomDirs();
        const projectDir = (0, node_path_1.join)(tempDir, "has-agents");
        await (0, promises_2.mkdir)(projectDir, { recursive: true });
        await (0, promises_2.writeFile)((0, node_path_1.join)(projectDir, "AGENTS.md"), "# Existing content\n", "utf-8");
        await runInitFolder({
            folder: projectDir,
            promptFn: async (q) => {
                if (q.includes("Project name"))
                    return "";
                if (q.includes("What is this project about"))
                    return "something";
                return "";
            },
        });
        const content = await (0, promises_1.readFile)((0, node_path_1.join)(projectDir, "AGENTS.md"), "utf-8");
        (0, vitest_1.expect)(content).toBe("# Existing content\n");
    });
    (0, vitest_1.it)("does not overwrite existing .tickets directory", async () => {
        const { ensureOpcomDirs } = await import("@opcom/core");
        const { runInitFolder } = await import("../../packages/cli/src/commands/init.js");
        await ensureOpcomDirs();
        const projectDir = (0, node_path_1.join)(tempDir, "has-tickets");
        await (0, promises_2.mkdir)((0, node_path_1.join)(projectDir, ".tickets/impl/my-task"), { recursive: true });
        await (0, promises_2.writeFile)((0, node_path_1.join)(projectDir, ".tickets/impl/my-task/README.md"), "# task\n", "utf-8");
        await runInitFolder({
            folder: projectDir,
            promptFn: async (q) => {
                if (q.includes("Project name"))
                    return "";
                if (q.includes("What is this project about"))
                    return "something";
                return "";
            },
        });
        // Existing ticket still there
        const taskFile = await (0, promises_1.readFile)((0, node_path_1.join)(projectDir, ".tickets/impl/my-task/README.md"), "utf-8");
        (0, vitest_1.expect)(taskFile).toBe("# task\n");
    });
    (0, vitest_1.it)("handles ~ in folder path", async () => {
        const { ensureOpcomDirs } = await import("@opcom/core");
        const { runInitFolder } = await import("../../packages/cli/src/commands/init.js");
        await ensureOpcomDirs();
        await runInitFolder({
            folder: "~/tilde-project",
            promptFn: async (q) => {
                if (q.includes("Project name"))
                    return "";
                if (q.includes("What is this project about"))
                    return "";
                return "";
            },
        });
        const expectedPath = (0, node_path_1.join)(tempDir, "tilde-project");
        (0, vitest_1.expect)((0, node_fs_1.existsSync)(expectedPath)).toBe(true);
        const { loadProject } = await import("@opcom/core");
        const config = await loadProject("tilde-project");
        (0, vitest_1.expect)(config).not.toBeNull();
        (0, vitest_1.expect)(config.path).toBe(expectedPath);
    });
});
(0, vitest_1.describe)("description field roundtrip", () => {
    let tempDir;
    let originalHome;
    (0, vitest_1.beforeEach)(async () => {
        tempDir = await (0, promises_1.mkdtemp)((0, node_path_1.join)((0, node_os_1.tmpdir)(), "opcom-desc-"));
        originalHome = process.env.HOME;
        process.env.HOME = tempDir;
    });
    (0, vitest_1.afterEach)(async () => {
        process.env.HOME = originalHome;
        await (0, promises_1.rm)(tempDir, { recursive: true, force: true });
    });
    (0, vitest_1.it)("persists and loads description in project config", async () => {
        const { ensureOpcomDirs, saveProject, loadProject, emptyStack } = await import("@opcom/core");
        await ensureOpcomDirs();
        await saveProject({
            id: "with-desc",
            name: "With Desc",
            path: "/tmp/wd",
            description: "A project with a description",
            stack: emptyStack(),
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
        });
        const loaded = await loadProject("with-desc");
        (0, vitest_1.expect)(loaded).not.toBeNull();
        (0, vitest_1.expect)(loaded.description).toBe("A project with a description");
    });
    (0, vitest_1.it)("omits description when not provided", async () => {
        const { ensureOpcomDirs, saveProject, loadProject, emptyStack } = await import("@opcom/core");
        await ensureOpcomDirs();
        await saveProject({
            id: "no-desc",
            name: "No Desc",
            path: "/tmp/nd",
            stack: emptyStack(),
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
        });
        const loaded = await loadProject("no-desc");
        (0, vitest_1.expect)(loaded).not.toBeNull();
        (0, vitest_1.expect)(loaded.description).toBeUndefined();
    });
});
//# sourceMappingURL=init-folder.test.js.map