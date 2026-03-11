// TUI Plan Overview View (Level 3)
// Shows a full summary of a plan before execution: steps, tracks, settings,
// blocked/ready breakdown, dependency structure, confirm/cancel prompt.

import type { Plan, PlanStep, OrchestratorConfig, WorkItem, DecompositionAssessment } from "@opcom/types";
import { formatTeamBadge } from "./plan-step-focus.js";
import type { Panel } from "../layout.js";
import {
  ScreenBuffer,
  ANSI,
  bold,
  dim,
  color,
  truncate,
  wrapText,
} from "../renderer.js";

// --- Summary computation ---

export interface PlanSummary {
  totalSteps: number;
  readyCount: number;
  blockedCount: number;
  tracks: TrackSummary[];
  criticalPathLength: number;
  criticalPath: string[];
  config: OrchestratorConfig;
}

export interface TrackSummary {
  name: string;
  stepCount: number;
  ticketIds: string[];
  readyCount: number;
  blockedCount: number;
}

export function computePlanSummary(plan: Plan, allTickets?: WorkItem[]): PlanSummary {
  const readyCount = plan.steps.filter((s) => s.status === "ready").length;
  const blockedCount = plan.steps.filter((s) => s.status === "blocked").length;

  // Group by track
  const trackMap = new Map<string, PlanStep[]>();
  for (const step of plan.steps) {
    const track = step.track ?? "unassigned";
    if (!trackMap.has(track)) trackMap.set(track, []);
    trackMap.get(track)!.push(step);
  }

  const tracks: TrackSummary[] = [];
  for (const [name, steps] of trackMap) {
    tracks.push({
      name,
      stepCount: steps.length,
      ticketIds: steps.map((s) => s.ticketId),
      readyCount: steps.filter((s) => s.status === "ready").length,
      blockedCount: steps.filter((s) => s.status === "blocked").length,
    });
  }

  // Compute critical path (longest chain of dependencies)
  const { length: criticalPathLength, path: criticalPath } = computeCriticalPath(plan.steps);

  return {
    totalSteps: plan.steps.length,
    readyCount,
    blockedCount,
    tracks,
    criticalPathLength,
    criticalPath,
    config: plan.config,
  };
}

/**
 * Compute the critical path — the longest dependency chain in the DAG.
 * Uses topological ordering with longest-path DP.
 */
export function computeCriticalPath(steps: PlanStep[]): { length: number; path: string[] } {
  if (steps.length === 0) return { length: 0, path: [] };

  const stepMap = new Map<string, PlanStep>();
  for (const s of steps) stepMap.set(s.ticketId, s);

  // dp[id] = longest chain ending at id (inclusive)
  const dp = new Map<string, number>();
  const parent = new Map<string, string | null>();

  function dfs(id: string): number {
    if (dp.has(id)) return dp.get(id)!;
    const step = stepMap.get(id);
    if (!step) { dp.set(id, 1); parent.set(id, null); return 1; }

    let maxLen = 0;
    let bestParent: string | null = null;
    for (const dep of step.blockedBy) {
      if (stepMap.has(dep)) {
        const depLen = dfs(dep);
        if (depLen > maxLen) {
          maxLen = depLen;
          bestParent = dep;
        }
      }
    }
    dp.set(id, maxLen + 1);
    parent.set(id, bestParent);
    return maxLen + 1;
  }

  for (const s of steps) dfs(s.ticketId);

  // Find the endpoint with the longest chain
  let maxId = steps[0].ticketId;
  let maxLen = 0;
  for (const [id, len] of dp) {
    if (len > maxLen) { maxLen = len; maxId = id; }
  }

  // Trace back the path
  const path: string[] = [];
  let cur: string | null = maxId;
  while (cur) {
    path.push(cur);
    cur = parent.get(cur) ?? null;
  }
  path.reverse();

  return { length: maxLen, path };
}

// --- Plan config field definitions ---

export interface PlanConfigField {
  key: string;
  label: string;
  type: "boolean" | "number" | "string";
  get: (cfg: OrchestratorConfig) => unknown;
  set: (cfg: OrchestratorConfig, raw: string) => void;
  min?: number;
  max?: number;
}

