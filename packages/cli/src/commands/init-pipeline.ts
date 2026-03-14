import { resolve } from "node:path";
import { existsSync } from "node:fs";
import {
  ensureOpcomDirs,
  detectProject,
  saveProject,
  loadGlobalConfig,
  loadWorkspace,
  saveWorkspace,
  saveGlobalConfig,
  defaultSettings,
  globalConfigPath,
  writeProjectSummary,
  createInitialSummaryFromDescription,
} from "@opcom/core";
import type { ProjectConfig, DetectionResult, WorkspaceConfig, WorkSystemType } from "@opcom/types";
import { formatDetectionResult, formatProfilePrompt } from "../ui/format.js";

export type InitMode = "interactive" | "agent";

const CYAN = "\x1b[36m";
const GREEN = "\x1b[32m";
const DIM = "\x1b[2m";
const RESET = "\x1b[0m";

// ── Shared Helpers ──

/** Expand ~, resolve relative paths, validate directory exists. */
export function resolvePath(input: string): string {
  return resolve(input.replace(/^~/, process.env.HOME ?? "~"));
}

/** Idempotent: load default workspace, add projectId if not present, save. */
export async function addToWorkspace(projectId: string): Promise<void> {
  if (!existsSync(globalConfigPath())) return;

  const global = await loadGlobalConfig();
  const workspace = await loadWorkspace(global.defaultWorkspace);
  if (workspace && !workspace.projectIds.includes(projectId)) {
    workspace.projectIds.push(projectId);
    await saveWorkspace(workspace);
  }
}

/**
 * Convert a DetectionResult into a ProjectConfig.
 * Re-exported from the pipeline module so all init flows share it.
 */
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

/**
 * Handle profile confirmation prompt.
 * Returns the profile to save (or undefined to skip).
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
      const { spawnSync } = await import("node:child_process");
      const { projectPath: getProjectConfigPath } = await import("@opcom/core");
      const configPath = getProjectConfigPath(projectId);
      console.log(`  Opening ${configPath} in ${editor}...\n`);
      spawnSync(editor, [configPath], { stdio: "inherit" });
    }
    return result.profile;
  }

  // Enter or anything else → accept
  return result.profile;
}

export interface ConfigureProjectOptions {
  ask?: (question: string) => Promise<string>;
  /** Prompt for specs directory (welcome flow). */
  promptSpecs?: boolean;
  /** Prompt for work system (welcome flow). */
  promptWorkSystem?: boolean;
  /** Project ID for $EDITOR launch during profile edit. */
  projectId?: string;
  /** Custom description. */
  description?: string;
  /** Override id/name on the resulting config. */
  overrides?: { id?: string; name?: string };
}

/**
 * Mode-driven project configuration.
 * Interactive: prompt for specs, work system, profile.
 * Agent: return detection defaults unchanged.
 */
export async function configureProject(
  detection: DetectionResult,
  mode: InitMode,
  options?: ConfigureProjectOptions,
): Promise<ProjectConfig> {
  const config = detectionToProjectConfig(detection, { description: options?.description });

  if (options?.overrides?.id) config.id = options.overrides.id;
  if (options?.overrides?.name) config.name = options.overrides.name;

  if (mode === "agent") {
    return config;
  }

  const ask = options?.ask;
  if (!ask) return config;

  // ── Specs directory prompt ──
  if (options?.promptSpecs && !detection.docs.specsDir) {
    console.log(`  Where do you keep specs / design docs?`);
    console.log(`    ${CYAN}[1]${RESET} docs/spec/ ${DIM}(convention, will create if needed)${RESET}`);
    console.log(`    ${CYAN}[2]${RESET} specs/`);
    console.log(`    ${CYAN}[3]${RESET} docs/`);
    console.log(`    ${CYAN}[4]${RESET} Let me type a path`);
    console.log(`    ${CYAN}[5]${RESET} No specs yet`);
    console.log("");

    const specChoice = (await ask("  > ")).trim();
    const specMap: Record<string, string> = {
      "1": "docs/spec",
      "2": "specs",
      "3": "docs",
    };
    if (specChoice === "4") {
      const customPath = (await ask("  Specs path (relative to project): ")).trim();
      if (customPath) config.docs = { ...config.docs, specsDir: customPath };
    } else if (specMap[specChoice]) {
      config.docs = { ...config.docs, specsDir: specMap[specChoice] };
    }
    console.log("");
  } else if (options?.promptSpecs && detection.docs.specsDir) {
    console.log(`  ${GREEN}Specs found:${RESET} ${detection.docs.specsDir}`);
    console.log("");
  }

  // ── Work system prompt ──
  if (options?.promptWorkSystem) {
    const detectedSystem = detection.workSystem?.type;

    if (detectedSystem) {
      console.log(`  ${GREEN}Tasks found:${RESET} ${detectedSystem} (${detection.workSystem!.ticketDir})`);
    } else {
      console.log(`  How do you track tasks / tickets?`);
      console.log(`    ${CYAN}[1]${RESET} Local .tickets/ directory ${DIM}(default, built-in)${RESET}`);
      console.log(`    ${CYAN}[2]${RESET} plan.md ${DIM}(flat markdown task list)${RESET}`);
      console.log(`    ${CYAN}[3]${RESET} GitHub Issues`);
      console.log(`    ${CYAN}[4]${RESET} Jira`);
      console.log(`    ${CYAN}[5]${RESET} Linear`);
      console.log(`    ${CYAN}[6]${RESET} None / I'll set this up later`);
      console.log("");

      const ticketChoice = (await ask("  > ")).trim();
      const ticketMap: Record<string, WorkSystemType> = {
        "1": "tickets-dir",
        "2": "plan-md",
        "3": "github-issues",
        "4": "jira",
        "5": "linear",
      };
      const workSystemType = ticketMap[ticketChoice];

      if (workSystemType) {
        let ticketDir: string | undefined;
        if (workSystemType === "plan-md") {
          const defaultPlan = "plan.md";
          const planInput = (await ask(`  Plan file path [${defaultPlan}]: `)).trim();
          ticketDir = planInput
            ? (planInput.includes("/") ? planInput.slice(0, planInput.lastIndexOf("/")) : ".")
            : ".";
        } else if (workSystemType === "tickets-dir") {
          ticketDir = ".tickets/impl";
        }

        if (!config.workSystem) {
          config.workSystem = { type: workSystemType, ticketDir: ticketDir ?? "." };
        }
      }
    }
    console.log("");
  }

  // ── Profile confirmation ──
  const confirmedProfile = await confirmProfile(detection, ask, options?.projectId);
  if (confirmedProfile === undefined) {
    delete config.profile;
  }

  return config;
}

