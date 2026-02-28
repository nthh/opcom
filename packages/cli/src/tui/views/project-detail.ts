// TUI Project Detail View (Level 2)
// Tickets panel | Agents panel | Stack panel

import type { ProjectStatusSnapshot, AgentSession, WorkItem, ProjectConfig } from "@opcom/types";
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

export interface ProjectDetailState {
  project: ProjectStatusSnapshot;
  projectConfig: ProjectConfig | null;
  tickets: WorkItem[];
  agents: AgentSession[];
  focusedPanel: number; // 0=tickets, 1=agents, 2=stack
  selectedIndex: number[]; // per panel
  scrollOffset: number[]; // per panel
}

export function createProjectDetailState(project: ProjectStatusSnapshot): ProjectDetailState {
  return {
    project,
    projectConfig: null,
    tickets: [],
    agents: [],
    focusedPanel: 0,
    selectedIndex: [0, 0, 0],
    scrollOffset: [0, 0, 0],
  };
}

export function renderProjectDetail(
  buf: ScreenBuffer,
  panels: Panel[],
  state: ProjectDetailState,
): void {
  const ticketsPanel = panels.find((p) => p.id === "tickets");
  const agentsPanel = panels.find((p) => p.id === "agents");
  const stackPanel = panels.find((p) => p.id === "stack");

  if (ticketsPanel) renderTicketsPanel(buf, ticketsPanel, state, state.focusedPanel === 0);
  if (agentsPanel) renderAgentsPanel(buf, agentsPanel, state, state.focusedPanel === 1);
  if (stackPanel) renderStackPanel(buf, stackPanel, state, state.focusedPanel === 2);
}

// --- Tickets Panel ---

interface TicketGroup {
  label: string;
  items: WorkItem[];
}

function groupTickets(tickets: WorkItem[]): TicketGroup[] {
  const groups: TicketGroup[] = [
    { label: "In Progress", items: [] },
    { label: "Open", items: [] },
    { label: "Deferred", items: [] },
    { label: "Closed", items: [] },
  ];

  for (const ticket of tickets) {
    switch (ticket.status) {
      case "in-progress":
        groups[0].items.push(ticket);
        break;
      case "open":
        groups[1].items.push(ticket);
        break;
      case "deferred":
        groups[2].items.push(ticket);
        break;
      case "closed":
        groups[3].items.push(ticket);
        break;
    }
  }

  // Sort each group by priority
  for (const group of groups) {
    group.items.sort((a, b) => a.priority - b.priority);
  }

  return groups.filter((g) => g.items.length > 0);
}

// Build flat list of display rows for tickets (with group headers)
interface TicketRow {
  kind: "header" | "ticket";
  label?: string;
  ticket?: WorkItem;
}

function buildTicketRows(tickets: WorkItem[]): TicketRow[] {
  const groups = groupTickets(tickets);
  const rows: TicketRow[] = [];
  for (const group of groups) {
    rows.push({ kind: "header", label: `${group.label} (${group.items.length})` });
    for (const ticket of group.items) {
      rows.push({ kind: "ticket", ticket });
    }
  }
  return rows;
}

function renderTicketsPanel(
  buf: ScreenBuffer,
  panel: Panel,
  state: ProjectDetailState,
  focused: boolean,
): void {
  const title = `${state.project.name} - Tickets (${state.tickets.length})`;
  drawBox(buf, panel.x, panel.y, panel.width, panel.height, title, focused);

  const contentWidth = panel.width - 4;
  const maxItems = panel.height - 2;
  const selected = state.selectedIndex[0] ?? 0;
  const scroll = state.scrollOffset[0] ?? 0;

  if (state.tickets.length === 0) {
    buf.writeLine(panel.y + 1, panel.x + 2, dim("No tickets found"), contentWidth);
    return;
  }

  const rows = buildTicketRows(state.tickets);

  // Map selected index to the nth ticket (skip headers)
  let ticketIdx = 0;

  for (let i = 0; i < maxItems && i + scroll < rows.length; i++) {
    const rowIdx = i + scroll;
    const row = rows[rowIdx];
    const y = panel.y + 1 + i;

    if (row.kind === "header") {
      buf.writeLine(y, panel.x + 2, bold(row.label ?? ""), contentWidth);
    } else if (row.ticket) {
      const isSelected = ticketIdx === selected && focused;
      const line = formatTicketLine(row.ticket, state.agents, contentWidth);
      if (isSelected) {
        buf.writeLine(y, panel.x + 2, ANSI.reverse + line + ANSI.reset, contentWidth);
      } else {
        buf.writeLine(y, panel.x + 2, line, contentWidth);
      }
      ticketIdx++;
    }
  }
}