export const planConfigFields: PlanConfigField[] = [
  {
    key: "maxConcurrentAgents", label: "Max concurrent agents", type: "number",
    get: (c) => c.maxConcurrentAgents,
    set: (c, v) => { c.maxConcurrentAgents = Math.max(1, Math.min(32, Number(v))); },
    min: 1, max: 32,
  },
  {
    key: "backend", label: "Backend", type: "string",
    get: (c) => c.backend,
    set: (c, v) => { c.backend = v; },
  },
  {
    key: "worktree", label: "Worktree mode", type: "boolean",
    get: (c) => c.worktree,
    set: (c, v) => { c.worktree = v === "true"; },
  },
  {
    key: "autoCommit", label: "Auto-commit", type: "boolean",
    get: (c) => c.autoCommit,
    set: (c, v) => { c.autoCommit = v === "true"; },
  },
  {
    key: "autoStart", label: "Auto-start", type: "boolean",
    get: (c) => c.autoStart,
    set: (c, v) => { c.autoStart = v === "true"; },
  },
  {
    key: "pauseOnFailure", label: "Pause on failure", type: "boolean",
    get: (c) => c.pauseOnFailure,
    set: (c, v) => { c.pauseOnFailure = v === "true"; },
  },
  {
    key: "ticketTransitions", label: "Ticket transitions", type: "boolean",
    get: (c) => c.ticketTransitions,
    set: (c, v) => { c.ticketTransitions = v === "true"; },
  },
  {
    key: "verification.runTests", label: "Run tests", type: "boolean",
    get: (c) => c.verification.runTests,
    set: (c, v) => { c.verification.runTests = v === "true"; },
  },
  {
    key: "verification.runOracle", label: "Run oracle", type: "boolean",
    get: (c) => c.verification.runOracle,
    set: (c, v) => { c.verification.runOracle = v === "true"; },
  },
];

// --- State ---

export interface PlanOverviewState {
  plan: Plan;
  summary: PlanSummary;
  scrollOffset: number;
  displayLines: string[];
  wrapWidth: number;
  confirmed: boolean | null; // null = pending, true = confirmed, false = cancelled
  editMode: boolean;
  editFieldIndex: number;
  /** Flagged tickets that may need decomposition (shown before plan overview) */
  decompositionAssessments?: DecompositionAssessment[];
  /** Whether decomposition overlay has been resolved (d=decompose, s=skip) */
  decompositionResolved: boolean;
}

export function createPlanOverviewState(
  plan: Plan,
  allTickets?: WorkItem[],
  decompositionAssessments?: DecompositionAssessment[],
): PlanOverviewState {
  const summary = computePlanSummary(plan, allTickets);
  const state: PlanOverviewState = {
    plan,
    summary,
    scrollOffset: 0,
    displayLines: [],
    wrapWidth: 0,
    confirmed: null,
    editMode: false,
    editFieldIndex: 0,
    decompositionAssessments,
    decompositionResolved: !decompositionAssessments || decompositionAssessments.length === 0,
  };
  rebuildDisplayLines(state);
  return state;
}

// --- Display lines ---

function formatElapsed(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  if (m > 0) return `${m}m${s % 60}s`;
  return `${s}s`;
}

function stepStatusIcon(status: string): string {
  switch (status) {
    case "blocked": return "\u25cc"; // ◌
    case "ready": return "\u25cb";   // ○
    case "in-progress": return "\u25cf"; // ●
    case "verifying": return "\u25ce";   // ◎
    case "done": return "\u2713";    // ✓
    case "failed": return "\u2717";  // ✗
    case "skipped": return "\u2298"; // ⊘
    case "needs-rebase": return "\u21c4"; // ⇄
    case "rebasing": return "\u27f3"; // ⟳
    case "pending-confirmation": return "\u2709"; // ✉
    default: return "?";
  }
}

function stepStatusColor(status: string): string {
  switch (status) {
    case "in-progress": return ANSI.yellow;
    case "verifying": return ANSI.orange;
    case "ready": return ANSI.cyan;
    case "done": return ANSI.green;
    case "failed": return ANSI.red;
    case "needs-rebase": return ANSI.red;
    case "rebasing": return ANSI.yellow;
    case "pending-confirmation": return ANSI.magenta;
    case "skipped": return ANSI.dim;
    case "blocked": return ANSI.dim;
    default: return ANSI.white;
  }
}