/**
 * Dev startup hook (stub).
 * Interactive: would prompt to start dev environment.
 * Agent: would print dev command in guide.
 * Wired by dev-startup-on-init ticket once dev-command-detection lands.
 */
export async function devStartup(_config: ProjectConfig, _mode: InitMode): Promise<void> {
  // No-op until dev-command-detection provides profile.commands.dev
}

/** Save project config + initial summary. */
export async function persistProject(config: ProjectConfig): Promise<void> {
  await saveProject(config);
  await writeProjectSummary(
    config.id,
    createInitialSummaryFromDescription(config.name, config.description),
  );
}

/**
 * Ensure workspace + global config exist for first-run scenarios.
 * Creates "personal" workspace and global config if they don't exist.
 * Returns true if this was the first run.
 */
export async function ensureWorkspace(): Promise<boolean> {
  await ensureOpcomDirs();
  const isFirst = !existsSync(globalConfigPath());
  if (isFirst) {
    await saveGlobalConfig({ defaultWorkspace: "personal", settings: defaultSettings() });
    const workspace: WorkspaceConfig = {
      id: "personal",
      name: "personal",
      description: "personal workspace",
      projectIds: [],
      createdAt: new Date().toISOString(),
    };
    await saveWorkspace(workspace);
  }
  return isFirst;
}

// ── Pipeline ──

export interface InitPipelineOptions {
  mode: InitMode;
  /** Path to project directory. Defaults to cwd. */
  path?: string;
  /** Prompt function for interactive mode. */
  ask?: (question: string) => Promise<string>;
  /** Prompt for specs directory. */
  promptSpecs?: boolean;
  /** Prompt for work system. */
  promptWorkSystem?: boolean;
  /** Custom project description. */
  description?: string;
  /** Override id/name on the resulting config. */
  overrides?: { id?: string; name?: string };
  /** Print detection result to console. Default: true for interactive, false for agent. */
  printDetection?: boolean;
}

export interface InitPipelineResult {
  config: ProjectConfig;
  detection: DetectionResult;
}

/**
 * Unified init pipeline: single flow with mode-driven behavior.
 *
 * Steps:
 * 1. resolvePath(input) → absolute path
 * 2. detectProject(path) → DetectionResult
 * 3. configureProject(result, mode) → ProjectConfig
 * 4. persistProject(config) → save to ~/.opcom/projects/
 * 5. addToWorkspace(projectId) → idempotent add to workspace
 * 6. devStartup(config, mode) → optional dev environment hook
 */
export async function initPipeline(options: InitPipelineOptions): Promise<InitPipelineResult> {
  const targetPath = options.path ? resolvePath(options.path) : process.cwd();

  // Ensure workspace exists (idempotent — no-op if already created by caller)
  await ensureWorkspace();

  // Detect
  const detection = await detectProject(targetPath);

  // Print detection (interactive flows show this, agent flows don't)
  const shouldPrint = options.printDetection ?? (options.mode === "interactive");
  if (shouldPrint) {
    console.log(formatDetectionResult(detection));
    console.log("");
  }

  // Configure (mode-driven)
  const config = await configureProject(detection, options.mode, {
    ask: options.ask,
    promptSpecs: options.promptSpecs,
    promptWorkSystem: options.promptWorkSystem,
    description: options.description,
    overrides: options.overrides,
  });

  // Persist
  await persistProject(config);

  // Add to workspace (no-op if no workspace exists yet)
  await addToWorkspace(config.id);

  // Dev startup (stub — wired by dev-startup-on-init)
  await devStartup(config, options.mode);

  return { config, detection };
}
