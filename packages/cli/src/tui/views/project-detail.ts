// TUI Project Detail View (Level 2)
// Tickets panel | Agents panel | Stack panel | Cloud panel

import type {
  ProjectStatusSnapshot,
  AgentSession,
  WorkItem,
  ProjectConfig,
  CloudService,
  CloudServiceKind,
  Pipeline,
  DeploymentStatus,
  InfraResource,
  PodDetail,
  ResourceStatus,
} from "@opcom/types";
import type { Panel } from "../layout.js";
import type { SpecCoverageItem } from "../health-data.js";
import {
  ScreenBuffer,
  drawBox,
  ANSI,
  bold,
  dim,
  color,
  truncate,
  padRight,
} from "../renderer.js";
import { healthDot } from "./cloud-service-detail.js";
import { renderCICDPanel, getCICDItemCount } from "./cicd-pane.js";
import {
  AgentsListComponent,
  getVisibleAgents,
  type AgentsListState,
} from "../components/agents-list.js";
import {
  ChatComponent,
  type ChatState,
} from "../components/chat.js";

export interface InfraCrashEvent {
  pod: PodDetail;
  container: string;
  reason: string;
  timestamp: string;
}

export interface ProjectDetailState {
  project: ProjectStatusSnapshot;
  projectConfig: ProjectConfig | null;
  tickets: WorkItem[];
  agents: AgentSession[];
  cloudServices: CloudService[];
  projectSpecs: SpecCoverageItem[];
  pipelines: Pipeline[];
  deployments: DeploymentStatus[];
  infraResources: InfraResource[];
  infraCrashEvents: InfraCrashEvent[];
  focusedPanel: number; // 0=tickets, 1=agents, 2=specs, 3=stack, 4=cloud, 5=cicd, 6=infra, 7=chat
  selectedIndex: number[]; // per panel
  scrollOffset: number[]; // per panel
  agentsComponent: AgentsListState; // component state for agents panel
  chatComponent: ChatState; // component state for chat panel
}

export function createProjectDetailState(project: ProjectStatusSnapshot): ProjectDetailState {
  const agentsComponent = AgentsListComponent.init();
  agentsComponent.mode = "project-detail";
  agentsComponent.projectId = project.id;
  return {
    project,
    projectConfig: null,
    tickets: [],
    agents: [],
    cloudServices: [],
    projectSpecs: [],
    pipelines: [],
    deployments: [],
    infraResources: [],
    infraCrashEvents: [],
    focusedPanel: 0,
    selectedIndex: [0, 0, 0, 0, 0, 0, 0, 0],
    scrollOffset: [0, 0, 0, 0, 0, 0, 0, 0],
    agentsComponent,
    chatComponent: ChatComponent.init(),
  };
}

