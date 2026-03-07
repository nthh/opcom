import { randomUUID } from "node:crypto";
import type {
  Plan,
  PlanStep,
  PlanStage,
  PlanScope,
  OrchestratorConfig,
  WorkItem,
  StepStatus,
} from "@opcom/types";
import { defaultConfig } from "./persistence.js";

export interface TicketSet {
  projectId: string;
  tickets: WorkItem[];
}

/**
 * Filter tickets by scope criteria.
 */
export function resolveScope(ticketSets: TicketSet[], scope: PlanScope): TicketSet[] {
  let result = ticketSets;

  if (scope.projectIds?.length) {
    result = result.filter((ts) => scope.projectIds!.includes(ts.projectId));
  }

  result = result.map((ts) => {
    let tickets = ts.tickets;

    if (scope.ticketIds?.length) {
      tickets = tickets.filter((t) => scope.ticketIds!.includes(t.id));
    }

    if (scope.query) {
      tickets = applyQuery(tickets, scope.query);
    }

    return { ...ts, tickets };
  });

  return result.filter((ts) => ts.tickets.length > 0);
}

/**
 * Simple query parser: "status:open priority:<=2"
 */
export function applyQuery(tickets: WorkItem[], query: string): WorkItem[] {
  const parts = query.trim().split(/\s+/);
  let result = tickets;

  for (const part of parts) {
    const [key, val] = part.split(":");
    if (!key || !val) continue;

    switch (key) {
      case "status":
        result = result.filter((t) => t.status === val);
        break;
      case "priority": {
        const match = val.match(/^(<=?|>=?|=)?(\d+)$/);
        if (match) {
          const op = match[1] || "=";
          const num = parseInt(match[2], 10);
          result = result.filter((t) => {
            switch (op) {
              case "<=": return t.priority <= num;
              case "<": return t.priority < num;
              case ">=": return t.priority >= num;
              case ">": return t.priority > num;
              default: return t.priority === num;
            }
          });
        }
        break;
      }
      case "type":
        result = result.filter((t) => t.type === val);
        break;
      case "tag":
        result = result.filter((t) =>
          Object.values(t.tags).some((arr) => arr.includes(val)),
        );
        break;
    }
  }
  return result;
}

/**
 * Build a plan from ticket dependencies.
 * Closed/deferred tickets are excluded unless they appear in existingPlan with sticky status.
 */
export function computePlan(
  ticketSets: TicketSet[],
  scope: PlanScope,
  name: string,
  existingPlan?: Plan,
  config?: Partial<OrchestratorConfig>,
): Plan {
  const scoped = resolveScope(ticketSets, scope);
  const mergedConfig = { ...defaultConfig(), ...config };

  // Collect all active tickets (exclude closed/deferred)
  const allTickets = new Map<string, { ticket: WorkItem; projectId: string }>();
  for (const ts of scoped) {
    for (const t of ts.tickets) {
      if (t.status !== "closed" && t.status !== "deferred") {
        allTickets.set(t.id, { ticket: t, projectId: ts.projectId });
      }
    }
  }

  // Identify parent tickets (tickets that have children in scope).
  // Parents are excluded from plan steps — their children are the steps.
  const parentIds = findParentTicketIds(allTickets);

  // Build steps
  const steps: PlanStep[] = [];
  for (const [ticketId, { ticket, projectId }] of allTickets) {
    // Skip parent tickets — children are the executable steps
    if (parentIds.has(ticketId)) continue;

    // Only include deps that are in our scope and are not parent tickets
    const blockedBy = ticket.deps.filter(
      (d) => allTickets.has(d) && !parentIds.has(d),
    );

    const status: StepStatus = blockedBy.length > 0 ? "blocked" : "ready";

    steps.push({
      ticketId,
      projectId,
      status,
      blockedBy,
      role: ticket.role,
    });
  }

  // Sort steps by priority (P1 first) so executor picks highest priority ready steps
  steps.sort((a, b) => {
    const pa = allTickets.get(a.ticketId)?.ticket.priority ?? 99;
    const pb = allTickets.get(b.ticketId)?.ticket.priority ?? 99;
    return pa - pb;
  });

  // Assign tracks
  const tracks = computeTracks(steps);
  for (const [trackName, stepIds] of tracks) {
    for (const id of stepIds) {
      const step = steps.find((s) => s.ticketId === id);
      if (step) step.track = trackName;
    }
  }

  // Preserve sticky statuses from existing plan
  if (existingPlan) {
    for (const step of steps) {
      const existing = existingPlan.steps.find((s) => s.ticketId === step.ticketId);
      if (existing && isSticky(existing.status)) {
        step.status = existing.status;
        step.agentSessionId = existing.agentSessionId;
        step.startedAt = existing.startedAt;
        step.completedAt = existing.completedAt;
        step.error = existing.error;
        step.worktreePath = existing.worktreePath;
        step.worktreeBranch = existing.worktreeBranch;
      }
    }
  }

  const now = new Date().toISOString();

  return {
    id: existingPlan?.id ?? randomUUID(),
    name,
    status: "planning",
    scope,
    steps,
    config: mergedConfig,
    context: existingPlan?.context ?? "",
    createdAt: existingPlan?.createdAt ?? now,
    updatedAt: now,
  };
}

