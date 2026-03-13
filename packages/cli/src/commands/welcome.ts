import { createInterface } from "node:readline";
import { existsSync } from "node:fs";
import {
  ensureOpcomDirs,
  saveGlobalConfig,
  saveWorkspace,
  defaultSettings,
  globalConfigPath,
} from "@opcom/core";
import type { WorkspaceConfig } from "@opcom/types";
import { formatDetectionResult } from "../ui/format.js";
import {
  resolvePath,
  initPipeline,
  configureProject,
  persistProject,
  addToWorkspace,
} from "./init-pipeline.js";
import { detectProject } from "@opcom/core";

const DIM = "\x1b[2m";
const BOLD = "\x1b[1m";
const RESET = "\x1b[0m";
const CYAN = "\x1b[36m";

function prompt(rl: ReturnType<typeof createInterface>, question: string): Promise<string> {
  return new Promise((resolve) => rl.question(question, resolve));
}

/**
 * Returns true if opcom has been set up (global config exists).
 */
export function isFirstRun(): boolean {
  return !existsSync(globalConfigPath());
}

/**
 * The first-run experience for `npx opcom`.
 * Walks the user through setup and explains how opcom works.
 */
export async function runWelcome(): Promise<void> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const ask = (q: string) => prompt(rl, q);

  try {
    // ── Welcome banner ──
    console.log("");
    console.log(`  ${BOLD}opcom${RESET} — developer workspace manager`);
    console.log("");
    console.log(`  ${DIM}Detect your projects, read your tickets, orchestrate agents.${RESET}`);
    console.log("");

    // ── New or existing? ──
    console.log(`  How would you like to start?`);
    console.log(`    ${CYAN}[1]${RESET} Integrate an existing project`);
    console.log(`    ${CYAN}[2]${RESET} Set up from current directory`);
    console.log("");

    const choice = (await ask("  > ")).trim();
    console.log("");

    // ── Create workspace + global config ──
    await ensureOpcomDirs();

    const wsId = "personal";
    const workspace: WorkspaceConfig = {
      id: wsId,
      name: "personal",
      description: "personal workspace",
      projectIds: [],
      createdAt: new Date().toISOString(),
    };
    await saveGlobalConfig({ defaultWorkspace: wsId, settings: defaultSettings() });
    await saveWorkspace(workspace);

    // ── Resolve project path ──
    let projectPath: string;

    if (choice === "1") {
      const pathInput = (await ask("  Project path: ")).trim();
      if (!pathInput) {
        console.log("  No path given. Run 'opcom init' when you're ready.\n");
        return;
      }
      projectPath = resolvePath(pathInput);
    } else {
      projectPath = process.cwd();
    }

    if (!existsSync(projectPath)) {
      console.log(`  ${projectPath} does not exist.\n`);
      return;
    }

    // ── First project via pipeline ──
    console.log(`  Scanning ${projectPath}...\n`);
    const { config } = await initPipeline({
      mode: "interactive",
      path: projectPath,
      ask,
      promptSpecs: true,
      promptWorkSystem: true,
    });

    // ── Ask to add more projects ──
    let addMore = true;
    while (addMore) {
      const more = (await ask("  Add another project? [y/N]: ")).trim().toLowerCase();
      if (more !== "y" && more !== "yes") {
        addMore = false;
        continue;
      }

      const morePath = (await ask("  Project path: ")).trim();
      if (!morePath) {
        addMore = false;
        continue;
      }

      const moreAbsPath = resolvePath(morePath);
      console.log(`\n  Scanning ${moreAbsPath}...\n`);
      try {
        const moreResult = await detectProject(moreAbsPath);
        console.log(formatDetectionResult(moreResult));
        console.log("");

        const moreConfirm = (await ask("  Add this project? [Y/n]: ")).trim().toLowerCase();
        if (moreConfirm === "" || moreConfirm === "y" || moreConfirm === "yes") {
          const moreConfig = await configureProject(moreResult, "interactive", { ask });
          await persistProject(moreConfig);
          await addToWorkspace(moreConfig.id);
          console.log(`  Added ${moreConfig.name}\n`);
        }
      } catch (err) {
        console.error(`  Error: ${err instanceof Error ? err.message : err}\n`);
      }
    }

    // ── Reload workspace to get all added projects ──
    const { loadWorkspace: loadWs } = await import("@opcom/core");
    const finalWorkspace = await loadWs(wsId);
    const projectCount = finalWorkspace?.projectIds.length ?? 0;

    // ── Explain how opcom works ──
    console.log("");
    console.log(`  ${BOLD}You're set up.${RESET} Here's how opcom works:`);
    console.log("");
    console.log(`  ${BOLD}1. Seed work${RESET}`);
    console.log(`    Create tickets describing what needs to be done.`);
    console.log(`    Use ${CYAN}opcom ticket create${RESET} or add markdown files to your tickets dir.`);
    console.log("");
    console.log(`  ${BOLD}2. Open the dashboard${RESET}`);
    console.log(`    Run ${CYAN}npx opcom tui${RESET} — this is your control center.`);
    console.log(`    Navigate projects with ${BOLD}j/k${RESET}, press ${BOLD}Enter${RESET} to see a project's`);
    console.log(`    tickets, specs, stack, and active agents.`);
    console.log("");
    console.log(`  ${BOLD}3. Plan & execute${RESET}`);
    console.log(`    Press ${BOLD}P${RESET} on a project to create a plan — pick tickets, set`);
    console.log(`    concurrency, toggle tests and oracle verification.`);
    console.log(`    Press ${BOLD}Space${RESET} to start, pause, or resume a plan.`);
    console.log(`    Press ${BOLD}w${RESET} on any ticket to start a single agent on it.`);
    console.log("");
    console.log(`  The TUI must be running for agents to work — it's the process`);
    console.log(`  that spawns and supervises them. Keep it open while agents execute.`);
    console.log(`  Press ${BOLD}Enter${RESET} on an agent to see its live event log and send prompts.`);
    console.log(`  Press ${BOLD}?${RESET} for full keybinding help at any time.`);
    console.log("");
    console.log(`  ${projectCount} project(s) configured. Launching dashboard...`);
    console.log("");
  } finally {
    rl.close();
  }

  // ── Drop into the TUI ──
  const { runTui } = await import("./tui.js");
  await runTui();
}
