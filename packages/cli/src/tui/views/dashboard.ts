// TUI Dashboard View (Level 1)
// Projects panel | Work queue panel | Agents panel

import type { ProjectStatusSnapshot, AgentSession, WorkItem, Plan, PlanStep, PlanSummary, StallSignal, DeploymentStatus, InfraHealthSummary } from "@opcom/types";
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
  AgentsListComponent,
  sortAgents,
  getPlanStepForAgent,
  getAgentSortTier,
  formatDuration,
  formatStallBadge,
  type AgentsListState,
} from "../components/agents-list.js";
import {
  ChatComponent,
  type ChatState,
} from "../components/chat.js";
import { formatTeamBadge } from "./plan-step-focus.js";

// Re-export agent helpers for backward compatibility
export { sortAgents, getPlanStepForAgent, getAgentSortTier, formatStallBadge };

export interface PlanPanelState {
  plan: Plan;
}

export interface DashboardWorkItem {
  item: WorkItem;
  projectId: string;
  projectName: string;
}

export interface DashboardDeployStatus {
  projectId: string;
  environment: string;
  state: "healthy" | "failing" | "deploying" | "unknown";
  relativeTime: string;
  commitSha?: string;
}

/** Environment priority for selecting "most important" deployment. */
const ENV_PRIORITY: Record<string, number> = {
  production: 0,
  prod: 0,
  staging: 1,
  stage: 1,
  preview: 2,
  dev: 3,
  development: 3,
};

function envPriority(env: string): number {
  return ENV_PRIORITY[env.toLowerCase()] ?? 10;
}

/**
 * Pick the single most important deployment status for a project.
 * Priority: failing > in-progress > most recent active in highest environment.
 */
