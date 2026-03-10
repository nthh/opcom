import { randomUUID } from "node:crypto";
import type {
  Plan,
  PlanStep,
  PlanStage,
  PlanScope,
  OrchestratorConfig,
  WorkItem,
  StepStatus,
  TeamDefinition,
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
  teamResolutions?: Map<string, TeamDefinition>,
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
  let steps: PlanStep[] = [];
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
      verificationMode: ticket.verification,
    });
  }

  // Expand team definitions into multi-step sequences
  if (teamResolutions && teamResolutions.size > 0) {
    steps = expandTeamSteps(steps, teamResolutions);
  }

  // Sort steps by priority (P1 first) so executor picks highest priority ready steps
  steps.sort((a, b) => {
    const pa = allTickets.get(a.ticketId)?.ticket.priority
      ?? allTickets.get(baseTicketId(a.ticketId))?.ticket.priority
      ?? 99;
    const pb = allTickets.get(b.ticketId)?.ticket.priority
      ?? allTickets.get(baseTicketId(b.ticketId))?.ticket.priority
      ?? 99;
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
 * Extract the base ticket ID from a team-expanded step ID.
 * "implement-auth/engineer" → "implement-auth"
 * "implement-auth" → "implement-auth"
 */
export function baseTicketId(stepTicketId: string): string {
  const slashIdx = stepTicketId.lastIndexOf("/");
  return slashIdx >= 0 ? stepTicketId.slice(0, slashIdx) : stepTicketId;
}

/**
 * Expand team definitions into multi-step sequences.
 * For each step whose ticket has a resolved team with >1 step,
 * replace the single step with multiple sub-steps chained by depends_on.
 *
 * Sub-step ticketIds use the format: "ticketId/role"
 * Sub-steps share the same base ticketId for worktree reuse.
 */
export function expandTeamSteps(
  steps: PlanStep[],
  teamResolutions: Map<string, TeamDefinition>,
): PlanStep[] {
  const result: PlanStep[] = [];

  for (const step of steps) {
    const team = teamResolutions.get(step.ticketId);
    if (!team || team.steps.length <= 1) {
      // No team or single-step team — keep the original step
      // For single-step teams, apply the team's verification and role
      if (team && team.steps.length === 1) {
        const ts = team.steps[0];
        step.role = ts.role;
        step.teamId = team.id;
        step.teamStepRole = ts.role;
        if (ts.verification) step.verificationMode = ts.verification;
      }
      result.push(step);
      continue;
    }

    // Multi-step team: expand into sub-steps
    // Build a map of role → synthesized ticketId for dependency resolution
    const roleToStepId = new Map<string, string>();
    for (const ts of team.steps) {
      roleToStepId.set(ts.role, `${step.ticketId}/${ts.role}`);
    }

    for (const ts of team.steps) {
      const subStepId = roleToStepId.get(ts.role)!;

      // Build blockedBy: original ticket deps (for the first step) + team internal deps
      const subBlockedBy: string[] = [];

      if (ts.depends_on) {
        // Blocked by the preceding team step
        const depStepId = roleToStepId.get(ts.depends_on);
        if (depStepId) subBlockedBy.push(depStepId);
      } else {
        // First step in team — inherits the original ticket's blockedBy
        subBlockedBy.push(...step.blockedBy);
      }

      const subStatus: StepStatus = subBlockedBy.length > 0 ? "blocked" : "ready";

      result.push({
        ticketId: subStepId,
        projectId: step.projectId,
        status: subStatus,
        blockedBy: subBlockedBy,
        role: ts.role,
        verificationMode: ts.verification,
        teamId: team.id,
        teamStepRole: ts.role,
      });
    }

    // Update any other steps that were blocked by the original ticketId
    // to instead be blocked by the LAST sub-step of the team sequence
    const lastRole = team.steps[team.steps.length - 1].role;
    const lastSubStepId = roleToStepId.get(lastRole)!;

    // We need to fix blockedBy references in steps that haven't been expanded yet
    // and also in the already-expanded result
    for (const s of steps) {
      if (s === step) continue;
      const idx = s.blockedBy.indexOf(step.ticketId);
      if (idx >= 0) {
        s.blockedBy[idx] = lastSubStepId;
      }
    }
    // Also fix in already-expanded result
    for (const s of result) {
      const idx = s.blockedBy.indexOf(step.ticketId);
      if (idx >= 0) {
        s.blockedBy[idx] = lastSubStepId;
      }
    }
  }

  return result;
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
    // Preserve sticky statuses — return the SAME object reference so that
    // fire-and-forget functions (handleWorktreeCompletion, runVerification)
    // that hold a reference to the step can still mutate it in place.
    // Spreading ({ ...step }) would create a detached copy, and any
    // subsequent mutations by those async functions would be silently lost.
    if (isSticky(step.status)) {
      return step;
    }

    // Auto-skip steps whose tickets have been closed externally (e.g. merged
    // by a different plan execution).  Without this, closed tickets stay
    // "ready" and waste agent time re-implementing already-done work.
    const ownTicket = ticketStates.get(step.ticketId);
    if (ownTicket?.status === "closed") {
      step.status = "skipped";
      return step;
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
  return status === "in-progress" || status === "verifying" || status === "done" || status === "failed" || status === "skipped" || status === "needs-rebase" || status === "pending-confirmation";
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
 * Compute stages by grouping steps by track (feature area), not dependency depth.
 *
 * 1. Group steps by their assigned track (connected components in dep graph)
 * 2. Order tracks: if track B depends on track A, A comes first; among peers, higher priority first
 * 3. Batch tracks into stages based on maxStageSize (default 6)
 * 4. Name each stage from its constituent track names
 *
 * This produces reviewable batches: "geo pipeline", "serving layer", "UI + demos"
 * instead of "all root tickets" vs "everything else".
 */
export function computeStages(steps: PlanStep[], maxStageSize = 6): PlanStage[] {
  if (steps.length === 0) return [];

  // Group steps by track
  const trackMap = new Map<string, PlanStep[]>();
  for (const step of steps) {
    const track = step.track ?? "unassigned";
    if (!trackMap.has(track)) trackMap.set(track, []);
    trackMap.get(track)!.push(step);
  }

  // Build inter-track dependency graph: track B depends on track A if any
  // step in B has a blockedBy pointing to a step in A
  const stepToTrack = new Map<string, string>();
  for (const [trackName, trackSteps] of trackMap) {
    for (const s of trackSteps) {
      stepToTrack.set(s.ticketId, trackName);
    }
  }

  const trackDeps = new Map<string, Set<string>>();
  for (const trackName of trackMap.keys()) {
    trackDeps.set(trackName, new Set());
  }
  for (const step of steps) {
    const myTrack = stepToTrack.get(step.ticketId)!;
    for (const dep of step.blockedBy) {
      const depTrack = stepToTrack.get(dep);
      if (depTrack && depTrack !== myTrack) {
        trackDeps.get(myTrack)!.add(depTrack);
      }
    }
  }

  // Topological sort tracks with priority as tiebreaker
  const orderedTracks = topoSortTracks(trackMap, trackDeps);

  // Batch tracks into stages respecting maxStageSize and inter-track deps
  const stages: PlanStage[] = [];
  const assignedTracks = new Set<string>();

  for (const trackName of orderedTracks) {
    const trackSteps = trackMap.get(trackName)!;

    // Check if this track can fit in the current (last) stage
    const lastStage = stages.length > 0 ? stages[stages.length - 1] : null;
    const canMerge = lastStage &&
      lastStage.stepTicketIds.length + trackSteps.length <= maxStageSize &&
      // All of this track's dep tracks must be in earlier stages (not the same stage)
      allDepsInEarlierStages(trackName, trackDeps, assignedTracks, lastStage, stepToTrack);

    if (canMerge && lastStage) {
      lastStage.stepTicketIds.push(...trackSteps.map((s) => s.ticketId));
      if (lastStage.name) {
        lastStage.name += ` + ${trackName}`;
      }
    } else {
      stages.push({
        index: stages.length,
        name: trackName,
        stepTicketIds: trackSteps.map((s) => s.ticketId),
        status: "pending",
      });
    }

    assignedTracks.add(trackName);
  }

  return stages;
}

/**
 * Check if all dep-tracks for a given track have been assigned to stages
 * earlier than the candidate stage (i.e., not in the candidate stage itself).
 */
function allDepsInEarlierStages(
  trackName: string,
  trackDeps: Map<string, Set<string>>,
  assignedTracks: Set<string>,
  candidateStage: PlanStage,
  stepToTrack: Map<string, string>,
): boolean {
  const deps = trackDeps.get(trackName);
  if (!deps || deps.size === 0) return true;

  // Get which tracks are in the candidate stage
  const tracksInCandidate = new Set<string>();
  for (const id of candidateStage.stepTicketIds) {
    const t = stepToTrack.get(id);
    if (t) tracksInCandidate.add(t);
  }

  for (const depTrack of deps) {
    if (!assignedTracks.has(depTrack)) return false; // dep not yet assigned
    if (tracksInCandidate.has(depTrack)) return false; // dep is in same stage
  }
  return true;
}

/**
 * Topological sort of tracks, using priority as tiebreaker.
 * Higher priority (lower number) tracks come first among peers.
 */
function topoSortTracks(
  trackMap: Map<string, PlanStep[]>,
  trackDeps: Map<string, Set<string>>,
): string[] {
  const inDegree = new Map<string, number>();
  for (const name of trackMap.keys()) {
    inDegree.set(name, 0);
  }
  for (const [, deps] of trackDeps) {
    for (const dep of deps) {
      if (inDegree.has(dep)) {
        // dep has a dependent — but inDegree counts how many deps point INTO a node
      }
    }
  }
  // inDegree[X] = how many tracks X depends on (that are in the graph)
  for (const [trackName, deps] of trackDeps) {
    let count = 0;
    for (const dep of deps) {
      if (trackMap.has(dep)) count++;
    }
    inDegree.set(trackName, count);
  }

  // Track priority = min priority among its steps (lower = higher priority)
  const trackPriority = new Map<string, number>();
  for (const [name, steps] of trackMap) {
    const minP = Math.min(...steps.map((s) => {
      // Steps don't have priority directly; use position in the sorted array as proxy
      // Steps are already sorted by priority in computePlan
      return steps.indexOf(s);
    }));
    trackPriority.set(name, minP);
  }

  // Kahn's algorithm with priority queue (sorted by priority)
  const queue: string[] = [];
  for (const [name, deg] of inDegree) {
    if (deg === 0) queue.push(name);
  }
  queue.sort((a, b) => (trackPriority.get(a) ?? 99) - (trackPriority.get(b) ?? 99));

  const result: string[] = [];
  const visited = new Set<string>();

  while (queue.length > 0) {
    const current = queue.shift()!;
    if (visited.has(current)) continue;
    visited.add(current);
    result.push(current);

    // Find tracks that depend on current and decrement their in-degree
    for (const [trackName, deps] of trackDeps) {
      if (deps.has(current) && !visited.has(trackName)) {
        inDegree.set(trackName, (inDegree.get(trackName) ?? 1) - 1);
        if (inDegree.get(trackName) === 0) {
          queue.push(trackName);
          queue.sort((a, b) => (trackPriority.get(a) ?? 99) - (trackPriority.get(b) ?? 99));
        }
      }
    }
  }

  // Catch any remaining tracks (cycles) — append them at the end
  for (const name of trackMap.keys()) {
    if (!visited.has(name)) {
      result.push(name);
    }
  }

  return result;
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
