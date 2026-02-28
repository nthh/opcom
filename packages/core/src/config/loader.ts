import { readFile, writeFile, mkdir, readdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname } from "node:path";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";
import type { GlobalConfig, WorkspaceConfig, ProjectConfig } from "@opcom/types";
import {
  globalConfigPath,
  workspacesDir,
  workspacePath,
  projectsDir,
  projectPath,
  opcomRoot,
} from "./paths.js";
import { validateGlobalConfig, validateWorkspaceConfig, validateProjectConfig } from "./schema.js";

async function ensureDir(path: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
}

async function readYaml<T>(path: string): Promise<T | null> {
  if (!existsSync(path)) return null;
  const raw = await readFile(path, "utf-8");
  return parseYaml(raw) as T;
}

async function writeYaml(path: string, data: unknown): Promise<void> {
  await ensureDir(path);
  const content = stringifyYaml(data, { lineWidth: 120 });
  await writeFile(path, content, "utf-8");
}

// --- Global config ---

export async function loadGlobalConfig(): Promise<GlobalConfig> {
  const data = await readYaml<unknown>(globalConfigPath());
  return validateGlobalConfig(data ?? {});
}

export async function saveGlobalConfig(config: GlobalConfig): Promise<void> {
  await writeYaml(globalConfigPath(), config);
}

// --- Workspace config ---

export async function loadWorkspace(id: string): Promise<WorkspaceConfig | null> {
  const data = await readYaml<unknown>(workspacePath(id));
  if (!data) return null;
  return validateWorkspaceConfig(data);
}

export async function saveWorkspace(config: WorkspaceConfig): Promise<void> {
  await writeYaml(workspacePath(config.id), config);
}

export async function listWorkspaces(): Promise<WorkspaceConfig[]> {
  const dir = workspacesDir();
  if (!existsSync(dir)) return [];
  const files = await readdir(dir);
  const configs: WorkspaceConfig[] = [];
  for (const f of files) {
    if (!f.endsWith(".yaml")) continue;
    const data = await readYaml<unknown>(`${dir}/${f}`);
    if (data) configs.push(validateWorkspaceConfig(data));
  }
  return configs;
}

// --- Project config ---

export async function loadProject(id: string): Promise<ProjectConfig | null> {
  const data = await readYaml<unknown>(projectPath(id));
  if (!data) return null;
  return validateProjectConfig(data);
}

export async function saveProject(config: ProjectConfig): Promise<void> {
  await writeYaml(projectPath(config.id), config);
}

export async function listProjects(): Promise<ProjectConfig[]> {
  const dir = projectsDir();
  if (!existsSync(dir)) return [];
  const files = await readdir(dir);
  const configs: ProjectConfig[] = [];
  for (const f of files) {
    if (!f.endsWith(".yaml")) continue;
    const data = await readYaml<unknown>(`${dir}/${f}`);
    if (data) configs.push(validateProjectConfig(data));
  }
  return configs;
}

// --- Init helpers ---

export async function ensureOpcomDirs(): Promise<void> {
  await mkdir(opcomRoot(), { recursive: true });
  await mkdir(workspacesDir(), { recursive: true });
  await mkdir(projectsDir(), { recursive: true });
}