export function rebuildDisplayLines(state: PlanOverviewState, width = 80): void {
  const { plan, summary } = state;
  const lines: string[] = [];

  // --- Decomposition overlay ---
  if (state.decompositionAssessments && state.decompositionAssessments.length > 0 && !state.decompositionResolved) {
    lines.push(bold(color(ANSI.yellow, "Decomposition Assessment")));
    lines.push("");
    lines.push(`${state.decompositionAssessments.length} oversized ticket(s) detected:`);
    lines.push("");
    for (const a of state.decompositionAssessments) {
      lines.push(`  ${color(ANSI.yellow, "!")} ${bold(a.ticketId)}`);
      lines.push(`    ${dim(a.reason)}`);
    }
    lines.push("");
    lines.push(`Press ${bold("d")} to decompose, ${bold("s")} to skip, ${bold("Esc")} to cancel`);
    state.displayLines = lines;
    state.wrapWidth = width;
    return;
  }

  // --- Header ---
  lines.push(bold(`Plan: ${plan.name}`));
  lines.push(`${dim("ID:")} ${plan.id.slice(0, 8)}  ${dim("Status:")} ${plan.status}`);
  lines.push("");

  // --- Step breakdown ---
  lines.push(bold("Steps"));
  const readyBar = summary.readyCount > 0 ? color(ANSI.cyan, `${summary.readyCount} ready`) : "";
  const blockedBar = summary.blockedCount > 0 ? color(ANSI.dim, `${summary.blockedCount} blocked`) : "";
  const otherCount = summary.totalSteps - summary.readyCount - summary.blockedCount;
  const otherBar = otherCount > 0 ? `${otherCount} other` : "";
  const parts = [readyBar, blockedBar, otherBar].filter(Boolean);
  lines.push(`  ${bold(String(summary.totalSteps))} total: ${parts.join(", ")}`);
  lines.push("");

  // --- Stages (if computed) ---
  if (plan.stages && plan.stages.length > 1) {
    lines.push(bold("Stages"));
    for (const stage of plan.stages) {
      const stageName = stage.name ?? `Stage ${stage.index + 1}`;
      const stageIcon = stage.status === "executing" ? color(ANSI.yellow, "\u25cf")
        : stage.status === "completed" ? color(ANSI.green, "\u2713")
        : stage.status === "failed" ? color(ANSI.red, "\u2717")
        : dim("\u25cb");
      const isCurrent = plan.currentStage === stage.index;
      const currentMarker = isCurrent ? color(ANSI.yellow, " \u25c0 current") : "";
      lines.push(`  ${stageIcon} ${bold(stageName)} (${stage.stepTicketIds.length} steps)${currentMarker}`);

      for (const ticketId of stage.stepTicketIds) {
        const step = plan.steps.find((s) => s.ticketId === ticketId);
        if (step) {
          const ds = step.rebaseConflict ? "rebasing" : step.status;
          const icon = stepStatusIcon(ds);
          const sColor = stepStatusColor(ds);
          const reVerify = ds === "verifying" && (step.attempt ?? 1) > 1 ? "re-" : "";
          const elapsed = step.verifyingPhaseStartedAt ? ` ${formatElapsed(step.verifyingPhaseStartedAt)}` : "";
          const phaseLabel = ds === "verifying" && step.verifyingPhase
            ? ` ${reVerify}${step.verifyingPhase}...${elapsed}`
            : "";
          const deps = step.blockedBy.length > 0
            ? dim(` \u2190 ${step.blockedBy.join(", ")}`)
            : "";
          const teamBadge = formatTeamBadge(step, plan);
          const teamStr = teamBadge ? dim(` ${teamBadge}`) : "";
          lines.push(`    ${color(sColor, icon)} ${ticketId}${teamStr}${color(sColor, phaseLabel)}${deps}`);
        }
      }
    }
    lines.push("");
  }

  // --- Tracks ---
  lines.push(bold("Tracks"));
  if (summary.tracks.length === 0) {
    lines.push(`  ${dim("No tracks")}`);
  } else {
    for (const track of summary.tracks) {
      const readyLabel = track.readyCount > 0 ? color(ANSI.cyan, `${track.readyCount}r`) : "";
      const blockedLabel = track.blockedCount > 0 ? dim(`${track.blockedCount}b`) : "";
      const counts = [readyLabel, blockedLabel].filter(Boolean).join("/");
      lines.push(`  ${bold(track.name)} (${track.stepCount} steps${counts ? `, ${counts}` : ""})`);

      // Show ticket chain within track
      // Strip parent prefix from step IDs within a track (redundant with track name)
      const stripPrefix = (id: string) => id.includes("/") ? id.split("/").pop()! : id;
      for (const ticketId of track.ticketIds) {
        const step = plan.steps.find((s) => s.ticketId === ticketId);
        if (step) {
          const ds = step.rebaseConflict ? "rebasing" : step.status;
          const icon = stepStatusIcon(ds);
          const sColor = stepStatusColor(ds);
          const reVerify = ds === "verifying" && (step.attempt ?? 1) > 1 ? "re-" : "";
          const elapsed = step.verifyingPhaseStartedAt ? ` ${formatElapsed(step.verifyingPhaseStartedAt)}` : "";
          const phaseLabel = ds === "verifying" && step.verifyingPhase
            ? ` ${reVerify}${step.verifyingPhase}...${elapsed}`
            : "";
          const deps = step.blockedBy.length > 0
            ? dim(` \u2190 ${step.blockedBy.map(stripPrefix).join(", ")}`)
            : "";
          const teamBadge = formatTeamBadge(step, plan);
          const teamStr = teamBadge ? dim(` ${teamBadge}`) : "";
          const displayId = stripPrefix(ticketId);
          lines.push(`    ${color(sColor, icon)} ${displayId}${teamStr}${color(sColor, phaseLabel)}${deps}`);
        }
      }
    }
  }
  lines.push("");

  // --- Critical path ---
  if (summary.criticalPathLength > 1) {
    lines.push(bold("Critical Path"));
    lines.push(`  ${dim("Length:")} ${summary.criticalPathLength} steps`);
    lines.push(`  ${summary.criticalPath.join(dim(" \u2192 "))}`);
    lines.push("");
  }

  // --- Settings ---
  lines.push(bold(state.editMode ? "Settings (editing)" : "Settings"));
  if (state.editMode) {
    for (let i = 0; i < planConfigFields.length; i++) {
      const field = planConfigFields[i];
      const value = field.get(summary.config);
      const isSelected = i === state.editFieldIndex;
      const cursor = isSelected ? color(ANSI.cyan, "▸ ") : "  ";
      const label = isSelected ? color(ANSI.cyan, field.label + ":") : dim(field.label + ":");
      const pad = " ".repeat(Math.max(1, 24 - field.label.length));
      const valStr = field.type === "boolean"
        ? (value ? color(ANSI.green, "yes") : color(ANSI.red, "no"))
        : String(value);
      lines.push(`${cursor}${label}${pad}${valStr}`);
    }
  } else {
    const cfg = summary.config;
    lines.push(`  ${dim("Max concurrent agents:")} ${cfg.maxConcurrentAgents}`);
    lines.push(`  ${dim("Backend:")}              ${cfg.backend}`);
    lines.push(`  ${dim("Worktree mode:")}        ${cfg.worktree ? "yes" : "no"}`);
    lines.push(`  ${dim("Auto-commit:")}          ${cfg.autoCommit ? "yes" : "no"}`);
    lines.push(`  ${dim("Auto-start:")}           ${cfg.autoStart ? "yes" : "no"}`);
    lines.push(`  ${dim("Pause on failure:")}     ${cfg.pauseOnFailure ? "yes" : "no"}`);
    lines.push(`  ${dim("Ticket transitions:")}   ${cfg.ticketTransitions ? "yes" : "no"}`);

    // Verification
    const v = cfg.verification;
    const vParts: string[] = [];
    if (v.runTests) vParts.push("tests");
    if (v.runOracle) vParts.push(`oracle${v.oracleModel ? ` (${v.oracleModel})` : ""}`);
    lines.push(`  ${dim("Verification:")}         ${vParts.length > 0 ? vParts.join(", ") : "none"}`);
  }
  lines.push("");

  // --- Context ---
  if (plan.context) {
    lines.push(bold("Context"));
    for (const cl of plan.context.split("\n")) {
      lines.push(...wrapText(`  ${cl}`, width));
    }
    lines.push("");
  }

  // --- Confirm prompt ---
  if (state.confirmed === null) {
    lines.push(bold(color(ANSI.yellow, "Press Space to start execution, or Esc to cancel.")));
    lines.push(dim("+/-:agents  t:toggle tests  o:toggle oracle  w:toggle worktree  e:edit config"));
  } else if (state.confirmed) {
    lines.push(bold(color(ANSI.green, "\u2713 Plan execution started.")));
  } else {
    lines.push(bold(color(ANSI.red, "\u2717 Plan creation cancelled.")));
  }

  state.displayLines = lines;
  state.wrapWidth = width;
}

