// TUI Project Detail View (Level 2)
// Tickets panel | Agents panel | Stack panel | Cloud panel

import type {
  ProjectStatusSnapshot,
  AgentSession,
  WorkItem,
  ProjectConfig,
  CloudService,
  CloudServiceKind,
} from "@opcom/types";
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
import { healthDot } from "./cloud-service-detail.js";

export interface ProjectDetailState {
  project: ProjectStatusSnapshot;
  projectConfig: ProjectConfig | null;
  tickets: WorkItem[];
  agents: AgentSession[];
  cloudServices: CloudService[];
  focusedPanel: number; // 0=tickets, 1=agents, 2=stack, 3=cloud
  selectedIndex: number[]; // per panel
  scrollOffset: number[]; // per panel
}

export function createProjectDetailState(project: ProjectStatusSnapshot): ProjectDetailState {
  return {
    project,
    projectConfig: null,
    tickets: [],
    agents: [],
    cloudServices: [],
    focusedPanel: 0,
    selectedIndex: [0, 0, 0, 0],
    scrollOffset: [0, 0, 0, 0],
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
  const cloudPanel = panels.find((p) => p.id === "cloud");

  if (ticketsPanel) renderTicketsPanel(buf, ticketsPanel, state, state.focusedPanel === 0);
  if (agentsPanel) renderAgentsPanel(buf, agentsPanel, state, state.focusedPanel === 1);
  if (stackPanel) renderStackPanel(buf, stackPanel, state, state.focusedPanel === 2);
  if (cloudPanel) renderCloudPanel(buf, cloudPanel, state, state.focusedPanel === 3);
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

// --- Cloud Panel ---

/** Sections shown in cloud panel, organized by kind. Only shown if services exist. */
interface CloudSection {
  title: string;
  kind: CloudServiceKind;
  services: CloudService[];
}

/** Build cloud sections from services — only includes kinds with data. */
export function buildCloudSections(services: CloudService[]): CloudSection[] {
  const byKind = new Map<CloudServiceKind, CloudService[]>();
  for (const svc of services) {
    const list = byKind.get(svc.kind) ?? [];
    list.push(svc);
    byKind.set(svc.kind, list);
  }

  const sections: CloudSection[] = [];
  const kindOrder: Array<[CloudServiceKind, string]> = [
    ["database", "DATABASES"],
    ["storage", "STORAGE"],
    ["serverless", "SERVERLESS"],
    ["hosting", "HOSTING"],
    ["mobile", "MOBILE"],
  ];

  for (const [kind, title] of kindOrder) {
    const svcs = byKind.get(kind);
    if (svcs && svcs.length > 0) {
      sections.push({ title, kind, services: svcs });
    }
  }

  return sections;
}

/** Flat list of items in the cloud panel for navigation purposes. */
export function getCloudServicesList(state: ProjectDetailState): CloudService[] {
  const sections = buildCloudSections(state.cloudServices);
  const result: CloudService[] = [];
  for (const section of sections) {
    result.push(...section.services);
  }
  return result;
}

function renderCloudPanel(
  buf: ScreenBuffer,
  panel: Panel,
  state: ProjectDetailState,
  focused: boolean,
): void {
  const count = state.cloudServices.length;
  const title = count > 0 ? `Cloud (${count})` : "Cloud";
  drawBox(buf, panel.x, panel.y, panel.width, panel.height, title, focused);

  const contentWidth = panel.width - 4;
  const maxRows = panel.height - 2;
  const selected = state.selectedIndex[3] ?? 0;
  const scroll = state.scrollOffset[3] ?? 0;

  if (state.cloudServices.length === 0) {
    buf.writeLine(panel.y + 1, panel.x + 2, dim("No cloud services detected"), contentWidth);
    return;
  }

  const sections = buildCloudSections(state.cloudServices);

  // Build flat display rows: section headers + service lines
  interface DisplayRow {
    type: "header" | "service";
    text?: string;
    service?: CloudService;
    serviceIndex?: number;
  }
  const rows: DisplayRow[] = [];
  let svcIdx = 0;
  for (const section of sections) {
    rows.push({ type: "header", text: section.title });
    for (const svc of section.services) {
      rows.push({ type: "service", service: svc, serviceIndex: svcIdx++ });
    }
  }

  for (let i = 0; i < maxRows && i + scroll < rows.length; i++) {
    const rowIdx = i + scroll;
    const row = rows[rowIdx];
    const y = panel.y + 1 + i;

    if (row.type === "header") {
      buf.writeLine(y, panel.x + 2, bold(row.text ?? ""), contentWidth);
    } else if (row.service) {
      const isSelected = row.serviceIndex === selected && focused;
      const line = formatCloudServiceLine(row.service, contentWidth);
      if (isSelected) {
        buf.writeLine(y, panel.x + 2, ANSI.reverse + line + ANSI.reset, contentWidth);
      } else {
        buf.writeLine(y, panel.x + 2, line, contentWidth);
      }
    }
  }
}

function formatCloudServiceLine(service: CloudService, maxWidth: number): string {
  const dot = healthDot(service.status);
  const providerStr = shortProvider(service.provider);
  const name = service.name;

  // Kind-specific detail suffix
  let detail = "";
  switch (service.detail.kind) {
    case "database": {
      const d = service.detail;
      const parts: string[] = [];
      if (d.sizeBytes !== undefined) parts.push(formatBytes(d.sizeBytes));
      if (d.tableCount !== undefined) parts.push(`${d.tableCount} tables`);
      if (d.migration && d.migration.pending > 0) {
        parts.push(color(ANSI.yellow, `${d.migration.tool}: ${d.migration.pending} pending`));
      } else if (d.migration) {
        parts.push(dim(`${d.migration.tool}: 0 pending`));
      }
      detail = parts.join("  ");
      break;
    }
    case "storage": {
      const d = service.detail;
      if (d.buckets.length > 0) {
        const totalSize = d.buckets.reduce((s, b) => s + (b.sizeBytes ?? 0), 0);
        detail = totalSize > 0 ? formatBytes(totalSize) : `${d.buckets.length} bucket${d.buckets.length > 1 ? "s" : ""}`;
      }
      break;
    }
    case "serverless": {
      const d = service.detail;
      const httpCount = d.functions.filter((f) => f.trigger === "http").length;
      const schedCount = d.functions.filter((f) => f.trigger === "schedule").length;
      const parts: string[] = [];
      if (httpCount > 0) parts.push(`${httpCount} route${httpCount > 1 ? "s" : ""}`);
      if (schedCount > 0) parts.push(`${schedCount} sched`);
      detail = parts.join("  ");
      break;
    }
    case "hosting": {
      const d = service.detail;
      const primary = d.domains.find((dm) => dm.primary);
      if (primary) detail = primary.hostname;
      if (d.lastDeployedAt) {
        detail += detail ? `  ${dim(formatTimeAgo(d.lastDeployedAt))}` : dim(formatTimeAgo(d.lastDeployedAt));
      }
      break;
    }
    case "mobile": {
      const d = service.detail;
      const parts: string[] = [];
      if (d.currentVersion) parts.push(`v${d.currentVersion}`);
      parts.push(`(${d.distribution})`);
      detail = parts.join(" ");
      break;
    }
  }

  const detailStr = detail ? `  ${detail}` : "";
  const line = `  ${dot} ${providerStr}: ${name}${detailStr}`;
  return truncate(line, maxWidth);
}

function shortProvider(provider: string): string {
  const labels: Record<string, string> = {
    "turso": "Turso",
    "neon": "Neon",
    "planetscale": "PlanetScale",
    "supabase": "Supabase",
    "cloudflare-r2": "R2",
    "gcs": "GCS",
    "s3": "S3",
    "cloudflare-workers": "CF Workers",
    "firebase-functions": "FB Func",
    "firebase-hosting": "Firebase",
    "vercel": "Vercel",
    "netlify": "Netlify",
    "cloudflare-pages": "CF Pages",
    "expo-eas": "EAS",
    "firebase-app-distribution": "FB App Dist",
  };
  return labels[provider] ?? provider;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

function formatTimeAgo(iso: string): string {
  try {
    const diff = Date.now() - new Date(iso).getTime();
    if (diff < 60_000) return "just now";
    if (diff < 3600_000) return `${Math.floor(diff / 60_000)}m ago`;
    if (diff < 86400_000) return `${Math.floor(diff / 3600_000)}h ago`;
    return `${Math.floor(diff / 86400_000)}d ago`;
  } catch {
    return iso;
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
    case 3: return getCloudServicesList(state).length;
    default: return 0;
  }
}

/** Total number of panels for Tab cycling. */
export const PANEL_COUNT = 4;

export function clampSelection(state: ProjectDetailState): void {
  for (let p = 0; p < PANEL_COUNT; p++) {
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
