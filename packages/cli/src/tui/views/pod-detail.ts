// TUI Pod Detail View (Level 3)
// Full-screen drill-down into a single pod with container status and logs

import type { PodDetail, ContainerStatus, ResourceCondition, InfraLogLine } from "@opcom/types";
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

export interface PodDetailState {
  pod: PodDetail;
  projectName: string;
  displayLines: string[];
  scrollOffset: number;
  logLines: InfraLogLine[];
  selectedContainer: string;
  followMode: boolean;
}

export function createPodDetailState(
  pod: PodDetail,
  projectName: string,
): PodDetailState {
  const selectedContainer = pod.containers.length > 0 ? pod.containers[0].name : "";
  const state: PodDetailState = {
    pod,
    projectName,
    displayLines: [],
    scrollOffset: 0,
    logLines: [],
    selectedContainer,
    followMode: false,
  };
  rebuildDisplayLines(state, 80);
  return state;
}

export function rebuildDisplayLines(state: PodDetailState, wrapWidth: number): void {
  const { pod, projectName } = state;
  const lines: string[] = [];

  // Header
  const statusIcon = podStatusIcon(pod.status);
  lines.push(bold(`${projectName} \u2500 ${pod.name} \u2500 ${statusIcon} ${pod.status}`));
  lines.push("");

  // Pod info
  lines.push(`${bold("Phase:")}     ${pod.phase}`);
  lines.push(`${bold("Namespace:")} ${pod.namespace ?? "default"}`);
  if (pod.node) {
    lines.push(`${bold("Node:")}      ${pod.node}`);
  }
  lines.push(`${bold("Restarts:")}  ${pod.restarts}`);
  lines.push(`${bold("Age:")}       ${formatAge(pod.age)}`);
  lines.push("");

  // Containers
  lines.push(bold(`CONTAINERS (${pod.containers.length})`));
  lines.push(dim("\u2500".repeat(Math.min(60, wrapWidth - 4))));

  for (const container of pod.containers) {
    lines.push(...formatContainerLines(container));
  }

  // Conditions
  if (pod.conditions && pod.conditions.length > 0) {
    lines.push("");
    lines.push(bold("CONDITIONS"));
    lines.push(dim("\u2500".repeat(Math.min(60, wrapWidth - 4))));
    for (const cond of pod.conditions) {
      lines.push(formatConditionLine(cond));
    }
  }

  // Labels
  if (pod.labels && Object.keys(pod.labels).length > 0) {
    lines.push("");
    lines.push(bold("LABELS"));
    lines.push(dim("\u2500".repeat(Math.min(60, wrapWidth - 4))));
    for (const [key, value] of Object.entries(pod.labels)) {
      lines.push(`  ${dim(key)}: ${value}`);
    }
  }

  // Logs
  lines.push("");
  const followLabel = state.followMode ? " (following)" : "";
  lines.push(bold(`LOGS (${state.selectedContainer})${followLabel}`));
  lines.push(dim("\u2500".repeat(Math.min(60, wrapWidth - 4))));

  if (state.logLines.length === 0) {
    lines.push(dim("  No logs available"));
  } else {
    for (const logLine of state.logLines) {
      const ts = logLine.timestamp ? dim(logLine.timestamp + "  ") : "";
      lines.push(`  ${ts}${logLine.text}`);
    }
  }

  // Footer
  lines.push("");
  lines.push(dim("esc:back  f:follow logs  c:switch container  j/k:scroll"));

  state.displayLines = lines;
}

function formatContainerLines(container: ContainerStatus): string[] {
  const lines: string[] = [];
  const icon = containerStateIcon(container.state, container.reason);
  const restartStr = container.restarts > 0
    ? ` ${color(ANSI.yellow, `${container.restarts} restarts`)}`
    : "";
  const reasonStr = container.reason ? ` ${color(ANSI.red, container.reason)}` : "";

  lines.push(`  ${icon} ${bold(container.name)}  ${container.state}${reasonStr}${restartStr}`);
  lines.push(`    ${dim(`image: ${container.image}`)}`);

  if (container.lastTerminatedAt) {
    lines.push(`    ${dim(`last terminated: ${formatAge(container.lastTerminatedAt)}`)}`);
  }

  return lines;
}

function formatConditionLine(cond: ResourceCondition): string {
  const icon = cond.status ? color(ANSI.green, "\u25cf") : color(ANSI.red, "\u25cb");
  const reason = cond.reason ? dim(` (${cond.reason})`) : "";
  return `  ${icon} ${cond.type}${reason}`;
}

function podStatusIcon(status: string): string {
  switch (status) {
    case "healthy": return color(ANSI.green, "\u25cf");
    case "degraded": return color(ANSI.yellow, "\u25d0");
    case "unhealthy": return color(ANSI.red, "\u25cb");
    case "progressing": return color(ANSI.cyan, "\u25d0");
    case "suspended": return dim("\u25cc");
    default: return dim("\u25cc");
  }
}

function containerStateIcon(state: string, reason?: string): string {
  if (reason === "CrashLoopBackOff" || reason === "OOMKilled") {
    return color(ANSI.red, "\u25cb");
  }
  switch (state) {
    case "running": return color(ANSI.green, "\u25cf");
    case "waiting": return color(ANSI.yellow, "\u25d0");
    case "terminated": return color(ANSI.red, "\u25cb");
    default: return dim("\u25cc");
  }
}

function formatAge(iso: string): string {
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

export function renderPodDetail(
  buf: ScreenBuffer,
  panel: Panel,
  state: PodDetailState,
): void {
  drawBox(buf, panel.x, panel.y, panel.width, panel.height, "Pod Detail", false);

  const contentWidth = panel.width - 4;
  const maxRows = panel.height - 2;

  for (let i = 0; i < maxRows && i + state.scrollOffset < state.displayLines.length; i++) {
    const lineIdx = i + state.scrollOffset;
    const line = state.displayLines[lineIdx];
    buf.writeLine(panel.y + 1 + i, panel.x + 2, line, contentWidth);
  }
}

// --- Scroll helpers ---

export function scrollUp(state: PodDetailState, amount: number): void {
  state.scrollOffset = Math.max(0, state.scrollOffset - amount);
}

export function scrollDown(state: PodDetailState, amount: number, viewHeight: number): void {
  const max = Math.max(0, state.displayLines.length - viewHeight);
  state.scrollOffset = Math.min(max, state.scrollOffset + amount);
}

export function scrollToTop(state: PodDetailState): void {
  state.scrollOffset = 0;
}

export function scrollToBottom(state: PodDetailState, viewHeight: number): void {
  state.scrollOffset = Math.max(0, state.displayLines.length - viewHeight);
}

// --- Log and container helpers ---

export function toggleFollow(state: PodDetailState): void {
  state.followMode = !state.followMode;
  rebuildDisplayLines(state, 80);
}

export function switchContainer(state: PodDetailState): void {
  const containers = state.pod.containers;
  if (containers.length <= 1) return;
  const currentIdx = containers.findIndex(c => c.name === state.selectedContainer);
  const nextIdx = (currentIdx + 1) % containers.length;
  state.selectedContainer = containers[nextIdx].name;
  state.logLines = [];
  state.followMode = false;
  rebuildDisplayLines(state, 80);
}

export function addLogLines(state: PodDetailState, lines: InfraLogLine[], viewHeight?: number): void {
  state.logLines.push(...lines);
  rebuildDisplayLines(state, 80);
  if (state.followMode && viewHeight) {
    scrollToBottom(state, viewHeight);
  }
}
