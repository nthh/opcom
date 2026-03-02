import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

describe("settings", () => {
  let tempDir: string;
  let originalHome: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "opcom-settings-"));
    originalHome = process.env.HOME!;
    process.env.HOME = tempDir;
  });

  afterEach(async () => {
    process.env.HOME = originalHome;
    await rm(tempDir, { recursive: true, force: true });
  });

  it("returns default settings when none configured", async () => {
    const { defaultSettings } = await import("@opcom/core");
    const defaults = defaultSettings();

    expect(defaults.agent.backend).toBe("claude-code");
    expect(defaults.agent.worktree).toBe(false);
    expect(defaults.server.port).toBe(4700);
    expect(defaults.orchestrator.maxConcurrentAgents).toBe(2);
    expect(defaults.orchestrator.autoCommit).toBe(true);
    expect(defaults.notifications.enabled).toBe(false);
  });

  it("validates settings from raw data with defaults", async () => {
    const { validateSettings } = await import("@opcom/core");

    const settings = validateSettings({});
    expect(settings.agent.backend).toBe("claude-code");
    expect(settings.server.port).toBe(4700);
  });

  it("validates settings preserving configured values", async () => {
    const { validateSettings } = await import("@opcom/core");

    const settings = validateSettings({
      agent: { backend: "opencode", worktree: true },
      server: { port: 8080 },
    });

    expect(settings.agent.backend).toBe("opencode");
    expect(settings.agent.worktree).toBe(true);
    expect(settings.server.port).toBe(8080);
    // Non-specified values get defaults
    expect(settings.orchestrator.autoCommit).toBe(true);
  });

  it("gets a setting by dot-path key", async () => {
    const { defaultSettings, getSetting } = await import("@opcom/core");
    const settings = defaultSettings();

    expect(getSetting(settings, "agent.backend")).toBe("claude-code");
    expect(getSetting(settings, "server.port")).toBe(4700);
    expect(getSetting(settings, "orchestrator.maxConcurrentAgents")).toBe(2);
    expect(getSetting(settings, "notifications.enabled")).toBe(false);
  });

  it("returns undefined for unknown keys", async () => {
    const { defaultSettings, getSetting } = await import("@opcom/core");
    const settings = defaultSettings();

    expect(getSetting(settings, "unknown.key")).toBeUndefined();
  });

  it("sets a string setting", async () => {
    const { defaultSettings, setSetting, getSetting } = await import("@opcom/core");
    const settings = defaultSettings();

    const updated = setSetting(settings, "agent.backend", "opencode");
    expect(getSetting(updated, "agent.backend")).toBe("opencode");
    // Original not mutated
    expect(getSetting(settings, "agent.backend")).toBe("claude-code");
  });

  it("sets a boolean setting", async () => {
    const { defaultSettings, setSetting, getSetting } = await import("@opcom/core");
    const settings = defaultSettings();

    const updated = setSetting(settings, "agent.worktree", "true");
    expect(getSetting(updated, "agent.worktree")).toBe(true);

    const updated2 = setSetting(settings, "notifications.enabled", "yes");
    expect(getSetting(updated2, "notifications.enabled")).toBe(true);
  });

  it("sets a number setting", async () => {
    const { defaultSettings, setSetting, getSetting } = await import("@opcom/core");
    const settings = defaultSettings();

    const updated = setSetting(settings, "server.port", "8080");
    expect(getSetting(updated, "server.port")).toBe(8080);
  });

  it("rejects unknown setting keys", async () => {
    const { defaultSettings, setSetting } = await import("@opcom/core");
    const settings = defaultSettings();

    expect(() => setSetting(settings, "unknown.key", "val")).toThrow("Unknown setting");
  });

  it("rejects invalid enum values", async () => {
    const { defaultSettings, setSetting } = await import("@opcom/core");
    const settings = defaultSettings();

    expect(() => setSetting(settings, "agent.backend", "gpt4")).toThrow("must be one of");
  });

  it("rejects out-of-range numbers", async () => {
    const { defaultSettings, setSetting } = await import("@opcom/core");
    const settings = defaultSettings();

    expect(() => setSetting(settings, "server.port", "0")).toThrow(">= 1");
    expect(() => setSetting(settings, "server.port", "99999")).toThrow("<= 65535");
  });

  it("rejects invalid boolean strings", async () => {
    const { defaultSettings, setSetting } = await import("@opcom/core");
    const settings = defaultSettings();

    expect(() => setSetting(settings, "agent.worktree", "maybe")).toThrow("Invalid boolean");
  });

  it("rejects invalid number strings", async () => {
    const { defaultSettings, setSetting } = await import("@opcom/core");
    const settings = defaultSettings();

    expect(() => setSetting(settings, "server.port", "abc")).toThrow("Invalid number");
  });

  it("persists settings through global config roundtrip", async () => {
    const { ensureOpcomDirs, loadGlobalConfig, saveGlobalConfig, setSetting, getSetting } = await import("@opcom/core");
    await ensureOpcomDirs();

    // Load default config (creates defaults)
    let global = await loadGlobalConfig();
    expect(getSetting(global.settings, "server.port")).toBe(4700);

    // Modify and save
    global.settings = setSetting(global.settings, "server.port", "9000");
    global.settings = setSetting(global.settings, "agent.backend", "opencode");
    await saveGlobalConfig(global);

    // Reload and verify
    const reloaded = await loadGlobalConfig();
    expect(getSetting(reloaded.settings, "server.port")).toBe(9000);
    expect(getSetting(reloaded.settings, "agent.backend")).toBe("opencode");
    // Unchanged values should still be defaults
    expect(getSetting(reloaded.settings, "agent.worktree")).toBe(false);
  });

  it("settingsDefs covers all expected keys", async () => {
    const { settingsDefs } = await import("@opcom/core");

    const keys = settingsDefs.map((d) => d.key);
    expect(keys).toContain("agent.backend");
    expect(keys).toContain("agent.model");
    expect(keys).toContain("agent.worktree");
    expect(keys).toContain("server.port");
    expect(keys).toContain("orchestrator.maxConcurrentAgents");
    expect(keys).toContain("orchestrator.autoCommit");
    expect(keys).toContain("orchestrator.pauseOnFailure");
    expect(keys).toContain("orchestrator.runTests");
    expect(keys).toContain("orchestrator.runOracle");
    expect(keys).toContain("notifications.enabled");
    expect(keys).toHaveLength(10);
  });
});
