import { createInterface } from "node:readline";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";
import {
  detectProject,
  saveProject,
  loadGlobalConfig,
  loadWorkspace,
  saveWorkspace,
  buildGraph,
  projectPath as getProjectConfigPath,
} from "@opcom/core";
import type { ProjectConfig, DetectionResult } from "@opcom/types";
import { formatDetectionResult, formatProfilePrompt } from "../ui/format.js";

export function detectionToProjectConfig(result: DetectionResult, opts?: { description?: string }): ProjectConfig {
  return {
    id: result.name,
    name: result.name,
    path: result.path,
    description: opts?.description,
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
    ...(result.profile ? { profile: result.profile as ProjectConfig["profile"] } : {}),
  };
}

export interface AddOptions {
  /** For testing: override readline with scripted answers */
  promptFn?: (question: string) => Promise<string>;
}

/**
 * Handle profile confirmation prompt. Returns the profile to save (or undefined to skip).
 */
export async function confirmProfile(
  result: DetectionResult,
  ask: (question: string) => Promise<string>,
  projectId?: string,
): Promise<DetectionResult["profile"]> {
  if (!result.profile) return undefined;

  const prompt = formatProfilePrompt(result.profile);
  if (!prompt) return undefined;

  console.log("");
  console.log(prompt);
  const answer = (await ask("  > ")).trim().toLowerCase();

  if (answer === "s") {
    console.log("  Profile skipped.\n");
    return undefined;
  }

  if (answer === "e") {
    const editor = process.env.EDITOR || "vi";
    if (projectId) {
      const configPath = getProjectConfigPath(projectId);
      console.log(`  Opening ${configPath} in ${editor}...\n`);
      spawnSync(editor, [configPath], { stdio: "inherit" });
    }
    // After editing, return the profile as-is (user edits the YAML directly)
    return result.profile;
  }

  // Enter or anything else → accept
  return result.profile;
}

export async function runAdd(pathArg: string, opts?: AddOptions): Promise<void> {
  const rl = opts?.promptFn
    ? null
    : createInterface({ input: process.stdin, output: process.stdout });

  const ask = opts?.promptFn ?? ((question: string) =>
    new Promise<string>((res) => rl!.question(question, res)));

  try {
    const projectPath = resolve(pathArg.replace(/^~/, process.env.HOME ?? "~"));

    console.log(`\n  Scanning ${projectPath}...\n`);
    const result = await detectProject(projectPath);
    console.log(formatDetectionResult(result));

    // Profile confirmation
    const confirmedProfile = await confirmProfile(result, ask);
    const config = detectionToProjectConfig(result);
    if (confirmedProfile === undefined) {
      delete config.profile;
    }

    await saveProject(config);

    // Add to default workspace
    const global = await loadGlobalConfig();
    const workspace = await loadWorkspace(global.defaultWorkspace);
    if (workspace && !workspace.projectIds.includes(config.id)) {
      workspace.projectIds.push(config.id);
      await saveWorkspace(workspace);
    }

    console.log(`\n  Project "${config.name}" added.`);

    // Build context graph in background
    console.log(`  Building context graph...`);
    buildGraph(config.name, config.path)
      .then((stats) => {
        console.log(`  Graph built: ${stats.totalNodes} nodes, ${stats.totalEdges} edges.\n`);
      })
      .catch(() => {
        console.log(`  Graph build skipped (not a git repo or no analyzable files).\n`);
      });
  } finally {
    rl?.close();
  }
}
