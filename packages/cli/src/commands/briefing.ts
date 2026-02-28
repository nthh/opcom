import {
  loadGlobalConfig,
  loadWorkspace,
  loadProject,
  collectBriefingSignals,
  formatBriefingPrompt,
  generateBriefing,
} from "@opcom/core";
import type { BriefingInput } from "@opcom/core";

export async function runBriefing(options: {
  since?: string;
  project?: string;
}): Promise<void> {
  const global = await loadGlobalConfig();
  const workspace = await loadWorkspace(global.defaultWorkspace);

  if (!workspace) {
    console.log("\n  No workspace found. Run 'opcom init' first.\n");
    return;
  }

  const sinceDate = options.since
    ? new Date(options.since)
    : new Date(Date.now() - 24 * 60 * 60 * 1000); // Default: last 24 hours

  console.log(`\n  Collecting briefing signals since ${sinceDate.toISOString().slice(0, 10)}...\n`);

  const input: BriefingInput = {
    projects: [],
    since: sinceDate.toISOString(),
  };

  for (const pid of workspace.projectIds) {
    const project = await loadProject(pid);
    if (!project) continue;
    if (options.project && project.name !== options.project) continue;

    const signals = await collectBriefingSignals(project.path, sinceDate);
    input.projects.push(signals);
  }

  if (input.projects.length === 0) {
    console.log("  No projects found.\n");
    return;
  }

  // Display collected signals
  for (const project of input.projects) {
    console.log(`  Project: ${project.name}`);
    console.log(`    Commits: ${project.gitLog.length}`);
    console.log(`    Ticket changes: ${project.ticketChanges.length}`);
    console.log(`    Agent sessions: ${project.agentSessions.length}`);
    console.log("");
  }

  // Show the prompt that would be sent to the LLM
  const prompt = formatBriefingPrompt(input);
  console.log("  --- Briefing Prompt (LLM integration required for full briefing) ---");
  console.log("");
  console.log(prompt);
  console.log("");
}
