import type { ProjectStatusSnapshot, AgentSession, WorkItem } from "@opcom/types";

// --- Command Types ---

export interface ChannelCommand {
  type: "status" | "status_project" | "work" | "agents" | "stop" | "approve_merge" | "unknown";
  projectId?: string;
  workItemId?: string;
  agentId?: string;
  raw: string;
}

export interface ChannelResponse {
  text: string;           // Plain text version
  richText?: string;      // Platform-specific formatted version (markdown)
  actions?: Array<{       // Interactive buttons/actions
    label: string;
    action: string;
    style?: "primary" | "danger";
  }>;
}

// --- Command Parsing ---

/**
 * Parse a natural language message into an opcom command.
 * Uses simple regex/string matching, not LLM.
 */
export function parseCommand(text: string): ChannelCommand {
  const raw = text;
  const trimmed = text.trim().toLowerCase();

  // "work on project/work-item" or "start project/work-item"
  const workMatch = trimmed.match(/^(?:work\s+on|start)\s+(\S+?)\/(\S+)$/);
  if (workMatch) {
    return { type: "work", projectId: workMatch[1], workItemId: workMatch[2], raw };
  }

  // "work on project" or "start project" (no work item)
  const workProjectMatch = trimmed.match(/^(?:work\s+on|start)\s+(\S+)$/);
  if (workProjectMatch) {
    return { type: "work", projectId: workProjectMatch[1], raw };
  }

  // "stop <project>" or "stop the <project> agent"
  const stopMatch = trimmed.match(/^stop\s+(?:the\s+)?(\S+?)(?:\s+agent)?$/);
  if (stopMatch) {
    return { type: "stop", projectId: stopMatch[1], raw };
  }

  // "approve" / "approve merge"
  if (/^approve(?:\s+merge)?$/.test(trimmed)) {
    return { type: "approve_merge", raw };
  }

  // "agents" / "what's running" / "who's working"
  if (/^(?:agents|what'?s\s+running|who'?s\s+working)$/.test(trimmed)) {
    return { type: "agents", raw };
  }

  // "status <project>" / "status of <project>"
  const statusProjectMatch = trimmed.match(/^status\s+(?:of\s+)?(\S+)$/);
  if (statusProjectMatch) {
    return { type: "status_project", projectId: statusProjectMatch[1], raw };
  }

  // "status" / "what's going on" / "how's it going"
  if (/^(?:status|what'?s\s+going\s+on|how'?s\s+it\s+going)$/.test(trimmed)) {
    return { type: "status", raw };
  }

  return { type: "unknown", raw };
}

// --- Response Formatting ---

function formatDuration(startedAt: string): string {
  const ms = Date.now() - new Date(startedAt).getTime();
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 1) return "<1m";
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ${minutes % 60}m`;
}

function stateIcon(state: AgentSession["state"]): string {
  switch (state) {
    case "streaming": return ">>>";
    case "idle": return "---";
    case "waiting": return "...";
    case "error": return "ERR";
    case "stopped": return "[x]";
    default: return "   ";
  }
}

/**
 * Format a workspace-wide status response.
 */
export function formatStatusResponse(
  projects: ProjectStatusSnapshot[],
  agents: AgentSession[],
): ChannelResponse {
  if (projects.length === 0) {
    return {
      text: "No projects configured. Run `opcom add <path>` to add one.",
      richText: "No projects configured. Run `opcom add <path>` to add one.",
    };
  }

  const lines: string[] = [];
  const mdLines: string[] = [];

  for (const p of projects) {
    const branch = p.git?.branch ?? "?";
    const clean = p.git?.clean ? "clean" : "dirty";
    const tickets = p.workSummary ? `${p.workSummary.open} open` : "no tickets";
    lines.push(`  ${p.name}  ${branch} ${clean}  ${tickets}`);
    mdLines.push(`**${p.name}** \`${branch}\` ${clean} - ${tickets}`);
  }

  const activeAgents = agents.filter((a) => a.state !== "stopped");
  const agentLine = activeAgents.length === 0
    ? "No agents running"
    : `${activeAgents.length} agent${activeAgents.length > 1 ? "s" : ""} running`;

  lines.push("");
  lines.push(agentLine);
  mdLines.push("");
  mdLines.push(`_${agentLine}_`);

  return {
    text: lines.join("\n"),
    richText: mdLines.join("\n"),
    actions: activeAgents.length > 0
      ? [{ label: "View Agents", action: "agents", style: "primary" }]
      : undefined,
  };
}

/**
 * Format a single project's detailed status.
 */