/**
 * Recompute plan statuses from current ticket state, preserving sticky statuses.
 * Handles parent-child rollup: a dep on a parent ticket is resolved when all
 * of that parent's children are done/skipped.
 */
export function recomputePlan(plan: Plan, ticketSets: TicketSet[]): Plan {
  // Build lookup of current ticket states
  const ticketStates = new Map<string, WorkItem>();
  for (const ts of ticketSets) {
    for (const t of ts.tickets) {
      ticketStates.set(t.id, t);
    }
  }

  // Build parent→children map for rollup
  const parentChildren = new Map<string, string[]>();
  for (const [, ticket] of ticketStates) {
    if (ticket.parent) {
      const children = parentChildren.get(ticket.parent) ?? [];
      children.push(ticket.id);
      parentChildren.set(ticket.parent, children);
    }
  }

  const updatedSteps = plan.steps.map((step) => {
    // Preserve sticky statuses
    if (isSticky(step.status)) {
      return { ...step };
    }

    // Check if all blockers are resolved
    const unresolvedBlockers = step.blockedBy.filter((depId) => {
      // A blocker is resolved if:
      // 1. The dep ticket is closed
      const depTicket = ticketStates.get(depId);
      if (depTicket?.status === "closed") return false;

      // 2. The dep step is done or skipped
      const depStep = plan.steps.find((s) => s.ticketId === depId);
      if (depStep && (depStep.status === "done" || depStep.status === "skipped")) return false;

      // 3. The dep is a parent ticket and all its children are done/skipped
      if (isParentResolved(depId, parentChildren, plan.steps, ticketStates)) {
        return false;
      }

      return true;
    });

    const newStatus: StepStatus = unresolvedBlockers.length > 0 ? "blocked" : "ready";
    return { ...step, status: newStatus };
  });

  return {
    ...plan,
    steps: updatedSteps,
    updatedAt: new Date().toISOString(),
  };
}

/**
 * Check if a parent ticket is resolved (all children done/skipped/closed).
 */
function isParentResolved(
  ticketId: string,
  parentChildren: Map<string, string[]>,
  steps: PlanStep[],
  ticketStates: Map<string, WorkItem>,
): boolean {
  const children = parentChildren.get(ticketId);
  if (!children || children.length === 0) return false;

  return children.every((childId) => {
    const childTicket = ticketStates.get(childId);
    if (childTicket?.status === "closed") return true;
    const childStep = steps.find((s) => s.ticketId === childId);
    return childStep && (childStep.status === "done" || childStep.status === "skipped");
  });
}

function isSticky(status: StepStatus): boolean {
  return status === "in-progress" || status === "verifying" || status === "done" || status === "failed" || status === "skipped" || status === "needs-rebase";
}

/**
 * Compute tracks using BFS connected components.
 * Tickets connected by deps form one track. Isolated tickets get their own track.
 */
export function computeTracks(steps: PlanStep[]): Map<string, string[]> {
  const ids = steps.map((s) => s.ticketId);
  const parent = new Map<string, string>();
  for (const id of ids) parent.set(id, id);

  function find(x: string): string {
    while (parent.get(x) !== x) {
      parent.set(x, parent.get(parent.get(x)!)!);
      x = parent.get(x)!;
    }
    return x;
  }

  function union(a: string, b: string): void {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent.set(ra, rb);
  }

  // Union steps connected by deps
  for (const step of steps) {
    for (const dep of step.blockedBy) {
      if (parent.has(dep)) {
        union(step.ticketId, dep);
      }
    }
  }

  // Group by root
  const groups = new Map<string, string[]>();
  for (const id of ids) {
    const root = find(id);
    if (!groups.has(root)) groups.set(root, []);
    groups.get(root)!.push(id);
  }

  // Name tracks by common prefix or fallback to track-N
  const tracks = new Map<string, string[]>();
  let trackNum = 0;
  for (const members of groups.values()) {
    const name = computeTrackName(members) ?? `track-${trackNum}`;
    tracks.set(name, members);
    trackNum++;
  }

  return tracks;
}

