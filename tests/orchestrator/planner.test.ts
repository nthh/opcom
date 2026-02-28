import { describe, it, expect } from "vitest";
import {
  computePlan,
  recomputePlan,
  computeTracks,
  resolveScope,
  detectCycles,
  applyQuery,
} from "../../packages/core/src/orchestrator/planner.js";
import type { WorkItem, Plan } from "@opcom/types";
import type { TicketSet } from "../../packages/core/src/orchestrator/planner.js";

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

describe("computePlan", () => {
  it("creates steps from tickets and computes blocked/ready from deps", () => {
    const tickets: TicketSet[] = [
      {
        projectId: "proj-a",
        tickets: [
          makeTicket({ id: "setup-db", deps: [] }),
          makeTicket({ id: "add-api", deps: ["setup-db"] }),
          makeTicket({ id: "add-ui", deps: ["add-api"] }),
        ],
      },
    ];

    const plan = computePlan(tickets, {}, "test-plan");

    expect(plan.steps).toHaveLength(3);
    expect(plan.name).toBe("test-plan");
    expect(plan.status).toBe("planning");

    const dbStep = plan.steps.find((s) => s.ticketId === "setup-db")!;
    const apiStep = plan.steps.find((s) => s.ticketId === "add-api")!;
    const uiStep = plan.steps.find((s) => s.ticketId === "add-ui")!;

    expect(dbStep.status).toBe("ready");
    expect(dbStep.blockedBy).toEqual([]);

    expect(apiStep.status).toBe("blocked");
    expect(apiStep.blockedBy).toEqual(["setup-db"]);

    expect(uiStep.status).toBe("blocked");
    expect(uiStep.blockedBy).toEqual(["add-api"]);
  });

  it("with no deps → all steps ready", () => {
    const tickets: TicketSet[] = [
      {
        projectId: "proj-a",
        tickets: [
          makeTicket({ id: "task-1" }),
          makeTicket({ id: "task-2" }),
          makeTicket({ id: "task-3" }),
        ],
      },
    ];

    const plan = computePlan(tickets, {}, "parallel-plan");
    expect(plan.steps.every((s) => s.status === "ready")).toBe(true);
  });

  it("filters closed and deferred tickets", () => {
    const tickets: TicketSet[] = [
      {
        projectId: "proj-a",
        tickets: [
          makeTicket({ id: "open-1" }),
          makeTicket({ id: "closed-1", status: "closed" }),
          makeTicket({ id: "deferred-1", status: "deferred" }),
          makeTicket({ id: "in-progress-1", status: "in-progress" }),
        ],
      },
    ];

    const plan = computePlan(tickets, {}, "filter-plan");
    const ids = plan.steps.map((s) => s.ticketId);

    expect(ids).toContain("open-1");
    expect(ids).toContain("in-progress-1");
    expect(ids).not.toContain("closed-1");
    expect(ids).not.toContain("deferred-1");
  });
});

describe("resolveScope", () => {
  const tickets: TicketSet[] = [
    {
      projectId: "proj-a",
      tickets: [
        makeTicket({ id: "a-1" }),
        makeTicket({ id: "a-2", priority: 1 }),
      ],
    },
    {
      projectId: "proj-b",
      tickets: [
        makeTicket({ id: "b-1" }),
      ],
    },
  ];

  it("filters by projectIds", () => {
    const result = resolveScope(tickets, { projectIds: ["proj-a"] });
    expect(result).toHaveLength(1);
    expect(result[0].projectId).toBe("proj-a");
  });

  it("filters by ticketIds", () => {
    const result = resolveScope(tickets, { ticketIds: ["a-1", "b-1"] });
    const allIds = result.flatMap((ts) => ts.tickets.map((t) => t.id));
    expect(allIds).toEqual(["a-1", "b-1"]);
  });

  it("filters by query", () => {
    const result = resolveScope(tickets, { query: "priority:1" });
    const allIds = result.flatMap((ts) => ts.tickets.map((t) => t.id));
    expect(allIds).toEqual(["a-2"]);
  });
});

describe("detectCycles", () => {
  it("detects simple A→B→A cycle", () => {
    const steps = [
      { ticketId: "a", projectId: "p", status: "blocked" as const, blockedBy: ["b"] },
      { ticketId: "b", projectId: "p", status: "blocked" as const, blockedBy: ["a"] },
    ];

    const cycles = detectCycles(steps);
    expect(cycles.length).toBeGreaterThan(0);
    // The cycle should contain both a and b
    const flat = cycles.flat();
    expect(flat).toContain("a");
    expect(flat).toContain("b");
  });

  it("no false positives on DAG", () => {
    const steps = [
      { ticketId: "a", projectId: "p", status: "ready" as const, blockedBy: [] },
      { ticketId: "b", projectId: "p", status: "blocked" as const, blockedBy: ["a"] },
      { ticketId: "c", projectId: "p", status: "blocked" as const, blockedBy: ["a"] },
      { ticketId: "d", projectId: "p", status: "blocked" as const, blockedBy: ["b", "c"] },
    ];

    const cycles = detectCycles(steps);
    expect(cycles).toHaveLength(0);
  });
});

