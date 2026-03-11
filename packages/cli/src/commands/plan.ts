import { createInterface } from "node:readline";
import {
  loadGlobalConfig,
  loadWorkspace,
  loadProject,
  scanTickets,
  computePlan,
  resolveScope,
  resolveTeam,
  listPlans,
  loadPlan,
  savePlan,
  deletePlan,
  checkHygiene,
  Executor,
  SessionManager,
  EventStore,
  defaultOrchestratorConfig,
  assessTicketsForDecomposition,
  generateDecomposition,
  writeSubTickets,
} from "@opcom/core";
import type { Plan, PlanScope, OrchestratorConfig, TeamDefinition, DecompositionAssessment, WorkItem } from "@opcom/types";
import type { TicketSet } from "@opcom/core";
import { computePlanSummary } from "../tui/views/plan-overview.js";

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

export interface PlanCreateOptions {
  name?: string;
  scope?: string;
  ticketIds?: string[];
  projectIds?: string[];
  config?: Partial<OrchestratorConfig>;
  /** true = auto-decompose, false = skip assessment, undefined = interactive */
  decompose?: boolean;
  /** For testing: override readline with scripted answers */
  promptFn?: (question: string) => Promise<string>;
  /** For testing: override LLM call for decomposition */
  llmCall?: (prompt: string) => Promise<string>;
  /** For testing: override ticket set building */
  buildTicketSetsFn?: () => Promise<TicketSet[]>;
}

export async function runPlanCreate(options: PlanCreateOptions): Promise<void> {
  let ticketSets = options.buildTicketSetsFn
    ? await options.buildTicketSetsFn()
    : await buildTicketSets();

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

  // --- Decomposition assessment ---
  if (options.decompose !== false) {
    const allTickets = ticketSets.flatMap((ts) => ts.tickets);
    const assessments = assessTicketsForDecomposition(allTickets);
    const flagged = assessments.filter((a) => a.needsDecomposition);

    if (flagged.length > 0) {
      console.log(`  Decomposition assessment: ${flagged.length} oversized ticket(s) found\n`);
      for (const a of flagged) {
        console.log(`    ! ${a.ticketId}: ${a.reason}`);
      }
      console.log();

      const decomposed = await handleDecomposition(
        flagged,
        allTickets,
        ticketSets,
        options,
      );

      if (decomposed === "abort") {
        console.log("  Aborted.");
        return;
      }

      if (decomposed === "rescan") {
        // Sub-tickets were written to disk — rescan to pick them up
        ticketSets = options.buildTicketSetsFn
          ? await options.buildTicketSetsFn()
          : await buildTicketSets();
      }
    }
  }

  // Resolve teams for all tickets so the planner can expand multi-step teams
  const teamResolutions = new Map<string, TeamDefinition>();
  for (const ts of ticketSets) {
    for (const ticket of ts.tickets) {
      const team = await resolveTeam(ticket);
      if (team) {
        teamResolutions.set(ticket.id, team);
      }
    }
  }

  const name = options.name ?? `plan-${new Date().toISOString().slice(0, 10)}`;
  const plan = computePlan(ticketSets, scope, name, undefined, options.config, teamResolutions);

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
      console.log(`    ${trackName}: ${steps.map((s) => s.ticketId).join(" \u2192 ")}`);
    }
  }
}

/**
 * Handle decomposition for flagged tickets.
 * Returns "abort" if user chose to abort, "rescan" if tickets were decomposed,
 * or "skip" if all flagged tickets were skipped.
 */
async function handleDecomposition(
  flagged: DecompositionAssessment[],
  allTickets: WorkItem[],
  ticketSets: TicketSet[],
  options: PlanCreateOptions,
): Promise<"abort" | "rescan" | "skip"> {
  if (options.decompose === true) {
    // Auto-decompose all flagged tickets
    return decomposeTickets(flagged, allTickets, ticketSets, options);
  }

  // Interactive mode
  const rl = options.promptFn
    ? null
    : createInterface({ input: process.stdin, output: process.stdout });
  const ask = options.promptFn ?? ((question: string) =>
    new Promise<string>((res) => rl!.question(question, res)));

  try {
    const answer = (await ask("  [d]ecompose / [s]kip / [a]bort: ")).trim().toLowerCase();

    if (answer === "a") {
      return "abort";
    }

    if (answer === "d") {
      return decomposeTickets(flagged, allTickets, ticketSets, options);
    }

    // Default: skip
    return "skip";
  } finally {
    rl?.close();
  }
}

/**
 * Decompose all flagged tickets by generating sub-tickets and writing them to disk.
 */
