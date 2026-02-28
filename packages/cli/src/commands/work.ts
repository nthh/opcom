import {
  loadGlobalConfig,
  loadWorkspace,
  loadProject,
  buildContextPacket,
  SessionManager,
} from "@opcom/core";
import { scanTickets } from "@opcom/core";
import type { AgentBackend } from "@opcom/types";

export async function runWork(target: string, options: {
  backend?: string;
  model?: string;
  worktree?: boolean;
}): Promise<void> {
  // Parse target: "project/ticket" or "project"
  const parts = target.split("/");
  const projectId = parts[0];
  const ticketId = parts[1];

  // Load project
  const global = await loadGlobalConfig();
  const workspace = await loadWorkspace(global.defaultWorkspace);
  if (!workspace) {
    console.error("  No workspace found. Run 'opcom init' first.");
    process.exit(1);
  }

  if (!workspace.projectIds.includes(projectId)) {
    console.error(`  Project '${projectId}' not in workspace. Known: ${workspace.projectIds.join(", ")}`);
    process.exit(1);
  }

  const project = await loadProject(projectId);
  if (!project) {
    console.error(`  Project '${projectId}' config not found.`);
    process.exit(1);
  }

  // Find work item
  const tickets = await scanTickets(project.path);
  let workItem;

  if (ticketId) {
    workItem = tickets.find((t) => t.id === ticketId);
    if (!workItem) {
      console.error(`  Ticket '${ticketId}' not found in ${projectId}.`);
      console.error(`  Available: ${tickets.map((t) => t.id).join(", ") || "(none)"}`);
      process.exit(1);
    }
  } else {
    // Pick highest-priority open ticket
    const openTickets = tickets
      .filter((t) => t.status === "open")
      .sort((a, b) => a.priority - b.priority);

    if (openTickets.length > 0) {
      workItem = openTickets[0];
      console.log(`  Auto-selected: ${workItem.id} (P${workItem.priority} ${workItem.type})`);
    }
  }

  // Build context
  const contextPacket = await buildContextPacket(project, workItem);
  const backend = (options.backend ?? "claude-code") as AgentBackend;

  console.log(`  Starting ${backend} on ${projectId}${workItem ? `/${workItem.id}` : ""}...`);

  // Stack summary
  const langs = project.stack.languages.map((l) => l.name).join(", ");
  const fws = project.stack.frameworks.map((f) => f.name).join(", ");
  console.log(`  Context: ${[langs, fws].filter(Boolean).join(" + ") || "detected stack"}`);

  if (workItem) {
    console.log(`  Ticket: ${workItem.title} (P${workItem.priority}, ${workItem.status})`);
  }

  if (project.testing) {
    console.log(`  Testing: ${project.testing.framework}`);
  }

  // Start agent session
  const sessionManager = new SessionManager();
  await sessionManager.init();

  const session = await sessionManager.startSession(
    projectId,
    backend,
    {
      projectPath: project.path,
      workItemId: workItem?.id,
      contextPacket,
      model: options.model,
      worktree: options.worktree,
    },
    workItem?.id,
  );

  console.log(`  Session: ${session.id}`);
  console.log(`  Agent ready, streaming...\n`);

  // Stream output to console
  const sub = sessionManager.subscribeToSession(session.id);
  if (sub) {
    for await (const event of sub) {
      switch (event.type) {
        case "message_delta":
          if (event.data?.text) {
            process.stdout.write(event.data.text);
          }
          break;
        case "tool_start":
          console.log(`\n  > ${event.data?.toolName}${event.data?.toolInput ? ` ${event.data.toolInput.slice(0, 80)}` : ""}`);
          break;
        case "tool_end":
          if (event.data?.toolOutput) {
            const output = event.data.toolOutput.slice(0, 200);
            console.log(`    ${output}`);
          }
          break;
        case "agent_end":
          console.log(`\n  Agent finished: ${event.data?.reason ?? "completed"}`);
          break;
        case "error":
          console.error(`\n  Error: ${event.data?.reason}`);
          break;
      }
    }
  }
}
