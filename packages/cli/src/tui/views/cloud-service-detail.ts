// TUI Cloud Service Detail View (Level 3)
// Full-screen drill-down into a single cloud service

import type {
  CloudService,
  CloudServiceHealth,
  DatabaseDetail,
  StorageDetail,
  ServerlessDetail,
  HostingDetail,
  MobileDetail,
} from "@opcom/types";
import type { Panel } from "../layout.js";
import {
  ScreenBuffer,
  drawBox,
  ANSI,
  bold,
  dim,
  color,
  truncate,
} from "../renderer.js";

export interface CloudServiceDetailState {
  service: CloudService;
  projectName: string;
  scrollOffset: number;
  totalLines: number;
}

export function createCloudServiceDetailState(
  service: CloudService,
  projectName: string,
): CloudServiceDetailState {
  return {
    service,
    projectName,
    scrollOffset: 0,
    totalLines: 0,
  };
}

export function renderCloudServiceDetail(
  buf: ScreenBuffer,
  panel: Panel,
  state: CloudServiceDetailState,
): void {
  const { service, projectName } = state;
  const healthStr = healthIndicator(service.status);
  const title = `${projectName} \u2500 ${providerLabel(service.provider)}: ${service.name} \u2500 ${healthStr}`;

  drawBox(buf, panel.x, panel.y, panel.width, panel.height, title, true);

  const contentWidth = panel.width - 4;
  const maxRows = panel.height - 4; // box borders + footer
  const lines = buildDetailLines(service, contentWidth);
  state.totalLines = lines.length;

  const scroll = state.scrollOffset;
  for (let i = 0; i < maxRows && i + scroll < lines.length; i++) {
    buf.writeLine(panel.y + 1 + i, panel.x + 2, lines[i + scroll], contentWidth);
  }

  // Footer with keybindings
  const footerY = panel.y + panel.height - 1;
  const footerKeys = buildFooterKeys(service);
  buf.writeLine(footerY, panel.x + 2, dim(footerKeys), contentWidth);
}

function buildDetailLines(service: CloudService, width: number): string[] {
  const lines: string[] = [];

  // Header info
  lines.push(`${bold("Provider:")} ${providerLabel(service.provider)}    ${bold("Kind:")} ${service.kind}`);
  if (service.url) {
    lines.push(`${bold("URL:")} ${dim(service.url)}`);
  }
  lines.push(`${bold("Status:")} ${healthIndicator(service.status)}    ${bold("Last checked:")} ${formatTime(service.lastCheckedAt)}`);
  if (service.capabilities.length > 0) {
    lines.push(`${bold("Capabilities:")} ${service.capabilities.join(", ")}`);
  }
  lines.push("");

  // Kind-specific details
  switch (service.detail.kind) {
    case "database":
      buildDatabaseLines(service.detail, lines);
      break;
    case "storage":
      buildStorageLines(service.detail, lines);
      break;
    case "serverless":
      buildServerlessLines(service.detail, lines);
      break;
    case "hosting":
      buildHostingLines(service.detail, lines);
      break;
    case "mobile":
      buildMobileLines(service.detail, lines);
      break;
  }

  return lines;
}

function buildDatabaseLines(detail: DatabaseDetail, lines: string[]): void {
  lines.push(bold("DATABASE"));
  lines.push(`  Engine: ${detail.engine}`);
  if (detail.region) lines.push(`  Region: ${detail.region}`);
  if (detail.replicas !== undefined) lines.push(`  Replicas: ${detail.replicas}`);
  if (detail.sizeBytes !== undefined) lines.push(`  Size: ${formatBytes(detail.sizeBytes)}`);
  if (detail.tableCount !== undefined) lines.push(`  Tables: ${detail.tableCount}`);
  if (detail.connectionUrl) lines.push(`  URL: ${dim(detail.connectionUrl)}`);
  lines.push("");

  if (detail.migration) {
    const m = detail.migration;
    lines.push(bold(`MIGRATIONS (${m.tool})`));
    lines.push(`  Applied: ${color(ANSI.green, String(m.applied))}    Pending: ${m.pending > 0 ? color(ANSI.yellow, String(m.pending)) : color(ANSI.green, "0")}`);
    if (m.lastMigrationName) lines.push(`  Last: ${m.lastMigrationName}`);
    if (m.lastAppliedAt) lines.push(`  Applied at: ${formatTime(m.lastAppliedAt)}`);
  }
}

function buildStorageLines(detail: StorageDetail, lines: string[]): void {
  lines.push(bold("BUCKETS"));
  if (detail.buckets.length === 0) {
    lines.push(dim("  No buckets found"));
    return;
  }
  for (const bucket of detail.buckets) {
    const size = bucket.sizeBytes !== undefined ? formatBytes(bucket.sizeBytes) : "?";
    const objects = bucket.objectCount !== undefined ? `${bucket.objectCount} objects` : "";
    const access = bucket.publicAccess ? color(ANSI.yellow, "public") : color(ANSI.green, "private");
    const region = bucket.region ? dim(` (${bucket.region})`) : "";
    lines.push(`  ${bold(bucket.name)}  ${size}  ${objects}  ${access}${region}`);
  }
}

