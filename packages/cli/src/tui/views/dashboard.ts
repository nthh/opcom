// TUI Dashboard View (Level 1)
// Projects panel | Work queue panel | Agents panel

import type { ProjectStatusSnapshot, AgentSession, WorkItem, Plan, PlanStep } from "@opcom/types";
import type { Panel } from "../layout.js";
import {
  ScreenBuffer,
  drawBox,
  ANSI,
  bold,
  dim,
  color,
  stateColor,
  truncate,
  progressBar,
} from "../renderer.js";

export interface PlanPanelState {
  plan: Plan;
}

export interface DashboardWorkItem {
  item: WorkItem;
  projectId: string;
  projectName: string;
}

export interface DashboardState {
  projects: ProjectStatusSnapshot[];
  agents: AgentSession[];
  workItems: DashboardWorkItem[];
  focusedPanel: number; // 0=projects, 1=workqueue, 2=agents
  selectedIndex: number[]; // selected item per panel
  scrollOffset: number[]; // scroll offset per panel
  priorityFilter: number | null; // null = all, 0-4 = filter
  projectFilter: string | null; // null = all, string = projectId
  searchQuery: string;
  planPanel: PlanPanelState | null; // non-null when plan is active
}

export function createDashboardState(): DashboardState {
  return {
    projects: [],
    agents: [],
    workItems: [],
    focusedPanel: 0,
    selectedIndex: [0, 0, 0],
    scrollOffset: [0, 0, 0],
    priorityFilter: null,
    projectFilter: null,
    searchQuery: "",
    planPanel: null,
  };
}

export function renderDashboard(
  buf: ScreenBuffer,
  panels: Panel[],
  state: DashboardState,
): void {
  const projectsPanel = panels.find((p) => p.id === "projects");
  const workqueuePanel = panels.find((p) => p.id === "workqueue");
  const agentsPanel = panels.find((p) => p.id === "agents");

  if (projectsPanel) renderProjectsPanel(buf, projectsPanel, state, state.focusedPanel === 0);
  if (workqueuePanel) {
    if (state.planPanel) {
      renderPlanPanel(buf, workqueuePanel, state, state.focusedPanel === 1);
    } else {
      renderWorkQueuePanel(buf, workqueuePanel, state, state.focusedPanel === 1);
    }
  }
  if (agentsPanel) renderAgentsPanel(buf, agentsPanel, state, state.focusedPanel === 2);
}

function renderProjectsPanel(
  buf: ScreenBuffer,
  panel: Panel,
  state: DashboardState,
  focused: boolean,
): void {
  const { projects } = state;
  const count = projects.length;
  const title = `Projects (${count})`;

  drawBox(buf, panel.x, panel.y, panel.width, panel.height, title, focused);

  const contentWidth = panel.width - 4;
  const maxItems = panel.height - 2;
  const selected = state.selectedIndex[0] ?? 0;
  const scroll = state.scrollOffset[0] ?? 0;

  if (projects.length === 0) {
    buf.writeLine(panel.y + 1, panel.x + 2, dim("No projects. Run 'opcom add <path>'"), contentWidth);
    return;
  }

  for (let i = 0; i < maxItems && i + scroll < projects.length; i++) {
    const idx = i + scroll;
    const project = projects[idx];
    const row = panel.y + 1 + i;
    const isSelected = idx === selected && focused;

    const line = formatProjectLine(project, contentWidth);
    if (isSelected) {
      buf.writeLine(row, panel.x + 2, ANSI.reverse + line + ANSI.reset, contentWidth);
    } else {
      buf.writeLine(row, panel.x + 2, line, contentWidth);
    }
  }
}

function formatProjectLine(project: ProjectStatusSnapshot, maxWidth: number): string {
  const name = bold(project.name);
  const git = project.git;

  let gitStr = "";
  if (git) {
    const branchStr = color(ANSI.cyan, git.branch);
    const cleanStr = git.clean
      ? color(ANSI.green, "clean")
      : color(ANSI.yellow, `${git.uncommittedCount ?? 0} dirty`);
    gitStr = ` ${branchStr} ${cleanStr}`;
  }

  let ticketStr = "";
  if (project.workSummary) {
    const ws = project.workSummary;
    ticketStr = dim(` [${ws.open}/${ws.total}]`);
  }

  let cloudStr = "";
  if (project.cloudHealthSummary && project.cloudHealthSummary.total > 0) {
    cloudStr = ` ${formatCloudDots(project.cloudHealthSummary)}`;
  }

  const line = `${name}${gitStr}${ticketStr}${cloudStr}`;
  return truncate(line, maxWidth);
}