function computeTrackName(ticketIds: string[]): string | null {
  if (ticketIds.length === 0) return null;
  if (ticketIds.length === 1) return ticketIds[0];

  // Find common prefix
  const parts = ticketIds.map((id) => id.split("-"));
  const minLen = Math.min(...parts.map((p) => p.length));
  const common: string[] = [];

  for (let i = 0; i < minLen; i++) {
    const val = parts[0][i];
    if (parts.every((p) => p[i] === val)) {
      common.push(val);
    } else {
      break;
    }
  }

  return common.length > 0 ? common.join("-") : null;
}

/**
 * Identify tickets that have children in the ticket set.
 * These are "epic" tickets that should be excluded from plan steps.
 */
export function findParentTicketIds(
  allTickets: Map<string, { ticket: WorkItem; projectId: string }>,
): Set<string> {
  const parentIds = new Set<string>();
  for (const [, { ticket }] of allTickets) {
    if (ticket.parent && allTickets.has(ticket.parent)) {
      parentIds.add(ticket.parent);
    }
  }
  return parentIds;
}

/**
 * DFS-based cycle detection on the step DAG.
 * Returns arrays of ticket IDs forming cycles.
 */
export function detectCycles(steps: PlanStep[]): string[][] {
  const adj = new Map<string, string[]>();
  const ids = new Set<string>();
  for (const step of steps) {
    ids.add(step.ticketId);
    adj.set(step.ticketId, step.blockedBy.filter((d) => ids.has(d) || steps.some((s) => s.ticketId === d)));
  }

  // Rebuild adj to only include edges to known nodes
  for (const [id, deps] of adj) {
    adj.set(id, deps.filter((d) => ids.has(d)));
  }

  const WHITE = 0, GRAY = 1, BLACK = 2;
  const color = new Map<string, number>();
  const parent = new Map<string, string | null>();
  for (const id of ids) {
    color.set(id, WHITE);
    parent.set(id, null);
  }

  const cycles: string[][] = [];

  function dfs(u: string): void {
    color.set(u, GRAY);
    for (const v of adj.get(u) ?? []) {
      if (color.get(v) === GRAY) {
        // Found cycle — trace back
        const cycle: string[] = [v];
        let cur = u;
        while (cur !== v) {
          cycle.push(cur);
          cur = parent.get(cur)!;
        }
        cycle.reverse();
        cycles.push(cycle);
      } else if (color.get(v) === WHITE) {
        parent.set(v, u);
        dfs(v);
      }
    }
    color.set(u, BLACK);
  }

  for (const id of ids) {
    if (color.get(id) === WHITE) {
      dfs(id);
    }
  }

  return cycles;
}

/**
 * Compute stages from the DAG — each "wave" of steps that can run in parallel
 * at the same dependency depth forms a stage.
 *
 * Stage 1: all steps with no deps (leaf nodes)
 * Stage 2: steps whose deps were all in stage 1
 * Stage 3: steps whose deps were all in stages 1 or 2
 * ...
 */
export function computeStages(steps: PlanStep[]): PlanStage[] {
  const stages: PlanStage[] = [];
  const assigned = new Set<string>();
  const allIds = new Set(steps.map((s) => s.ticketId));

  while (assigned.size < steps.length) {
    const wave = steps.filter(
      (s) =>
        !assigned.has(s.ticketId) &&
        s.blockedBy
          .filter((dep) => allIds.has(dep))
          .every((dep) => assigned.has(dep)),
    );

    if (wave.length === 0) {
      // Remaining steps have unresolvable deps (cycles or external deps) —
      // put them all in a final stage to avoid infinite loop
      const remaining = steps.filter((s) => !assigned.has(s.ticketId));
      stages.push({
        index: stages.length,
        stepTicketIds: remaining.map((s) => s.ticketId),
        status: "pending",
      });
      break;
    }

    stages.push({
      index: stages.length,
      stepTicketIds: wave.map((s) => s.ticketId),
      status: "pending",
    });
    wave.forEach((s) => assigned.add(s.ticketId));
  }

  return stages;
}