function formatTicketLine(
  ticket: WorkItem,
  agents: AgentSession[],
  maxWidth: number,
): string {
  const priorityColors = [ANSI.red, ANSI.red, ANSI.yellow, ANSI.cyan, ANSI.dim];
  const pColor = priorityColors[ticket.priority] ?? ANSI.dim;
  const priority = color(pColor, `P${ticket.priority}`);

  const statusIcons: Record<string, string> = {
    "in-progress": color(ANSI.yellow, "\u25b6"),
    "open": color(ANSI.white, "\u25cb"),
    "closed": color(ANSI.green, "\u2713"),
    "deferred": color(ANSI.dim, "\u2013"),
  };
  const statusIcon = statusIcons[ticket.status] ?? "\u25cb";

  const hasAgent = agents.some((a) => a.workItemId === ticket.id && a.state !== "stopped");
  const agentIcon = hasAgent ? " \ud83e\udd16" : "";

  const typeStr = ticket.type ? dim(` [${ticket.type}]`) : "";

  const line = `  ${priority} ${statusIcon} ${ticket.id}: ${ticket.title}${typeStr}${agentIcon}`;
  return truncate(line, maxWidth);
}

// --- Agents Panel ---

function renderAgentsPanel(
  buf: ScreenBuffer,
  panel: Panel,
  state: ProjectDetailState,
  focused: boolean,
): void {
  const projectAgents = state.agents.filter((a) => a.projectId === state.project.id);
  const title = `Agents (${projectAgents.filter((a) => a.state !== "stopped").length})`;

  drawBox(buf, panel.x, panel.y, panel.width, panel.height, title, focused);

  const contentWidth = panel.width - 4;
  const maxItems = panel.height - 2;
  const selected = state.selectedIndex[1] ?? 0;
  const scroll = state.scrollOffset[1] ?? 0;

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

function formatAgentLine(agent: AgentSession, maxWidth: number): string {
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

// --- Stack Panel ---

function renderStackPanel(
  buf: ScreenBuffer,
  panel: Panel,
  state: ProjectDetailState,
  focused: boolean,
): void {
  const title = "Stack";
  drawBox(buf, panel.x, panel.y, panel.width, panel.height, title, focused);

  const contentWidth = panel.width - 4;
  let row = panel.y + 1;
  const maxRow = panel.y + panel.height - 1;

  const config = state.projectConfig;
  if (!config) {
    buf.writeLine(row, panel.x + 2, dim("Loading..."), contentWidth);
    return;
  }

  const stack = config.stack;

  // Languages
  if (stack.languages.length > 0 && row < maxRow) {
    buf.writeLine(row++, panel.x + 2, bold("Languages"), contentWidth);
    for (const lang of stack.languages) {
      if (row >= maxRow) break;
      const version = lang.version ? dim(` v${lang.version}`) : "";
      buf.writeLine(row++, panel.x + 4, `${lang.name}${version}`, contentWidth - 2);
    }
  }

  // Frameworks
  if (stack.frameworks.length > 0 && row < maxRow) {
    if (row > panel.y + 1) row++; // spacer
    buf.writeLine(row++, panel.x + 2, bold("Frameworks"), contentWidth);
    for (const fw of stack.frameworks) {
      if (row >= maxRow) break;
      const version = fw.version ? dim(` v${fw.version}`) : "";
      buf.writeLine(row++, panel.x + 4, `${fw.name}${version}`, contentWidth - 2);
    }
  }

  // Infrastructure
  if (stack.infrastructure.length > 0 && row < maxRow) {
    if (row > panel.y + 1) row++;
    buf.writeLine(row++, panel.x + 2, bold("Infrastructure"), contentWidth);
    for (const infra of stack.infrastructure) {
      if (row >= maxRow) break;
      buf.writeLine(row++, panel.x + 4, infra.name, contentWidth - 2);
    }
  }

  // Package managers
  if (stack.packageManagers.length > 0 && row < maxRow) {
    if (row > panel.y + 1) row++;
    buf.writeLine(row++, panel.x + 2, bold("Package Managers"), contentWidth);
    for (const pm of stack.packageManagers) {
      if (row >= maxRow) break;
      buf.writeLine(row++, panel.x + 4, pm.name, contentWidth - 2);
    }
  }

  // Testing
  if (config.testing && row < maxRow) {
    if (row > panel.y + 1) row++;
    buf.writeLine(row++, panel.x + 2, bold("Testing"), contentWidth);
    buf.writeLine(row++, panel.x + 4, config.testing.framework, contentWidth - 2);
  }

  // Services
  if (config.services.length > 0 && row < maxRow) {
    if (row > panel.y + 1) row++;
    buf.writeLine(row++, panel.x + 2, bold("Services"), contentWidth);
    for (const svc of config.services) {
      if (row >= maxRow) break;
      const port = svc.port ? dim(`:${svc.port}`) : "";
      buf.writeLine(row++, panel.x + 4, `${svc.name}${port}`, contentWidth - 2);
    }
  }
}

// --- Navigation helpers ---

export function getTicketsList(state: ProjectDetailState): WorkItem[] {
  // Return only actual tickets in order (no headers)
  const groups = groupTickets(state.tickets);
  const result: WorkItem[] = [];
  for (const group of groups) {
    result.push(...group.items);
  }
  return result;
}

export function getPanelItemCount(state: ProjectDetailState, panelIndex: number): number {
  switch (panelIndex) {
    case 0: return getTicketsList(state).length;
    case 1: return state.agents.filter((a) => a.projectId === state.project.id).length;
    case 2: return 0; // stack is not navigable
    default: return 0;
  }
}

export function clampSelection(state: ProjectDetailState): void {
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
