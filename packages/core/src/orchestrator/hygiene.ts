import type {
  WorkItem,
  AgentSession,
  HygieneReport,
  HygieneIssue,
} from "@opcom/types";
import type { TicketSet } from "./planner.js";
export type { TicketSet } from "./planner.js";

export interface HygieneOptions {
  /** Flag open tickets with no activity in this many days (default: 14) */
  staleDays?: number;
  /** Override "now" for testing */
  now?: Date;
}

/**
 * Run automated ticket health checks across all projects.
 */
export function checkHygiene(
  ticketSets: TicketSet[],
  sessions: AgentSession[],
  options?: HygieneOptions,
): HygieneReport {
  const allTickets = new Map<string, WorkItem>();
  for (const ts of ticketSets) {
    for (const t of ts.tickets) {
      allTickets.set(t.id, t);
    }
  }

  const activeSessions = sessions.filter((s) => s.state !== "stopped");
  const activeWorkItemIds = new Set(activeSessions.map((s) => s.workItemId).filter(Boolean) as string[]);

  const issues: HygieneIssue[] = [];
  const orphanDeps: string[] = [];
  const staleTickets: string[] = [];
  const unblockedTickets: string[] = [];
  const abandonedTickets: string[] = [];

  // Check each ticket
  for (const [, ticket] of allTickets) {
    // Orphan deps: deps referencing non-existent tickets
    for (const dep of ticket.deps) {
      if (!allTickets.has(dep)) {
        orphanDeps.push(ticket.id);
        issues.push({
          severity: "warning",
          category: "orphan-dep",
          ticketId: ticket.id,
          message: `Depends on '${dep}' which does not exist`,
          suggestion: `Remove '${dep}' from deps or create the missing ticket`,
        });
      }
    }

    // Unblocked: all deps are closed but ticket is still open
    if (ticket.status === "open" && ticket.deps.length > 0) {
      const allDepsClosed = ticket.deps.every((dep) => {
        const depTicket = allTickets.get(dep);
        return depTicket?.status === "closed";
      });
      // Only flag if all deps exist and are closed (skip if some deps are orphans)
      const allDepsExist = ticket.deps.every((dep) => allTickets.has(dep));
      if (allDepsClosed && allDepsExist) {
        unblockedTickets.push(ticket.id);
        issues.push({
          severity: "info",
          category: "unblocked",
          ticketId: ticket.id,
          message: "All dependencies are closed but ticket is still open",
          suggestion: "This ticket is ready to work on",
        });
      }
    }

    // Abandoned: in-progress with no running agent
    if (ticket.status === "in-progress" && !activeWorkItemIds.has(ticket.id)) {
      abandonedTickets.push(ticket.id);
      issues.push({
        severity: "warning",
        category: "abandoned",
        ticketId: ticket.id,
        message: "Ticket is in-progress but no agent is working on it",
        suggestion: "Assign an agent or move back to open status",
      });
    }

    // Stale: open ticket created more than N days ago
    const staleDays = options?.staleDays ?? 14;
    if (ticket.status === "open" && ticket.created) {
      const createdDate = new Date(ticket.created);
      if (!isNaN(createdDate.getTime())) {
        const now = options?.now ?? new Date();
        const ageMs = now.getTime() - createdDate.getTime();
        const ageDays = Math.floor(ageMs / (1000 * 60 * 60 * 24));
        if (ageDays >= staleDays) {
          staleTickets.push(ticket.id);
          issues.push({
            severity: "warning",
            category: "stale",
            ticketId: ticket.id,
            message: `Open for ${ageDays} days with no progress`,
            suggestion: "Work on this ticket, update its priority, or defer it",
          });
        }
      }
    }
  }

  // Cycle detection on raw tickets
  const cycles = detectCyclesInTickets(allTickets);
  for (const cycle of cycles) {
    const cycleStr = cycle.join(" → ") + " → " + cycle[0];
    for (const ticketId of cycle) {
      issues.push({
        severity: "error",
        category: "cycle",
        ticketId,
        message: `Part of dependency cycle: ${cycleStr}`,
        suggestion: "Break the cycle by removing one of the dependency links",
      });
    }
  }

  return {
    staleTickets,
    orphanDeps,
    cycles,
    unblockedTickets,
    abandonedTickets,
    issues,
  };
}

/**
 * DFS cycle detection on raw WorkItem dependency graph.
 */
function detectCyclesInTickets(tickets: Map<string, WorkItem>): string[][] {
  const WHITE = 0, GRAY = 1, BLACK = 2;
  const color = new Map<string, number>();
  const parent = new Map<string, string | null>();
  for (const id of tickets.keys()) {
    color.set(id, WHITE);
    parent.set(id, null);
  }

  const cycles: string[][] = [];

  function dfs(u: string): void {
    color.set(u, GRAY);
    const ticket = tickets.get(u);
    if (!ticket) return;

    for (const v of ticket.deps) {
      if (!tickets.has(v)) continue; // skip orphan deps
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

  for (const id of tickets.keys()) {
    if (color.get(id) === WHITE) {
      dfs(id);
    }
  }

  return cycles;
}
