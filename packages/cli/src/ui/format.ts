import type { StackInfo, GitInfo, AgentSession, WorkItem, ProjectCommand, AgentConstraint, ProjectProfileConfig, FieldMapping } from "@opcom/types";
import type { ProjectStatus, ManagedProcess } from "@opcom/core";
import type { DetectionResult } from "@opcom/types";

const DIM = "\x1b[2m";
const BOLD = "\x1b[1m";
const RESET = "\x1b[0m";
const GREEN = "\x1b[32m";
const YELLOW = "\x1b[33m";
const CYAN = "\x1b[36m";
const RED = "\x1b[31m";

export interface StatusDashboardOptions {
  projectTickets?: Map<string, WorkItem[]>;
  projectFilter?: string | null;
  processes?: ManagedProcess[];
}

export function formatDetectionResult(result: DetectionResult): string {
  const lines: string[] = [];
  lines.push(`${BOLD}${result.name}${RESET}  ${DIM}${result.path}${RESET}`);
  lines.push(`  Confidence: ${formatConfidence(result.confidence)}`);
  lines.push(`  Stack: ${formatStackSummary(result.stack)}`);

  if (result.git) {
    lines.push(`  Git: ${formatGitBrief(result.git)}`);
  }
  if (result.workSystem) {
    lines.push(`  Work system: ${result.workSystem.type}`);
  }
  if (result.testing) {
    lines.push(`  Testing: ${result.testing.framework}`);
  }
  if (result.linting.length > 0) {
    lines.push(`  Linting: ${result.linting.map((l) => l.name).join(", ")}`);
  }
  if (result.services.length > 0) {
    lines.push(`  Services: ${result.services.map((s) => s.name + (s.port ? `:${s.port}` : "")).join(", ")}`);
  }
  if (result.subProjects.length > 0) {
    lines.push(`  Sub-projects: ${result.subProjects.map((s) => s.name).join(", ")} (${result.subProjects.length})`);
  }
  // Docs summary
  const docParts: string[] = [];
  if (result.docs.agentConfig) docParts.push(result.docs.agentConfig);
  if (result.docs.specsDir) docParts.push(result.docs.specsDir);
  if (result.docs.decisionsDir) docParts.push("ADRs");
  if (result.docs.vision) docParts.push("vision");
  if (result.docs.architecture) docParts.push("architecture");
  if (result.docs.runbooksDir) docParts.push("runbooks");
  if (docParts.length > 0) {
    lines.push(`  Docs: ${docParts.join(", ")}`);
  }

  // Profile summary
  if (result.profile) {
    const profileParts: string[] = [];
    if (result.profile.commands && result.profile.commands.length > 0) {
      for (const cmd of result.profile.commands) {
        profileParts.push(`${cmd.name}: ${cmd.command}`);
      }
    }
    if (result.profile.fieldMappings && result.profile.fieldMappings.length > 0) {
      for (const fm of result.profile.fieldMappings) {
        profileParts.push(`${fm.field} → ${fm.type}`);
      }
    }
    if (result.profile.agentConstraints && result.profile.agentConstraints.length > 0) {
      profileParts.push(`${result.profile.agentConstraints.length} agent constraint(s)`);
    }
    if (profileParts.length > 0) {
      lines.push(`  Profile: ${profileParts.join(", ")}`);
    }
  }

  return lines.join("\n");
}