describe("computeTracks", () => {
  it("independent tickets → separate tracks", () => {
    const steps = [
      { ticketId: "auth-setup", projectId: "p", status: "ready" as const, blockedBy: [] },
      { ticketId: "ui-design", projectId: "p", status: "ready" as const, blockedBy: [] },
    ];

    const tracks = computeTracks(steps);
    expect(tracks.size).toBe(2);
  });

  it("dep chains → same track", () => {
    const steps = [
      { ticketId: "auth-setup", projectId: "p", status: "ready" as const, blockedBy: [] },
      { ticketId: "auth-api", projectId: "p", status: "blocked" as const, blockedBy: ["auth-setup"] },
      { ticketId: "auth-ui", projectId: "p", status: "blocked" as const, blockedBy: ["auth-api"] },
    ];

    const tracks = computeTracks(steps);
    expect(tracks.size).toBe(1);
    // All three should be in same track
    const members = [...tracks.values()][0];
    expect(members).toHaveLength(3);
  });

  it("names tracks by common prefix", () => {
    const steps = [
      { ticketId: "auth-setup", projectId: "p", status: "ready" as const, blockedBy: [] },
      { ticketId: "auth-api", projectId: "p", status: "blocked" as const, blockedBy: ["auth-setup"] },
    ];

    const tracks = computeTracks(steps);
    const names = [...tracks.keys()];
    expect(names[0]).toBe("auth");
  });

  it("falls back to track-N when no common prefix", () => {
    const steps = [
      { ticketId: "setup", projectId: "p", status: "ready" as const, blockedBy: [] },
      { ticketId: "deploy", projectId: "p", status: "blocked" as const, blockedBy: ["setup"] },
    ];

    const tracks = computeTracks(steps);
    const names = [...tracks.keys()];
    // No common prefix, should use track-N
    expect(names[0]).toMatch(/^track-\d+$/);
  });
});

describe("recomputePlan", () => {
  it("preserves in-progress/done/failed status", () => {
    const plan: Plan = {
      id: "p1",
      name: "test",
      status: "executing",
      scope: {},
      steps: [
        { ticketId: "a", projectId: "p", status: "done", blockedBy: [] },
        { ticketId: "b", projectId: "p", status: "in-progress", blockedBy: ["a"], agentSessionId: "s1" },
        { ticketId: "c", projectId: "p", status: "blocked", blockedBy: ["b"] },
      ],
      config: {
        maxConcurrentAgents: 3, autoStart: false, backend: "claude-code",
        worktree: false, pauseOnFailure: true, ticketTransitions: true,
      },
      context: "",
      createdAt: "2025-01-01",
      updatedAt: "2025-01-01",
    };

    const ticketSets: TicketSet[] = [
      {
        projectId: "p",
        tickets: [
          makeTicket({ id: "a", status: "closed" }),
          makeTicket({ id: "b", status: "in-progress", deps: ["a"] }),
          makeTicket({ id: "c", status: "open", deps: ["b"] }),
        ],
      },
    ];

    const updated = recomputePlan(plan, ticketSets);

    expect(updated.steps.find((s) => s.ticketId === "a")!.status).toBe("done");
    expect(updated.steps.find((s) => s.ticketId === "b")!.status).toBe("in-progress");
    expect(updated.steps.find((s) => s.ticketId === "b")!.agentSessionId).toBe("s1");
    expect(updated.steps.find((s) => s.ticketId === "c")!.status).toBe("blocked");
  });

  it("newly-closed dep → blocked→ready transition", () => {
    const plan: Plan = {
      id: "p1",
      name: "test",
      status: "executing",
      scope: {},
      steps: [
        { ticketId: "a", projectId: "p", status: "done", blockedBy: [] },
        { ticketId: "b", projectId: "p", status: "blocked", blockedBy: ["a"] },
      ],
      config: {
        maxConcurrentAgents: 3, autoStart: false, backend: "claude-code",
        worktree: false, pauseOnFailure: true, ticketTransitions: true,
      },
      context: "",
      createdAt: "2025-01-01",
      updatedAt: "2025-01-01",
    };

    const ticketSets: TicketSet[] = [
      {
        projectId: "p",
        tickets: [
          makeTicket({ id: "a", status: "closed" }),
          makeTicket({ id: "b", status: "open", deps: ["a"] }),
        ],
      },
    ];

    const updated = recomputePlan(plan, ticketSets);
    // Step A's dep is done, so B should transition to ready
    expect(updated.steps.find((s) => s.ticketId === "b")!.status).toBe("ready");
  });
});

describe("applyQuery", () => {
  const tickets = [
    makeTicket({ id: "t1", status: "open", priority: 1, type: "bug" }),
    makeTicket({ id: "t2", status: "open", priority: 3, type: "feature" }),
    makeTicket({ id: "t3", status: "closed", priority: 2, type: "task" }),
  ];

  it("filters by status", () => {
    const result = applyQuery(tickets, "status:open");
    expect(result.map((t) => t.id)).toEqual(["t1", "t2"]);
  });

  it("filters by priority with operator", () => {
    const result = applyQuery(tickets, "priority:<=2");
    expect(result.map((t) => t.id)).toEqual(["t1", "t3"]);
  });

  it("combines multiple filters", () => {
    const result = applyQuery(tickets, "status:open priority:<=2");
    expect(result.map((t) => t.id)).toEqual(["t1"]);
  });
});
