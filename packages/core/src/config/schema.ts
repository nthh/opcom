import type { GlobalConfig, WorkspaceConfig, ProjectConfig, StackInfo, IntegrationsConfig } from "@opcom/types";
import { validateSettings } from "./settings.js";

export function validateIntegrationsConfig(data: unknown): IntegrationsConfig | undefined {
  if (!data || typeof data !== "object") return undefined;
  const obj = data as Record<string, unknown>;
  const result: IntegrationsConfig = {};
  const keys: (keyof IntegrationsConfig)[] = ["work-sources", "notifications", "cicd", "agent-backends", "features"];
  for (const key of keys) {
    const val = obj[key];
    if (Array.isArray(val)) {
      result[key] = val.filter((v): v is string => typeof v === "string");
    }
  }
  return Object.keys(result).length > 0 ? result : undefined;
}

export function validateGlobalConfig(data: unknown): GlobalConfig {
  const obj = data as Record<string, unknown>;
  return {
    defaultWorkspace: typeof obj?.defaultWorkspace === "string" ? obj.defaultWorkspace : "default",
    settings: validateSettings(obj?.settings),
    integrations: validateIntegrationsConfig(obj?.integrations),
  };
}

export function validateWorkspaceConfig(data: unknown): WorkspaceConfig {
  const obj = data as Record<string, unknown>;
  if (!obj || typeof obj.id !== "string") {
    throw new Error("Workspace config requires 'id'");
  }
  return {
    id: obj.id,
    name: typeof obj.name === "string" ? obj.name : obj.id,
    description: typeof obj.description === "string" ? obj.description : undefined,
    projectIds: Array.isArray(obj.projectIds) ? obj.projectIds.filter((p): p is string => typeof p === "string") : [],
    createdAt: typeof obj.createdAt === "string" ? obj.createdAt : new Date().toISOString(),
  };
}

export function emptyStack(): StackInfo {
  return {
    languages: [],
    frameworks: [],
    packageManagers: [],
    infrastructure: [],
    versionManagers: [],
  };
}

export function validateProjectConfig(data: unknown): ProjectConfig {
  const obj = data as Record<string, unknown>;
  if (!obj || typeof obj.id !== "string" || typeof obj.path !== "string") {
    throw new Error("Project config requires 'id' and 'path'");
  }
  return {
    id: obj.id,
    name: typeof obj.name === "string" ? obj.name : obj.id,
    path: obj.path,
    description: typeof obj.description === "string" ? obj.description : undefined,
    stack: (obj.stack as StackInfo) ?? emptyStack(),
    git: (obj.git as ProjectConfig["git"]) ?? null,
    workSystem: (obj.workSystem as ProjectConfig["workSystem"]) ?? null,
    docs: (obj.docs as ProjectConfig["docs"]) ?? {},
    services: Array.isArray(obj.services) ? obj.services : [],
    environments: Array.isArray(obj.environments) ? obj.environments : [],
    testing: migrateTestingConfig(obj.testing),
    linting: Array.isArray(obj.linting) ? obj.linting : [],
    subProjects: Array.isArray(obj.subProjects) ? obj.subProjects : [],
    cloudServices: Array.isArray(obj.cloudServices) ? obj.cloudServices : [],
    lastScannedAt: typeof obj.lastScannedAt === "string" ? obj.lastScannedAt : new Date().toISOString(),
    overrides: obj.overrides as ProjectConfig["overrides"],
    profile: validateProfileConfig(obj.profile),
  };
}

function validateProfileConfig(data: unknown): ProjectConfig["profile"] {
  if (!data || typeof data !== "object") return undefined;
  const obj = data as Record<string, unknown>;
  const result: NonNullable<ProjectConfig["profile"]> = {};

  if (Array.isArray(obj.commands)) {
    result.commands = obj.commands.filter(
      (c): c is { name: string; command: string; description?: string } =>
        typeof c === "object" && c !== null &&
        typeof (c as Record<string, unknown>).name === "string" &&
        typeof (c as Record<string, unknown>).command === "string",
    );
  }

  if (Array.isArray(obj.fieldMappings)) {
    result.fieldMappings = obj.fieldMappings.filter(
      (m): m is { field: string; type: "use-case" | "tag"; targetPath?: string } =>
        typeof m === "object" && m !== null &&
        typeof (m as Record<string, unknown>).field === "string" &&
        ((m as Record<string, unknown>).type === "use-case" || (m as Record<string, unknown>).type === "tag"),
    );
  }

  if (Array.isArray(obj.agentConstraints)) {
    result.agentConstraints = obj.agentConstraints.filter(
      (c): c is { name: string; rule: string } =>
        typeof c === "object" && c !== null &&
        typeof (c as Record<string, unknown>).name === "string" &&
        typeof (c as Record<string, unknown>).rule === "string",
    );
  }

  return Object.keys(result).length > 0 ? result : undefined;
}

/**
 * Migrate old TestingConfig (single object) to TestSuite[] (array).
 * Handles: null, undefined, old `{ framework, command, testDir }`, and new array format.
 */
function migrateTestingConfig(data: unknown): ProjectConfig["testing"] {
  if (!data) return [];
  if (Array.isArray(data)) return data as ProjectConfig["testing"];
  // Old format: { framework: string; command?: string; testDir?: string }
  if (typeof data === "object") {
    const old = data as { framework?: string; command?: string; testDir?: string };
    if (typeof old.framework === "string") {
      return [{
        name: old.framework,
        framework: old.framework,
        command: old.command ?? `npx ${old.framework}`,
        testDir: old.testDir,
        required: true,
      }];
    }
  }
  return [];
}