// --- Rendering ---

export function renderPlanOverview(
  buf: ScreenBuffer,
  panel: Panel,
  state: PlanOverviewState,
): void {
  const headerHeight = 1;
  const footerHeight = 1;
  const contentHeight = panel.height - headerHeight - footerHeight;
  const contentWidth = panel.width - 2;

  // Header
  const header = truncate(
    `${bold("Plan Overview:")} ${state.plan.name}`,
    contentWidth,
  );
  buf.writeLine(panel.y, panel.x + 1, header, contentWidth);

  // Re-wrap if panel width changed
  if (state.wrapWidth !== contentWidth) {
    rebuildDisplayLines(state, contentWidth);
  }

  const totalLines = state.displayLines.length;

  // Clamp scroll
  state.scrollOffset = Math.max(
    0,
    Math.min(state.scrollOffset, Math.max(0, totalLines - contentHeight)),
  );

  // Content
  for (let i = 0; i < contentHeight; i++) {
    const lineIdx = i + state.scrollOffset;
    const row = panel.y + headerHeight + i;
    if (lineIdx >= totalLines) break;
    buf.writeLine(row, panel.x + 1, state.displayLines[lineIdx], contentWidth);
  }

  // Scroll indicator
  if (totalLines > contentHeight) {
    const scrollPct = totalLines > contentHeight
      ? Math.round((state.scrollOffset / (totalLines - contentHeight)) * 100)
      : 100;
    const indicator = dim(`[${scrollPct}%]`);
    buf.writeLine(panel.y + headerHeight, panel.x + panel.width - 8, indicator, 7);
  }

  // Footer
  const footerY = panel.y + panel.height - 1;
  let keys: string;
  if (state.editMode) {
    keys = dim("j/k:nav  Enter/Space:toggle  +/-:adjust  Esc:done editing");
  } else if (state.confirmed === null) {
    keys = dim("j/k:scroll  e:edit config  +/-:agents  t:tests  o:oracle  w:worktree  Space:start  Esc:cancel");
  } else {
    keys = dim("Esc:back");
  }
  buf.writeLine(footerY, panel.x + 1, keys, contentWidth);
}