export function aggregateDeployStatus(
  deployments: DeploymentStatus[],
  projectId: string,
): DashboardDeployStatus | null {
  if (deployments.length === 0) return null;

  // 1. Any failing?
  const failing = deployments.filter((d) => d.status === "failed" || d.status === "error");
  if (failing.length > 0) {
    const pick = failing.sort((a, b) => envPriority(a.environment) - envPriority(b.environment))[0];
    return {
      projectId,
      environment: shortEnv(pick.environment),
      state: "failing",
      relativeTime: formatDeployTimeAgo(pick.updatedAt),
      commitSha: pick.ref,
    };
  }

  // 2. Any in-progress / pending?
  const deploying = deployments.filter((d) => d.status === "in_progress" || d.status === "pending");
  if (deploying.length > 0) {
    const pick = deploying.sort((a, b) => envPriority(a.environment) - envPriority(b.environment))[0];
    return {
      projectId,
      environment: shortEnv(pick.environment),
      state: "deploying",
      relativeTime: formatDeployTimeAgo(pick.updatedAt),
      commitSha: pick.ref,
    };
  }

  // 3. Most recent active in highest environment
  const active = deployments.filter((d) => d.status === "active");
  if (active.length > 0) {
    const pick = active.sort((a, b) => {
      const envDiff = envPriority(a.environment) - envPriority(b.environment);
      if (envDiff !== 0) return envDiff;
      return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
    })[0];
    return {
      projectId,
      environment: shortEnv(pick.environment),
      state: "healthy",
      relativeTime: formatDeployTimeAgo(pick.updatedAt),
      commitSha: pick.ref,
    };
  }

  // 4. Inactive/unknown — show most recent
  const sorted = [...deployments].sort(
    (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
  );
  return {
    projectId,
    environment: shortEnv(sorted[0].environment),
    state: "unknown",
    relativeTime: formatDeployTimeAgo(sorted[0].updatedAt),
    commitSha: sorted[0].ref,
  };
}

function shortEnv(env: string): string {
  const map: Record<string, string> = {
    production: "prod",
    staging: "staging",
    preview: "preview",
    development: "dev",
  };
  return map[env.toLowerCase()] ?? env;
}

function formatDeployTimeAgo(iso: string): string {
  try {
    const diff = Date.now() - new Date(iso).getTime();
    if (isNaN(diff)) return iso;
    if (diff < 60_000) return "just now";
    if (diff < 3600_000) return `${Math.floor(diff / 60_000)}m ago`;
    if (diff < 86400_000) return `${Math.floor(diff / 3600_000)}h ago`;
    return `${Math.floor(diff / 86400_000)}d ago`;
  } catch {
    return iso;
  }
}

export interface DashboardState {
  projects: ProjectStatusSnapshot[];
  agents: AgentSession[];
  workItems: DashboardWorkItem[];
  focusedPanel: number; // 0=projects, 1=workqueue, 2=agents, 3=chat
  selectedIndex: number[]; // selected item per panel
  scrollOffset: number[]; // scroll offset per panel
  priorityFilter: number | null; // null = all, 0-4 = filter
  projectFilter: string | null; // null = all, string = projectId
  searchQuery: string;
  deployStatuses: Map<string, DashboardDeployStatus>; // projectId → deploy status
  planPanel: PlanPanelState | null; // non-null when plan is active
  allPlans: PlanSummary[]; // all plans for the switcher
  agentsComponent: AgentsListState; // component state for agents panel
  chatComponent: ChatState; // component state for chat panel
}

/** Total number of panels in dashboard for Tab cycling. */
export const DASHBOARD_PANEL_COUNT = 4;

export function createDashboardState(): DashboardState {
  return {
    projects: [],
    agents: [],
    workItems: [],
    deployStatuses: new Map(),
    focusedPanel: 0,
    selectedIndex: [0, 0, 0, 0],
    scrollOffset: [0, 0, 0, 0],
    priorityFilter: null,
    projectFilter: null,
    searchQuery: "",
    planPanel: null,
    allPlans: [],
    agentsComponent: AgentsListComponent.init(),
    chatComponent: ChatComponent.init(),
  };
}

export function renderDashboard(
  buf: ScreenBuffer,
  panels: Panel[],
  state: DashboardState,
): void {
  const projectsPanel = panels.find((p) => p.id === "projects");
  const workqueuePanel = panels.find((p) => p.id === "workqueue");
  const agentsPanel = panels.find((p) => p.id === "agents");
  const chatPanel = panels.find((p) => p.id === "chat");

  if (projectsPanel) renderProjectsPanel(buf, projectsPanel, state, state.focusedPanel === 0);
  if (workqueuePanel) {
    if (state.planPanel) {
      renderPlanPanel(buf, workqueuePanel, state, state.focusedPanel === 1);
    } else {
      renderWorkQueuePanel(buf, workqueuePanel, state, state.focusedPanel === 1);
    }
  }
  if (agentsPanel) AgentsListComponent.render(buf, agentsPanel, state.agentsComponent, state.focusedPanel === 2);
  if (chatPanel) ChatComponent.render(buf, chatPanel, state.chatComponent, state.focusedPanel === 3);
}

function renderProjectsPanel(
  buf: ScreenBuffer,
  panel: Panel,
  state: DashboardState,
  focused: boolean,
): void {
  const { projects } = state;
  const count = projects.length;
  const title = `Projects (${count})`;

  drawBox(buf, panel.x, panel.y, panel.width, panel.height, title, focused);

  const contentWidth = panel.width - 4;
  const maxItems = panel.height - 2;
  const selected = state.selectedIndex[0] ?? 0;
  const scroll = state.scrollOffset[0] ?? 0;

  if (projects.length === 0) {
    buf.writeLine(panel.y + 1, panel.x + 2, dim("No projects. Run 'opcom add <path>'"), contentWidth);
    return;
  }

  for (let i = 0; i < maxItems && i + scroll < projects.length; i++) {
    const idx = i + scroll;
    const project = projects[idx];
    const row = panel.y + 1 + i;
    const isSelected = idx === selected && focused;

    const deployStatus = state.deployStatuses.get(project.id) ?? null;
    const line = formatProjectLine(project, deployStatus, contentWidth);
    if (isSelected) {
      buf.writeLine(row, panel.x + 2, ANSI.reverse + line + ANSI.reset, contentWidth);
    } else {
      buf.writeLine(row, panel.x + 2, line, contentWidth);
    }
  }
}

export function formatProjectLine(
  project: ProjectStatusSnapshot,
  deployStatus: DashboardDeployStatus | null,
  maxWidth: number,
): string {
  const name = bold(project.name);
  const git = project.git;

  let gitStr = "";
  if (git) {
    const branchStr = color(ANSI.cyan, git.branch);
    const cleanStr = git.clean
      ? color(ANSI.green, "clean")
      : color(ANSI.yellow, `${git.uncommittedCount ?? 0} dirty`);
    gitStr = ` ${branchStr} ${cleanStr}`;
  }

  let deployStr = "";
  if (deployStatus) {
    deployStr = ` ${formatDeployIndicator(deployStatus)}`;
  }

  let ticketStr = "";
  if (project.workSummary) {
    const ws = project.workSummary;
    ticketStr = dim(` [${ws.open}/${ws.total}]`);
  }

  let cloudStr = "";
  if (project.cloudHealthSummary && project.cloudHealthSummary.total > 0) {
    cloudStr = ` ${formatCloudDots(project.cloudHealthSummary)}`;
  }

  let infraStr = "";
  if (project.infraHealthSummary && project.infraHealthSummary.total > 0) {
    infraStr = ` ${formatInfraDots(project.infraHealthSummary)} K8s`;
  }

  const line = `${name}${gitStr}${deployStr}${ticketStr}${cloudStr}${infraStr}`;
  return truncate(line, maxWidth);
}

export function formatDeployIndicator(status: DashboardDeployStatus): string {
  switch (status.state) {
    case "healthy":
      return color(ANSI.green, "\u2713") + ` ${dim(status.environment)} ${dim(status.relativeTime)}`;
    case "failing":
      return color(ANSI.red, "\u2717") + ` ${color(ANSI.red, status.environment)} ${dim(status.relativeTime)}`;
    case "deploying":
      return color(ANSI.yellow, "\u25cf") + ` ${dim(status.environment)} ${dim("deploying...")}`;
    case "unknown":
      return dim("\u25cb") + ` ${dim(status.environment)} ${dim(status.relativeTime)}`;
  }
}

function formatCloudDots(summary: import("@opcom/types").CloudHealthSummary): string {
  const dots: string[] = [];
  for (let i = 0; i < summary.healthy; i++) dots.push(color(ANSI.green, "\u25cf"));
  for (let i = 0; i < summary.degraded; i++) dots.push(color(ANSI.yellow, "\u25d0"));
  for (let i = 0; i < summary.unreachable; i++) dots.push(color(ANSI.red, "\u25cb"));
  for (let i = 0; i < summary.unknown; i++) dots.push(dim("\u25cc"));
  return dots.join("");
}

export function formatInfraDots(summary: InfraHealthSummary): string {
  const dots: string[] = [];
  for (let i = 0; i < summary.healthy; i++) dots.push(color(ANSI.green, "\u25cf"));     // ●
  for (let i = 0; i < summary.progressing; i++) dots.push(color(ANSI.cyan, "\u25d0"));   // ◐
  for (let i = 0; i < summary.degraded; i++) dots.push(color(ANSI.yellow, "\u25d0"));    // ◐
  for (let i = 0; i < summary.unhealthy; i++) dots.push(color(ANSI.red, "\u25cb"));      // ○
  for (let i = 0; i < summary.suspended; i++) dots.push(dim("\u2013"));                   // –
  for (let i = 0; i < summary.unknown; i++) dots.push(dim("?"));
  return dots.join("");
}

function renderWorkQueuePanel(
  buf: ScreenBuffer,
  panel: Panel,
  state: DashboardState,
  focused: boolean,
): void {
  const items = getFilteredWorkItems(state);
  const showProject = state.projectFilter === null;

  const projectLabel = state.projectFilter !== null
    ? (() => {
        const proj = state.projects.find((p) => p.id === state.projectFilter);
        return ` [${proj?.name ?? state.projectFilter}]`;
      })()
    : "";
  const priorityLabel = state.priorityFilter !== null ? ` P${state.priorityFilter}` : "";
  const title = `Work Queue (${items.length})${projectLabel}${priorityLabel}`;

  drawBox(buf, panel.x, panel.y, panel.width, panel.height, title, focused);

  const contentWidth = panel.width - 4;
  const maxItems = panel.height - 2;
  const selected = state.selectedIndex[1] ?? 0;
  const scroll = state.scrollOffset[1] ?? 0;

  if (items.length === 0) {
    buf.writeLine(panel.y + 1, panel.x + 2, dim("No work items"), contentWidth);
    return;
  }

  for (let i = 0; i < maxItems && i + scroll < items.length; i++) {
    const idx = i + scroll;
    const dw = items[idx];
    const row = panel.y + 1 + i;
    const isSelected = idx === selected && focused;

    const line = formatWorkItemLine(dw, state.agents, contentWidth, showProject);
    if (isSelected) {
      buf.writeLine(row, panel.x + 2, ANSI.reverse + line + ANSI.reset, contentWidth);
    } else {
      buf.writeLine(row, panel.x + 2, line, contentWidth);
    }
  }
}

function formatWorkItemLine(
  dw: DashboardWorkItem,
  agents: AgentSession[],
  maxWidth: number,
  showProject: boolean,
): string {
  const item = dw.item;
  const priorityColors = [ANSI.red, ANSI.red, ANSI.yellow, ANSI.cyan, ANSI.dim];
  const pColor = priorityColors[item.priority] ?? ANSI.dim;
  const priority = color(pColor, `P${item.priority}`);

  const projectLabel = showProject ? dim(`[${dw.projectName}] `) : "";

  const statusIcon = item.status === "in-progress" ? color(ANSI.yellow, "\u25b6") :
    item.status === "closed" ? color(ANSI.green, "\u2713") :
    color(ANSI.white, "\u25cb");

  const hasAgent = agents.some((a) => a.workItemId === item.id && a.state !== "stopped");
  const agentIcon = hasAgent ? " \ud83e\udd16" : "";

  // Show scheduled date for items that have one (e.g. conferences)
  const dateBadge = item.scheduled ? dim(` [${item.scheduled}]`) : "";

  const line = `${priority} ${statusIcon} ${projectLabel}${item.title}${dateBadge}${agentIcon}`;
  return truncate(line, maxWidth);
}

function planStepIcon(status: string): string {
  switch (status) {
    case "blocked": return "\u25cc"; // ◌
    case "ready": return "\u25cb"; // ○
    case "in-progress": return "\u25cf"; // ●
    case "verifying": return "\u25ce"; // ◎
    case "done": return "\u2713"; // ✓
    case "failed": return "\u2717"; // ✗
    case "skipped": return "\u2298"; // ⊘
    case "needs-rebase": return "\u21c4"; // ⇄
    case "rebasing": return "\u27f3"; // ⟳
    case "pending-confirmation": return "\u2709"; // ✉
    default: return "?";
  }
}

function planStatusColor(status: string): string {
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

function renderPlanPanel(
  buf: ScreenBuffer,
  panel: Panel,
  state: DashboardState,
  focused: boolean,
): void {
  const plan = state.planPanel!.plan;
  const done = plan.steps.filter((s) => s.status === "done" || s.status === "skipped").length;
  const total = plan.steps.length;
  const planStatusIcon = plan.status === "executing" ? "\u25cf" :
    plan.status === "paused" ? "\u25cc" :
    plan.status === "done" ? "\u2713" : "\u25cb";

  const verifiedCount = plan.steps.filter((s) => s.verification?.passed).length;
  const failedVerifyCount = plan.steps.filter((s) => s.verification && !s.verification.passed).length;
  let verifyStr = "";
  if (verifiedCount > 0 || failedVerifyCount > 0) {
    const parts: string[] = [];
    if (verifiedCount > 0) parts.push(color(ANSI.green, `\u2713${verifiedCount}`));
    if (failedVerifyCount > 0) parts.push(color(ANSI.red, `\u2717${failedVerifyCount}`));
    verifyStr = ` [${parts.join(" ")}]`;
  }

  const planStallStr = plan.steps.some((s) => s.stallSignal?.type === "plan-stall")
    ? color(ANSI.orange, " \u26a0 stalled")
    : "";

  let stageStr = "";
  if (plan.stages && plan.stages.length > 1 && plan.currentStage !== undefined) {
    const currentStage = plan.stages[plan.currentStage];
    const stageName = currentStage?.name ? ` ${currentStage.name}` : "";
    stageStr = dim(` [stage ${plan.currentStage + 1}/${plan.stages.length}${stageName}]`);
  }

  // Show plan index in switcher if multiple plans exist
  const planCount = state.allPlans.length;
  const planIdx = planCount > 1
    ? (() => {
        const idx = state.allPlans.findIndex((p) => p.id === plan.id);
        return dim(` (${idx + 1}/${planCount})`);
      })()
    : "";

  const title = `Plan: ${plan.name} ${planStatusIcon} ${plan.status} ${done}/${total}${verifyStr}${stageStr}${planStallStr}${planIdx}`;

  drawBox(buf, panel.x, panel.y, panel.width, panel.height, title, focused);

  const contentWidth = panel.width - 4;
  const maxItems = panel.height - 2;
  const selected = state.selectedIndex[1] ?? 0;
  const scroll = state.scrollOffset[1] ?? 0;

  if (plan.steps.length === 0) {
    buf.writeLine(panel.y + 1, panel.x + 2, dim("No steps in plan"), contentWidth);
    return;
  }

  // Build stage-aware step ID set for current stage (for stage-gated indicator)
  const currentStageStepIds = new Set<string>();
  if (plan.stages && plan.stages.length > 1 && plan.currentStage !== undefined) {
    const stage = plan.stages[plan.currentStage];
    if (stage) {
      for (const id of stage.stepTicketIds) currentStageStepIds.add(id);
    }
  }
  const hasStages = plan.stages && plan.stages.length > 1;

  // Build flat list of display lines: stage headers + steps (grouped by stage if available)
  type DisplayLine =
    | { type: "stage-header"; name: string; stageIndex: number; stageStatus: string }
    | { type: "step"; step: typeof plan.steps[0]; index: number };
  const lines: DisplayLine[] = [];
  let stepIdx = 0;

  if (hasStages) {
    // Group by stage
    const steppedIds = new Set<string>();
    for (const stage of plan.stages!) {
      const stageName = stage.name ?? `Stage ${stage.index + 1}`;
      lines.push({ type: "stage-header", name: stageName, stageIndex: stage.index, stageStatus: stage.status });
      for (const id of stage.stepTicketIds) {
        const step = plan.steps.find((s) => s.ticketId === id);
        if (step) {
          lines.push({ type: "step", step, index: stepIdx++ });
          steppedIds.add(id);
        }
      }
    }
    // Any steps not in a stage (shouldn't happen, but safety)
    for (const step of plan.steps) {
      if (!steppedIds.has(step.ticketId)) {
        lines.push({ type: "step", step, index: stepIdx++ });
      }
    }
  } else {
    // No stages — group by track as before
    const tracks = new Map<string, typeof plan.steps>();
    for (const step of plan.steps) {
      const track = step.track ?? "unassigned";
      if (!tracks.has(track)) tracks.set(track, []);
      tracks.get(track)!.push(step);
    }
    for (const [trackName, steps] of tracks) {
      lines.push({ type: "stage-header", name: trackName, stageIndex: -1, stageStatus: "" });
      for (const step of steps) {
        lines.push({ type: "step", step, index: stepIdx++ });
      }
    }
  }

  for (let i = 0; i < maxItems && i + scroll < lines.length; i++) {
    const idx = i + scroll;
    const line = lines[idx];
    const row = panel.y + 1 + i;

    if (line.type === "stage-header") {
      const stageStatusIcon = line.stageStatus === "executing" ? color(ANSI.yellow, "\u25cf ")
        : line.stageStatus === "completed" ? color(ANSI.green, "\u2713 ")
        : line.stageStatus === "failed" ? color(ANSI.red, "\u2717 ")
        : "";
      buf.writeLine(row, panel.x + 2, bold(dim(`${stageStatusIcon}[${line.name}]`)), contentWidth);
    } else {
      const step = line.step;
      const displayStatus = step.rebaseConflict ? "rebasing" : step.status;
      const icon = planStepIcon(displayStatus);
      const sColor = planStatusColor(displayStatus);
      const reVerify = displayStatus === "verifying" && (step.attempt ?? 1) > 1 ? "re-" : "";
      const elapsed = step.verifyingPhaseStartedAt
        ? ` ${formatDuration(step.verifyingPhaseStartedAt)}`
        : "";
      const phaseLabel = displayStatus === "verifying" && step.verifyingPhase
        ? `${reVerify}${step.verifyingPhase}...${elapsed}`
        : displayStatus;
      const statusStr = color(sColor, `${icon} ${phaseLabel}`);
      const verifyBadge = formatStepVerificationBadge(step);
      const stallBadge = step.stallSignal
        ? color(ANSI.orange, ` \u26a0 ${formatStallBadge(step.stallSignal)}`)
        : "";

      // Stage-gated indicator: step is blocked because it's in a future stage, not deps
      let gatedBadge = "";
      if (hasStages && step.status === "blocked" && !currentStageStepIds.has(step.ticketId)) {
        const depsSatisfied = step.blockedBy.every((dep) => {
          const depStep = plan.steps.find((s) => s.ticketId === dep);
          return !depStep || depStep.status === "done" || depStep.status === "skipped";
        });
        if (depsSatisfied) {
          gatedBadge = dim(" (stage-gated)");
        }
      }

      const teamBadge = formatTeamBadge(step, plan);
      const teamStr = teamBadge ? dim(` ${teamBadge}`) : "";
      const text = `  ${statusStr} ${step.ticketId}${teamStr}${verifyBadge}${stallBadge}${gatedBadge}`;
      const isSelected = line.index === selected && focused;

      if (isSelected) {
        buf.writeLine(row, panel.x + 2, ANSI.reverse + truncate(text, contentWidth) + ANSI.reset, contentWidth);
      } else {
        buf.writeLine(row, panel.x + 2, truncate(text, contentWidth), contentWidth);
      }
    }
  }
}

/** Format a compact verification badge for a plan step in the dashboard list */
export function formatStepVerificationBadge(step: PlanStep): string {
  const attemptSuffix = (step.attempt ?? 1) > 1 ? dim(` #${step.attempt}`) : "";
  const rebaseSuffix = (step.rebaseAttempts ?? 0) > 0 ? dim(` r${step.rebaseAttempts}`) : "";

  if (!step.verification) return `${attemptSuffix}${rebaseSuffix}`;
  const v = step.verification;
  if (v.passed) {
    if (v.testGate) {
      return ` ${color(ANSI.green, `\u2713 ${v.testGate.passedTests}/${v.testGate.totalTests}`)}${attemptSuffix}${rebaseSuffix}`;
    }
    return ` ${color(ANSI.green, "\u2713 verified")}${attemptSuffix}${rebaseSuffix}`;
  }
  // Failed
  if (v.testGate && !v.testGate.passed) {
    return ` ${color(ANSI.red, `\u2717 ${v.testGate.passedTests}/${v.testGate.totalTests}`)}${attemptSuffix}${rebaseSuffix}`;
  }
  if (v.oracle && !v.oracle.passed) {
    return ` ${color(ANSI.red, "\u2717 oracle")}${attemptSuffix}${rebaseSuffix}`;
  }
  return ` ${color(ANSI.red, "\u2717 verify")}${attemptSuffix}${rebaseSuffix}`;
}

// --- Navigation helpers ---

export function getFilteredWorkItems(state: DashboardState): DashboardWorkItem[] {
  let items = state.workItems;

  // Project filter
  if (state.projectFilter !== null) {
    items = items.filter((w) => w.projectId === state.projectFilter);
  }

  // Priority filter
  if (state.priorityFilter !== null) {
    items = items.filter((w) => w.item.priority === state.priorityFilter);
  }

  // Search filter
  if (state.searchQuery) {
    const q = state.searchQuery.toLowerCase();
    items = items.filter(
      (w) =>
        w.item.title.toLowerCase().includes(q) ||
        w.item.id.toLowerCase().includes(q) ||
        w.projectName.toLowerCase().includes(q),
    );
  }

  return [...items].sort((a, b) => {
    // Primary: priority (lower = higher priority)
    const pDiff = a.item.priority - b.item.priority;
    if (pDiff !== 0) return pDiff;
    // Secondary: scheduled date (earlier first, unscheduled last)
    const aDate = a.item.scheduled ?? "\uffff";
    const bDate = b.item.scheduled ?? "\uffff";
    return aDate.localeCompare(bDate);
  });
}

export function getPanelItemCount(state: DashboardState, panelIndex: number): number {
  switch (panelIndex) {
    case 0: return state.projects.length;
    case 1:
      if (state.planPanel) return state.planPanel.plan.steps.length;
      return getFilteredWorkItems(state).length;
    case 2: return state.agents.length;
    case 3: return 0; // chat panel uses component scrolling, not index-based
    default: return 0;
  }
}

/**
 * Get plan steps in display order (grouped by track).
 * Used by both rendering and drill-down to ensure consistent indexing.
 */
export function getPlanStepsInDisplayOrder(plan: Plan): PlanStep[] {
  const tracks = new Map<string, PlanStep[]>();
  for (const step of plan.steps) {
    const track = step.track ?? "unassigned";
    if (!tracks.has(track)) tracks.set(track, []);
    tracks.get(track)!.push(step);
  }
  const ordered: PlanStep[] = [];
  for (const steps of tracks.values()) {
    ordered.push(...steps);
  }
  return ordered;
}

/**
 * Compute the next plan ID when cycling through plans.
 * Prioritizes non-terminal plans (executing, paused, planning) so running plans
 * are always immediately discoverable — never hidden behind cancelled/done plans.
 * When all plans are terminal, cycles through them normally.
 * @param offset +1 for next, -1 for previous
 */
export function getNextPlanId(state: DashboardState, offset: number): string | null {
  const { allPlans, planPanel } = state;
  if (allPlans.length <= 1) return null;

  const currentId = planPanel?.plan.id;
  const terminalStatuses = new Set(["cancelled", "done"]);
  const nonTerminal = allPlans.filter((p) => !terminalStatuses.has(p.status));

  // Multiple non-terminal plans: cycle only through those
  if (nonTerminal.length > 1) {
    const curIdx = currentId ? nonTerminal.findIndex((p) => p.id === currentId) : -1;
    const nextIdx = curIdx === -1
      ? 0
      : ((curIdx + offset) % nonTerminal.length + nonTerminal.length) % nonTerminal.length;
    return nonTerminal[nextIdx].id;
  }

  // Exactly 1 non-terminal plan: jump to it if we're not on it, otherwise nothing to cycle to
  if (nonTerminal.length === 1) {
    return currentId === nonTerminal[0].id ? null : nonTerminal[0].id;
  }

  // All plans are terminal — cycle through all normally
  const currentIdx = currentId ? allPlans.findIndex((p) => p.id === currentId) : -1;
  const nextIdx = currentIdx === -1
    ? 0
    : ((currentIdx + offset) % allPlans.length + allPlans.length) % allPlans.length;
  return allPlans[nextIdx].id;
}

export function clampSelection(state: DashboardState): void {
  for (let p = 0; p < DASHBOARD_PANEL_COUNT; p++) {
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