/**
 * Build stages from explicit user-defined stage definitions.
 * Each entry in `stageDefinitions` is an array of ticket IDs that form a stage.
 * Validates that deps are respected: a ticket cannot be staged before its deps.
 */
export function buildExplicitStages(
  steps: PlanStep[],
  stageDefinitions: string[][],
): PlanStage[] {
  const errors = validateExplicitStages(steps, stageDefinitions);
  if (errors.length > 0) {
    throw new Error(`Invalid stage definitions: ${errors.join("; ")}`);
  }

  const stages: PlanStage[] = stageDefinitions.map((ticketIds, index) => ({
    index,
    stepTicketIds: ticketIds,
    status: "pending" as const,
  }));

  // Steps not listed in any explicit stage go into a final auto-stage
  const explicitIds = new Set(stageDefinitions.flat());
  const unlisted = steps.filter((s) => !explicitIds.has(s.ticketId));
  if (unlisted.length > 0) {
    stages.push({
      index: stages.length,
      stepTicketIds: unlisted.map((s) => s.ticketId),
      status: "pending",
    });
  }

  return stages;
}

/**
 * Validate explicit stage definitions against the dependency graph.
 * Returns an array of error messages (empty if valid).
 */
export function validateExplicitStages(
  steps: PlanStep[],
  stageDefinitions: string[][],
): string[] {
  const errors: string[] = [];
  const stepMap = new Map(steps.map((s) => [s.ticketId, s]));
  const allStepIds = new Set(steps.map((s) => s.ticketId));

  // Check that all referenced tickets exist as steps
  for (let i = 0; i < stageDefinitions.length; i++) {
    for (const id of stageDefinitions[i]) {
      if (!stepMap.has(id)) {
        errors.push(`Stage ${i + 1}: ticket "${id}" is not a plan step`);
      }
    }
  }

  // Build ticket → stage index mapping
  const ticketStage = new Map<string, number>();
  for (let i = 0; i < stageDefinitions.length; i++) {
    for (const id of stageDefinitions[i]) {
      if (ticketStage.has(id)) {
        errors.push(`Ticket "${id}" appears in multiple stages`);
      }
      ticketStage.set(id, i);
    }
  }

  // Check dependency ordering: a ticket's deps must be in an earlier stage
  for (let i = 0; i < stageDefinitions.length; i++) {
    for (const id of stageDefinitions[i]) {
      const step = stepMap.get(id);
      if (!step) continue;
      for (const dep of step.blockedBy) {
        if (!allStepIds.has(dep)) continue; // external dep — skip
        const depStageIdx = ticketStage.get(dep);
        if (depStageIdx !== undefined && depStageIdx >= i) {
          errors.push(
            `Stage ${i + 1}: ticket "${id}" depends on "${dep}" which is in stage ${depStageIdx + 1} (must be earlier)`,
          );
        }
      }
    }
  }

  return errors;
}

/**
 * Compute the summary for a completed stage by examining its steps.
 */
export function computeStageSummary(
  stage: PlanStage,
  steps: PlanStep[],
): import("@opcom/types").StageSummary {
  const stageSteps = steps.filter((s) => stage.stepTicketIds.includes(s.ticketId));

  let totalPassed = 0;
  let totalFailed = 0;
  let hasTestResults = false;

  for (const step of stageSteps) {
    if (step.verification?.testGate) {
      hasTestResults = true;
      totalPassed += step.verification.testGate.passedTests;
      totalFailed += step.verification.testGate.failedTests;
    }
  }

  const startedAt = stage.startedAt ? new Date(stage.startedAt).getTime() : Date.now();
  const completedAt = stage.completedAt ? new Date(stage.completedAt).getTime() : Date.now();

  return {
    completed: stageSteps.filter((s) => s.status === "done").length,
    failed: stageSteps.filter((s) => s.status === "failed" || s.status === "needs-rebase").length,
    skipped: stageSteps.filter((s) => s.status === "skipped").length,
    durationMs: completedAt - startedAt,
    ...(hasTestResults ? { testResults: { passed: totalPassed, failed: totalFailed } } : {}),
  };
}
