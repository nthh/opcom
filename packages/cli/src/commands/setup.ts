import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import {
  ensureOpcomDirs,
  saveGlobalConfig,
  saveWorkspace,
  saveProject,
  loadGlobalConfig,
  loadWorkspace,
  detectProject,
  defaultSettings,
  writeProjectSummary,
  createInitialSummaryFromDescription,
  globalConfigPath,
  listProjects,
  scanTickets,
} from "@opcom/core";
import type { WorkspaceConfig, ProjectConfig } from "@opcom/types";
import { detectionToProjectConfig } from "./add.js";

/**
 * Non-interactive setup: detect project at given path (or cwd),
 * save config with all auto-detected defaults.
 * Designed for agent use — no prompts, no TTY required.
 */
export async function autoSetup(projectPath?: string): Promise<ProjectConfig> {
  const targetPath = projectPath
    ? resolve(projectPath.replace(/^~/, process.env.HOME ?? "~"))
    : process.cwd();

  await ensureOpcomDirs();

  const result = await detectProject(targetPath);
  const config = detectionToProjectConfig(result);

  await saveProject(config);
  await writeProjectSummary(
    config.id,
    createInitialSummaryFromDescription(config.name),
  );

  // Ensure workspace + global config exist
  const isFirst = !existsSync(globalConfigPath());
  if (isFirst) {
    const workspace: WorkspaceConfig = {
      id: "personal",
      name: "personal",
      description: "personal workspace",
      projectIds: [config.id],
      createdAt: new Date().toISOString(),
    };
    await saveGlobalConfig({ defaultWorkspace: "personal", settings: defaultSettings() });
    await saveWorkspace(workspace);
  } else {
    const global = await loadGlobalConfig();
    const workspace = await loadWorkspace(global.defaultWorkspace);
    if (workspace && !workspace.projectIds.includes(config.id)) {
      workspace.projectIds.push(config.id);
      await saveWorkspace(workspace);
    }
  }

  return config;
}

/**
 * Agent-facing entry point for `npx opcom`.
 *
 * - Auto-sets up the project if first run
 * - Prints what was detected
 * - Lists existing tickets if any
 * - Shows available CLI commands (tickets + plans first)
 * - Suggests next steps
 *
 * Called when stdin is not a TTY (agent running it) or --auto flag.
 */
export async function runSetup(): Promise<void> {
  const isFirst = !existsSync(globalConfigPath());

  let setupConfig: ProjectConfig | undefined;
  if (isFirst) {
    setupConfig = await autoSetup();
  }

  const projects = await listProjects().catch(() => []);
  const lines: string[] = [];

  lines.push("opcom — developer workspace manager");
  lines.push("Detects your projects, manages tickets, orchestrates agents.");
  lines.push("");

  // --- What was detected / configured ---

  if (setupConfig) {
    lines.push(`Project configured: ${setupConfig.name}`);
    lines.push(`  Path: ${setupConfig.path}`);
    const stack = [
      ...(setupConfig.stack?.languages ?? []).map((l) => l.name),
      ...(setupConfig.stack?.frameworks ?? []).map((f) => f.name),
      ...(setupConfig.stack?.infrastructure ?? []).map((i) => i.name),
    ].join(", ");
    if (stack) lines.push(`  Stack: ${stack}`);
    if (setupConfig.workSystem) {
      lines.push(`  Work system: ${setupConfig.workSystem.type} (${setupConfig.workSystem.ticketDir})`);
    }
    if (setupConfig.docs?.specsDir) {
      lines.push(`  Specs: ${setupConfig.docs.specsDir}`);
    }

    // Check for AGENTS.md in the project
    const agentsMdPath = join(setupConfig.path, "AGENTS.md");
    if (existsSync(agentsMdPath)) {
      lines.push(`  Agent constitution: AGENTS.md`);
    }

    lines.push("");

    // Show existing tickets if any were detected
    if (setupConfig.workSystem) {
      try {
        const tickets = await scanTickets(setupConfig.path, setupConfig.workSystem.type);
        if (tickets.length > 0) {
          const open = tickets.filter((t) => t.status === "open").length;
          const inProgress = tickets.filter((t) => t.status === "in-progress").length;
          lines.push(`Tickets: ${tickets.length} total (${open} open, ${inProgress} in-progress)`);
          // Show up to 5 open tickets
          const openTickets = tickets.filter((t) => t.status === "open").slice(0, 5);
          for (const t of openTickets) {
            lines.push(`  ${t.id}: ${t.title}`);
          }
          if (open > 5) lines.push(`  ... and ${open - 5} more`);
          lines.push("");
        }
      } catch {
        // Ticket scan failed — skip
      }
    }
  } else if (projects.length > 0) {
    lines.push(`${projects.length} project(s) configured:`);
    for (const p of projects) {
      const stack = [
        ...(p.stack?.languages ?? []).map((l) => l.name),
        ...(p.stack?.frameworks ?? []).map((f) => f.name),
      ].slice(0, 4).join(", ");
      lines.push(`  ${p.name}: ${p.path}${stack ? ` (${stack})` : ""}`);
    }
    lines.push("");
  }

  // --- CLI commands, prioritized for agent workflow ---

  lines.push("Commands:");
  lines.push("");

  lines.push("  Tickets:");
  lines.push("    opcom ticket list [project]              List tickets");
  lines.push("    opcom ticket create <project> \"<desc>\"   Create a ticket");
  lines.push("    opcom ticket show <project> <id>         Show ticket details");
  lines.push("");

  lines.push("  Plans:");
  lines.push("    opcom plan create                        Create plan from tickets");
  lines.push("    opcom plan show [id]                     Show plan details");
  lines.push("    opcom plan execute [id]                  Execute plan (starts agents)");
  lines.push("");

  lines.push("  Work:");
  lines.push("    opcom work <project>/<ticket>            Start agent on a ticket");
  lines.push("    opcom work <project>/<ticket> --worktree   With git isolation");
  lines.push("");

  lines.push("  Projects:");
  lines.push("    opcom add <path>                         Add another project");
  lines.push("    opcom status                             Workspace overview");
  lines.push("    opcom scan [project]                     Re-detect project stack");
  lines.push("");

  lines.push("Workflow:");
  lines.push("  1. Seed tickets for work the user wants done");
  lines.push("  2. Create a plan to set execution order and dependencies");
  lines.push("  3. Execute with 'opcom work <project>/<ticket>' or 'opcom plan execute'");
  lines.push("  4. Tell user to run 'opcom' for the interactive dashboard");

  console.log(lines.join("\n"));
}
