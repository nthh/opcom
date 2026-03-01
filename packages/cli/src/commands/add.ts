import { resolve } from "node:path";
import {
  detectProject,
  saveProject,
  loadGlobalConfig,
  loadWorkspace,
  saveWorkspace,
} from "@opcom/core";
import type { ProjectConfig, DetectionResult } from "@opcom/types";
import { formatDetectionResult } from "../ui/format.js";

export function detectionToProjectConfig(result: DetectionResult): ProjectConfig {
  return {
    id: result.name,
    name: result.name,
    path: result.path,
    stack: result.stack,
    git: result.git,
    workSystem: result.workSystem,
    docs: result.docs,
    services: result.services,
    environments: [],
    testing: result.testing,
    linting: result.linting,
    subProjects: result.subProjects,
    cloudServices: result.cloudServices,
    lastScannedAt: new Date().toISOString(),
  };
}

export async function runAdd(pathArg: string): Promise<void> {
  const projectPath = resolve(pathArg.replace(/^~/, process.env.HOME ?? "~"));

  console.log(`\n  Scanning ${projectPath}...\n`);
  const result = await detectProject(projectPath);
  console.log(formatDetectionResult(result));

  const config = detectionToProjectConfig(result);
  await saveProject(config);

  // Add to default workspace
  const global = await loadGlobalConfig();
  const workspace = await loadWorkspace(global.defaultWorkspace);
  if (workspace && !workspace.projectIds.includes(config.id)) {
    workspace.projectIds.push(config.id);
    await saveWorkspace(workspace);
  }

  console.log(`\n  Project "${config.name}" added.\n`);
}
