// TUI Service Detail View (Level 3)
// Full-screen drill-down into a service with health, status, and controls

import type { ServiceInstance, HealthCheckResult } from "@opcom/types";
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

export interface ServiceDetailState {
  projectId: string;
  serviceName: string;
  instance: ServiceInstance | null;
  displayLines: string[];
  scrollOffset: number;
}

export function createServiceDetailState(
  projectId: string,
  serviceName: string,
  instance?: ServiceInstance,
): ServiceDetailState {
  const state: ServiceDetailState = {
    projectId,
    serviceName,
    instance: instance ?? null,
    displayLines: [],
    scrollOffset: 0,
  };
  rebuildDisplayLines(state, 80);
  return state;
}

export function rebuildDisplayLines(state: ServiceDetailState, wrapWidth: number): void {
  const { serviceName, projectId, instance } = state;
  const lines: string[] = [];

  if (!instance) {
    // Service not running
    const icon = dim("\u25cb"); // ○
    lines.push(bold(`${projectId} \u2500 ${serviceName} \u2500 ${icon} stopped`));
    lines.push("");
    lines.push(dim("Service is not running. Press d from the project view to start services."));
    lines.push("");
    lines.push(dim("esc:back  ?:help"));
    state.displayLines = lines;
    return;
  }

  // Header
  const icon = stateIcon(instance.state);
  const stateLabel = stateColorLabel(instance.state);
  lines.push(bold(`${projectId} \u2500 ${serviceName} \u2500 ${icon} ${stateLabel}`));
  lines.push("");

  // Status info
  lines.push(`${bold("State:")}      ${stateLabel}`);
  lines.push(`${bold("PID:")}        ${instance.pid}`);
  if (instance.port) {
    lines.push(`${bold("Port:")}       :${instance.port}`);
  }
  lines.push(`${bold("Uptime:")}     ${formatUptime(instance.startedAt)}`);
  lines.push(`${bold("Restarts:")}   ${instance.restartCount}`);
  lines.push("");

  // Health check
  lines.push(bold("HEALTH CHECK"));
  lines.push(dim("\u2500".repeat(Math.min(60, wrapWidth - 4))));
  if (instance.lastHealthCheck) {
    lines.push(...formatHealthCheck(instance.lastHealthCheck));
  } else {
    lines.push(dim("  No health check configured"));
  }
  lines.push("");

  // Footer
  lines.push(dim("esc:back  r:restart  s:stop  ?:help"));

  state.displayLines = lines;
}

function formatHealthCheck(result: HealthCheckResult): string[] {
  const lines: string[] = [];
  const icon = result.healthy ? color(ANSI.green, "\u25cf") : color(ANSI.red, "\u25cb");
  const status = result.healthy ? color(ANSI.green, "healthy") : color(ANSI.red, "unhealthy");
  lines.push(`  ${icon} ${status}  ${dim(`${result.latencyMs}ms`)}`);
  lines.push(`  ${dim("Checked:")} ${result.checkedAt}`);
  if (result.error) {
    lines.push(`  ${color(ANSI.red, "Error:")} ${result.error}`);
  }
  return lines;
}

function stateIcon(state: string): string {
  switch (state) {
    case "running": return color(ANSI.green, "\u25cf");      // ●
    case "starting":
    case "restarting": return color(ANSI.cyan, "\u25d0");     // ◐
    case "unhealthy": return color(ANSI.yellow, "\u25d0");    // ◐
    case "crashed": return color(ANSI.red, "\u25cb");         // ○
    default: return dim("\u25cb");                             // ○
  }
}

function stateColorLabel(state: string): string {
  switch (state) {
    case "running": return color(ANSI.green, "running");
    case "starting": return color(ANSI.cyan, "starting");
    case "restarting": return color(ANSI.cyan, "restarting");
    case "unhealthy": return color(ANSI.yellow, "unhealthy");
    case "crashed": return color(ANSI.red, "crashed");
    case "stopped": return dim("stopped");
    default: return dim(state);
  }
}

function formatUptime(startedAt: string): string {
  try {
    const diff = Date.now() - new Date(startedAt).getTime();
    if (diff < 60_000) return `${Math.floor(diff / 1000)}s`;
    if (diff < 3600_000) return `${Math.floor(diff / 60_000)}m`;
    if (diff < 86400_000) {
      const h = Math.floor(diff / 3600_000);
      const m = Math.floor((diff % 3600_000) / 60_000);
      return `${h}h ${m}m`;
    }
    return `${Math.floor(diff / 86400_000)}d`;
  } catch {
    return startedAt;
  }
}

// --- Rendering ---

export function renderServiceDetail(
  buf: ScreenBuffer,
  panel: Panel,
  state: ServiceDetailState,
): void {
  const title = `${state.projectId}/${state.serviceName}`;
  drawBox(buf, panel.x, panel.y, panel.width, panel.height, title, true);

  const contentWidth = panel.width - 4;
  const maxLines = panel.height - 2;

  for (let i = 0; i < maxLines && i + state.scrollOffset < state.displayLines.length; i++) {
    const line = state.displayLines[i + state.scrollOffset];
    buf.writeLine(panel.y + 1 + i, panel.x + 2, truncate(line, contentWidth), contentWidth);
  }
}

// --- Scrolling ---

export function scrollUp(state: ServiceDetailState, amount: number): void {
  state.scrollOffset = Math.max(0, state.scrollOffset - amount);
}

export function scrollDown(state: ServiceDetailState, amount: number, viewHeight: number): void {
  const maxScroll = Math.max(0, state.displayLines.length - viewHeight);
  state.scrollOffset = Math.min(maxScroll, state.scrollOffset + amount);
}

export function scrollToTop(state: ServiceDetailState): void {
  state.scrollOffset = 0;
}

export function scrollToBottom(state: ServiceDetailState): void {
  state.scrollOffset = Math.max(0, state.displayLines.length - 10);
}
