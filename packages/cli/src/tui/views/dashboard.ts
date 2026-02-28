// TUI Dashboard View (Level 1)
// Projects panel | Work queue panel | Agents panel

import type { ProjectStatusSnapshot, AgentSession, WorkItem } from "@opcom/types";
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

export interface DashboardState {
  projects: ProjectStatusSnapshot[];
  agents: AgentSession[];
  workItems: WorkItem[];
  focusedPanel: number; // 0=projects, 1=workqueue, 2=agents
  selectedIndex: number[]; // selected item per panel
  scrollOffset: number[]; // scroll offset per panel
  priorityFilter: number | null; // null = all, 0-4 = filter
  searchQuery: string;
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
    searchQuery: "",
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
  if (workqueuePanel) renderWorkQueuePanel(buf, workqueuePanel, state, state.focusedPanel === 1);
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

  const line = `${name}${gitStr}${ticketStr}`;
  return truncate(line, maxWidth);
}

function renderWorkQueuePanel(
  buf: ScreenBuffer,
  panel: Panel,
  state: DashboardState,
  focused: boolean,
): void {
  let items = state.workItems;

  // Apply priority filter
  if (state.priorityFilter !== null) {
    items = items.filter((w) => w.priority === state.priorityFilter);
  }

  // Apply search filter
  if (state.searchQuery) {
    const q = state.searchQuery.toLowerCase();
    items = items.filter(
      (w) => w.title.toLowerCase().includes(q) || w.id.toLowerCase().includes(q),
    );
  }

  // Sort by priority (P0 first)
  items = [...items].sort((a, b) => a.priority - b.priority);

  const filterLabel = state.priorityFilter !== null ? ` P${state.priorityFilter}` : "";
  const title = `Work Queue (${items.length})${filterLabel}`;

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
    const item = items[idx];
    const row = panel.y + 1 + i;
    const isSelected = idx === selected && focused;

    const line = formatWorkItemLine(item, state.agents, contentWidth);
    if (isSelected) {
      buf.writeLine(row, panel.x + 2, ANSI.reverse + line + ANSI.reset, contentWidth);
    } else {
      buf.writeLine(row, panel.x + 2, line, contentWidth);
    }
  }
}

function formatWorkItemLine(
  item: WorkItem,
  agents: AgentSession[],
  maxWidth: number,
): string {
  const priorityColors = [ANSI.red, ANSI.red, ANSI.yellow, ANSI.cyan, ANSI.dim];
  const pColor = priorityColors[item.priority] ?? ANSI.dim;
  const priority = color(pColor, `P${item.priority}`);

  const statusIcon = item.status === "in-progress" ? color(ANSI.yellow, "\u25b6") :
    item.status === "closed" ? color(ANSI.green, "\u2713") :
    color(ANSI.white, "\u25cb");

  const hasAgent = agents.some((a) => a.workItemId === item.id && a.state !== "stopped");
  const agentIcon = hasAgent ? " \ud83e\udd16" : "";

  const line = `${priority} ${statusIcon} ${item.title}${agentIcon}`;
  return truncate(line, maxWidth);
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

  // Show active agents first, then stopped
  const sorted = [...agents].sort((a, b) => {
    if (a.state === "stopped" && b.state !== "stopped") return 1;
    if (a.state !== "stopped" && b.state === "stopped") return -1;
    return 0;
  });

  for (let i = 0; i < maxItems && i + scroll < sorted.length; i++) {
    const idx = i + scroll;
    const agent = sorted[idx];
    const row = panel.y + 1 + i;
    const isSelected = idx === selected && focused;

    const lines = formatAgentLines(agent, state.projects, contentWidth);
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
  maxWidth: number,
): string[] {
  const project = projects.find((p) => p.id === agent.projectId);
  const projectName = project?.name ?? agent.projectId.slice(0, 8);
  const sColor = stateColor(agent.state);
  const stateStr = color(sColor, agent.state);

  const duration = formatDuration(agent.startedAt, agent.stoppedAt);

  const line1 = `${bold(projectName)} ${stateStr} ${dim(duration)}`;

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

export function getFilteredWorkItems(state: DashboardState): WorkItem[] {
  let items = state.workItems;
  if (state.priorityFilter !== null) {
    items = items.filter((w) => w.priority === state.priorityFilter);
  }
  if (state.searchQuery) {
    const q = state.searchQuery.toLowerCase();
    items = items.filter(
      (w) => w.title.toLowerCase().includes(q) || w.id.toLowerCase().includes(q),
    );
  }
  return [...items].sort((a, b) => a.priority - b.priority);
}

export function getPanelItemCount(state: DashboardState, panelIndex: number): number {
  switch (panelIndex) {
    case 0: return state.projects.length;
    case 1: return getFilteredWorkItems(state).length;
    case 2: return state.agents.length;
    default: return 0;
  }
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
