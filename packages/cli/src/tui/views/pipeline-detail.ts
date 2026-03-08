// Pipeline Detail View (Level 3)
// Shows individual workflow run with jobs, steps, and metadata

import type { Pipeline, PipelineJob, PipelineStep } from "@opcom/types";
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
  pipelineStatusIcon,
  formatDuration,
  formatTimeAgo,
} from "./cicd-pane.js";

export interface PipelineDetailState {
  pipeline: Pipeline;
  projectName: string;
  displayLines: string[];
  scrollOffset: number;
}

export function createPipelineDetailState(
  pipeline: Pipeline,
  projectName: string,
): PipelineDetailState {
  const state: PipelineDetailState = {
    pipeline,
    projectName,
    displayLines: [],
    scrollOffset: 0,
  };
  rebuildDisplayLines(state, 80);
  return state;
}

export function rebuildDisplayLines(state: PipelineDetailState, wrapWidth: number): void {
  const { pipeline } = state;
  const lines: string[] = [];

  // Header
  lines.push(bold(`${state.projectName} — Pipeline Detail`));
  lines.push("");

  // Pipeline info
  const statusIcon = pipelineStatusIcon(pipeline.status);
  lines.push(`${bold("Workflow:")} ${pipeline.name}`);
  lines.push(`${bold("Status:")}   ${statusIcon} ${pipeline.status}`);

  const branch = pipeline.ref.replace("refs/heads/", "");
  lines.push(`${bold("Branch:")}   ${branch}`);
  lines.push(`${bold("Commit:")}   ${dim(pipeline.commitSha.slice(0, 7))}${pipeline.commitMessage ? ` ${pipeline.commitMessage}` : ""}`);

  if (pipeline.triggeredBy) {
    lines.push(`${bold("Triggered:")} ${pipeline.triggeredBy}`);
  }

  if (pipeline.startedAt) {
    lines.push(`${bold("Started:")}  ${formatTimeAgo(pipeline.startedAt)}`);
  }

  if (pipeline.durationMs) {
    lines.push(`${bold("Duration:")} ${formatDuration(pipeline.durationMs)}`);
  }

  if (pipeline.url) {
    lines.push(`${bold("URL:")}      ${dim(pipeline.url)}`);
  }

  // Jobs
  if (pipeline.jobs.length > 0) {
    lines.push("");
    lines.push(bold(`Jobs (${pipeline.jobs.length})`));
    lines.push(dim("\u2500".repeat(Math.min(60, wrapWidth - 4))));

    for (const job of pipeline.jobs) {
      lines.push(...formatJobLines(job, wrapWidth));
    }
  } else {
    lines.push("");
    lines.push(dim("No job data available"));
  }

  // Footer
  lines.push("");
  lines.push(dim("Esc:back  j/k:scroll  o:open URL"));

  state.displayLines = lines;
}

function formatJobLines(job: PipelineJob, wrapWidth: number): string[] {
  const lines: string[] = [];
  const icon = pipelineStatusIcon(job.status);
  const duration = job.durationMs ? dim(` (${formatDuration(job.durationMs)})`) : "";
  const runner = job.runner ? dim(` [${job.runner}]`) : "";

  lines.push(`  ${icon} ${bold(job.name)}${duration}${runner}`);

  // Steps
  if (job.steps && job.steps.length > 0) {
    for (const step of job.steps) {
      lines.push(formatStepLine(step, wrapWidth));
    }
  }

  return lines;
}

function formatStepLine(step: PipelineStep, maxWidth: number): string {
  const icon = pipelineStatusIcon(step.status);
  const duration = step.durationMs ? dim(` ${formatDuration(step.durationMs)}`) : "";
  return truncate(`    ${icon} ${step.name}${duration}`, maxWidth);
}

export function renderPipelineDetail(
  buf: ScreenBuffer,
  panel: Panel,
  state: PipelineDetailState,
): void {
  drawBox(buf, panel.x, panel.y, panel.width, panel.height, "Pipeline Detail", false);

  const contentWidth = panel.width - 4;
  const maxRows = panel.height - 2;

  for (let i = 0; i < maxRows && i + state.scrollOffset < state.displayLines.length; i++) {
    const lineIdx = i + state.scrollOffset;
    const line = state.displayLines[lineIdx];
    buf.writeLine(panel.y + 1 + i, panel.x + 2, line, contentWidth);
  }
}

// --- Scroll helpers ---

export function scrollUp(state: PipelineDetailState, amount: number): void {
  state.scrollOffset = Math.max(0, state.scrollOffset - amount);
}

export function scrollDown(state: PipelineDetailState, amount: number, viewHeight: number): void {
  const max = Math.max(0, state.displayLines.length - viewHeight);
  state.scrollOffset = Math.min(max, state.scrollOffset + amount);
}

export function scrollToTop(state: PipelineDetailState): void {
  state.scrollOffset = 0;
}

export function scrollToBottom(state: PipelineDetailState, viewHeight: number): void {
  state.scrollOffset = Math.max(0, state.displayLines.length - viewHeight);
}
