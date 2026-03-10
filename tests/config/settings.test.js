"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const promises_1 = require("node:fs/promises");
const node_path_1 = require("node:path");
const node_os_1 = require("node:os");
(0, vitest_1.describe)("settings", () => {
    let tempDir;
    let originalHome;
    (0, vitest_1.beforeEach)(async () => {
        tempDir = await (0, promises_1.mkdtemp)((0, node_path_1.join)((0, node_os_1.tmpdir)(), "opcom-settings-"));
        originalHome = process.env.HOME;
        process.env.HOME = tempDir;
    });
    (0, vitest_1.afterEach)(async () => {
        process.env.HOME = originalHome;
        await (0, promises_1.rm)(tempDir, { recursive: true, force: true });
    });
    (0, vitest_1.it)("returns default settings when none configured", async () => {
        const { defaultSettings } = await import("@opcom/core");
        const defaults = defaultSettings();
        (0, vitest_1.expect)(defaults.agent.backend).toBe("claude-code");
        (0, vitest_1.expect)(defaults.agent.worktree).toBe(false);
        (0, vitest_1.expect)(defaults.server.port).toBe(4700);
        (0, vitest_1.expect)(defaults.orchestrator.maxConcurrentAgents).toBe(2);
        (0, vitest_1.expect)(defaults.orchestrator.autoCommit).toBe(true);
        (0, vitest_1.expect)(defaults.notifications.enabled).toBe(false);
    });
    (0, vitest_1.it)("validates settings from raw data with defaults", async () => {
        const { validateSettings } = await import("@opcom/core");
        const settings = validateSettings({});
        (0, vitest_1.expect)(settings.agent.backend).toBe("claude-code");
        (0, vitest_1.expect)(settings.server.port).toBe(4700);
    });
    (0, vitest_1.it)("validates settings preserving configured values", async () => {
        const { validateSettings } = await import("@opcom/core");
        const settings = validateSettings({
            agent: { backend: "opencode", worktree: true },
            server: { port: 8080 },
        });
        (0, vitest_1.expect)(settings.agent.backend).toBe("opencode");
        (0, vitest_1.expect)(settings.agent.worktree).toBe(true);
        (0, vitest_1.expect)(settings.server.port).toBe(8080);
        // Non-specified values get defaults
        (0, vitest_1.expect)(settings.orchestrator.autoCommit).toBe(true);
    });
    (0, vitest_1.it)("gets a setting by dot-path key", async () => {
        const { defaultSettings, getSetting } = await import("@opcom/core");
        const settings = defaultSettings();
        (0, vitest_1.expect)(getSetting(settings, "agent.backend")).toBe("claude-code");
        (0, vitest_1.expect)(getSetting(settings, "server.port")).toBe(4700);
        (0, vitest_1.expect)(getSetting(settings, "orchestrator.maxConcurrentAgents")).toBe(2);
        (0, vitest_1.expect)(getSetting(settings, "notifications.enabled")).toBe(false);
    });
    (0, vitest_1.it)("returns undefined for unknown keys", async () => {
        const { defaultSettings, getSetting } = await import("@opcom/core");
        const settings = defaultSettings();
        (0, vitest_1.expect)(getSetting(settings, "unknown.key")).toBeUndefined();
    });
    (0, vitest_1.it)("sets a string setting", async () => {
        const { defaultSettings, setSetting, getSetting } = await import("@opcom/core");
        const settings = defaultSettings();
        const updated = setSetting(settings, "agent.backend", "opencode");
        (0, vitest_1.expect)(getSetting(updated, "agent.backend")).toBe("opencode");
        // Original not mutated
        (0, vitest_1.expect)(getSetting(settings, "agent.backend")).toBe("claude-code");
    });
    (0, vitest_1.it)("sets a boolean setting", async () => {
        const { defaultSettings, setSetting, getSetting } = await import("@opcom/core");
        const settings = defaultSettings();
        const updated = setSetting(settings, "agent.worktree", "true");
        (0, vitest_1.expect)(getSetting(updated, "agent.worktree")).toBe(true);
        const updated2 = setSetting(settings, "notifications.enabled", "yes");
        (0, vitest_1.expect)(getSetting(updated2, "notifications.enabled")).toBe(true);
    });
    (0, vitest_1.it)("sets a number setting", async () => {
        const { defaultSettings, setSetting, getSetting } = await import("@opcom/core");
        const settings = defaultSettings();
        const updated = setSetting(settings, "server.port", "8080");
        (0, vitest_1.expect)(getSetting(updated, "server.port")).toBe(8080);
    });
    (0, vitest_1.it)("rejects unknown setting keys", async () => {
        const { defaultSettings, setSetting } = await import("@opcom/core");
        const settings = defaultSettings();
        (0, vitest_1.expect)(() => setSetting(settings, "unknown.key", "val")).toThrow("Unknown setting");
    });
    (0, vitest_1.it)("rejects invalid enum values", async () => {
        const { defaultSettings, setSetting } = await import("@opcom/core");
        const settings = defaultSettings();
        (0, vitest_1.expect)(() => setSetting(settings, "agent.backend", "gpt4")).toThrow("must be one of");
    });
    (0, vitest_1.it)("rejects out-of-range numbers", async () => {
        const { defaultSettings, setSetting } = await import("@opcom/core");
        const settings = defaultSettings();
        (0, vitest_1.expect)(() => setSetting(settings, "server.port", "0")).toThrow(">= 1");
        (0, vitest_1.expect)(() => setSetting(settings, "server.port", "99999")).toThrow("<= 65535");
    });
    (0, vitest_1.it)("rejects invalid boolean strings", async () => {
        const { defaultSettings, setSetting } = await import("@opcom/core");
        const settings = defaultSettings();
        (0, vitest_1.expect)(() => setSetting(settings, "agent.worktree", "maybe")).toThrow("Invalid boolean");
    });
    (0, vitest_1.it)("rejects invalid number strings", async () => {
        const { defaultSettings, setSetting } = await import("@opcom/core");
        const settings = defaultSettings();
        (0, vitest_1.expect)(() => setSetting(settings, "server.port", "abc")).toThrow("Invalid number");
    });
    (0, vitest_1.it)("persists settings through global config roundtrip", async () => {
        const { ensureOpcomDirs, loadGlobalConfig, saveGlobalConfig, setSetting, getSetting } = await import("@opcom/core");
        await ensureOpcomDirs();
        // Load default config (creates defaults)
        let global = await loadGlobalConfig();
        (0, vitest_1.expect)(getSetting(global.settings, "server.port")).toBe(4700);
        // Modify and save
        global.settings = setSetting(global.settings, "server.port", "9000");
        global.settings = setSetting(global.settings, "agent.backend", "opencode");
        await saveGlobalConfig(global);
        // Reload and verify
        const reloaded = await loadGlobalConfig();
        (0, vitest_1.expect)(getSetting(reloaded.settings, "server.port")).toBe(9000);
        (0, vitest_1.expect)(getSetting(reloaded.settings, "agent.backend")).toBe("opencode");
        // Unchanged values should still be defaults
        (0, vitest_1.expect)(getSetting(reloaded.settings, "agent.worktree")).toBe(false);
    });
    (0, vitest_1.it)("settingsDefs covers all expected keys", async () => {
        const { settingsDefs } = await import("@opcom/core");
        const keys = settingsDefs.map((d) => d.key);
        (0, vitest_1.expect)(keys).toContain("agent.backend");
        (0, vitest_1.expect)(keys).toContain("agent.model");
        (0, vitest_1.expect)(keys).toContain("agent.worktree");
        (0, vitest_1.expect)(keys).toContain("server.port");
        (0, vitest_1.expect)(keys).toContain("orchestrator.maxConcurrentAgents");
        (0, vitest_1.expect)(keys).toContain("orchestrator.autoCommit");
        (0, vitest_1.expect)(keys).toContain("orchestrator.pauseOnFailure");
        (0, vitest_1.expect)(keys).toContain("orchestrator.runTests");
        (0, vitest_1.expect)(keys).toContain("orchestrator.runOracle");
        (0, vitest_1.expect)(keys).toContain("orchestrator.maxRetries");
        (0, vitest_1.expect)(keys).toContain("orchestrator.autoRebase");
        (0, vitest_1.expect)(keys).toContain("notifications.enabled");
        (0, vitest_1.expect)(keys).toHaveLength(12);
    });
});
//# sourceMappingURL=settings.test.js.map