function formatCloudDots(summary: import("@opcom/types").CloudHealthSummary): string {
  const dots: string[] = [];
  for (let i = 0; i < summary.healthy; i++) dots.push(color(ANSI.green, "\u25cf"));
  for (let i = 0; i < summary.degraded; i++) dots.push(color(ANSI.yellow, "\u25d0"));
  for (let i = 0; i < summary.unreachable; i++) dots.push(color(ANSI.red, "\u25cb"));
  for (let i = 0; i < summary.unknown; i++) dots.push(dim("\u25cc"));
  return dots.join("");
}

function renderWorkQueuePanel(
  buf: ScreenBuffer,
  panel: Panel,
  state: DashboardState,
  focused: boolean,
): void {
  const items = getFilteredWorkItems(state);
  const showProject = state.projectFilter === null;

  const projectLabel = state.projectFilter !== null
    ? (() => {
        const proj = state.projects.find((p) => p.id === state.projectFilter);
        return ` [${proj?.name ?? state.projectFilter}]`;
      })()
    : "";
  const priorityLabel = state.priorityFilter !== null ? ` P${state.priorityFilter}` : "";
  const title = `Work Queue (${items.length})${projectLabel}${priorityLabel}`;

  drawBox(buf, panel.x, panel.y, panel.width, panel.height, title, focused);

  const contentWidth = panel.width - 4;
  const maxItems = panel.height - 2;
  const selected = state.selectedIndex[1] ?? 0;
  const scroll = state.scrollOffset[1] ?? 0;

  if (items.length === 0) {
    buf.writeLine(panel.y + 1, panel.x + 2, dim("No work items"), contentWidth);
    return;
  }

  for (let i = 0; i < maxItems && i + scroll < items.length; i++) {
    const idx = i + scroll;
    const dw = items[idx];
    const row = panel.y + 1 + i;
    const isSelected = idx === selected && focused;

    const line = formatWorkItemLine(dw, state.agents, contentWidth, showProject);
    if (isSelected) {
      buf.writeLine(row, panel.x + 2, ANSI.reverse + line + ANSI.reset, contentWidth);
    } else {
      buf.writeLine(row, panel.x + 2, line, contentWidth);
    }
  }
}

function formatWorkItemLine(
  dw: DashboardWorkItem,
  agents: AgentSession[],
  maxWidth: number,
  showProject: boolean,
): string {
  const item = dw.item;
  const priorityColors = [ANSI.red, ANSI.red, ANSI.yellow, ANSI.cyan, ANSI.dim];
  const pColor = priorityColors[item.priority] ?? ANSI.dim;
  const priority = color(pColor, `P${item.priority}`);

  const projectLabel = showProject ? dim(`[${dw.projectName}] `) : "";

  const statusIcon = item.status === "in-progress" ? color(ANSI.yellow, "\u25b6") :
    item.status === "closed" ? color(ANSI.green, "\u2713") :
    color(ANSI.white, "\u25cb");

  const hasAgent = agents.some((a) => a.workItemId === item.id && a.state !== "stopped");
  const agentIcon = hasAgent ? " \ud83e\udd16" : "";

  const line = `${priority} ${statusIcon} ${projectLabel}${item.title}${agentIcon}`;
  return truncate(line, maxWidth);
}

function planStepIcon(status: string): string {
  switch (status) {
    case "blocked": return "\u25cc"; // ◌
    case "ready": return "\u25cb"; // ○
    case "in-progress": return "\u25cf"; // ●
    case "verifying": return "\u25ce"; // ◎
    case "done": return "\u2713"; // ✓
    case "failed": return "\u2717"; // ✗
    case "skipped": return "\u2298"; // ⊘
    case "needs-rebase": return "\u21c4"; // ⇄
    case "rebasing": return "\u27f3"; // ⟳
    default: return "?";
  }
}

