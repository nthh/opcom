import {
  loadGlobalConfig,
  loadWorkspace,
  loadProject,
  collectTriageSignals,
  formatTriagePrompt,
} from "@opcom/core";
import type { ProjectConfig } from "@opcom/types";

export async function runTriage(): Promise<void> {
  const global = await loadGlobalConfig();
  const workspace = await loadWorkspace(global.defaultWorkspace);

  if (!workspace) {
    console.log("\n  No workspace found. Run 'opcom init' first.\n");
    return;
  }

  console.log("\n  Collecting triage signals...\n");

  const projects: ProjectConfig[] = [];

  for (const pid of workspace.projectIds) {
    const project = await loadProject(pid);
    if (!project) continue;
    projects.push(project);
  }

  if (projects.length === 0) {
    console.log("  No projects found.\n");
    return;
  }

  const input = await collectTriageSignals(projects);

  // Display collected signals
  for (const project of input.projects) {
    const openTickets = project.tickets.filter(
      (t) => t.status === "open" || t.status === "in-progress",
    );
    console.log(`  Project: ${project.name}`);
    console.log(`    Open tickets: ${openTickets.length}`);
    console.log(`    Active agents: ${project.agentCount}`);
    console.log(`    Last commit: ${project.lastCommitAge === Infinity ? "unknown" : `${project.lastCommitAge}h ago`}`);
    console.log("");
  }

  // Show the prompt that would be sent to the LLM
  const prompt = formatTriagePrompt(input);
  console.log("  --- Triage Prompt (LLM integration required for recommendations) ---");
  console.log("");
  console.log(prompt);
  console.log("");
}
