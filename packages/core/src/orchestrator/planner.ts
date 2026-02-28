import { randomUUID } from "node:crypto";
import type {
  Plan,
  PlanStep,
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

  // Build steps
  const steps: PlanStep[] = [];
  for (const [ticketId, { ticket, projectId }] of allTickets) {
    // Only include deps that are in our scope
    const blockedBy = ticket.deps.filter((d) => allTickets.has(d));

    const status: StepStatus = blockedBy.length > 0 ? "blocked" : "ready";

    steps.push({
      ticketId,
      projectId,
      status,
      blockedBy,
    });
  }

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
 */
export function recomputePlan(plan: Plan, ticketSets: TicketSet[]): Plan {
  // Build lookup of current ticket states
  const ticketStates = new Map<string, WorkItem>();
  for (const ts of ticketSets) {
    for (const t of ts.tickets) {
      ticketStates.set(t.id, t);
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

function isSticky(status: StepStatus): boolean {
  return status === "in-progress" || status === "done" || status === "failed" || status === "skipped";
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
