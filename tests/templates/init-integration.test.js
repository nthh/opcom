"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const promises_1 = require("node:fs/promises");
const node_fs_1 = require("node:fs");
const node_path_1 = require("node:path");
const node_os_1 = require("node:os");
(0, vitest_1.describe)("opcom init <folder> with templates", () => {
    let tempDir;
    let originalHome;
    (0, vitest_1.beforeEach)(async () => {
        tempDir = await (0, promises_1.mkdtemp)((0, node_path_1.join)((0, node_os_1.tmpdir)(), "opcom-init-tpl-"));
        originalHome = process.env.HOME;
        process.env.HOME = tempDir;
    });
    (0, vitest_1.afterEach)(async () => {
        process.env.HOME = originalHome;
        await (0, promises_1.rm)(tempDir, { recursive: true, force: true });
    });
    (0, vitest_1.it)("scaffolds project from travel template with variables", async () => {
        const { ensureOpcomDirs } = await import("@opcom/core");
        const { runInitFolder } = await import("../../packages/cli/src/commands/init.js");
        await ensureOpcomDirs();
        const projectDir = (0, node_path_1.join)(tempDir, "japan-trip");
        const prompts = [];
        await runInitFolder({
            folder: projectDir,
            promptFn: async (q) => {
                prompts.push(q);
                if (q.includes("Project name"))
                    return "Japan Trip";
                if (q.includes("What is this project about"))
                    return "Plan Japan trip";
                // Template selection: travel is [3]
                if (q.trim() === ">")
                    return "3";
                if (q.includes("Where are you going"))
                    return "Tokyo";
                if (q.includes("What dates"))
                    return "May 12-20";
                if (q.includes("How many travelers"))
                    return "2";
                return "";
            },
        });
        // Tickets from travel template were created
        (0, vitest_1.expect)((0, node_fs_1.existsSync)((0, node_path_1.join)(projectDir, ".tickets/impl/book-flights.md"))).toBe(true);
        (0, vitest_1.expect)((0, node_fs_1.existsSync)((0, node_path_1.join)(projectDir, ".tickets/impl/book-accommodation.md"))).toBe(true);
        (0, vitest_1.expect)((0, node_fs_1.existsSync)((0, node_path_1.join)(projectDir, ".tickets/impl/plan-activities.md"))).toBe(true);
        (0, vitest_1.expect)((0, node_fs_1.existsSync)((0, node_path_1.join)(projectDir, ".tickets/impl/create-itinerary.md"))).toBe(true);
        // Variable substitution happened
        const flights = await (0, promises_1.readFile)((0, node_path_1.join)(projectDir, ".tickets/impl/book-flights.md"), "utf-8");
        (0, vitest_1.expect)(flights).toContain("Tokyo");
        (0, vitest_1.expect)(flights).toContain("2 traveler(s)");
        (0, vitest_1.expect)(flights).toContain("May 12-20");
        // AGENTS.md created with template content
        const agentsMd = await (0, promises_1.readFile)((0, node_path_1.join)(projectDir, "AGENTS.md"), "utf-8");
        (0, vitest_1.expect)(agentsMd).toContain("Japan Trip");
        (0, vitest_1.expect)(agentsMd).toContain("Tokyo");
        // docs/research directory created
        (0, vitest_1.expect)((0, node_fs_1.existsSync)((0, node_path_1.join)(projectDir, "docs/research"))).toBe(true);
        // Project config saved
        const { loadProject } = await import("@opcom/core");
        const config = await loadProject("japan-trip");
        (0, vitest_1.expect)(config).not.toBeNull();
        (0, vitest_1.expect)(config.name).toBe("Japan Trip");
    });
    (0, vitest_1.it)("scaffolds project from software template without variables", async () => {
        const { ensureOpcomDirs } = await import("@opcom/core");
        const { runInitFolder } = await import("../../packages/cli/src/commands/init.js");
        await ensureOpcomDirs();
        const projectDir = (0, node_path_1.join)(tempDir, "my-app");
        await runInitFolder({
            folder: projectDir,
            promptFn: async (q) => {
                if (q.includes("Project name"))
                    return "My App";
                if (q.includes("What is this project about"))
                    return "A web application";
                // Template selection: software is [1]
                if (q.trim() === ">")
                    return "1";
                return "";
            },
        });
        // Software template tickets created
        (0, vitest_1.expect)((0, node_fs_1.existsSync)((0, node_path_1.join)(projectDir, ".tickets/impl/setup-ci.md"))).toBe(true);
        (0, vitest_1.expect)((0, node_fs_1.existsSync)((0, node_path_1.join)(projectDir, ".tickets/impl/setup-testing.md"))).toBe(true);
        (0, vitest_1.expect)((0, node_fs_1.existsSync)((0, node_path_1.join)(projectDir, ".tickets/impl/initial-feature.md"))).toBe(true);
        // AGENTS.md has project info
        const agentsMd = await (0, promises_1.readFile)((0, node_path_1.join)(projectDir, "AGENTS.md"), "utf-8");
        (0, vitest_1.expect)(agentsMd).toContain("My App");
        (0, vitest_1.expect)(agentsMd).toContain("A web application");
    });
    (0, vitest_1.it)("skips template when user selects 'none'", async () => {
        const { ensureOpcomDirs } = await import("@opcom/core");
        const { runInitFolder } = await import("../../packages/cli/src/commands/init.js");
        await ensureOpcomDirs();
        const projectDir = (0, node_path_1.join)(tempDir, "empty-proj");
        await runInitFolder({
            folder: projectDir,
            promptFn: async (q) => {
                if (q.includes("Project name"))
                    return "";
                if (q.includes("What is this project about"))
                    return "Just a project";
                // Select "none" (last option = 5)
                if (q.trim() === ">")
                    return "5";
                return "";
            },
        });
        // Basic scaffolding still created
        (0, vitest_1.expect)((0, node_fs_1.existsSync)((0, node_path_1.join)(projectDir, ".tickets/impl"))).toBe(true);
        (0, vitest_1.expect)((0, node_fs_1.existsSync)((0, node_path_1.join)(projectDir, "AGENTS.md"))).toBe(true);
        // No template tickets
        (0, vitest_1.expect)((0, node_fs_1.existsSync)((0, node_path_1.join)(projectDir, ".tickets/impl/setup-ci.md"))).toBe(false);
        (0, vitest_1.expect)((0, node_fs_1.existsSync)((0, node_path_1.join)(projectDir, ".tickets/impl/book-flights.md"))).toBe(false);
        // AGENTS.md is the basic one, not a template
        const agentsMd = await (0, promises_1.readFile)((0, node_path_1.join)(projectDir, "AGENTS.md"), "utf-8");
        (0, vitest_1.expect)(agentsMd).toContain("empty-proj");
        (0, vitest_1.expect)(agentsMd).toContain("Just a project");
    });
    (0, vitest_1.it)("uses default variable value when user enters empty string", async () => {
        const { ensureOpcomDirs } = await import("@opcom/core");
        const { runInitFolder } = await import("../../packages/cli/src/commands/init.js");
        await ensureOpcomDirs();
        const projectDir = (0, node_path_1.join)(tempDir, "trip");
        await runInitFolder({
            folder: projectDir,
            promptFn: async (q) => {
                if (q.includes("Project name"))
                    return "";
                if (q.includes("What is this project about"))
                    return "A trip";
                if (q.trim() === ">")
                    return "3"; // travel
                if (q.includes("Where are you going"))
                    return "Paris";
                if (q.includes("What dates"))
                    return "June 1-5";
                if (q.includes("How many travelers"))
                    return ""; // default: 1
                return "";
            },
        });
        const flights = await (0, promises_1.readFile)((0, node_path_1.join)(projectDir, ".tickets/impl/book-flights.md"), "utf-8");
        (0, vitest_1.expect)(flights).toContain("1 traveler(s)");
    });
});
//# sourceMappingURL=init-integration.test.js.map