async function decomposeTickets(
  flagged: DecompositionAssessment[],
  allTickets: WorkItem[],
  ticketSets: TicketSet[],
  options: PlanCreateOptions,
): Promise<"rescan" | "skip"> {
  const llmCall = options.llmCall;
  if (!llmCall) {
    console.error("  Decomposition requires an LLM backend. Use --decompose with an available backend.");
    return "skip";
  }

  let decomposed = false;
  for (const assessment of flagged) {
    const ticket = allTickets.find((t) => t.id === assessment.ticketId);
    if (!ticket) continue;

    // Find the project path for this ticket
    const projectPath = findProjectPath(ticket, ticketSets);
    if (!projectPath) continue;

    console.log(`  Decomposing ${ticket.id}...`);
    try {
      const result = await generateDecomposition(ticket, undefined, allTickets, llmCall);

      if (result.subTickets.length > 0) {
        const paths = await writeSubTickets(projectPath, result);
        console.log(`    Created ${paths.length} sub-ticket(s)`);
        for (const p of paths) {
          console.log(`      ${p}`);
        }
        decomposed = true;
      } else {
        console.log(`    No sub-tickets generated for ${ticket.id}`);
      }
    } catch (err) {
      console.error(`    Failed to decompose ${ticket.id}: ${err}`);
    }
  }

  return decomposed ? "rescan" : "skip";
}

/**
 * Find the project path for a ticket by matching its file path against ticket sets.
 */
function findProjectPath(ticket: WorkItem, ticketSets: TicketSet[]): string | undefined {
  for (const ts of ticketSets) {
    if (ts.tickets.some((t) => t.id === ticket.id)) {
      // Derive project path from ticket's filePath
      // Ticket files are at <projectPath>/.tickets/impl/<id>/...
      const ticketsIdx = ticket.filePath.indexOf(".tickets");
      if (ticketsIdx > 0) {
        return ticket.filePath.slice(0, ticketsIdx - 1);
      }
    }
  }
  return undefined;
}

export async function runPlanShow(planId?: string): Promise<void> {
  const plan = await resolvePlan(planId);
  if (!plan) {
    console.error("  No plan found.");
    return;
  }

  const summary = computePlanSummary(plan);

  const done = plan.steps.filter((s) => s.status === "done" || s.status === "skipped").length;
  console.log(`  Plan: ${plan.name}  ${statusIcon(plan.status)} ${plan.status}  ${done}/${plan.steps.length}`);
  console.log(`  ID: ${plan.id.slice(0, 8)}`);
  console.log();

  // Step breakdown
  console.log(`  Steps: ${summary.totalSteps} total, ${summary.readyCount} ready, ${summary.blockedCount} blocked`);
  console.log();

  // Tracks with steps
  for (const track of summary.tracks) {
    console.log(`  [${track.name}] (${track.stepCount} steps)`);
    for (const ticketId of track.ticketIds) {
      const step = plan.steps.find((s) => s.ticketId === ticketId);
      if (step) {
        const icon = stepIcon(step.status);
        const deps = step.blockedBy.length > 0 ? `  (after: ${step.blockedBy.join(", ")})` : "";
        const agent = step.agentSessionId ? `  agent:${step.agentSessionId.slice(0, 8)}` : "";
        const err = step.error ? `  err: ${step.error}` : "";
        console.log(`    ${icon} ${step.ticketId}  ${step.status}${deps}${agent}${err}`);
      }
    }
    console.log();
  }

  // Critical path
  if (summary.criticalPathLength > 1) {
    console.log(`  Critical path (${summary.criticalPathLength} steps): ${summary.criticalPath.join(" -> ")}`);
    console.log();
  }

  // Settings
  const cfg = summary.config;
  console.log("  Settings:");
  console.log(`    Max concurrent agents: ${cfg.maxConcurrentAgents}`);
  console.log(`    Backend: ${cfg.backend}`);
  console.log(`    Worktree: ${cfg.worktree ? "yes" : "no"}`);
  console.log(`    Auto-commit: ${cfg.autoCommit ? "yes" : "no"}`);
  console.log(`    Pause on failure: ${cfg.pauseOnFailure ? "yes" : "no"}`);
  const vParts: string[] = [];
  if (cfg.verification.runTests) vParts.push("tests");
  if (cfg.verification.runOracle) vParts.push("oracle");
  console.log(`    Verification: ${vParts.length > 0 ? vParts.join(", ") : "none"}`);
  console.log();

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

  if (plan.status === "executing") {
    console.error("  Plan is already executing. Use 'opcom plan pause' first to stop the current run.");
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
