// Deployment Detail View (Level 3)
// Shows deployment history for a project with per-environment breakdown and live commit indicator

import type { DeploymentStatus } from "@opcom/types";
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
import {
  deploymentStateIcon,
  formatTimeAgo,
} from "./cicd-pane.js";

export interface DeploymentDetailState {
  projectName: string;
  deployments: DeploymentStatus[];
  displayLines: string[];
  scrollOffset: number;
}

export function createDeploymentDetailState(
  deployments: DeploymentStatus[],
  projectName: string,
): DeploymentDetailState {
  const state: DeploymentDetailState = {
    projectName,
    deployments,
    displayLines: [],
    scrollOffset: 0,
  };
  rebuildDisplayLines(state, 80);
  return state;
}

export function rebuildDisplayLines(state: DeploymentDetailState, wrapWidth: number): void {
  const { deployments } = state;
  const lines: string[] = [];

  lines.push(bold(`${state.projectName} — Deploy History`));
  lines.push("");

  if (deployments.length === 0) {
    lines.push(dim("No deployments found"));
    lines.push("");
    lines.push(dim("Esc:back"));
    state.displayLines = lines;
    return;
  }

  // Group deployments by environment
  const byEnv = new Map<string, DeploymentStatus[]>();
  for (const d of deployments) {
    const list = byEnv.get(d.environment) ?? [];
    list.push(d);
    byEnv.set(d.environment, list);
  }

  // Sort environments by priority (production first)
  const envOrder: Record<string, number> = {
    production: 0, prod: 0,
    staging: 1, stage: 1,
    preview: 2,
    development: 3, dev: 3,
  };
  const sortedEnvs = [...byEnv.keys()].sort(
    (a, b) => (envOrder[a.toLowerCase()] ?? 10) - (envOrder[b.toLowerCase()] ?? 10),
  );

  for (const env of sortedEnvs) {
    const envDeployments = byEnv.get(env)!;
    // Sort by updatedAt descending (most recent first)
    envDeployments.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());

    const activeDeployment = envDeployments.find((d) => d.status === "active");
    const envLabel = activeDeployment
      ? `${env.toUpperCase()} ${color(ANSI.green, "LIVE")}`
      : env.toUpperCase();

    lines.push(bold(envLabel));
    lines.push(dim("\u2500".repeat(Math.min(60, wrapWidth - 4))));

    // Show which commit is live
    if (activeDeployment) {
      const commitRef = activeDeployment.ref || "unknown";
      const shortRef = commitRef.length > 7 ? commitRef.slice(0, 7) : commitRef;
      lines.push(`  ${bold("Live commit:")} ${color(ANSI.green, shortRef)} ${dim(formatTimeAgo(activeDeployment.updatedAt))}`);
      lines.push("");
    }

    // Show deploy history for this environment
    lines.push(`  ${bold("History")} (${envDeployments.length})`);
    for (const d of envDeployments) {
      const icon = deploymentStateIcon(d.status);
      const commitRef = d.ref || "unknown";
      const shortRef = commitRef.length > 7 ? commitRef.slice(0, 7) : commitRef;
      const timeStr = formatTimeAgo(d.updatedAt);
      const liveTag = d.status === "active" ? color(ANSI.green, " LIVE") : "";
      lines.push(truncate(`    ${icon} ${shortRef} ${d.status}${liveTag} ${dim(timeStr)}`, wrapWidth));
    }

    lines.push("");
  }

  // Footer
  lines.push(dim("Esc:back  j/k:scroll"));

  state.displayLines = lines;
}

export function renderDeploymentDetail(
  buf: ScreenBuffer,
  panel: Panel,
  state: DeploymentDetailState,
): void {
  drawBox(buf, panel.x, panel.y, panel.width, panel.height, "Deploy History", false);

  const contentWidth = panel.width - 4;
  const maxRows = panel.height - 2;

  for (let i = 0; i < maxRows && i + state.scrollOffset < state.displayLines.length; i++) {
    const lineIdx = i + state.scrollOffset;
    const line = state.displayLines[lineIdx];
    buf.writeLine(panel.y + 1 + i, panel.x + 2, line, contentWidth);
  }
}

// --- Scroll helpers ---

export function scrollUp(state: DeploymentDetailState, amount: number): void {
  state.scrollOffset = Math.max(0, state.scrollOffset - amount);
}

export function scrollDown(state: DeploymentDetailState, amount: number, viewHeight: number): void {
  const max = Math.max(0, state.displayLines.length - viewHeight);
  state.scrollOffset = Math.min(max, state.scrollOffset + amount);
}

export function scrollToTop(state: DeploymentDetailState): void {
  state.scrollOffset = 0;
}

export function scrollToBottom(state: DeploymentDetailState, viewHeight: number): void {
  state.scrollOffset = Math.max(0, state.displayLines.length - viewHeight);
}