function planStatusColor(status: string): string {
  switch (status) {
    case "in-progress": return ANSI.yellow;
    case "verifying": return ANSI.orange;
    case "ready": return ANSI.cyan;
    case "done": return ANSI.green;
    case "failed": return ANSI.red;
    case "needs-rebase": return ANSI.red;
    case "rebasing": return ANSI.yellow;
    case "skipped": return ANSI.dim;
    case "blocked": return ANSI.dim;
    default: return ANSI.white;
  }
}

function renderPlanPanel(
  buf: ScreenBuffer,
  panel: Panel,
  state: DashboardState,
  focused: boolean,
): void {
  const plan = state.planPanel!.plan;
  const done = plan.steps.filter((s) => s.status === "done" || s.status === "skipped").length;
  const total = plan.steps.length;
  const planStatusIcon = plan.status === "executing" ? "\u25cf" :
    plan.status === "paused" ? "\u25cc" :
    plan.status === "done" ? "\u2713" : "\u25cb";

  const verifiedCount = plan.steps.filter((s) => s.verification?.passed).length;
  const failedVerifyCount = plan.steps.filter((s) => s.verification && !s.verification.passed).length;
  let verifyStr = "";
  if (verifiedCount > 0 || failedVerifyCount > 0) {
    const parts: string[] = [];
    if (verifiedCount > 0) parts.push(color(ANSI.green, `\u2713${verifiedCount}`));
    if (failedVerifyCount > 0) parts.push(color(ANSI.red, `\u2717${failedVerifyCount}`));
    verifyStr = ` [${parts.join(" ")}]`;
  }

  const title = `Plan: ${plan.name} ${planStatusIcon} ${plan.status} ${done}/${total}${verifyStr}`;

  drawBox(buf, panel.x, panel.y, panel.width, panel.height, title, focused);

  const contentWidth = panel.width - 4;
  const maxItems = panel.height - 2;
  const selected = state.selectedIndex[1] ?? 0;
  const scroll = state.scrollOffset[1] ?? 0;

  if (plan.steps.length === 0) {
    buf.writeLine(panel.y + 1, panel.x + 2, dim("No steps in plan"), contentWidth);
    return;
  }

  // Group by track
  const tracks = new Map<string, typeof plan.steps>();
  for (const step of plan.steps) {
    const track = step.track ?? "unassigned";
    if (!tracks.has(track)) tracks.set(track, []);
    tracks.get(track)!.push(step);
  }

  // Build flat list of display lines: track headers + steps
  const lines: Array<{ type: "track"; name: string } | { type: "step"; step: typeof plan.steps[0]; index: number }> = [];
  let stepIdx = 0;
  for (const [trackName, steps] of tracks) {
    lines.push({ type: "track", name: trackName });
    for (const step of steps) {
      lines.push({ type: "step", step, index: stepIdx++ });
    }
  }

  for (let i = 0; i < maxItems && i + scroll < lines.length; i++) {
    const idx = i + scroll;
    const line = lines[idx];
    const row = panel.y + 1 + i;

    if (line.type === "track") {
      buf.writeLine(row, panel.x + 2, bold(dim(`[${line.name}]`)), contentWidth);
    } else {
      const step = line.step;
      const displayStatus = step.rebaseConflict ? "rebasing" : step.status;
      const icon = planStepIcon(displayStatus);
      const sColor = planStatusColor(displayStatus);
      const reVerify = displayStatus === "verifying" && (step.attempt ?? 1) > 1 ? "re-" : "";
      const phaseLabel = displayStatus === "verifying" && step.verifyingPhase
        ? `${reVerify}${step.verifyingPhase}...`
        : displayStatus;
      const statusStr = color(sColor, `${icon} ${phaseLabel}`);
      const verifyBadge = formatStepVerificationBadge(step);
      const text = `  ${statusStr} ${step.ticketId}${verifyBadge}`;
      const isSelected = line.index === selected && focused;

      if (isSelected) {
        buf.writeLine(row, panel.x + 2, ANSI.reverse + truncate(text, contentWidth) + ANSI.reset, contentWidth);
      } else {
        buf.writeLine(row, panel.x + 2, truncate(text, contentWidth), contentWidth);
      }
    }
  }
}

