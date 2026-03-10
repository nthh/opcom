"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const promises_1 = require("node:fs/promises");
const node_path_1 = require("node:path");
const node_os_1 = require("node:os");
function makeMod(id, category, overrides) {
    return {
        id,
        category,
        name: id,
        description: `${id} module`,
        init: vitest_1.vi.fn(async () => { }),
        teardown: vitest_1.vi.fn(async () => { }),
        ...overrides,
    };
}
(0, vitest_1.describe)("IntegrationRegistry", () => {
    let tempDir;
    let originalHome;
    (0, vitest_1.beforeEach)(async () => {
        tempDir = await (0, promises_1.mkdtemp)((0, node_path_1.join)((0, node_os_1.tmpdir)(), "opcom-registry-"));
        originalHome = process.env.HOME;
        process.env.HOME = tempDir;
    });
    (0, vitest_1.afterEach)(async () => {
        process.env.HOME = originalHome;
        await (0, promises_1.rm)(tempDir, { recursive: true, force: true });
    });
    (0, vitest_1.it)("registers and lists modules", async () => {
        const { IntegrationRegistry } = await import("@opcom/core");
        const registry = new IntegrationRegistry();
        const mod1 = makeMod("tickets", "work-sources");
        const mod2 = makeMod("github-actions", "cicd");
        registry.register(mod1);
        registry.register(mod2);
        const list = registry.list();
        (0, vitest_1.expect)(list).toHaveLength(2);
        (0, vitest_1.expect)(list[0].id).toBe("tickets");
        (0, vitest_1.expect)(list[0].enabled).toBe(false);
        (0, vitest_1.expect)(list[1].id).toBe("github-actions");
    });
    (0, vitest_1.it)("gets a module by id", async () => {
        const { IntegrationRegistry } = await import("@opcom/core");
        const registry = new IntegrationRegistry();
        const mod = makeMod("tickets", "work-sources");
        registry.register(mod);
        (0, vitest_1.expect)(registry.get("tickets")).toBe(mod);
        (0, vitest_1.expect)(registry.get("nonexistent")).toBeUndefined();
    });
    (0, vitest_1.it)("lists modules by category", async () => {
        const { IntegrationRegistry } = await import("@opcom/core");
        const registry = new IntegrationRegistry();
        registry.register(makeMod("tickets", "work-sources"));
        registry.register(makeMod("jira", "work-sources"));
        registry.register(makeMod("github-actions", "cicd"));
        const workSources = registry.listByCategory("work-sources");
        (0, vitest_1.expect)(workSources).toHaveLength(2);
        (0, vitest_1.expect)(workSources.map((m) => m.id)).toEqual(["tickets", "jira"]);
        const cicd = registry.listByCategory("cicd");
        (0, vitest_1.expect)(cicd).toHaveLength(1);
        (0, vitest_1.expect)(cicd[0].id).toBe("github-actions");
    });
    (0, vitest_1.it)("enables all modules when config is undefined (backwards compat)", async () => {
        const { IntegrationRegistry } = await import("@opcom/core");
        const registry = new IntegrationRegistry();
        const mod1 = makeMod("tickets", "work-sources");
        const mod2 = makeMod("github-actions", "cicd");
        registry.register(mod1);
        registry.register(mod2);
        await registry.initFromConfig(undefined);
        (0, vitest_1.expect)(registry.isEnabled("tickets")).toBe(true);
        (0, vitest_1.expect)(registry.isEnabled("github-actions")).toBe(true);
        (0, vitest_1.expect)(mod1.init).toHaveBeenCalled();
        (0, vitest_1.expect)(mod2.init).toHaveBeenCalled();
    });
    (0, vitest_1.it)("enables only listed modules from config", async () => {
        const { IntegrationRegistry } = await import("@opcom/core");
        const registry = new IntegrationRegistry();
        const mod1 = makeMod("tickets", "work-sources");
        const mod2 = makeMod("jira", "work-sources");
        const mod3 = makeMod("github-actions", "cicd");
        registry.register(mod1);
        registry.register(mod2);
        registry.register(mod3);
        const config = {
            "work-sources": ["tickets"],
            // cicd not specified — defaults to all enabled
        };
        await registry.initFromConfig(config);
        (0, vitest_1.expect)(registry.isEnabled("tickets")).toBe(true);
        (0, vitest_1.expect)(registry.isEnabled("jira")).toBe(false);
        (0, vitest_1.expect)(registry.isEnabled("github-actions")).toBe(true); // category not specified, default enabled
        (0, vitest_1.expect)(mod1.init).toHaveBeenCalled();
        (0, vitest_1.expect)(mod2.init).not.toHaveBeenCalled();
        (0, vitest_1.expect)(mod3.init).toHaveBeenCalled();
    });
    (0, vitest_1.it)("disables all in a category when config has empty array", async () => {
        const { IntegrationRegistry } = await import("@opcom/core");
        const registry = new IntegrationRegistry();
        const mod1 = makeMod("tickets", "work-sources");
        const mod2 = makeMod("jira", "work-sources");
        registry.register(mod1);
        registry.register(mod2);
        const config = {
            "work-sources": [],
        };
        await registry.initFromConfig(config);
        (0, vitest_1.expect)(registry.isEnabled("tickets")).toBe(false);
        (0, vitest_1.expect)(registry.isEnabled("jira")).toBe(false);
    });
    (0, vitest_1.it)("enables and disables individual modules", async () => {
        const { IntegrationRegistry } = await import("@opcom/core");
        const registry = new IntegrationRegistry();
        const mod = makeMod("tickets", "work-sources");
        registry.register(mod);
        await registry.enable("tickets");
        (0, vitest_1.expect)(registry.isEnabled("tickets")).toBe(true);
        (0, vitest_1.expect)(mod.init).toHaveBeenCalledTimes(1);
        // Enabling again is a no-op
        await registry.enable("tickets");
        (0, vitest_1.expect)(mod.init).toHaveBeenCalledTimes(1);
        await registry.disable("tickets");
        (0, vitest_1.expect)(registry.isEnabled("tickets")).toBe(false);
        (0, vitest_1.expect)(mod.teardown).toHaveBeenCalledTimes(1);
        // Disabling again is a no-op
        await registry.disable("tickets");
        (0, vitest_1.expect)(mod.teardown).toHaveBeenCalledTimes(1);
    });
    (0, vitest_1.it)("throws on enable/disable of unknown module", async () => {
        const { IntegrationRegistry } = await import("@opcom/core");
        const registry = new IntegrationRegistry();
        await (0, vitest_1.expect)(registry.enable("nonexistent")).rejects.toThrow("Unknown integration");
        await (0, vitest_1.expect)(registry.disable("nonexistent")).rejects.toThrow("Unknown integration");
    });
    (0, vitest_1.it)("tears down all active modules", async () => {
        const { IntegrationRegistry } = await import("@opcom/core");
        const registry = new IntegrationRegistry();
        const mod1 = makeMod("tickets", "work-sources");
        const mod2 = makeMod("github-actions", "cicd");
        registry.register(mod1);
        registry.register(mod2);
        await registry.initFromConfig(undefined);
        (0, vitest_1.expect)(registry.isEnabled("tickets")).toBe(true);
        (0, vitest_1.expect)(registry.isEnabled("github-actions")).toBe(true);
        await registry.teardownAll();
        (0, vitest_1.expect)(registry.isEnabled("tickets")).toBe(false);
        (0, vitest_1.expect)(registry.isEnabled("github-actions")).toBe(false);
        (0, vitest_1.expect)(mod1.teardown).toHaveBeenCalled();
        (0, vitest_1.expect)(mod2.teardown).toHaveBeenCalled();
    });
    (0, vitest_1.it)("produces a config snapshot from current state", async () => {
        const { IntegrationRegistry } = await import("@opcom/core");
        const registry = new IntegrationRegistry();
        registry.register(makeMod("tickets", "work-sources"));
        registry.register(makeMod("jira", "work-sources"));
        registry.register(makeMod("github-actions", "cicd"));
        await registry.enable("tickets");
        await registry.enable("github-actions");
        const config = registry.toConfig();
        (0, vitest_1.expect)(config["work-sources"]).toEqual(["tickets"]);
        (0, vitest_1.expect)(config.cicd).toEqual(["github-actions"]);
        // jira not enabled, so work-sources should only have tickets
        (0, vitest_1.expect)(config["work-sources"]).not.toContain("jira");
    });
    (0, vitest_1.it)("passes module config to init", async () => {
        const { IntegrationRegistry } = await import("@opcom/core");
        const registry = new IntegrationRegistry();
        const mod = makeMod("slack-webhook", "notifications");
        registry.register(mod);
        await registry.initFromConfig({ notifications: ["slack-webhook"] }, { "slack-webhook": { url: "https://hooks.slack.com/test" } });
        (0, vitest_1.expect)(mod.init).toHaveBeenCalledWith({ url: "https://hooks.slack.com/test" });
    });
    (0, vitest_1.it)("builtinModules covers expected categories", async () => {
        const { builtinModules } = await import("@opcom/core");
        const categories = new Set(builtinModules.map((m) => m.category));
        (0, vitest_1.expect)(categories).toContain("work-sources");
        (0, vitest_1.expect)(categories).toContain("notifications");
        (0, vitest_1.expect)(categories).toContain("cicd");
        (0, vitest_1.expect)(categories).toContain("agent-backends");
        (0, vitest_1.expect)(categories).toContain("features");
    });
    (0, vitest_1.it)("defaultIntegrationsConfig includes all builtin module ids", async () => {
        const { builtinModules, defaultIntegrationsConfig } = await import("@opcom/core");
        const config = defaultIntegrationsConfig();
        const allIds = builtinModules.map((m) => m.id);
        const configIds = Object.values(config).flat();
        for (const id of allIds) {
            (0, vitest_1.expect)(configIds).toContain(id);
        }
    });
    (0, vitest_1.it)("validateIntegrationsConfig parses valid data", async () => {
        const { validateIntegrationsConfig } = await import("@opcom/core");
        const config = validateIntegrationsConfig({
            "work-sources": ["tickets", "github-issues"],
            notifications: ["slack-webhook"],
            cicd: ["github-actions"],
        });
        (0, vitest_1.expect)(config).toEqual({
            "work-sources": ["tickets", "github-issues"],
            notifications: ["slack-webhook"],
            cicd: ["github-actions"],
        });
    });
    (0, vitest_1.it)("validateIntegrationsConfig returns undefined for empty/null", async () => {
        const { validateIntegrationsConfig } = await import("@opcom/core");
        (0, vitest_1.expect)(validateIntegrationsConfig(null)).toBeUndefined();
        (0, vitest_1.expect)(validateIntegrationsConfig(undefined)).toBeUndefined();
        (0, vitest_1.expect)(validateIntegrationsConfig({})).toBeUndefined();
    });
    (0, vitest_1.it)("validateIntegrationsConfig filters non-string values", async () => {
        const { validateIntegrationsConfig } = await import("@opcom/core");
        const config = validateIntegrationsConfig({
            "work-sources": ["tickets", 42, null, "jira"],
        });
        (0, vitest_1.expect)(config["work-sources"]).toEqual(["tickets", "jira"]);
    });
    (0, vitest_1.it)("integrations config roundtrips through global config", async () => {
        const { ensureOpcomDirs, loadGlobalConfig, saveGlobalConfig } = await import("@opcom/core");
        await ensureOpcomDirs();
        let global = await loadGlobalConfig();
        global.integrations = {
            "work-sources": ["tickets"],
            cicd: ["github-actions"],
        };
        await saveGlobalConfig(global);
        const reloaded = await loadGlobalConfig();
        (0, vitest_1.expect)(reloaded.integrations).toEqual({
            "work-sources": ["tickets"],
            cicd: ["github-actions"],
        });
    });
});
//# sourceMappingURL=registry.test.js.map