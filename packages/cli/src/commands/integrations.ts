import {
  builtinModules,
  loadGlobalConfig,
  saveGlobalConfig,
} from "@opcom/core";
import type { IntegrationsConfig, IntegrationCategory } from "@opcom/types";

export async function runIntegrationsList(): Promise<void> {
  const global = await loadGlobalConfig();
  const config = global.integrations;

  // Determine which are enabled based on config
  const enabledIds = new Set<string>();
  for (const mod of builtinModules) {
    const categoryList = config?.[mod.category as keyof IntegrationsConfig];
    if (categoryList === undefined) {
      // Not specified — enabled by default
      enabledIds.add(mod.id);
    } else if (Array.isArray(categoryList) && categoryList.includes(mod.id)) {
      enabledIds.add(mod.id);
    }
  }

  console.log("\n  opcom integrations\n");

  const categories: IntegrationCategory[] = ["work-sources", "notifications", "cicd", "agent-backends", "features"];
  for (const category of categories) {
    const mods = builtinModules.filter((m) => m.category === category);
    if (mods.length === 0) continue;

    console.log(`  [${category}]`);
    for (const mod of mods) {
      const status = enabledIds.has(mod.id) ? "enabled" : "disabled";
      const marker = enabledIds.has(mod.id) ? "+" : "-";
      console.log(`    ${marker} ${mod.id} — ${mod.name} (${status})`);
      console.log(`      ${mod.description}`);
    }
  }
  console.log();
}

export async function runIntegrationsEnable(id: string): Promise<void> {
  const mod = builtinModules.find((m) => m.id === id);
  if (!mod) {
    console.error(`  Unknown integration: ${id}`);
    console.error(`  Run 'opcom integrations list' to see available integrations.`);
    process.exit(1);
  }

  const global = await loadGlobalConfig();
  if (!global.integrations) {
    // Initialize from defaults (all enabled)
    global.integrations = {};
    const categories: IntegrationCategory[] = ["work-sources", "notifications", "cicd", "agent-backends", "features"];
    for (const cat of categories) {
      const mods = builtinModules.filter((m) => m.category === cat);
      if (mods.length > 0) {
        global.integrations[cat as keyof IntegrationsConfig] = mods.map((m) => m.id);
      }
    }
  }

  const key = mod.category as keyof IntegrationsConfig;
  if (!global.integrations[key]) {
    global.integrations[key] = [];
  }

  if (!global.integrations[key]!.includes(id)) {
    global.integrations[key]!.push(id);
  }

  await saveGlobalConfig(global);
  console.log(`  Enabled: ${id} (${mod.name})`);
  console.log(`  Takes effect on next station start.`);
}

export async function runIntegrationsDisable(id: string): Promise<void> {
  const mod = builtinModules.find((m) => m.id === id);
  if (!mod) {
    console.error(`  Unknown integration: ${id}`);
    console.error(`  Run 'opcom integrations list' to see available integrations.`);
    process.exit(1);
  }

  const global = await loadGlobalConfig();
  if (!global.integrations) {
    // Initialize from defaults, then remove
    global.integrations = {};
    const categories: IntegrationCategory[] = ["work-sources", "notifications", "cicd", "agent-backends", "features"];
    for (const cat of categories) {
      const mods = builtinModules.filter((m) => m.category === cat);
      if (mods.length > 0) {
        global.integrations[cat as keyof IntegrationsConfig] = mods.map((m) => m.id);
      }
    }
  }

  const key = mod.category as keyof IntegrationsConfig;
  if (global.integrations[key]) {
    global.integrations[key] = global.integrations[key]!.filter((x) => x !== id);
  }

  await saveGlobalConfig(global);
  console.log(`  Disabled: ${id} (${mod.name})`);
  console.log(`  Takes effect on next station start.`);
}
