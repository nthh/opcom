import { createInterface } from "node:readline";
import { resolve } from "node:path";
import { existsSync } from "node:fs";
import {
  ensureOpcomDirs,
  saveGlobalConfig,
  saveWorkspace,
  saveProject,
  detectProject,
  defaultSettings,
  writeProjectSummary,
  createInitialSummaryFromDescription,
  opcomRoot,
  globalConfigPath,
} from "@opcom/core";
import type { WorkspaceConfig, ProjectConfig, WorkSystemType } from "@opcom/types";
import { formatDetectionResult } from "../ui/format.js";
import { detectionToProjectConfig, confirmProfile } from "./add.js";

const DIM = "\x1b[2m";
const BOLD = "\x1b[1m";
const RESET = "\x1b[0m";
const CYAN = "\x1b[36m";
const GREEN = "\x1b[32m";
const YELLOW = "\x1b[33m";

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

    await ensureOpcomDirs();

    const wsId = "personal";
    const workspace: WorkspaceConfig = {
      id: wsId,
      name: "personal",
      description: "personal workspace",
      projectIds: [],
      createdAt: new Date().toISOString(),
    };

    let projectPath: string;

    if (choice === "1") {
      // Integrate existing — ask for path
      const pathInput = (await ask("  Project path: ")).trim();
      if (!pathInput) {
        console.log("  No path given. Run 'opcom init' when you're ready.\n");
        return;
      }
      projectPath = resolve(pathInput.replace(/^~/, process.env.HOME ?? "~"));
    } else {
      // Default: use current directory
      projectPath = process.cwd();
    }

    if (!existsSync(projectPath)) {
      console.log(`  ${projectPath} does not exist.\n`);
      return;
    }

    // ── Detect project ──
    console.log(`  Scanning ${projectPath}...\n`);
    const result = await detectProject(projectPath);
    console.log(formatDetectionResult(result));
    console.log("");

    // ── Specs location ──
    if (result.docs.specsDir) {
      console.log(`  ${GREEN}Specs found:${RESET} ${result.docs.specsDir}`);
    } else {
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
        if (customPath) result.docs.specsDir = customPath;
      } else if (specMap[specChoice]) {
        result.docs.specsDir = specMap[specChoice];
      }
    }
    console.log("");

    // ── Work system / tasks ──
    const detectedSystem = result.workSystem?.type;
    let workSystemType: WorkSystemType | undefined = detectedSystem;
    let ticketDir: string | undefined;

    if (detectedSystem) {
      console.log(`  ${GREEN}Tasks found:${RESET} ${detectedSystem} (${result.workSystem!.ticketDir})`);
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
      workSystemType = ticketMap[ticketChoice];

      // For file-based systems, ask where tasks live if not obvious
      if (workSystemType === "plan-md") {
        const defaultPlan = "plan.md";
        const planInput = (await ask(`  Plan file path [${defaultPlan}]: `)).trim();
        ticketDir = planInput
          ? (planInput.includes("/") ? planInput.slice(0, planInput.lastIndexOf("/")) : ".")
          : ".";
      } else if (workSystemType === "tickets-dir") {
        ticketDir = ".tickets/impl";
      }
    }
    console.log("");

    // ── Profile confirmation ──
    const confirmedProfile = await confirmProfile(result, ask);

    // ── Save config ──
    const config: ProjectConfig = detectionToProjectConfig(result);
    if (confirmedProfile === undefined) {
      delete config.profile;
    }
    if (workSystemType && !config.workSystem) {
      config.workSystem = { type: workSystemType, ticketDir: ticketDir ?? "." };
    }

    await saveProject(config);
    await writeProjectSummary(
      config.id,
      createInitialSummaryFromDescription(config.name),
    );
    workspace.projectIds.push(config.id);

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

      const moreAbsPath = resolve(morePath.replace(/^~/, process.env.HOME ?? "~"));
      console.log(`\n  Scanning ${moreAbsPath}...\n`);
      try {
        const moreResult = await detectProject(moreAbsPath);
        console.log(formatDetectionResult(moreResult));
        console.log("");

        const moreConfirm = (await ask("  Add this project? [Y/n]: ")).trim().toLowerCase();
        if (moreConfirm === "" || moreConfirm === "y" || moreConfirm === "yes") {
          const moreProfile = await confirmProfile(moreResult, ask);
          const moreConfig = detectionToProjectConfig(moreResult);
          if (moreProfile === undefined) delete moreConfig.profile;
          await saveProject(moreConfig);
          await writeProjectSummary(
            moreConfig.id,
            createInitialSummaryFromDescription(moreConfig.name),
          );
          workspace.projectIds.push(moreConfig.id);
          console.log(`  Added ${moreConfig.name}\n`);
        }
      } catch (err) {
        console.error(`  Error: ${err instanceof Error ? err.message : err}\n`);
      }
    }

    // ── Save workspace + global config ──
    await saveGlobalConfig({ defaultWorkspace: wsId, settings: defaultSettings() });
    await saveWorkspace(workspace);

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
    console.log(`  Agents run in the background. The TUI shows live progress —`);
    console.log(`  press ${BOLD}Enter${RESET} on an agent to see its event log and send prompts.`);
    console.log("");
    console.log(`  ${workspace.projectIds.length} project(s) configured. Launching dashboard...`);
    console.log("");
  } finally {
    rl.close();
  }

  // ── Drop into the TUI ──
  const { runTui } = await import("./tui.js");
  await runTui();
}
