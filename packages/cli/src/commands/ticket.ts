import { readFile } from "node:fs/promises";
import {
  loadGlobalConfig,
  loadWorkspace,
  loadProject,
  scanTickets,
  buildContextPacket,
  buildTicketCreationPrompt,
  SessionManager,
} from "@opcom/core";

const DIM = "\x1b[2m";
const BOLD = "\x1b[1m";
const RESET = "\x1b[0m";
const GREEN = "\x1b[32m";
const YELLOW = "\x1b[33m";
const CYAN = "\x1b[36m";
const RED = "\x1b[31m";

export async function runTicketList(projectId?: string): Promise<void> {
  const global = await loadGlobalConfig();
  const workspace = await loadWorkspace(global.defaultWorkspace);
  if (!workspace) {
    console.error("  No workspace found. Run 'opcom init' first.");
    process.exit(1);
  }

  const projectIds = projectId ? [projectId] : workspace.projectIds;

  for (const pid of projectIds) {
    if (!workspace.projectIds.includes(pid)) {
      console.error(`  Project '${pid}' not in workspace. Known: ${workspace.projectIds.join(", ")}`);
      process.exit(1);
    }

    const project = await loadProject(pid);
    if (!project) {
      console.error(`  Project '${pid}' config not found.`);
      process.exit(1);
    }

    const tickets = await scanTickets(project.path);
    if (tickets.length === 0) {
      if (projectId) {
        console.log(`  No tickets in ${pid}.`);
      }
      continue;
    }

    const sorted = [...tickets].sort((a, b) => a.priority - b.priority);

    console.log(`\n  ${BOLD}${project.name}${RESET} ${DIM}(${tickets.length} tickets)${RESET}\n`);

    for (const t of sorted) {
      const pColor = t.priority <= 1 ? RED : t.priority === 2 ? YELLOW : CYAN;
      const statusIcon = t.status === "in-progress" ? `${YELLOW}\u25b6${RESET}` :
        t.status === "closed" ? `${GREEN}\u2713${RESET}` :
        t.status === "deferred" ? `${DIM}\u2298${RESET}` :
        `\u25cb`;
      const deps = t.deps.length > 0 ? `  ${DIM}deps: ${t.deps.join(", ")}${RESET}` : "";
      console.log(`  ${pColor}P${t.priority}${RESET} ${statusIcon} ${t.id}${" ".repeat(Math.max(1, 30 - t.id.length))}${t.title}${deps}`);
    }
  }

  console.log("");
}

export async function runTicketCreate(projectId: string, description: string): Promise<void> {
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

  const existingTickets = await scanTickets(project.path);
  const systemPrompt = buildTicketCreationPrompt(project, description, existingTickets);
  const contextPacket = await buildContextPacket(project);

  console.log(`  Creating ticket for ${BOLD}${project.name}${RESET}...`);
  console.log(`  Description: ${description}\n`);

  const sessionManager = new SessionManager();
  await sessionManager.init();

  const session = await sessionManager.startSession(
    projectId,
    "claude-code",
    {
      projectPath: project.path,
      contextPacket,
      systemPrompt,
      allowedTools: ["Bash", "Write"],
    },
  );

  console.log(`  Session: ${session.id}`);
  console.log(`  Agent working...\n`);

  // Stream output
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

  // Rescan tickets to confirm creation
  const updatedTickets = await scanTickets(project.path);
  const newTickets = updatedTickets.filter(
    (t) => !existingTickets.some((e) => e.id === t.id),
  );

  if (newTickets.length > 0) {
    console.log(`\n  ${GREEN}Created:${RESET}`);
    for (const t of newTickets) {
      console.log(`    ${t.id}: ${t.title} (P${t.priority}, ${t.type})`);
    }
  } else {
    console.log(`\n  ${YELLOW}No new tickets detected after agent run.${RESET}`);
  }
}

export async function runTicketShow(projectId: string, ticketId: string): Promise<void> {
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

  const tickets = await scanTickets(project.path);
  const ticket = tickets.find((t) => t.id === ticketId);
  if (!ticket) {
    console.error(`  Ticket '${ticketId}' not found in ${projectId}.`);
    console.error(`  Available: ${tickets.map((t) => t.id).join(", ") || "(none)"}`);
    process.exit(1);
  }

  const content = await readFile(ticket.filePath, "utf-8");

  const pColor = ticket.priority <= 1 ? RED : ticket.priority === 2 ? YELLOW : CYAN;
  const statusIcon = ticket.status === "in-progress" ? `${YELLOW}\u25b6${RESET}` :
    ticket.status === "closed" ? `${GREEN}\u2713${RESET}` :
    ticket.status === "deferred" ? `${DIM}\u2298${RESET}` :
    `\u25cb`;

  console.log(`\n  ${BOLD}${ticket.title}${RESET}`);
  console.log(`  ${pColor}P${ticket.priority}${RESET} ${statusIcon} ${ticket.status}  ${DIM}${ticket.type}${RESET}`);
  if (ticket.deps.length > 0) {
    console.log(`  Dependencies: ${ticket.deps.join(", ")}`);
  }
  if (ticket.created) {
    console.log(`  Created: ${ticket.created}`);
  }
  console.log(`  File: ${DIM}${ticket.filePath}${RESET}`);
  console.log("");

  // Print content after frontmatter
  const afterFrontmatter = content.replace(/^---\n[\s\S]*?\n---\n?/, "").trim();
  if (afterFrontmatter) {
    console.log(afterFrontmatter);
    console.log("");
  }
}
