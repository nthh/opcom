import type { GlobalConfig, WorkspaceConfig, ProjectConfig, StackInfo } from "@opcom/types";

export function validateGlobalConfig(data: unknown): GlobalConfig {
  const obj = data as Record<string, unknown>;
  return {
    defaultWorkspace: typeof obj?.defaultWorkspace === "string" ? obj.defaultWorkspace : "default",
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
    stack: (obj.stack as StackInfo) ?? emptyStack(),
    git: (obj.git as ProjectConfig["git"]) ?? null,
    workSystem: (obj.workSystem as ProjectConfig["workSystem"]) ?? null,
    docs: (obj.docs as ProjectConfig["docs"]) ?? {},
    services: Array.isArray(obj.services) ? obj.services : [],
    environments: Array.isArray(obj.environments) ? obj.environments : [],
    testing: (obj.testing as ProjectConfig["testing"]) ?? null,
    linting: Array.isArray(obj.linting) ? obj.linting : [],
    subProjects: Array.isArray(obj.subProjects) ? obj.subProjects : [],
    cloudServices: Array.isArray(obj.cloudServices) ? obj.cloudServices : [],
    lastScannedAt: typeof obj.lastScannedAt === "string" ? obj.lastScannedAt : new Date().toISOString(),
    overrides: obj.overrides as ProjectConfig["overrides"],
  };
}
