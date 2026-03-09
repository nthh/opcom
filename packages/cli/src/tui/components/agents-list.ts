// AgentsListComponent — Reusable agents panel for dashboard and project-detail views
// Extracted from inline renderAgentsPanel() in both views.

import type { AgentSession, ProjectStatusSnapshot, Plan, PlanStep } from "@opcom/types";
import type { TuiComponent } from "./types.js";
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

// --- Agent sorting helpers (moved from dashboard.ts) ---

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

// --- Component State ---

export type AgentsListMode = "dashboard" | "project-detail";

export interface AgentsListState {
  agents: AgentSession[];
  selectedIndex: number;
  scrollOffset: number;
  /** Panel height cached from last render, used for scroll adjustment in handleKey */
  panelHeight: number;
  // Dashboard-mode context (ignored in project-detail mode)
  projects: ProjectStatusSnapshot[];
  plan: Plan | null;
  // Mode
  mode: AgentsListMode;
  // Project-detail mode: filter agents to this project
  projectId: string | null;
}

/** Get the agents visible in this component (filtered/sorted by mode). */
export function getVisibleAgents(state: AgentsListState): AgentSession[] {
  if (state.mode === "project-detail" && state.projectId) {
    return state.agents.filter((a) => a.projectId === state.projectId);
  }
  return sortAgents(state.agents, state.plan);
}

/** Clamp selectedIndex/scrollOffset to valid range after data changes. */
export function clampAgentsSelection(state: AgentsListState): void {
  const count = getVisibleAgents(state).length;
  if (count === 0) {
    state.selectedIndex = 0;
    state.scrollOffset = 0;
  } else {
    state.selectedIndex = Math.min(state.selectedIndex, count - 1);
    state.selectedIndex = Math.max(state.selectedIndex, 0);
  }
}

// --- Scroll adjustment ---

function adjustScroll(state: AgentsListState): void {
  if (state.panelHeight <= 0) return;
  const maxVisible = state.panelHeight - 2; // box borders
  if (state.selectedIndex < state.scrollOffset) {
    state.scrollOffset = state.selectedIndex;
  } else if (state.selectedIndex >= state.scrollOffset + maxVisible) {
    state.scrollOffset = state.selectedIndex - maxVisible + 1;
  }
}

// --- Component ---

export const AgentsListComponent: TuiComponent<AgentsListState> = {
  id: "agents-list",

  init(): AgentsListState {
    return {
      agents: [],
      selectedIndex: 0,
      scrollOffset: 0,
      panelHeight: 0,
      projects: [],
      plan: null,
      mode: "dashboard",
      projectId: null,
    };
  },

  render(buf: ScreenBuffer, panel: Panel, state: AgentsListState, focused: boolean): void {
    // Cache panel height for scroll adjustment in handleKey
    state.panelHeight = panel.height;

    if (state.mode === "dashboard") {
      renderDashboardAgentsPanel(buf, panel, state, focused);
    } else {
      renderProjectAgentsPanel(buf, panel, state, focused);
    }
  },

  handleKey(key: string, state: AgentsListState): { handled: boolean; state: AgentsListState } {
    const itemCount = getVisibleAgents(state).length;

    switch (key) {
      case "j":
      case "\x1b[B": { // Down
        if (itemCount > 0) {
          const newState = { ...state };
          newState.selectedIndex = Math.min(state.selectedIndex + 1, itemCount - 1);
          adjustScroll(newState);
          return { handled: true, state: newState };
        }
        return { handled: true, state };
      }
      case "k":
      case "\x1b[A": { // Up
        if (itemCount > 0) {
          const newState = { ...state };
          newState.selectedIndex = Math.max(state.selectedIndex - 1, 0);
          adjustScroll(newState);
          return { handled: true, state: newState };
        }
        return { handled: true, state };
      }
      default:
        return { handled: false, state };
    }
  },
};

// --- Dashboard Mode Rendering ---

function renderDashboardAgentsPanel(
  buf: ScreenBuffer,
  panel: Panel,
  state: AgentsListState,
  focused: boolean,
): void {
  const { agents } = state;
  const activeAgents = agents.filter((a) => a.state !== "stopped");
  const title = `Agents (${activeAgents.length})`;

  drawBox(buf, panel.x, panel.y, panel.width, panel.height, title, focused);

  const contentWidth = panel.width - 4;
  const maxItems = panel.height - 2;
  const selected = state.selectedIndex;
  const scroll = state.scrollOffset;

  if (agents.length === 0) {
    buf.writeLine(panel.y + 1, panel.x + 2, dim("No agents running"), contentWidth);
    buf.writeLine(panel.y + 2, panel.x + 2, dim("Press 'w' on a project to start one"), contentWidth);
    return;
  }

  const sorted = sortAgents(agents, state.plan);

  for (let i = 0; i < maxItems && i + scroll < sorted.length; i++) {
    const idx = i + scroll;
    const agent = sorted[idx];
    const row = panel.y + 1 + i;
    const isSelected = idx === selected && focused;

    const lines = formatAgentLines(agent, state.projects, state.plan, contentWidth);
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

// --- Project Detail Mode Rendering ---

function renderProjectAgentsPanel(
  buf: ScreenBuffer,
  panel: Panel,
  state: AgentsListState,
  focused: boolean,
): void {
  const projectAgents = getVisibleAgents(state);
  const title = `Agents (${projectAgents.filter((a) => a.state !== "stopped").length})`;

  drawBox(buf, panel.x, panel.y, panel.width, panel.height, title, focused);

  const contentWidth = panel.width - 4;
  const maxItems = panel.height - 2;
  const selected = state.selectedIndex;
  const scroll = state.scrollOffset;

  if (projectAgents.length === 0) {
    buf.writeLine(panel.y + 1, panel.x + 2, dim("No agents for this project"), contentWidth);
    buf.writeLine(panel.y + 2, panel.x + 2, dim("Press 'w' on a ticket to start"), contentWidth);
    return;
  }

  for (let i = 0; i < maxItems && i + scroll < projectAgents.length; i++) {
    const idx = i + scroll;
    const agent = projectAgents[idx];
    const row = panel.y + 1 + i;
    const isSelected = idx === selected && focused;

    const line = formatAgentLine(agent, contentWidth);
    if (isSelected) {
      buf.writeLine(row, panel.x + 2, ANSI.reverse + line + ANSI.reset, contentWidth);
    } else {
      buf.writeLine(row, panel.x + 2, line, contentWidth);
    }
  }
}

// --- Formatting (moved from views/dashboard.ts and views/project-detail.ts) ---

/** Dashboard-mode agent formatting: project name + state + plan label + duration */
export function formatAgentLines(
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

/** Project-detail-mode agent formatting: short ID + state + ticket + context */
export function formatAgentLine(agent: AgentSession, maxWidth: number): string {
  const sColor = stateColor(agent.state);
  const stateStr = color(sColor, agent.state);
  const shortId = agent.id.slice(0, 8);
  const ticket = agent.workItemId ? ` ${dim(agent.workItemId)}` : "";

  let ctxStr = "";
  if (agent.contextUsage) {
    const pct = Math.round(agent.contextUsage.percentage);
    ctxStr = ` ${progressBar(agent.contextUsage.tokensUsed, agent.contextUsage.maxTokens, 8)} ${pct}%`;
  }

  const line = `${dim(shortId)} ${stateStr}${ticket}${ctxStr}`;
  return truncate(line, maxWidth);
}

/** Format elapsed duration from ISO timestamp. */
export function formatDuration(startedAt: string, stoppedAt?: string): string {
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
