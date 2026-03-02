import {
  loadGlobalConfig,
  saveGlobalConfig,
  settingsDefs,
  getSetting,
  setSetting,
} from "@opcom/core";

export async function runSettingsList(): Promise<void> {
  const global = await loadGlobalConfig();
  const settings = global.settings;

  console.log("\n  opcom settings\n");

  let currentGroup = "";
  for (const def of settingsDefs) {
    const group = def.key.split(".")[0];
    if (group !== currentGroup) {
      currentGroup = group;
      console.log(`  [${group}]`);
    }

    const value = getSetting(settings, def.key);
    const display = value === undefined ? "(not set)" : String(value);
    const enumHint = def.enum ? ` (${def.enum.join("|")})` : "";
    console.log(`    ${def.key} = ${display}${enumHint}`);
    console.log(`      ${def.description}`);
  }
  console.log();
}

export async function runSettingsGet(key: string): Promise<void> {
  const global = await loadGlobalConfig();

  // Also handle defaultWorkspace as a special top-level key
  if (key === "defaultWorkspace") {
    console.log(global.defaultWorkspace);
    return;
  }

  const def = settingsDefs.find((d) => d.key === key);
  if (!def) {
    console.error(`  Unknown setting: ${key}`);
    console.error(`  Run 'opcom settings list' to see available settings.`);
    process.exit(1);
  }

  const value = getSetting(global.settings, key);
  console.log(value === undefined ? "" : String(value));
}

export async function runSettingsSet(key: string, value: string): Promise<void> {
  const global = await loadGlobalConfig();

  // Handle defaultWorkspace as a special top-level key
  if (key === "defaultWorkspace") {
    global.defaultWorkspace = value;
    await saveGlobalConfig(global);
    console.log(`  ${key} = ${value}`);
    return;
  }

  try {
    global.settings = setSetting(global.settings, key, value);
  } catch (err) {
    console.error(`  ${(err as Error).message}`);
    process.exit(1);
  }

  await saveGlobalConfig(global);
  console.log(`  ${key} = ${value}`);
}

export async function runSettingsReset(key?: string): Promise<void> {
  const global = await loadGlobalConfig();

  if (!key) {
    const { defaultSettings } = await import("@opcom/core");
    global.settings = defaultSettings();
    await saveGlobalConfig(global);
    console.log("  All settings reset to defaults.");
    return;
  }

  const def = settingsDefs.find((d) => d.key === key);
  if (!def) {
    console.error(`  Unknown setting: ${key}`);
    process.exit(1);
  }

  const { defaultSettings } = await import("@opcom/core");
  const defaults = defaultSettings();
  const defaultValue = getSetting(defaults, key);

  // Apply the default value
  const parts = key.split(".");
  let current: Record<string, unknown> = global.settings as unknown as Record<string, unknown>;
  for (let i = 0; i < parts.length - 1; i++) {
    current = current[parts[i]] as Record<string, unknown>;
  }
  current[parts[parts.length - 1]] = defaultValue;

  await saveGlobalConfig(global);
  const display = defaultValue === undefined ? "(not set)" : String(defaultValue);
  console.log(`  ${key} reset to ${display}`);
}