export function formatStatusDashboard(
  workspaceName: string,
  statuses: ProjectStatus[],
  agents?: AgentSession[],
  opts?: StatusDashboardOptions,
): string {
  const lines: string[] = [];
  const projectTickets = opts?.projectTickets;
  const projectFilter = opts?.projectFilter ?? null;
  const processes = opts?.processes;
  const isSingleProject = projectFilter !== null;

  lines.push(`${BOLD}opcom${RESET} ${DIM}— ${workspaceName}${RESET}`);
  lines.push("");
  lines.push(`${BOLD}PROJECTS${RESET} (${statuses.length})`);
  lines.push("");

  for (const { project, workSummary, gitFresh } of statuses) {
    const git = gitFresh ?? project.git;
    const gitStr = git ? formatGitBrief(git) : `${DIM}(no git)${RESET}`;
    lines.push(`  ${BOLD}${project.name}${RESET}${" ".repeat(Math.max(1, 40 - project.name.length))}${gitStr}`);
    lines.push(`    ${formatStackSummary(project.stack)}`);

    if (workSummary) {
      const wsType = project.workSystem?.type === "trk" ? " (trk)" : "";
      lines.push(`    Tickets: ${workSummary.open} open / ${workSummary.total} total${wsType}`);
    }

    // Show agents for this project
    const projectAgents = agents?.filter((a) => a.projectId === project.id && a.state !== "stopped") ?? [];
    if (projectAgents.length > 0) {
      for (const a of projectAgents) {
        const stateColor = a.state === "streaming" ? GREEN : a.state === "idle" ? CYAN : a.state === "error" ? RED : YELLOW;
        const elapsed = formatRelativeTime(a.startedAt).replace(" ago", "");
        const ctx = a.contextUsage ? `  ctx: ${a.contextUsage.percentage}%` : "";
        lines.push(`    ${DIM}\u2192${RESET} ${a.backend}  ${stateColor}${a.state}${RESET}  ${elapsed}${ctx}${a.workItemId ? `  ${DIM}${a.workItemId}${RESET}` : ""}`);
      }
    }

    if (git?.lastCommitAt) {
      lines.push(`    Last commit: ${formatRelativeTime(git.lastCommitAt)}`);
    }

    // In single-project view, show profile and full ticket list
    if (isSingleProject) {
      // Profile: commands
      const commands = project.profile?.commands;
      if (commands && commands.length > 0) {
        lines.push("");
        lines.push(`    ${BOLD}Commands${RESET}`);
        for (const cmd of commands) {
          const desc = cmd.description ? `${DIM} — ${cmd.description}${RESET}` : "";
          lines.push(`    ${CYAN}${cmd.name}${RESET}: ${cmd.command}${desc}`);
        }
      }

      // Profile: agent constraints
      const constraints = project.profile?.agentConstraints;
      if (constraints && constraints.length > 0) {
        lines.push("");
        lines.push(`    ${BOLD}Agent Constraints${RESET}`);
        for (const c of constraints) {
          lines.push(`    ${YELLOW}${c.name}${RESET}: ${c.rule}`);
        }
      }

      if (projectTickets) {
        const tickets = projectTickets.get(project.id) ?? [];
        if (tickets.length > 0) {
          lines.push("");
          lines.push(`    ${BOLD}Tickets${RESET}`);
          const sorted = [...tickets].sort((a, b) => a.priority - b.priority);
          for (const t of sorted) {
            const hasAgent = agents?.some((a) => a.workItemId === t.id && a.state !== "stopped") ?? false;
            lines.push(`    ${formatWorkItemCli(t, hasAgent)}`);
          }
        }
      }
    }

    lines.push("");
  }

  // Agents summary
  const activeAgents = agents?.filter((a) => a.state !== "stopped") ?? [];
  lines.push(`${BOLD}AGENTS${RESET} (${activeAgents.length})`);
  if (activeAgents.length > 0) {
    for (const a of activeAgents) {
      const stateColor = a.state === "streaming" ? GREEN : a.state === "idle" ? CYAN : a.state === "error" ? RED : YELLOW;
      const elapsed = formatRelativeTime(a.startedAt).replace(" ago", "");
      const ticket = a.workItemId ? `/${a.workItemId}` : "";
      const ctx = a.contextUsage ? `  ctx: ${a.contextUsage.percentage}%` : "";
      lines.push(`  ${a.projectId}${ticket}`);
      lines.push(`    ${a.backend}  ${stateColor}${a.state}${RESET}  ${elapsed}${ctx}`);
    }
  } else {
    lines.push(`  ${DIM}No active agents${RESET}`);
  }
  lines.push("");

  // Processes summary
  const activeProcesses = processes?.filter((p) => p.state === "running") ?? [];
  lines.push(`${BOLD}PROCESSES${RESET} (${activeProcesses.length})`);
  if (activeProcesses.length > 0) {
    for (const p of activeProcesses) {
      const port = p.port ? `:${p.port}` : "";
      lines.push(`  ${GREEN}\u25cf${RESET} ${p.projectId}/${p.name}${port}  ${DIM}PID ${p.pid}${RESET}`);
    }
  } else {
    lines.push(`  ${DIM}No running processes${RESET}`);
  }

  // Global work queue (skip in single-project view — tickets shown inline)
  if (!isSingleProject && projectTickets && projectTickets.size > 0) {
    lines.push("");
    lines.push(formatWorkQueueSummary(statuses, projectTickets, agents));
  }

  return lines.join("\n");
}

export function formatWorkQueueSummary(
  statuses: ProjectStatus[],
  projectTickets: Map<string, WorkItem[]>,
  agents?: AgentSession[],
): string {
  const lines: string[] = [];

  // Build items with project names
  const items: Array<{ item: WorkItem; projectName: string }> = [];
  for (const [projectId, tickets] of projectTickets) {
    const status = statuses.find((s) => s.project.id === projectId);
    const projectName = status?.project.name ?? projectId;
    for (const t of tickets) {
      if (t.status === "closed") continue;
      items.push({ item: t, projectName });
    }
  }

  items.sort((a, b) => a.item.priority - b.item.priority);

  lines.push(`${BOLD}WORK QUEUE${RESET} (${items.length})`);
  if (items.length === 0) {
    lines.push(`  ${DIM}No open work items${RESET}`);
  } else {
    for (const { item, projectName } of items) {
      const hasAgent = agents?.some((a) => a.workItemId === item.id && a.state !== "stopped") ?? false;
      const agentStr = hasAgent ? " \ud83e\udd16" : "";
      const pColor = item.priority <= 1 ? RED : item.priority === 2 ? YELLOW : CYAN;
      lines.push(`  ${pColor}P${item.priority}${RESET}  ${item.title}${" ".repeat(Math.max(1, 30 - item.title.length))}${DIM}${projectName}${RESET}${agentStr}`);
    }
  }

  return lines.join("\n");
}

