// CI/CD Pane — Pipeline runs + deployment status for project detail (L2)

import type { Pipeline, PipelineStatus, DeploymentStatus, DeploymentState } from "@opcom/types";
import type { Panel } from "../layout.js";
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

// --- Rendering ---

export function renderCICDPanel(
  buf: ScreenBuffer,
  panel: Panel,
  pipelines: Pipeline[],
  deployments: DeploymentStatus[],
  selectedIndex: number,
  scrollOffset: number,
  focused: boolean,
): void {
  const totalItems = pipelines.length + deployments.length;
  const title = totalItems > 0 ? `CI/CD (${totalItems})` : "CI/CD";
  drawBox(buf, panel.x, panel.y, panel.width, panel.height, title, focused);

  const contentWidth = panel.width - 4;
  const maxRows = panel.height - 2;

  if (pipelines.length === 0 && deployments.length === 0) {
    buf.writeLine(panel.y + 1, panel.x + 2, dim("No CI/CD data"), contentWidth);
    return;
  }

  const rows = buildCICDRows(pipelines, deployments);

  for (let i = 0; i < maxRows && i + scrollOffset < rows.length; i++) {
    const rowIdx = i + scrollOffset;
    const row = rows[rowIdx];
    const y = panel.y + 1 + i;

    if (row.type === "header") {
      buf.writeLine(y, panel.x + 2, bold(row.text ?? ""), contentWidth);
    } else if (row.type === "pipeline" && row.pipeline) {
      const isSelected = row.itemIndex === selectedIndex && focused;
      const line = formatPipelineLine(row.pipeline, contentWidth);
      if (isSelected) {
        buf.writeLine(y, panel.x + 2, ANSI.reverse + line + ANSI.reset, contentWidth);
      } else {
        buf.writeLine(y, panel.x + 2, line, contentWidth);
      }
    } else if (row.type === "deployment" && row.deployment) {
      const isSelected = row.itemIndex === selectedIndex && focused;
      const line = formatDeploymentLine(row.deployment, contentWidth);
      if (isSelected) {
        buf.writeLine(y, panel.x + 2, ANSI.reverse + line + ANSI.reset, contentWidth);
      } else {
        buf.writeLine(y, panel.x + 2, line, contentWidth);
      }
    }
  }
}

// --- Display row types ---

interface CICDDisplayRow {
  type: "header" | "pipeline" | "deployment";
  text?: string;
  pipeline?: Pipeline;
  deployment?: DeploymentStatus;
  itemIndex?: number;
}

export function buildCICDRows(
  pipelines: Pipeline[],
  deployments: DeploymentStatus[],
): CICDDisplayRow[] {
  const rows: CICDDisplayRow[] = [];
  let itemIdx = 0;

  if (pipelines.length > 0) {
    rows.push({ type: "header", text: `WORKFLOWS (${pipelines.length})` });
    for (const p of pipelines) {
      rows.push({ type: "pipeline", pipeline: p, itemIndex: itemIdx++ });
    }
  }

  if (deployments.length > 0) {
    rows.push({ type: "header", text: `DEPLOYMENTS (${deployments.length})` });
    for (const d of deployments) {
      rows.push({ type: "deployment", deployment: d, itemIndex: itemIdx++ });
    }
  }

  return rows;
}

/** Total navigable items (pipelines + deployments). */
export function getCICDItemCount(
  pipelines: Pipeline[],
  deployments: DeploymentStatus[],
): number {
  return pipelines.length + deployments.length;
}

/** Get the pipeline at a given navigable index, or null if it's a deployment. */
export function getPipelineAtIndex(
  pipelines: Pipeline[],
  deployments: DeploymentStatus[],
  index: number,
): Pipeline | null {
  if (index < pipelines.length) return pipelines[index];
  return null;
}

/** Get the deployment at a given navigable index, or null if it's a pipeline. */
export function getDeploymentAtIndex(
  pipelines: Pipeline[],
  deployments: DeploymentStatus[],
  index: number,
): DeploymentStatus | null {
  if (index >= pipelines.length) return deployments[index - pipelines.length] ?? null;
  return null;
}

// --- Formatting ---

export function pipelineStatusIcon(status: PipelineStatus): string {
  switch (status) {
    case "success": return color(ANSI.green, "\u2713");
    case "failure": return color(ANSI.red, "\u2717");
    case "in_progress": return color(ANSI.yellow, "\u25b6");
    case "queued": return color(ANSI.cyan, "\u25cb");
    case "cancelled": return color(ANSI.dim, "\u2013");
    case "timed_out": return color(ANSI.red, "\u29d6");
    case "skipped": return color(ANSI.dim, "\u2192");
  }
}

export function deploymentStateIcon(state: DeploymentState): string {
  switch (state) {
    case "active": return color(ANSI.green, "\u25cf");
    case "in_progress": return color(ANSI.yellow, "\u25b6");
    case "pending": return color(ANSI.cyan, "\u25cb");
    case "inactive": return color(ANSI.dim, "\u25cb");
    case "failed": return color(ANSI.red, "\u2717");
    case "error": return color(ANSI.red, "\u2717");
  }
}

export function formatPipelineLine(pipeline: Pipeline, maxWidth: number): string {
  const icon = pipelineStatusIcon(pipeline.status);
  const branch = pipeline.ref.replace("refs/heads/", "");
  const duration = pipeline.durationMs ? formatDuration(pipeline.durationMs) : "";
  const durationStr = duration ? dim(` ${duration}`) : "";
  const timeStr = pipeline.startedAt ? dim(` ${formatTimeAgo(pipeline.startedAt)}`) : "";

  const line = `  ${icon} ${branch}: ${pipeline.name}${durationStr}${timeStr}`;
  return truncate(line, maxWidth);
}

export function formatDeploymentLine(deployment: DeploymentStatus, maxWidth: number): string {
  const icon = deploymentStateIcon(deployment.status);
  const timeStr = dim(` ${formatTimeAgo(deployment.updatedAt)}`);
  const commitStr = deployment.ref ? dim(` ${deployment.ref.slice(0, 7)}`) : "";
  const liveLabel = deployment.status === "active" ? color(ANSI.green, " LIVE") : "";

  const line = `  ${icon} ${deployment.environment}: ${deployment.status}${liveLabel}${commitStr}${timeStr}`;
  return truncate(line, maxWidth);
}

// --- Helpers ---

export function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const secs = Math.floor(ms / 1000);
  if (secs < 60) return `${secs}s`;
  const mins = Math.floor(secs / 60);
  const remSecs = secs % 60;
  if (mins < 60) return remSecs > 0 ? `${mins}m${remSecs}s` : `${mins}m`;
  const hours = Math.floor(mins / 60);
  const remMins = mins % 60;
  return remMins > 0 ? `${hours}h${remMins}m` : `${hours}h`;
}

export function formatTimeAgo(iso: string): string {
  try {
    const ts = new Date(iso).getTime();
    if (isNaN(ts)) return iso;
    const diff = Date.now() - ts;
    if (diff < 60_000) return "just now";
    if (diff < 3600_000) return `${Math.floor(diff / 60_000)}m ago`;
    if (diff < 86400_000) return `${Math.floor(diff / 3600_000)}h ago`;
    return `${Math.floor(diff / 86400_000)}d ago`;
  } catch {
    return iso;
  }
}
