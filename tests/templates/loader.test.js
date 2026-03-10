"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const promises_1 = require("node:fs/promises");
const node_path_1 = require("node:path");
const node_os_1 = require("node:os");
const yaml_1 = require("yaml");
const loader_js_1 = require("../../packages/core/src/templates/loader.js");
const builtins_js_1 = require("../../packages/core/src/templates/builtins.js");
(0, vitest_1.describe)("loadTemplateFromDir", () => {
    let tempDir;
    (0, vitest_1.beforeEach)(async () => {
        tempDir = await (0, promises_1.mkdtemp)((0, node_path_1.join)((0, node_os_1.tmpdir)(), "opcom-tpl-"));
    });
    (0, vitest_1.afterEach)(async () => {
        await (0, promises_1.rm)(tempDir, { recursive: true, force: true });
    });
    (0, vitest_1.it)("loads a template from a directory", async () => {
        const templateDir = (0, node_path_1.join)(tempDir, "my-template");
        await (0, promises_1.mkdir)((0, node_path_1.join)(templateDir, "tickets"), { recursive: true });
        await (0, promises_1.writeFile)((0, node_path_1.join)(templateDir, "template.yaml"), (0, yaml_1.stringify)({
            id: "my-template",
            name: "My Template",
            description: "A test template",
            tags: ["test"],
            variables: [{ name: "foo", prompt: "Enter foo" }],
            directories: ["docs"],
        }));
        await (0, promises_1.writeFile)((0, node_path_1.join)(templateDir, "AGENTS.md"), "# {{name}}\n\nAgent config for {{foo}}.\n");
        await (0, promises_1.writeFile)((0, node_path_1.join)(templateDir, "tickets/task-one.md"), "# Task: {{foo}}\n");
        const template = await (0, loader_js_1.loadTemplateFromDir)(templateDir);
        (0, vitest_1.expect)(template.id).toBe("my-template");
        (0, vitest_1.expect)(template.name).toBe("My Template");
        (0, vitest_1.expect)(template.description).toBe("A test template");
        (0, vitest_1.expect)(template.tags).toEqual(["test"]);
        (0, vitest_1.expect)(template.variables).toHaveLength(1);
        (0, vitest_1.expect)(template.variables[0].name).toBe("foo");
        (0, vitest_1.expect)(template.directories).toEqual(["docs"]);
        (0, vitest_1.expect)(template.agentsMd).toContain("{{name}}");
        (0, vitest_1.expect)(template.tickets["task-one.md"]).toContain("{{foo}}");
    });
    (0, vitest_1.it)("throws if no template.yaml", async () => {
        const templateDir = (0, node_path_1.join)(tempDir, "empty");
        await (0, promises_1.mkdir)(templateDir, { recursive: true });
        await (0, vitest_1.expect)((0, loader_js_1.loadTemplateFromDir)(templateDir)).rejects.toThrow("No template.yaml");
    });
    (0, vitest_1.it)("provides default AGENTS.md if missing", async () => {
        const templateDir = (0, node_path_1.join)(tempDir, "no-agents");
        await (0, promises_1.mkdir)(templateDir, { recursive: true });
        await (0, promises_1.writeFile)((0, node_path_1.join)(templateDir, "template.yaml"), (0, yaml_1.stringify)({ id: "no-agents", name: "No Agents", description: "Test" }));
        const template = await (0, loader_js_1.loadTemplateFromDir)(templateDir);
        (0, vitest_1.expect)(template.agentsMd).toContain("{{name}}");
        (0, vitest_1.expect)(template.agentsMd).toContain("{{description}}");
    });
    (0, vitest_1.it)("handles template with no tickets directory", async () => {
        const templateDir = (0, node_path_1.join)(tempDir, "no-tickets");
        await (0, promises_1.mkdir)(templateDir, { recursive: true });
        await (0, promises_1.writeFile)((0, node_path_1.join)(templateDir, "template.yaml"), (0, yaml_1.stringify)({ id: "no-tickets", name: "No Tickets", description: "Test" }));
        const template = await (0, loader_js_1.loadTemplateFromDir)(templateDir);
        (0, vitest_1.expect)(Object.keys(template.tickets)).toHaveLength(0);
    });
});
(0, vitest_1.describe)("loadUserTemplates", () => {
    let tempDir;
    let originalHome;
    (0, vitest_1.beforeEach)(async () => {
        tempDir = await (0, promises_1.mkdtemp)((0, node_path_1.join)((0, node_os_1.tmpdir)(), "opcom-user-tpl-"));
        originalHome = process.env.HOME;
        process.env.HOME = tempDir;
    });
    (0, vitest_1.afterEach)(async () => {
        process.env.HOME = originalHome;
        await (0, promises_1.rm)(tempDir, { recursive: true, force: true });
    });
    (0, vitest_1.it)("returns empty array when templates dir does not exist", async () => {
        const templates = await (0, loader_js_1.loadUserTemplates)();
        (0, vitest_1.expect)(templates).toHaveLength(0);
    });
    (0, vitest_1.it)("loads user templates from ~/.opcom/templates/", async () => {
        const tplDir = (0, node_path_1.join)(tempDir, ".opcom/templates/custom");
        await (0, promises_1.mkdir)(tplDir, { recursive: true });
        await (0, promises_1.writeFile)((0, node_path_1.join)(tplDir, "template.yaml"), (0, yaml_1.stringify)({ id: "custom", name: "Custom", description: "Custom template" }));
        const templates = await (0, loader_js_1.loadUserTemplates)();
        (0, vitest_1.expect)(templates).toHaveLength(1);
        (0, vitest_1.expect)(templates[0].id).toBe("custom");
    });
    (0, vitest_1.it)("skips directories without template.yaml", async () => {
        const tplDir = (0, node_path_1.join)(tempDir, ".opcom/templates/invalid");
        await (0, promises_1.mkdir)(tplDir, { recursive: true });
        await (0, promises_1.writeFile)((0, node_path_1.join)(tplDir, "README.md"), "# Not a template\n");
        const templates = await (0, loader_js_1.loadUserTemplates)();
        (0, vitest_1.expect)(templates).toHaveLength(0);
    });
});
(0, vitest_1.describe)("loadAllTemplates", () => {
    let tempDir;
    let originalHome;
    (0, vitest_1.beforeEach)(async () => {
        tempDir = await (0, promises_1.mkdtemp)((0, node_path_1.join)((0, node_os_1.tmpdir)(), "opcom-all-tpl-"));
        originalHome = process.env.HOME;
        process.env.HOME = tempDir;
    });
    (0, vitest_1.afterEach)(async () => {
        process.env.HOME = originalHome;
        await (0, promises_1.rm)(tempDir, { recursive: true, force: true });
    });
    (0, vitest_1.it)("includes built-in templates when no user templates exist", async () => {
        const templates = await (0, loader_js_1.loadAllTemplates)();
        (0, vitest_1.expect)(templates.length).toBe(builtins_js_1.BUILTIN_TEMPLATES.length);
        const ids = templates.map((t) => t.id);
        (0, vitest_1.expect)(ids).toContain("software");
        (0, vitest_1.expect)(ids).toContain("travel");
    });
    (0, vitest_1.it)("user template overrides built-in with same id", async () => {
        const tplDir = (0, node_path_1.join)(tempDir, ".opcom/templates/software");
        await (0, promises_1.mkdir)(tplDir, { recursive: true });
        await (0, promises_1.writeFile)((0, node_path_1.join)(tplDir, "template.yaml"), (0, yaml_1.stringify)({ id: "software", name: "Custom Software", description: "My custom software template" }));
        const templates = await (0, loader_js_1.loadAllTemplates)();
        const software = templates.find((t) => t.id === "software");
        (0, vitest_1.expect)(software.name).toBe("Custom Software");
        (0, vitest_1.expect)(software.description).toBe("My custom software template");
    });
    (0, vitest_1.it)("includes both built-ins and user templates", async () => {
        const tplDir = (0, node_path_1.join)(tempDir, ".opcom/templates/marketing");
        await (0, promises_1.mkdir)(tplDir, { recursive: true });
        await (0, promises_1.writeFile)((0, node_path_1.join)(tplDir, "template.yaml"), (0, yaml_1.stringify)({ id: "marketing", name: "Marketing", description: "Marketing campaign" }));
        const templates = await (0, loader_js_1.loadAllTemplates)();
        const ids = templates.map((t) => t.id);
        (0, vitest_1.expect)(ids).toContain("software");
        (0, vitest_1.expect)(ids).toContain("marketing");
        (0, vitest_1.expect)(templates.length).toBe(builtins_js_1.BUILTIN_TEMPLATES.length + 1);
    });
});
(0, vitest_1.describe)("findTemplate", () => {
    let tempDir;
    let originalHome;
    (0, vitest_1.beforeEach)(async () => {
        tempDir = await (0, promises_1.mkdtemp)((0, node_path_1.join)((0, node_os_1.tmpdir)(), "opcom-find-tpl-"));
        originalHome = process.env.HOME;
        process.env.HOME = tempDir;
    });
    (0, vitest_1.afterEach)(async () => {
        process.env.HOME = originalHome;
        await (0, promises_1.rm)(tempDir, { recursive: true, force: true });
    });
    (0, vitest_1.it)("finds a built-in template by id", async () => {
        const template = await (0, loader_js_1.findTemplate)("travel");
        (0, vitest_1.expect)(template).not.toBeNull();
        (0, vitest_1.expect)(template.id).toBe("travel");
    });
    (0, vitest_1.it)("returns null for unknown template", async () => {
        const template = await (0, loader_js_1.findTemplate)("nonexistent");
        (0, vitest_1.expect)(template).toBeNull();
    });
    (0, vitest_1.it)("prefers user template over built-in", async () => {
        const tplDir = (0, node_path_1.join)(tempDir, ".opcom/templates/travel");
        await (0, promises_1.mkdir)(tplDir, { recursive: true });
        await (0, promises_1.writeFile)((0, node_path_1.join)(tplDir, "template.yaml"), (0, yaml_1.stringify)({ id: "travel", name: "My Travel", description: "Custom travel" }));
        const template = await (0, loader_js_1.findTemplate)("travel");
        (0, vitest_1.expect)(template.name).toBe("My Travel");
    });
});
//# sourceMappingURL=loader.test.js.map