function formatWorkItemCli(item: WorkItem, hasAgent: boolean): string {
  const pColor = item.priority <= 1 ? RED : item.priority === 2 ? YELLOW : CYAN;
  const priority = `${pColor}P${item.priority}${RESET}`;
  const statusIcon = item.status === "in-progress" ? `${YELLOW}\u25b6${RESET}` :
    item.status === "closed" ? `${GREEN}\u2713${RESET}` :
    item.status === "deferred" ? `${DIM}\u2298${RESET}` :
    `\u25cb`;
  const agentStr = hasAgent ? " \ud83e\udd16" : "";
  return `${priority} ${statusIcon} ${item.title}${agentStr}`;
}

function formatConfidence(c: string): string {
  if (c === "high") return `${GREEN}high${RESET}`;
  if (c === "medium") return `${YELLOW}medium${RESET}`;
  return `${RED}low${RESET}`;
}

export function formatStackSummary(stack: StackInfo): string {
  const parts: string[] = [];

  if (stack.frameworks.length > 0) {
    parts.push(stack.frameworks.map((f) => f.name).join(" + "));
  } else if (stack.languages.length > 0) {
    parts.push(stack.languages.map((l) => l.name).join(" + "));
  }

  if (stack.infrastructure.length > 0) {
    const infraStr = stack.infrastructure.map((i) => capitalize(i.name)).join(" + ");
    parts.push(infraStr);
  }

  return parts.join(` ${DIM}+${RESET} `) || `${DIM}Data/experimental${RESET}`;
}

function formatGitBrief(git: GitInfo): string {
  const branch = `${CYAN}${git.branch}${RESET}`;
  if (git.clean) {
    return `${branch}  ${GREEN}clean${RESET}`;
  }
  const count = git.uncommittedCount ?? 0;
  return `${branch}  ${YELLOW}${count} uncommitted${RESET}`;
}

export function formatRelativeTime(isoDate: string): string {
  const now = Date.now();
  const then = new Date(isoDate).getTime();
  const diffMs = now - then;
  const diffMin = Math.floor(diffMs / 60_000);
  const diffHr = Math.floor(diffMs / 3_600_000);
  const diffDay = Math.floor(diffMs / 86_400_000);

  if (diffMin < 1) return "just now";
  if (diffMin < 60) return `${diffMin}m ago`;
  if (diffHr < 24) return `${diffHr}h ago`;
  if (diffDay < 30) return `${diffDay}d ago`;
  return `${Math.floor(diffDay / 30)}mo ago`;
}

/**
 * Format a detected profile for interactive confirmation.
 * Returns null if the profile is empty (nothing to confirm).
 */
export function formatProfilePrompt(profile: Partial<ProjectProfileConfig>): string | null {
  const hasCommands = profile.commands && profile.commands.length > 0;
  const hasMappings = profile.fieldMappings && profile.fieldMappings.length > 0;
  const hasConstraints = profile.agentConstraints && profile.agentConstraints.length > 0;

  if (!hasCommands && !hasMappings && !hasConstraints) return null;

  const lines: string[] = [];
  lines.push(`  ${BOLD}Detected profile:${RESET}`);

  if (hasCommands) {
    for (const cmd of profile.commands!) {
      const desc = cmd.description ? `  ${DIM}(${cmd.description})${RESET}` : "";
      lines.push(`    ${CYAN}${cmd.name}${RESET}: ${cmd.command}${desc}`);
    }
  }

  if (hasMappings) {
    lines.push(`    ${BOLD}Ticket fields:${RESET}`);
    for (const fm of profile.fieldMappings!) {
      lines.push(`      ${fm.field} ${DIM}\u2192${RESET} ${fm.type}`);
    }
  }

  if (hasConstraints) {
    lines.push(`    ${BOLD}Agent constraints:${RESET}`);
    for (const c of profile.agentConstraints!) {
      lines.push(`      ${YELLOW}${c.name}${RESET}: ${c.rule}`);
    }
  }

  lines.push("");
  lines.push(`  ${DIM}[Enter]${RESET} accept  ${DIM}[e]${RESET} edit  ${DIM}[s]${RESET} skip profile`);

  return lines.join("\n");
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
