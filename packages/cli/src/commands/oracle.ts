import {
  loadGlobalConfig,
  loadWorkspace,
  loadProject,
  collectOracleInputs,
  formatOraclePrompt,
  scanTickets,
} from "@opcom/core";

export async function runOracle(sessionId: string): Promise<void> {
  const global = await loadGlobalConfig();
  const workspace = await loadWorkspace(global.defaultWorkspace);

  if (!workspace) {
    console.log("\n  No workspace found. Run 'opcom init' first.\n");
    return;
  }

  console.log(`\n  Collecting oracle inputs for session: ${sessionId}...\n`);

  // Find the project and ticket for this session
  // For now, we iterate projects and try to match
  for (const pid of workspace.projectIds) {
    const project = await loadProject(pid);
    if (!project) continue;

    const tickets = project.workSystem ? await scanTickets(project.path) : [];
    if (tickets.length === 0) continue;

    // Use the first in-progress ticket as a reasonable default
    const ticket = tickets.find((t) => t.status === "in-progress") ?? tickets[0];

    const input = await collectOracleInputs(project.path, sessionId, ticket);

    console.log(`  Project: ${project.name}`);
    console.log(`  Ticket: ${input.ticket.id} - ${input.ticket.title}`);
    console.log(`  Acceptance criteria: ${input.acceptanceCriteria.length}`);
    console.log(`  Diff size: ${input.gitDiff.length} chars`);
    console.log("");

    if (input.acceptanceCriteria.length > 0) {
      console.log("  Acceptance Criteria:");
      for (const criterion of input.acceptanceCriteria) {
        console.log(`    - ${criterion}`);
      }
      console.log("");
    }

    // Show the prompt that would be sent to the LLM
    const prompt = formatOraclePrompt(input);
    console.log("  --- Oracle Prompt (LLM integration required for evaluation) ---");
    console.log("");
    console.log(prompt);
    console.log("");
    return;
  }

  console.log("  No projects with tickets found for oracle evaluation.\n");
}
