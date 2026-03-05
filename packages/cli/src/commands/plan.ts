import {
  loadGlobalConfig,
  loadWorkspace,
  loadProject,
  scanTickets,
  computePlan,
  resolveScope,
  listPlans,
  loadPlan,
  savePlan,
  deletePlan,
  checkHygiene,
  Executor,
  SessionManager,
  EventStore,
  defaultOrchestratorConfig,
} from "@opcom/core";
import type { Plan, PlanScope, OrchestratorConfig } from "@opcom/types";
import type { TicketSet } from "@opcom/core";

// --- Helpers ---

async function buildTicketSets(): Promise<TicketSet[]> {
  const global = await loadGlobalConfig();
  const workspace = await loadWorkspace(global.defaultWorkspace);
  if (!workspace) {
    console.error("  No workspace found. Run 'opcom init' first.");
    process.exit(1);
  }

  const ticketSets: TicketSet[] = [];
  for (const pid of workspace.projectIds) {
    const project = await loadProject(pid);
    if (!project) continue;
    const tickets = await scanTickets(project.path);
    ticketSets.push({ projectId: pid, tickets });
  }
  return ticketSets;
}

async function resolvePlan(planId?: string): Promise<Plan | null> {
  if (planId) {
    return loadPlan(planId);
  }
  // Find most recent active plan
  const plans = await listPlans();
  const active = plans.find((p) => p.status === "executing" || p.status === "paused" || p.status === "planning");
  return active ?? plans[0] ?? null;
}

function statusIcon(status: string): string {
  switch (status) {
    case "planning": return "\u25cb"; // ○
    case "executing": return "\u25cf"; // ●
    case "paused": return "\u25cc"; // ◌
    case "done": return "\u2713"; // ✓
    case "failed": return "\u2717"; // ✗
    default: return "?";
  }
}

function stepIcon(status: string): string {
  switch (status) {
    case "blocked": return "\u25cc"; // ◌
    case "ready": return "\u25cb"; // ○
    case "in-progress": return "\u25cf"; // ●
    case "done": return "\u2713"; // ✓
    case "failed": return "\u2717"; // ✗
    case "skipped": return "\u2298"; // ⊘
    case "needs-rebase": return "\u21c4"; // ⇄
    default: return "?";
  }
}

// --- Commands ---

export async function runPlanList(): Promise<void> {
  const plans = await listPlans();

  if (plans.length === 0) {
    console.log("  No plans found. Create one with 'opcom plan create'.");
    return;
  }

  console.log("  Plans:\n");
  for (const plan of plans) {
    const done = plan.steps.filter((s) => s.status === "done" || s.status === "skipped").length;
    const total = plan.steps.length;
    const icon = statusIcon(plan.status);
    console.log(`  ${icon} ${plan.name}  ${plan.status}  ${done}/${total} steps  [${plan.id.slice(0, 8)}]`);
  }
}

export async function runPlanCreate(options: {
  name?: string;
  scope?: string;
  ticketIds?: string[];
  projectIds?: string[];
  config?: Partial<OrchestratorConfig>;
}): Promise<void> {
  const ticketSets = await buildTicketSets();

  const scope: PlanScope = {};
  if (options.projectIds?.length) {
    scope.projectIds = options.projectIds;
  }
  if (options.ticketIds?.length) {
    scope.ticketIds = options.ticketIds;
  }
  if (options.scope) {
    scope.query = options.scope;
  }

  const name = options.name ?? `plan-${new Date().toISOString().slice(0, 10)}`;
  const plan = computePlan(ticketSets, scope, name, undefined, options.config);

  if (plan.steps.length === 0) {
    console.error("  No tickets match the scope. Nothing to plan.");
    return;
  }

  await savePlan(plan);

  const ready = plan.steps.filter((s) => s.status === "ready").length;
  const blocked = plan.steps.filter((s) => s.status === "blocked").length;

  console.log(`  Created plan: ${plan.name} [${plan.id.slice(0, 8)}]`);
  console.log(`  ${plan.steps.length} steps: ${ready} ready, ${blocked} blocked`);

  // Show tracks
  const tracks = new Map<string, typeof plan.steps>();
  for (const step of plan.steps) {
    const track = step.track ?? "unassigned";
    if (!tracks.has(track)) tracks.set(track, []);
    tracks.get(track)!.push(step);
  }

  if (tracks.size > 1 || (tracks.size === 1 && ![...tracks.keys()][0].startsWith("track-"))) {
    console.log("  Tracks:");
    for (const [trackName, steps] of tracks) {
      console.log(`    ${trackName}: ${steps.map((s) => s.ticketId).join(" → ")}`);
    }
  }
}

export async function runPlanShow(planId?: string): Promise<void> {
  const plan = await resolvePlan(planId);
  if (!plan) {
    console.error("  No plan found.");
    return;
  }

  const done = plan.steps.filter((s) => s.status === "done" || s.status === "skipped").length;
  console.log(`  Plan: ${plan.name}  ${statusIcon(plan.status)} ${plan.status}  ${done}/${plan.steps.length}\n`);

  // Group by track
  const tracks = new Map<string, typeof plan.steps>();
  for (const step of plan.steps) {
    const track = step.track ?? "unassigned";
    if (!tracks.has(track)) tracks.set(track, []);
    tracks.get(track)!.push(step);
  }

  for (const [trackName, steps] of tracks) {
    console.log(`  [${trackName}]`);
    for (const step of steps) {
      const icon = stepIcon(step.status);
      const deps = step.blockedBy.length > 0 ? `  (after: ${step.blockedBy.join(", ")})` : "";
      const agent = step.agentSessionId ? `  agent:${step.agentSessionId.slice(0, 8)}` : "";
      const err = step.error ? `  err: ${step.error}` : "";
      console.log(`    ${icon} ${step.ticketId}  ${step.status}${deps}${agent}${err}`);
    }
    console.log();
  }

  if (plan.context) {
    console.log(`  Context:\n  ${plan.context.split("\n").join("\n  ")}\n`);
  }
}

