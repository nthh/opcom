import type { ProjectConfig, StackInfo, WorkSummary, GitInfo, AgentSession } from "@opcom/types";
import type { ProjectStatus, ManagedProcess } from "@opcom/core";
import type { DetectionResult } from "@opcom/types";

const DIM = "\x1b[2m";
const BOLD = "\x1b[1m";
const RESET = "\x1b[0m";
const GREEN = "\x1b[32m";
const YELLOW = "\x1b[33m";
const CYAN = "\x1b[36m";
const RED = "\x1b[31m";

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

  return lines.join("\n");
}

export function formatStatusDashboard(
  workspaceName: string,
  statuses: ProjectStatus[],
  agents?: AgentSession[],
  processes?: ManagedProcess[],
): string {
  const lines: string[] = [];
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
        lines.push(`    ${DIM}→${RESET} ${a.backend}  ${stateColor}${a.state}${RESET}  ${elapsed}${ctx}${a.workItemId ? `  ${DIM}${a.workItemId}${RESET}` : ""}`);
      }
    }

    if (git?.lastCommitAt) {
      lines.push(`    Last commit: ${formatRelativeTime(git.lastCommitAt)}`);
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
      lines.push(`  ${GREEN}●${RESET} ${p.projectId}/${p.name}${port}  ${DIM}PID ${p.pid}${RESET}`);
    }
  } else {
    lines.push(`  ${DIM}No running processes${RESET}`);
  }

  return lines.join("\n");
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

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
