import { describe, it, expect } from "vitest";
import { checkHygiene } from "../../packages/core/src/orchestrator/hygiene.js";
import type { WorkItem, AgentSession } from "@opcom/types";
import type { TicketSet } from "../../packages/core/src/orchestrator/hygiene.js";

function makeTicket(overrides: Partial<WorkItem> & { id: string }): WorkItem {
  return {
    title: overrides.id,
    status: "open",
    priority: 2,
    type: "task",
    filePath: `/project/.tickets/${overrides.id}.md`,
    deps: [],
    links: [],
    tags: {},
    ...overrides,
  };
}

function makeSession(overrides: Partial<AgentSession> & { id: string }): AgentSession {
  return {
    backend: "claude-code",
    projectId: "proj-a",
    state: "idle",
    startedAt: "2025-01-01T00:00:00Z",
    ...overrides,
  };
}

describe("checkHygiene", () => {
  it("detects orphan deps", () => {
    const ticketSets: TicketSet[] = [
      {
        projectId: "proj-a",
        tickets: [
          makeTicket({ id: "task-1", deps: ["nonexistent-ticket"] }),
          makeTicket({ id: "task-2" }),
        ],
      },
    ];

    const report = checkHygiene(ticketSets, []);

    expect(report.orphanDeps).toContain("task-1");
    expect(report.issues.some((i) =>
      i.category === "orphan-dep" && i.ticketId === "task-1",
    )).toBe(true);
  });

  it("detects cycles", () => {
    const ticketSets: TicketSet[] = [
      {
        projectId: "proj-a",
        tickets: [
          makeTicket({ id: "a", deps: ["b"] }),
          makeTicket({ id: "b", deps: ["a"] }),
        ],
      },
    ];

    const report = checkHygiene(ticketSets, []);

    expect(report.cycles.length).toBeGreaterThan(0);
    const flat = report.cycles.flat();
    expect(flat).toContain("a");
    expect(flat).toContain("b");
    expect(report.issues.some((i) => i.category === "cycle")).toBe(true);
  });

  it("detects unblocked tickets (all deps closed)", () => {
    const ticketSets: TicketSet[] = [
      {
        projectId: "proj-a",
        tickets: [
          makeTicket({ id: "dep-1", status: "closed" }),
          makeTicket({ id: "dep-2", status: "closed" }),
          makeTicket({ id: "task-1", status: "open", deps: ["dep-1", "dep-2"] }),
        ],
      },
    ];

    const report = checkHygiene(ticketSets, []);

    expect(report.unblockedTickets).toContain("task-1");
    expect(report.issues.some((i) =>
      i.category === "unblocked" && i.ticketId === "task-1",
    )).toBe(true);
  });

  it("detects abandoned in-progress tickets", () => {
    const ticketSets: TicketSet[] = [
      {
        projectId: "proj-a",
        tickets: [
          makeTicket({ id: "abandoned-1", status: "in-progress" }),
        ],
      },
    ];

    // No running agents
    const report = checkHygiene(ticketSets, []);

    expect(report.abandonedTickets).toContain("abandoned-1");
    expect(report.issues.some((i) =>
      i.category === "abandoned" && i.ticketId === "abandoned-1",
    )).toBe(true);
  });

  it("does not flag in-progress ticket with active agent", () => {
    const ticketSets: TicketSet[] = [
      {
        projectId: "proj-a",
        tickets: [
          makeTicket({ id: "working-1", status: "in-progress" }),
        ],
      },
    ];

    const sessions: AgentSession[] = [
      makeSession({ id: "s1", state: "streaming", workItemId: "working-1" }),
    ];

    const report = checkHygiene(ticketSets, sessions);
    expect(report.abandonedTickets).not.toContain("working-1");
  });

  it("reports clean when all tickets are healthy", () => {
    const ticketSets: TicketSet[] = [
      {
        projectId: "proj-a",
        tickets: [
          makeTicket({ id: "task-1" }),
          makeTicket({ id: "task-2" }),
          makeTicket({ id: "task-3", deps: ["task-1"] }),
        ],
      },
    ];

    const report = checkHygiene(ticketSets, []);

    expect(report.issues).toHaveLength(0);
    expect(report.orphanDeps).toHaveLength(0);
    expect(report.cycles).toHaveLength(0);
    expect(report.unblockedTickets).toHaveLength(0);
    expect(report.abandonedTickets).toHaveLength(0);
  });
});