/** Format a compact verification badge for a plan step in the dashboard list */
export function formatStepVerificationBadge(step: PlanStep): string {
  const attemptSuffix = (step.attempt ?? 1) > 1 ? dim(` #${step.attempt}`) : "";
  const rebaseSuffix = (step.rebaseAttempts ?? 0) > 0 ? dim(` r${step.rebaseAttempts}`) : "";

  if (!step.verification) return `${attemptSuffix}${rebaseSuffix}`;
  const v = step.verification;
  if (v.passed) {
    if (v.testGate) {
      return ` ${color(ANSI.green, `\u2713 ${v.testGate.passedTests}/${v.testGate.totalTests}`)}${attemptSuffix}${rebaseSuffix}`;
    }
    return ` ${color(ANSI.green, "\u2713 verified")}${attemptSuffix}${rebaseSuffix}`;
  }
  // Failed
  if (v.testGate && !v.testGate.passed) {
    return ` ${color(ANSI.red, `\u2717 ${v.testGate.passedTests}/${v.testGate.totalTests}`)}${attemptSuffix}${rebaseSuffix}`;
  }
  if (v.oracle && !v.oracle.passed) {
    return ` ${color(ANSI.red, "\u2717 oracle")}${attemptSuffix}${rebaseSuffix}`;
  }
  return ` ${color(ANSI.red, "\u2717 verify")}${attemptSuffix}${rebaseSuffix}`;
}

function renderAgentsPanel(
  buf: ScreenBuffer,
  panel: Panel,
  state: DashboardState,
  focused: boolean,
): void {
  const { agents } = state;
  const activeAgents = agents.filter((a) => a.state !== "stopped");
  const title = `Agents (${activeAgents.length})`;

  drawBox(buf, panel.x, panel.y, panel.width, panel.height, title, focused);

  const contentWidth = panel.width - 4;
  const maxItems = panel.height - 2;
  const selected = state.selectedIndex[2] ?? 0;
  const scroll = state.scrollOffset[2] ?? 0;

  if (agents.length === 0) {
    buf.writeLine(panel.y + 1, panel.x + 2, dim("No agents running"), contentWidth);
    buf.writeLine(panel.y + 2, panel.x + 2, dim("Press 'w' on a project to start one"), contentWidth);
    return;
  }

  const sorted = sortAgents(agents, state.planPanel?.plan ?? null);

  for (let i = 0; i < maxItems && i + scroll < sorted.length; i++) {
    const idx = i + scroll;
    const agent = sorted[idx];
    const row = panel.y + 1 + i;
    const isSelected = idx === selected && focused;

    const lines = formatAgentLines(agent, state.projects, state.planPanel?.plan ?? null, contentWidth);
    if (isSelected) {
      buf.writeLine(row, panel.x + 2, ANSI.reverse + lines[0] + ANSI.reset, contentWidth);
    } else {
      buf.writeLine(row, panel.x + 2, lines[0], contentWidth);
    }

    // If there's room, show detail line
    if (i + 1 < maxItems && lines.length > 1) {
      i++;
      const detailRow = panel.y + 1 + i;
      buf.writeLine(detailRow, panel.x + 4, lines[1], contentWidth - 2);
    }
  }
}

function formatAgentLines(
  agent: AgentSession,
  projects: ProjectStatusSnapshot[],
  plan: Plan | null,
  maxWidth: number,
): string[] {
  const project = projects.find((p) => p.id === agent.projectId);
  const projectName = project?.name ?? agent.projectId.slice(0, 8);
  const sColor = stateColor(agent.state);
  const stateStr = color(sColor, agent.state);

  const duration = formatDuration(agent.startedAt, agent.stoppedAt);

  // Show plan step ticket ID prominently if agent is executing a plan step
  const planStep = getPlanStepForAgent(agent, plan);
  const planLabel = planStep ? color(ANSI.yellow, ` [step:${planStep.ticketId}]`) : "";

  const line1 = `${bold(projectName)} ${stateStr}${planLabel} ${dim(duration)}`;

  // Detail line: context usage + last activity
  const parts: string[] = [];
  if (agent.contextUsage) {
    const ctx = agent.contextUsage;
    const pct = Math.round(ctx.percentage);
    const bar = progressBar(ctx.tokensUsed, ctx.maxTokens, 10);
    parts.push(`${bar} ${pct}%`);
  }
  if (agent.workItemId) {
    parts.push(dim(`ticket:${agent.workItemId}`));
  }
  const line2 = parts.join("  ");

  return line2 ? [truncate(line1, maxWidth), truncate(line2, maxWidth - 2)] : [truncate(line1, maxWidth)];
}