export async function runPlanExecute(planId?: string): Promise<void> {
  const plan = await resolvePlan(planId);
  if (!plan) {
    console.error("  No plan found. Create one with 'opcom plan create'.");
    return;
  }

  if (plan.status === "done") {
    console.error("  Plan is already done.");
    return;
  }

  console.log(`  Executing plan: ${plan.name} [${plan.id.slice(0, 8)}]`);
  console.log(`  Max concurrent agents: ${plan.config.maxConcurrentAgents}`);
  console.log(`  Pause on failure: ${plan.config.pauseOnFailure}`);
  console.log();

  let eventStore: EventStore | undefined;
  try {
    eventStore = new EventStore();
  } catch {
    // EventStore is optional — continue without plan event persistence
  }

  const sessionManager = new SessionManager();
  await sessionManager.init({ eventStore });

  const executor = new Executor(plan, sessionManager, eventStore);

  executor.on("step_started", ({ step }) => {
    console.log(`  ${stepIcon("in-progress")} Started: ${step.ticketId}  agent:${step.agentSessionId?.slice(0, 8) ?? "?"}`);
  });

  executor.on("step_completed", ({ step }) => {
    console.log(`  ${stepIcon("done")} Completed: ${step.ticketId}`);
  });

  executor.on("step_failed", ({ step, error }) => {
    console.error(`  ${stepIcon("failed")} Failed: ${step.ticketId}  ${error}`);
  });

  executor.on("plan_paused", () => {
    console.log("\n  Plan paused.");
  });

  executor.on("plan_completed", () => {
    console.log("\n  Plan completed!");
  });

  // Handle Ctrl+C to pause
  const sigHandler = () => {
    console.log("\n  Pausing plan...");
    executor.pause();
  };
  process.on("SIGINT", sigHandler);

  try {
    await executor.run();
  } finally {
    process.off("SIGINT", sigHandler);
  }
}

export async function runPlanPause(planId?: string): Promise<void> {
  const plan = await resolvePlan(planId);
  if (!plan) {
    console.error("  No plan found.");
    return;
  }

  if (plan.status !== "executing") {
    console.error(`  Plan is not executing (status: ${plan.status}).`);
    return;
  }

  plan.status = "paused";
  await savePlan(plan);
  console.log(`  Paused plan: ${plan.name}`);
}

export async function runPlanResume(planId?: string): Promise<void> {
  const plan = await resolvePlan(planId);
  if (!plan) {
    console.error("  No plan found.");
    return;
  }

  if (plan.status !== "paused") {
    console.error(`  Plan is not paused (status: ${plan.status}).`);
    return;
  }

  // Resume by re-executing
  return runPlanExecute(plan.id);
}

export async function runPlanContext(text: string, planId?: string): Promise<void> {
  const plan = await resolvePlan(planId);
  if (!plan) {
    console.error("  No plan found.");
    return;
  }

  plan.context += (plan.context ? "\n" : "") + text;
  await savePlan(plan);
  console.log(`  Context added to plan: ${plan.name}`);
}

export async function runPlanSkip(ticketId: string, planId?: string): Promise<void> {
  const plan = await resolvePlan(planId);
  if (!plan) {
    console.error("  No plan found.");
    return;
  }

  const step = plan.steps.find((s) => s.ticketId === ticketId);
  if (!step) {
    console.error(`  Step '${ticketId}' not found in plan.`);
    return;
  }

  step.status = "skipped";
  step.completedAt = new Date().toISOString();
  await savePlan(plan);
  console.log(`  Skipped: ${ticketId}`);
}

export async function runPlanHygiene(): Promise<void> {
  const ticketSets = await buildTicketSets();

  const sessionManager = new SessionManager();
  await sessionManager.init();
  const sessions = await sessionManager.loadAllPersistedSessions();

  const report = checkHygiene(ticketSets, sessions);

  if (report.issues.length === 0) {
    console.log("  All tickets healthy. No issues found.");
    return;
  }

  console.log(`  Ticket Hygiene Report: ${report.issues.length} issue(s)\n`);

  const severityIcon = { error: "\u2717", warning: "\u26a0", info: "\u2139" };

  for (const issue of report.issues) {
    const icon = severityIcon[issue.severity] ?? "?";
    console.log(`  ${icon} [${issue.severity}] ${issue.ticketId}: ${issue.message}`);
    console.log(`    ${issue.suggestion}`);
  }

  console.log();
  if (report.cycles.length > 0) {
    console.log(`  Dependency cycles: ${report.cycles.length}`);
  }
  if (report.orphanDeps.length > 0) {
    console.log(`  Orphan dependencies: ${report.orphanDeps.length}`);
  }
  if (report.unblockedTickets.length > 0) {
    console.log(`  Ready to work: ${report.unblockedTickets.length}`);
  }
  if (report.abandonedTickets.length > 0) {
    console.log(`  Abandoned in-progress: ${report.abandonedTickets.length}`);
  }
  if (report.staleTickets.length > 0) {
    console.log(`  Stale tickets: ${report.staleTickets.length}`);
  }
}