export function formatProjectResponse(
  project: ProjectStatusSnapshot,
  agents: AgentSession[],
  tickets: WorkItem[],
): ChannelResponse {
  const lines: string[] = [];
  const mdLines: string[] = [];

  const branch = project.git?.branch ?? "?";
  const clean = project.git?.clean ? "clean" : "dirty";
  lines.push(`${project.name} (${branch}, ${clean})`);
  mdLines.push(`**${project.name}** \`${branch}\` ${clean}`);

  // Tickets summary
  const openTickets = tickets.filter((t) => t.status === "open");
  const inProgress = tickets.filter((t) => t.status === "in-progress");

  if (inProgress.length > 0) {
    lines.push("");
    lines.push("In progress:");
    mdLines.push("");
    mdLines.push("*In progress:*");
    for (const t of inProgress.slice(0, 5)) {
      lines.push(`  [${t.id}] ${t.title}`);
      mdLines.push(`- \`${t.id}\` ${t.title}`);
    }
  }

  if (openTickets.length > 0) {
    lines.push("");
    lines.push(`Open tickets (${openTickets.length}):`);
    mdLines.push("");
    mdLines.push(`*Open tickets (${openTickets.length}):*`);
    for (const t of openTickets.slice(0, 5)) {
      lines.push(`  [${t.id}] ${t.title} (P${t.priority})`);
      mdLines.push(`- \`${t.id}\` ${t.title} (P${t.priority})`);
    }
    if (openTickets.length > 5) {
      lines.push(`  ... and ${openTickets.length - 5} more`);
      mdLines.push(`_... and ${openTickets.length - 5} more_`);
    }
  }

  // Active agents on this project
  const projectAgents = agents.filter((a) => a.projectId === project.id && a.state !== "stopped");
  if (projectAgents.length > 0) {
    lines.push("");
    lines.push("Active agents:");
    mdLines.push("");
    mdLines.push("*Active agents:*");
    for (const a of projectAgents) {
      const dur = formatDuration(a.startedAt);
      const task = a.workItemId ? ` on ${a.workItemId}` : "";
      lines.push(`  ${a.backend} ${stateIcon(a.state)} ${dur}${task}`);
      mdLines.push(`- \`${a.backend}\` ${a.state} ${dur}${task}`);
    }
  }

  const actions: ChannelResponse["actions"] = [];
  if (openTickets.length > 0) {
    actions.push({ label: "Start Work", action: `work ${project.id}/${openTickets[0].id}`, style: "primary" });
  }

  return {
    text: lines.join("\n"),
    richText: mdLines.join("\n"),
    actions: actions.length > 0 ? actions : undefined,
  };
}

/**
 * Format a list of active agents.
 */
export function formatAgentsResponse(agents: AgentSession[]): ChannelResponse {
  const active = agents.filter((a) => a.state !== "stopped");

  if (active.length === 0) {
    return {
      text: "No agents running.",
      richText: "No agents running.",
    };
  }

  const lines: string[] = [];
  const mdLines: string[] = [];

  lines.push(`${active.length} agent${active.length > 1 ? "s" : ""} active:`);
  mdLines.push(`**${active.length} agent${active.length > 1 ? "s" : ""} active:**`);

  for (const a of active) {
    const dur = formatDuration(a.startedAt);
    const task = a.workItemId ? `/${a.workItemId}` : "";
    lines.push(`  ${a.backend} on ${a.projectId}${task}`);
    lines.push(`    ${a.state} ${dur}`);
    mdLines.push(`\`${a.backend}\` on **${a.projectId}${task}** - ${a.state} (${dur})`);
  }

  const actions: ChannelResponse["actions"] = active.map((a) => ({
    label: `Stop ${a.projectId}`,
    action: `stop ${a.projectId}`,
    style: "danger" as const,
  }));

  return {
    text: lines.join("\n"),
    richText: mdLines.join("\n"),
    actions,
  };
}

/**
 * Format a notification that an agent completed its work.
 */
export function formatAgentCompletedResponse(agent: AgentSession): ChannelResponse {
  const dur = formatDuration(agent.startedAt);
  const task = agent.workItemId ? `/${agent.workItemId}` : "";

  return {
    text: `Agent completed ${agent.projectId}${task}\n${agent.backend} ran for ${dur}`,
    richText: `Agent completed **${agent.projectId}${task}**\n\`${agent.backend}\` ran for ${dur}`,
    actions: [
      { label: "Approve Merge", action: "approve merge", style: "primary" },
      { label: "View Diff", action: `status ${agent.projectId}`, style: "primary" },
    ],
  };
}