// --- Agent sorting helpers ---

/** Find the in-progress plan step assigned to this agent, if any */
export function getPlanStepForAgent(agent: AgentSession, plan: Plan | null): PlanStep | undefined {
  if (!plan) return undefined;
  return plan.steps.find(
    (s) => s.agentSessionId === agent.id && s.status === "in-progress",
  );
}

/**
 * Returns sort tier for an agent: 0 = plan-active, 1 = other-active, 2 = idle, 3 = stopped.
 * Lower tier = higher priority in the list.
 */
export function getAgentSortTier(agent: AgentSession, plan: Plan | null): 0 | 1 | 2 | 3 {
  if (agent.state === "stopped") return 3;
  if (agent.state === "idle") return 2;
  // Agent is active (streaming, waiting, error) — check if plan-active
  if (getPlanStepForAgent(agent, plan)) return 0;
  return 1;
}

/** Sort agents by four tiers: plan-active > other-active > idle > stopped. Stable within tiers. */
export function sortAgents(agents: AgentSession[], plan: Plan | null): AgentSession[] {
  return [...agents].sort((a, b) => {
    return getAgentSortTier(a, plan) - getAgentSortTier(b, plan);
  });
}

function formatDuration(startedAt: string, stoppedAt?: string): string {
  const start = new Date(startedAt).getTime();
  const end = stoppedAt ? new Date(stoppedAt).getTime() : Date.now();
  const diffMs = end - start;

  const seconds = Math.floor(diffMs / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);

  if (hours > 0) return `${hours}h${minutes % 60}m`;
  if (minutes > 0) return `${minutes}m${seconds % 60}s`;
  return `${seconds}s`;
}

// --- Navigation helpers ---

export function getFilteredWorkItems(state: DashboardState): DashboardWorkItem[] {
  let items = state.workItems;

  // Project filter
  if (state.projectFilter !== null) {
    items = items.filter((w) => w.projectId === state.projectFilter);
  }

  // Priority filter
  if (state.priorityFilter !== null) {
    items = items.filter((w) => w.item.priority === state.priorityFilter);
  }

  // Search filter
  if (state.searchQuery) {
    const q = state.searchQuery.toLowerCase();
    items = items.filter(
      (w) =>
        w.item.title.toLowerCase().includes(q) ||
        w.item.id.toLowerCase().includes(q) ||
        w.projectName.toLowerCase().includes(q),
    );
  }

  return [...items].sort((a, b) => a.item.priority - b.item.priority);
}

export function getPanelItemCount(state: DashboardState, panelIndex: number): number {
  switch (panelIndex) {
    case 0: return state.projects.length;
    case 1:
      if (state.planPanel) return state.planPanel.plan.steps.length;
      return getFilteredWorkItems(state).length;
    case 2: return state.agents.length;
    default: return 0;
  }
}

/**
 * Get plan steps in display order (grouped by track).
 * Used by both rendering and drill-down to ensure consistent indexing.
 */
export function getPlanStepsInDisplayOrder(plan: Plan): PlanStep[] {
  const tracks = new Map<string, PlanStep[]>();
  for (const step of plan.steps) {
    const track = step.track ?? "unassigned";
    if (!tracks.has(track)) tracks.set(track, []);
    tracks.get(track)!.push(step);
  }
  const ordered: PlanStep[] = [];
  for (const steps of tracks.values()) {
    ordered.push(...steps);
  }
  return ordered;
}

export function clampSelection(state: DashboardState): void {
  for (let p = 0; p < 3; p++) {
    const count = getPanelItemCount(state, p);
    if (count === 0) {
      state.selectedIndex[p] = 0;
      state.scrollOffset[p] = 0;
    } else {
      state.selectedIndex[p] = Math.min(state.selectedIndex[p], count - 1);
      state.selectedIndex[p] = Math.max(state.selectedIndex[p], 0);
    }
  }
}
