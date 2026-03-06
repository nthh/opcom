import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { IntegrationModule, IntegrationsConfig } from "@opcom/types";

function makeMod(
  id: string,
  category: IntegrationModule["category"],
  overrides?: Partial<IntegrationModule>,
): IntegrationModule {
  return {
    id,
    category,
    name: id,
    description: `${id} module`,
    init: vi.fn(async () => {}),
    teardown: vi.fn(async () => {}),
    ...overrides,
  };
}

describe("IntegrationRegistry", () => {
  let tempDir: string;
  let originalHome: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "opcom-registry-"));
    originalHome = process.env.HOME!;
    process.env.HOME = tempDir;
  });

  afterEach(async () => {
    process.env.HOME = originalHome;
    await rm(tempDir, { recursive: true, force: true });
  });

  it("registers and lists modules", async () => {
    const { IntegrationRegistry } = await import("@opcom/core");
    const registry = new IntegrationRegistry();

    const mod1 = makeMod("tickets", "work-sources");
    const mod2 = makeMod("github-actions", "cicd");
    registry.register(mod1);
    registry.register(mod2);

    const list = registry.list();
    expect(list).toHaveLength(2);
    expect(list[0].id).toBe("tickets");
    expect(list[0].enabled).toBe(false);
    expect(list[1].id).toBe("github-actions");
  });

  it("gets a module by id", async () => {
    const { IntegrationRegistry } = await import("@opcom/core");
    const registry = new IntegrationRegistry();

    const mod = makeMod("tickets", "work-sources");
    registry.register(mod);

    expect(registry.get("tickets")).toBe(mod);
    expect(registry.get("nonexistent")).toBeUndefined();
  });

  it("lists modules by category", async () => {
    const { IntegrationRegistry } = await import("@opcom/core");
    const registry = new IntegrationRegistry();

    registry.register(makeMod("tickets", "work-sources"));
    registry.register(makeMod("jira", "work-sources"));
    registry.register(makeMod("github-actions", "cicd"));

    const workSources = registry.listByCategory("work-sources");
    expect(workSources).toHaveLength(2);
    expect(workSources.map((m) => m.id)).toEqual(["tickets", "jira"]);

    const cicd = registry.listByCategory("cicd");
    expect(cicd).toHaveLength(1);
    expect(cicd[0].id).toBe("github-actions");
  });

  it("enables all modules when config is undefined (backwards compat)", async () => {
    const { IntegrationRegistry } = await import("@opcom/core");
    const registry = new IntegrationRegistry();

    const mod1 = makeMod("tickets", "work-sources");
    const mod2 = makeMod("github-actions", "cicd");
    registry.register(mod1);
    registry.register(mod2);

    await registry.initFromConfig(undefined);

    expect(registry.isEnabled("tickets")).toBe(true);
    expect(registry.isEnabled("github-actions")).toBe(true);
    expect(mod1.init).toHaveBeenCalled();
    expect(mod2.init).toHaveBeenCalled();
  });

  it("enables only listed modules from config", async () => {
    const { IntegrationRegistry } = await import("@opcom/core");
    const registry = new IntegrationRegistry();

    const mod1 = makeMod("tickets", "work-sources");
    const mod2 = makeMod("jira", "work-sources");
    const mod3 = makeMod("github-actions", "cicd");
    registry.register(mod1);
    registry.register(mod2);
    registry.register(mod3);

    const config: IntegrationsConfig = {
      "work-sources": ["tickets"],
      // cicd not specified — defaults to all enabled
    };

    await registry.initFromConfig(config);

    expect(registry.isEnabled("tickets")).toBe(true);
    expect(registry.isEnabled("jira")).toBe(false);
    expect(registry.isEnabled("github-actions")).toBe(true); // category not specified, default enabled
    expect(mod1.init).toHaveBeenCalled();
    expect(mod2.init).not.toHaveBeenCalled();
    expect(mod3.init).toHaveBeenCalled();
  });

  it("disables all in a category when config has empty array", async () => {
    const { IntegrationRegistry } = await import("@opcom/core");
    const registry = new IntegrationRegistry();

    const mod1 = makeMod("tickets", "work-sources");
    const mod2 = makeMod("jira", "work-sources");
    registry.register(mod1);
    registry.register(mod2);

    const config: IntegrationsConfig = {
      "work-sources": [],
    };

    await registry.initFromConfig(config);

    expect(registry.isEnabled("tickets")).toBe(false);
    expect(registry.isEnabled("jira")).toBe(false);
  });

  it("enables and disables individual modules", async () => {
    const { IntegrationRegistry } = await import("@opcom/core");
    const registry = new IntegrationRegistry();

    const mod = makeMod("tickets", "work-sources");
    registry.register(mod);

    await registry.enable("tickets");
    expect(registry.isEnabled("tickets")).toBe(true);
    expect(mod.init).toHaveBeenCalledTimes(1);

    // Enabling again is a no-op
    await registry.enable("tickets");
    expect(mod.init).toHaveBeenCalledTimes(1);

    await registry.disable("tickets");
    expect(registry.isEnabled("tickets")).toBe(false);
    expect(mod.teardown).toHaveBeenCalledTimes(1);

    // Disabling again is a no-op
    await registry.disable("tickets");
    expect(mod.teardown).toHaveBeenCalledTimes(1);
  });

  it("throws on enable/disable of unknown module", async () => {
    const { IntegrationRegistry } = await import("@opcom/core");
    const registry = new IntegrationRegistry();

    await expect(registry.enable("nonexistent")).rejects.toThrow("Unknown integration");
    await expect(registry.disable("nonexistent")).rejects.toThrow("Unknown integration");
  });

  it("tears down all active modules", async () => {
    const { IntegrationRegistry } = await import("@opcom/core");
    const registry = new IntegrationRegistry();

    const mod1 = makeMod("tickets", "work-sources");
    const mod2 = makeMod("github-actions", "cicd");
    registry.register(mod1);
    registry.register(mod2);

    await registry.initFromConfig(undefined);
    expect(registry.isEnabled("tickets")).toBe(true);
    expect(registry.isEnabled("github-actions")).toBe(true);

    await registry.teardownAll();
    expect(registry.isEnabled("tickets")).toBe(false);
    expect(registry.isEnabled("github-actions")).toBe(false);
    expect(mod1.teardown).toHaveBeenCalled();
    expect(mod2.teardown).toHaveBeenCalled();
  });

  it("produces a config snapshot from current state", async () => {
    const { IntegrationRegistry } = await import("@opcom/core");
    const registry = new IntegrationRegistry();

    registry.register(makeMod("tickets", "work-sources"));
    registry.register(makeMod("jira", "work-sources"));
    registry.register(makeMod("github-actions", "cicd"));

    await registry.enable("tickets");
    await registry.enable("github-actions");

    const config = registry.toConfig();
    expect(config["work-sources"]).toEqual(["tickets"]);
    expect(config.cicd).toEqual(["github-actions"]);
    // jira not enabled, so work-sources should only have tickets
    expect(config["work-sources"]).not.toContain("jira");
  });

  it("passes module config to init", async () => {
    const { IntegrationRegistry } = await import("@opcom/core");
    const registry = new IntegrationRegistry();

    const mod = makeMod("slack-webhook", "notifications");
    registry.register(mod);

    await registry.initFromConfig(
      { notifications: ["slack-webhook"] },
      { "slack-webhook": { url: "https://hooks.slack.com/test" } },
    );

    expect(mod.init).toHaveBeenCalledWith({ url: "https://hooks.slack.com/test" });
  });

  it("builtinModules covers expected categories", async () => {
    const { builtinModules } = await import("@opcom/core");

    const categories = new Set(builtinModules.map((m) => m.category));
    expect(categories).toContain("work-sources");
    expect(categories).toContain("notifications");
    expect(categories).toContain("cicd");
    expect(categories).toContain("agent-backends");
    expect(categories).toContain("features");
  });

  it("defaultIntegrationsConfig includes all builtin module ids", async () => {
    const { builtinModules, defaultIntegrationsConfig } = await import("@opcom/core");

    const config = defaultIntegrationsConfig();
    const allIds = builtinModules.map((m) => m.id);
    const configIds = Object.values(config).flat();

    for (const id of allIds) {
      expect(configIds).toContain(id);
    }
  });

  it("validateIntegrationsConfig parses valid data", async () => {
    const { validateIntegrationsConfig } = await import("@opcom/core");

    const config = validateIntegrationsConfig({
      "work-sources": ["tickets", "github-issues"],
      notifications: ["slack-webhook"],
      cicd: ["github-actions"],
    });

    expect(config).toEqual({
      "work-sources": ["tickets", "github-issues"],
      notifications: ["slack-webhook"],
      cicd: ["github-actions"],
    });
  });

  it("validateIntegrationsConfig returns undefined for empty/null", async () => {
    const { validateIntegrationsConfig } = await import("@opcom/core");

    expect(validateIntegrationsConfig(null)).toBeUndefined();
    expect(validateIntegrationsConfig(undefined)).toBeUndefined();
    expect(validateIntegrationsConfig({})).toBeUndefined();
  });

  it("validateIntegrationsConfig filters non-string values", async () => {
    const { validateIntegrationsConfig } = await import("@opcom/core");

    const config = validateIntegrationsConfig({
      "work-sources": ["tickets", 42, null, "jira"],
    });

    expect(config!["work-sources"]).toEqual(["tickets", "jira"]);
  });

  it("integrations config roundtrips through global config", async () => {
    const { ensureOpcomDirs, loadGlobalConfig, saveGlobalConfig } = await import("@opcom/core");
    await ensureOpcomDirs();

    let global = await loadGlobalConfig();
    global.integrations = {
      "work-sources": ["tickets"],
      cicd: ["github-actions"],
    };
    await saveGlobalConfig(global);

    const reloaded = await loadGlobalConfig();
    expect(reloaded.integrations).toEqual({
      "work-sources": ["tickets"],
      cicd: ["github-actions"],
    });
  });
});