export function renderProjectDetail(
  buf: ScreenBuffer,
  panels: Panel[],
  state: ProjectDetailState,
): void {
  const ticketsPanel = panels.find((p) => p.id === "tickets");
  const agentsPanel = panels.find((p) => p.id === "agents");
  const specsPanel = panels.find((p) => p.id === "specs");
  const stackPanel = panels.find((p) => p.id === "stack");
  const cloudPanel = panels.find((p) => p.id === "cloud");
  const cicdPanel = panels.find((p) => p.id === "cicd");
  const infraPanel = panels.find((p) => p.id === "infra");
  const chatPanel = panels.find((p) => p.id === "chat");

  if (ticketsPanel) renderTicketsPanel(buf, ticketsPanel, state, state.focusedPanel === 0);
  if (agentsPanel) AgentsListComponent.render(buf, agentsPanel, state.agentsComponent, state.focusedPanel === 1);
  if (specsPanel) renderSpecsPanel(buf, specsPanel, state, state.focusedPanel === 2);
  if (stackPanel) renderStackPanel(buf, stackPanel, state, state.focusedPanel === 3);
  if (cloudPanel) renderCloudPanel(buf, cloudPanel, state, state.focusedPanel === 4);
  if (cicdPanel) renderCICDPanel(
    buf, cicdPanel, state.pipelines, state.deployments,
    state.selectedIndex[5] ?? 0, state.scrollOffset[5] ?? 0, state.focusedPanel === 5,
  );
  if (infraPanel) renderInfraPanel(buf, infraPanel, state, state.focusedPanel === 6);
  if (chatPanel) ChatComponent.render(buf, chatPanel, state.chatComponent, state.focusedPanel === 7);
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

// --- Specs Panel ---

function renderSpecsPanel(
  buf: ScreenBuffer,
  panel: Panel,
  state: ProjectDetailState,
  focused: boolean,
): void {
  const count = state.projectSpecs.length;
  const title = count > 0 ? `Specs (${count})` : "Specs";
  drawBox(buf, panel.x, panel.y, panel.width, panel.height, title, focused);

  const contentWidth = panel.width - 4;
  const maxItems = panel.height - 2;
  const selected = state.selectedIndex[2] ?? 0;
  const scroll = state.scrollOffset[2] ?? 0;

  if (state.projectSpecs.length === 0) {
    buf.writeLine(panel.y + 1, panel.x + 2, dim("No specs linked"), contentWidth);
    return;
  }

  for (let i = 0; i < maxItems && i + scroll < state.projectSpecs.length; i++) {
    const idx = i + scroll;
    const spec = state.projectSpecs[idx];
    const row = panel.y + 1 + i;
    const isSelected = idx === selected && focused;

    const line = formatSpecLine(spec, contentWidth);
    if (isSelected) {
      buf.writeLine(row, panel.x + 2, ANSI.reverse + line + ANSI.reset, contentWidth);
    } else {
      buf.writeLine(row, panel.x + 2, line, contentWidth);
    }
  }
}

function formatSpecLine(spec: SpecCoverageItem, maxWidth: number): string {
  const statusIcon = spec.status === "covered" ? "\u25cf"
    : spec.status === "partial" ? "\u25d0"
    : "\u25cb";
  const statusLabel = spec.status === "covered" ? "covered"
    : spec.status === "partial" ? "partial"
    : "missing";
  const sColor = spec.status === "covered" ? ANSI.green
    : spec.status === "partial" ? ANSI.yellow
    : ANSI.red;

  const nameCol = Math.max(12, Math.floor(maxWidth * 0.4));
  const ticketStr = `${spec.ticketCount} ticket${spec.ticketCount !== 1 ? "s" : ""}`;

  const line = padRight(spec.name, nameCol)
    + padRight(ticketStr, 12)
    + color(sColor, `${statusIcon} ${statusLabel}`);
  return truncate(line, maxWidth);
}

/** Return the specs list for navigation. */
export function getSpecsList(state: ProjectDetailState): SpecCoverageItem[] {
  return state.projectSpecs;
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
  const selected = state.selectedIndex[4] ?? 0;
  const scroll = state.scrollOffset[4] ?? 0;

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

// --- Infrastructure Panel ---

const INFRA_STATUS_ICONS: Record<ResourceStatus, string> = {
  healthy: "\u25CF",      // ●
  degraded: "\u25D0",     // ◐
  unhealthy: "\u25CB",    // ○
  progressing: "\u25CC",  // ◌
  suspended: "\u2013",    // –
  unknown: "?",
};

function infraStatusColor(status: ResourceStatus): string {
  switch (status) {
    case "healthy": return ANSI.green;
    case "degraded": return ANSI.yellow;
    case "unhealthy": return ANSI.red;
    case "progressing": return ANSI.cyan;
    case "suspended": return ANSI.dim;
    case "unknown": return ANSI.dim;
  }
}

/** Flat list of infra resources for navigation. */
export function getInfraResourcesList(state: ProjectDetailState): InfraResource[] {
  return state.infraResources;
}

function renderInfraPanel(
  buf: ScreenBuffer,
  panel: Panel,
  state: ProjectDetailState,
  focused: boolean,
): void {
  const count = state.infraResources.length;
  const crashes = state.infraCrashEvents.length;
  const crashSuffix = crashes > 0 ? ` ${color(ANSI.red, `${crashes} crash${crashes > 1 ? "es" : ""}`)}` : "";
  const title = count > 0 ? `Infrastructure (${count})${crashSuffix}` : "Infrastructure";
  drawBox(buf, panel.x, panel.y, panel.width, panel.height, title, focused);

  const contentWidth = panel.width - 4;
  const maxRows = panel.height - 2;
  const selected = state.selectedIndex[6] ?? 0;
  const scroll = state.scrollOffset[6] ?? 0;

  if (state.infraResources.length === 0 && state.infraCrashEvents.length === 0) {
    buf.writeLine(panel.y + 1, panel.x + 2, dim("No infrastructure detected"), contentWidth);
    return;
  }

  // Build display rows: crash alerts first, then resources grouped by kind
  interface InfraDisplayRow {
    type: "header" | "resource" | "crash";
    text?: string;
    resource?: InfraResource;
    crash?: InfraCrashEvent;
    resourceIndex?: number;
  }

  const rows: InfraDisplayRow[] = [];

  // Show recent crashes at top
  if (state.infraCrashEvents.length > 0) {
    rows.push({ type: "header", text: "CRASH ALERTS" });
    for (const crash of state.infraCrashEvents.slice(-5)) {
      rows.push({ type: "crash", crash });
    }
  }

  // Group resources by kind
  const deployments = state.infraResources.filter((r) => r.kind === "deployment" || r.kind === "statefulset" || r.kind === "daemonset");
  const services = state.infraResources.filter((r) => r.kind === "service");
  const pods = state.infraResources.filter((r) => r.kind === "pod");
  const ingresses = state.infraResources.filter((r) => r.kind === "ingress");

  let resIdx = 0;
  if (deployments.length > 0) {
    rows.push({ type: "header", text: "DEPLOYMENTS" });
    for (const r of deployments) {
      rows.push({ type: "resource", resource: r, resourceIndex: resIdx++ });
    }
  }
  if (services.length > 0) {
    rows.push({ type: "header", text: "SERVICES" });
    for (const r of services) {
      rows.push({ type: "resource", resource: r, resourceIndex: resIdx++ });
    }
  }
  if (ingresses.length > 0) {
    rows.push({ type: "header", text: "INGRESSES" });
    for (const r of ingresses) {
      rows.push({ type: "resource", resource: r, resourceIndex: resIdx++ });
    }
  }
  if (pods.length > 0) {
    rows.push({ type: "header", text: "PODS" });
    for (const r of pods) {
      rows.push({ type: "resource", resource: r, resourceIndex: resIdx++ });
    }
  }

  for (let i = 0; i < maxRows && i + scroll < rows.length; i++) {
    const rowIdx = i + scroll;
    const row = rows[rowIdx];
    const y = panel.y + 1 + i;

    if (row.type === "header") {
      buf.writeLine(y, panel.x + 2, bold(row.text ?? ""), contentWidth);
    } else if (row.type === "crash" && row.crash) {
      const line = formatCrashLine(row.crash, contentWidth);
      buf.writeLine(y, panel.x + 2, line, contentWidth);
    } else if (row.type === "resource" && row.resource) {
      const isSelected = row.resourceIndex === selected && focused;
      const line = formatInfraResourceLine(row.resource, contentWidth);
      if (isSelected) {
        buf.writeLine(y, panel.x + 2, ANSI.reverse + line + ANSI.reset, contentWidth);
      } else {
        buf.writeLine(y, panel.x + 2, line, contentWidth);
      }
    }
  }
}

function formatInfraResourceLine(resource: InfraResource, maxWidth: number): string {
  const sColor = infraStatusColor(resource.status);
  const icon = color(sColor, INFRA_STATUS_ICONS[resource.status]);
  const name = resource.name;

  let detail = "";
  if (resource.replicas) {
    detail = `${resource.replicas.ready}/${resource.replicas.desired} ready`;
  }
  if (resource.kind === "pod") {
    const pod = resource as PodDetail;
    const phase = pod.phase ?? "";
    const restarts = pod.restarts !== undefined ? `${pod.restarts} restarts` : "";
    detail = `${phase}  ${restarts}`.trim();
  }
  if (resource.kind === "service" && resource.endpoints?.[0]) {
    const ep = resource.endpoints[0];
    detail = `${ep.type} ${ep.address}:${ep.port}`;
  }

  const detailStr = detail ? `  ${dim(detail)}` : "";
  const line = `  ${icon} ${name}${detailStr}`;
  return truncate(line, maxWidth);
}

function formatCrashLine(crash: InfraCrashEvent, maxWidth: number): string {
  const icon = color(ANSI.red, "\u25CB"); // ○
  const line = `  ${icon} ${crash.pod.name} ${color(ANSI.red, crash.reason)} (${crash.container})`;
  return truncate(line, maxWidth);
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
    case 1: return getVisibleAgents(state.agentsComponent).length;
    case 2: return getSpecsList(state).length;
    case 3: return 0; // stack is not navigable
    case 4: return getCloudServicesList(state).length;
    case 5: return getCICDItemCount(state.pipelines, state.deployments);
    case 6: return getInfraResourcesList(state).length;
    case 7: return 0; // chat panel uses component scrolling, not index-based
    default: return 0;
  }
}

/** Total number of panels for Tab cycling. */
export const PANEL_COUNT = 8;

export function clampSelection(state: ProjectDetailState): void {
  // Ensure arrays are large enough for all panels
  while (state.selectedIndex.length < PANEL_COUNT) state.selectedIndex.push(0);
  while (state.scrollOffset.length < PANEL_COUNT) state.scrollOffset.push(0);

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
