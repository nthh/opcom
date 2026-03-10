"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const promises_1 = require("node:fs/promises");
const node_fs_1 = require("node:fs");
const node_path_1 = require("node:path");
const node_os_1 = require("node:os");
const promises_2 = require("node:fs/promises");
const scaffold_js_1 = require("../../packages/core/src/templates/scaffold.js");
const builtins_js_1 = require("../../packages/core/src/templates/builtins.js");
(0, vitest_1.describe)("scaffoldFromTemplate", () => {
    let tempDir;
    (0, vitest_1.beforeEach)(async () => {
        tempDir = await (0, promises_1.mkdtemp)((0, node_path_1.join)((0, node_os_1.tmpdir)(), "opcom-scaffold-"));
    });
    (0, vitest_1.afterEach)(async () => {
        await (0, promises_1.rm)(tempDir, { recursive: true, force: true });
    });
    (0, vitest_1.it)("creates directories from template", async () => {
        const template = {
            id: "test",
            name: "Test",
            description: "Test template",
            directories: [".tickets/impl", "docs", "docs/research"],
            tickets: {},
            agentsMd: "# {{name}}\n",
        };
        const result = await (0, scaffold_js_1.scaffoldFromTemplate)({
            projectDir: tempDir,
            template,
            variables: { name: "My Project" },
        });
        (0, vitest_1.expect)((0, node_fs_1.existsSync)((0, node_path_1.join)(tempDir, ".tickets/impl"))).toBe(true);
        (0, vitest_1.expect)((0, node_fs_1.existsSync)((0, node_path_1.join)(tempDir, "docs"))).toBe(true);
        (0, vitest_1.expect)((0, node_fs_1.existsSync)((0, node_path_1.join)(tempDir, "docs/research"))).toBe(true);
        (0, vitest_1.expect)(result.directoriesCreated).toContain("docs");
        (0, vitest_1.expect)(result.directoriesCreated).toContain("docs/research");
    });
    (0, vitest_1.it)("creates ticket files with variable substitution", async () => {
        const template = {
            id: "test",
            name: "Test",
            description: "Test",
            tickets: {
                "my-ticket.md": "# Build {{feature}}\n\nImplement {{feature}} for {{name}}.\n",
            },
            agentsMd: "# {{name}}\n",
        };
        const result = await (0, scaffold_js_1.scaffoldFromTemplate)({
            projectDir: tempDir,
            template,
            variables: { name: "Cool App", feature: "auth" },
        });
        (0, vitest_1.expect)(result.ticketCount).toBe(1);
        const content = await (0, promises_1.readFile)((0, node_path_1.join)(tempDir, ".tickets/impl/my-ticket.md"), "utf-8");
        (0, vitest_1.expect)(content).toBe("# Build auth\n\nImplement auth for Cool App.\n");
    });
    (0, vitest_1.it)("creates AGENTS.md with variable substitution", async () => {
        const template = {
            id: "test",
            name: "Test",
            description: "Test",
            tickets: {},
            agentsMd: "# {{name}}\n\n{{description}}\n\nDest: {{destination}}\n",
        };
        const result = await (0, scaffold_js_1.scaffoldFromTemplate)({
            projectDir: tempDir,
            template,
            variables: { name: "Japan Trip", description: "Plan Japan trip", destination: "Tokyo" },
        });
        (0, vitest_1.expect)(result.agentsMdWritten).toBe(true);
        const content = await (0, promises_1.readFile)((0, node_path_1.join)(tempDir, "AGENTS.md"), "utf-8");
        (0, vitest_1.expect)(content).toContain("# Japan Trip");
        (0, vitest_1.expect)(content).toContain("Plan Japan trip");
        (0, vitest_1.expect)(content).toContain("Dest: Tokyo");
    });
    (0, vitest_1.it)("does not overwrite existing AGENTS.md", async () => {
        await (0, promises_2.writeFile)((0, node_path_1.join)(tempDir, "AGENTS.md"), "# Existing\n", "utf-8");
        const template = {
            id: "test",
            name: "Test",
            description: "Test",
            tickets: {},
            agentsMd: "# New content\n",
        };
        const result = await (0, scaffold_js_1.scaffoldFromTemplate)({
            projectDir: tempDir,
            template,
            variables: {},
        });
        (0, vitest_1.expect)(result.agentsMdWritten).toBe(false);
        const content = await (0, promises_1.readFile)((0, node_path_1.join)(tempDir, "AGENTS.md"), "utf-8");
        (0, vitest_1.expect)(content).toBe("# Existing\n");
    });
    (0, vitest_1.it)("does not overwrite existing ticket files", async () => {
        await (0, promises_2.mkdir)((0, node_path_1.join)(tempDir, ".tickets/impl"), { recursive: true });
        await (0, promises_2.writeFile)((0, node_path_1.join)(tempDir, ".tickets/impl/existing.md"), "# Keep me\n", "utf-8");
        const template = {
            id: "test",
            name: "Test",
            description: "Test",
            tickets: {
                "existing.md": "# Overwritten\n",
                "new.md": "# New ticket\n",
            },
            agentsMd: "# Test\n",
        };
        const result = await (0, scaffold_js_1.scaffoldFromTemplate)({
            projectDir: tempDir,
            template,
            variables: {},
        });
        // Only the new ticket was created
        (0, vitest_1.expect)(result.ticketCount).toBe(1);
        const existing = await (0, promises_1.readFile)((0, node_path_1.join)(tempDir, ".tickets/impl/existing.md"), "utf-8");
        (0, vitest_1.expect)(existing).toBe("# Keep me\n");
        const newTicket = await (0, promises_1.readFile)((0, node_path_1.join)(tempDir, ".tickets/impl/new.md"), "utf-8");
        (0, vitest_1.expect)(newTicket).toBe("# New ticket\n");
    });
    (0, vitest_1.it)("scaffolds the travel template with variables", async () => {
        const travel = builtins_js_1.BUILTIN_TEMPLATES.find((t) => t.id === "travel");
        const result = await (0, scaffold_js_1.scaffoldFromTemplate)({
            projectDir: tempDir,
            template: travel,
            variables: {
                name: "Japan Trip",
                description: "Two weeks in Japan",
                destination: "Japan (Tokyo + Kyoto)",
                dates: "May 12-20, 2026",
                travelers: "2",
            },
        });
        (0, vitest_1.expect)(result.ticketCount).toBe(4);
        (0, vitest_1.expect)(result.agentsMdWritten).toBe(true);
        // Check variable substitution in tickets
        const flights = await (0, promises_1.readFile)((0, node_path_1.join)(tempDir, ".tickets/impl/book-flights.md"), "utf-8");
        (0, vitest_1.expect)(flights).toContain("Japan (Tokyo + Kyoto)");
        (0, vitest_1.expect)(flights).toContain("2 traveler(s)");
        (0, vitest_1.expect)(flights).toContain("May 12-20, 2026");
        // Check AGENTS.md
        const agentsMd = await (0, promises_1.readFile)((0, node_path_1.join)(tempDir, "AGENTS.md"), "utf-8");
        (0, vitest_1.expect)(agentsMd).toContain("Japan Trip");
        (0, vitest_1.expect)(agentsMd).toContain("Japan (Tokyo + Kyoto)");
        // Check directories
        (0, vitest_1.expect)((0, node_fs_1.existsSync)((0, node_path_1.join)(tempDir, "docs/research"))).toBe(true);
    });
    (0, vitest_1.it)("scaffolds the software template without variables", async () => {
        const software = builtins_js_1.BUILTIN_TEMPLATES.find((t) => t.id === "software");
        const result = await (0, scaffold_js_1.scaffoldFromTemplate)({
            projectDir: tempDir,
            template: software,
            variables: { name: "My App", description: "A cool app" },
        });
        (0, vitest_1.expect)(result.ticketCount).toBe(3);
        (0, vitest_1.expect)(result.agentsMdWritten).toBe(true);
        // Tickets have proper frontmatter
        const ci = await (0, promises_1.readFile)((0, node_path_1.join)(tempDir, ".tickets/impl/setup-ci.md"), "utf-8");
        (0, vitest_1.expect)(ci).toContain("id: setup-ci");
        (0, vitest_1.expect)(ci).toContain("status: open");
        // AGENTS.md has project info
        const agentsMd = await (0, promises_1.readFile)((0, node_path_1.join)(tempDir, "AGENTS.md"), "utf-8");
        (0, vitest_1.expect)(agentsMd).toContain("My App");
        (0, vitest_1.expect)(agentsMd).toContain("A cool app");
    });
});
//# sourceMappingURL=scaffold.test.js.map