// --- Edit mode helpers ---

export function enterEditMode(state: PlanOverviewState): void {
  if (state.confirmed !== null) return;
  state.editMode = true;
  state.editFieldIndex = 0;
  rebuildDisplayLines(state, state.wrapWidth || 80);
}

export function exitEditMode(state: PlanOverviewState): void {
  state.editMode = false;
  rebuildDisplayLines(state, state.wrapWidth || 80);
}

export function editMoveUp(state: PlanOverviewState): void {
  if (state.editFieldIndex > 0) {
    state.editFieldIndex--;
    rebuildDisplayLines(state, state.wrapWidth || 80);
  }
}

export function editMoveDown(state: PlanOverviewState): void {
  if (state.editFieldIndex < planConfigFields.length - 1) {
    state.editFieldIndex++;
    rebuildDisplayLines(state, state.wrapWidth || 80);
  }
}

export function editToggleField(state: PlanOverviewState): void {
  const field = planConfigFields[state.editFieldIndex];
  if (!field) return;
  const cfg = state.plan.config;

  if (field.type === "boolean") {
    const current = field.get(cfg) as boolean;
    field.set(cfg, String(!current));
  }

  state.summary.config = cfg;
  rebuildDisplayLines(state, state.wrapWidth || 80);
}

export function editAdjustField(state: PlanOverviewState, delta: number): void {
  const field = planConfigFields[state.editFieldIndex];
  if (!field) return;
  const cfg = state.plan.config;

  if (field.type === "number") {
    const current = field.get(cfg) as number;
    const next = current + delta;
    const clamped = Math.max(field.min ?? 0, Math.min(field.max ?? 999, next));
    field.set(cfg, String(clamped));
  }

  state.summary.config = cfg;
  rebuildDisplayLines(state, state.wrapWidth || 80);
}

// --- Scroll helpers ---

export function scrollUp(state: PlanOverviewState, amount = 1): void {
  state.scrollOffset = Math.max(0, state.scrollOffset - amount);
}

export function scrollDown(state: PlanOverviewState, amount = 1, viewHeight = 20): void {
  const maxScroll = Math.max(0, state.displayLines.length - viewHeight);
  state.scrollOffset = Math.min(maxScroll, state.scrollOffset + amount);
}

export function scrollToTop(state: PlanOverviewState): void {
  state.scrollOffset = 0;
}

export function scrollToBottom(state: PlanOverviewState, viewHeight = 20): void {
  state.scrollOffset = Math.max(0, state.displayLines.length - viewHeight);
}