function buildServerlessLines(detail: ServerlessDetail, lines: string[]): void {
  if (detail.runtime) {
    lines.push(`${bold("Runtime:")} ${detail.runtime}`);
    lines.push("");
  }

  lines.push(bold("FUNCTIONS"));
  if (detail.functions.length === 0) {
    lines.push(dim("  No functions found"));
    return;
  }

  for (const fn of detail.functions) {
    const statusColor = fn.status === "deployed" ? ANSI.green : fn.status === "failed" ? ANSI.red : ANSI.yellow;
    const statusStr = color(statusColor, fn.status);
    const triggerStr = dim(`[${fn.trigger}]`);
    const route = fn.route ? dim(` ${fn.route}`) : "";
    const region = fn.region ? dim(` (${fn.region})`) : "";
    lines.push(`  ${bold(fn.name)}  ${statusStr}  ${triggerStr}${route}${region}`);
    if (fn.lastDeployedAt) {
      lines.push(`    Deployed: ${formatTime(fn.lastDeployedAt)}`);
    }
  }
}

function buildHostingLines(detail: HostingDetail, lines: string[]): void {
  if (detail.framework) {
    lines.push(`${bold("Framework:")} ${detail.framework}`);
  }
  if (detail.lastDeployedAt) {
    lines.push(`${bold("Last deployed:")} ${formatTime(detail.lastDeployedAt)}`);
  }
  if (detail.deployedRef) {
    lines.push(`${bold("Deployed ref:")} ${detail.deployedRef}`);
  }
  lines.push("");

  lines.push(bold("DOMAINS"));
  if (detail.domains.length === 0) {
    lines.push(dim("  No domains configured"));
    return;
  }
  for (const domain of detail.domains) {
    const ssl = domain.ssl ? color(ANSI.green, "\u25cf SSL") : color(ANSI.red, "\u25cb no SSL");
    const primary = domain.primary ? bold(" (primary)") : "";
    lines.push(`  ${domain.hostname}  ${ssl}${primary}`);
  }
}

function buildMobileLines(detail: MobileDetail, lines: string[]): void {
  lines.push(`${bold("Platform:")} ${detail.platform}`);
  lines.push(`${bold("Distribution:")} ${detail.distribution}`);
  if (detail.currentVersion) lines.push(`${bold("Version:")} ${detail.currentVersion}`);
  if (detail.updateChannel) lines.push(`${bold("Channel:")} ${detail.updateChannel}`);
  if (detail.lastPublishedAt) lines.push(`${bold("Published:")} ${formatTime(detail.lastPublishedAt)}`);
}

function buildFooterKeys(service: CloudService): string {
  const keys: string[] = ["esc:back"];
  if (service.capabilities.includes("migrate")) keys.push("M:migrate");
  if (service.capabilities.includes("deploy")) keys.push("D:deploy");
  if (service.capabilities.includes("logs")) keys.push("f:logs");
  keys.push("o:open console");
  keys.push("?:help");
  return keys.join("  ");
}

// --- Scroll helpers ---

export function scrollUp(state: CloudServiceDetailState, amount: number): void {
  state.scrollOffset = Math.max(0, state.scrollOffset - amount);
}

export function scrollDown(state: CloudServiceDetailState, amount: number, viewHeight: number): void {
  const maxScroll = Math.max(0, state.totalLines - viewHeight);
  state.scrollOffset = Math.min(maxScroll, state.scrollOffset + amount);
}

export function scrollToTop(state: CloudServiceDetailState): void {
  state.scrollOffset = 0;
}

export function scrollToBottom(state: CloudServiceDetailState, viewHeight: number): void {
  state.scrollOffset = Math.max(0, state.totalLines - viewHeight);
}

// --- Helpers ---

export function healthIndicator(health: CloudServiceHealth): string {
  switch (health) {
    case "healthy": return color(ANSI.green, "\u25cf healthy");
    case "degraded": return color(ANSI.yellow, "\u25d0 degraded");
    case "unreachable": return color(ANSI.red, "\u25cb unreachable");
    case "unknown": return dim("\u25cc unknown");
  }
}

export function healthDot(health: CloudServiceHealth): string {
  switch (health) {
    case "healthy": return color(ANSI.green, "\u25cf");
    case "degraded": return color(ANSI.yellow, "\u25d0");
    case "unreachable": return color(ANSI.red, "\u25cb");
    case "unknown": return dim("\u25cc");
  }
}

function providerLabel(provider: string): string {
  const labels: Record<string, string> = {
    "turso": "Turso",
    "neon": "Neon",
    "planetscale": "PlanetScale",
    "supabase": "Supabase",
    "cloudflare-r2": "Cloudflare R2",
    "gcs": "Google Cloud Storage",
    "s3": "AWS S3",
    "cloudflare-workers": "CF Workers",
    "firebase-functions": "Firebase Functions",
    "firebase-hosting": "Firebase Hosting",
    "vercel": "Vercel",
    "netlify": "Netlify",
    "cloudflare-pages": "Cloudflare Pages",
    "expo-eas": "Expo/EAS",
    "firebase-app-distribution": "Firebase App Distribution",
  };
  return labels[provider] ?? provider;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

function formatTime(iso: string): string {
  try {
    const d = new Date(iso);
    const now = Date.now();
    const diff = now - d.getTime();

    if (diff < 60_000) return "just now";
    if (diff < 3600_000) return `${Math.floor(diff / 60_000)}m ago`;
    if (diff < 86400_000) return `${Math.floor(diff / 3600_000)}h ago`;
    return `${Math.floor(diff / 86400_000)}d ago`;
  } catch {
    return iso;
  }
}
