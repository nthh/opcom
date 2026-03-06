import { describe, it, expect } from "vitest";
import type { WorkItem, Plan, PlanStep } from "@opcom/types";
import {
  computePlan,
  recomputePlan,
  findParentTicketIds,
  type TicketSet,
} from "./planner.js";

// --- Helpers ---

function makeWorkItem(overrides: Partial<WorkItem> = {}): WorkItem {
  return {
    id: "ticket",
    title: "Ticket",
    status: "open",
    priority: 2,
    type: "feature",
    filePath: "/tmp/.tickets/impl/ticket/README.md",
    deps: [],
    links: [],
    tags: {},
    ...overrides,
  };
}

function makeTicketSets(tickets: WorkItem[]): TicketSet[] {
  return [{ projectId: "opcom", tickets }];
}

// --- Tests ---

describe("findParentTicketIds", () => {
  it("identifies tickets that have children", () => {
    const allTickets = new Map([
      ["parent-1", { ticket: makeWorkItem({ id: "parent-1" }), projectId: "p" }],
      ["child-a", { ticket: makeWorkItem({ id: "child-a", parent: "parent-1" }), projectId: "p" }],
      ["child-b", { ticket: makeWorkItem({ id: "child-b", parent: "parent-1" }), projectId: "p" }],
      ["standalone", { ticket: makeWorkItem({ id: "standalone" }), projectId: "p" }],
    ]);

    const parents = findParentTicketIds(allTickets);

    expect(parents.has("parent-1")).toBe(true);
    expect(parents.has("standalone")).toBe(false);
    expect(parents.has("child-a")).toBe(false);
  });

  it("ignores parent references to tickets not in scope", () => {
    const allTickets = new Map([
      ["child-x", { ticket: makeWorkItem({ id: "child-x", parent: "out-of-scope" }), projectId: "p" }],
    ]);

    const parents = findParentTicketIds(allTickets);
    expect(parents.size).toBe(0);
  });

  it("returns empty set when no parent-child relationships", () => {
    const allTickets = new Map([
      ["a", { ticket: makeWorkItem({ id: "a" }), projectId: "p" }],
      ["b", { ticket: makeWorkItem({ id: "b" }), projectId: "p" }],
    ]);

    const parents = findParentTicketIds(allTickets);
    expect(parents.size).toBe(0);
  });
});

describe("computePlan with parent-child tickets", () => {
  it("excludes parent tickets from plan steps", () => {
    const tickets = [
      makeWorkItem({ id: "cloud-serverless", title: "Serverless" }),
      makeWorkItem({ id: "serverless-types", title: "Types", parent: "cloud-serverless", deps: [] }),
      makeWorkItem({ id: "serverless-cf", title: "CF Adapter", parent: "cloud-serverless", deps: ["serverless-types"] }),
    ];

    const plan = computePlan(
      makeTicketSets(tickets),
      {},
      "test-plan",
    );

    const stepIds = plan.steps.map((s) => s.ticketId);

    // Parent should be excluded
    expect(stepIds).not.toContain("cloud-serverless");

    // Children should be included
    expect(stepIds).toContain("serverless-types");
    expect(stepIds).toContain("serverless-cf");
  });

  it("children have correct deps between themselves", () => {
    const tickets = [
      makeWorkItem({ id: "parent-ticket" }),
      makeWorkItem({ id: "child-a", parent: "parent-ticket", deps: [] }),
      makeWorkItem({ id: "child-b", parent: "parent-ticket", deps: ["child-a"] }),
      makeWorkItem({ id: "child-c", parent: "parent-ticket", deps: ["child-a", "child-b"] }),
    ];

    const plan = computePlan(makeTicketSets(tickets), {}, "test-plan");

    const stepA = plan.steps.find((s) => s.ticketId === "child-a")!;
    const stepB = plan.steps.find((s) => s.ticketId === "child-b")!;
    const stepC = plan.steps.find((s) => s.ticketId === "child-c")!;

    expect(stepA.status).toBe("ready");
    expect(stepA.blockedBy).toEqual([]);

    expect(stepB.status).toBe("blocked");
    expect(stepB.blockedBy).toEqual(["child-a"]);

    expect(stepC.status).toBe("blocked");
    expect(stepC.blockedBy).toContain("child-a");
    expect(stepC.blockedBy).toContain("child-b");
  });

  it("filters out parent ticket deps from child steps", () => {
    // If a child ticket has a dep on its parent, that dep should be filtered out
    // since the parent is not a step
    const tickets = [
      makeWorkItem({ id: "epic" }),
      makeWorkItem({ id: "sub-1", parent: "epic", deps: ["epic"] }),
    ];

    const plan = computePlan(makeTicketSets(tickets), {}, "test-plan");

    const step = plan.steps.find((s) => s.ticketId === "sub-1")!;
    expect(step.blockedBy).not.toContain("epic");
    expect(step.status).toBe("ready");
  });

  it("handles mixed parent and standalone tickets", () => {
    const tickets = [
      // Parent + children
      makeWorkItem({ id: "big-feature" }),
      makeWorkItem({ id: "big-feature-types", parent: "big-feature", deps: [] }),
      makeWorkItem({ id: "big-feature-impl", parent: "big-feature", deps: ["big-feature-types"] }),
      // Standalone
      makeWorkItem({ id: "small-fix", deps: [] }),
      // Depends on the parent ticket
      makeWorkItem({ id: "after-big-feature", deps: ["big-feature"] }),
    ];

    const plan = computePlan(makeTicketSets(tickets), {}, "test-plan");
    const stepIds = plan.steps.map((s) => s.ticketId);

    expect(stepIds).not.toContain("big-feature");
    expect(stepIds).toContain("big-feature-types");
    expect(stepIds).toContain("big-feature-impl");
    expect(stepIds).toContain("small-fix");
    expect(stepIds).toContain("after-big-feature");

    // after-big-feature depends on big-feature (a parent), so the dep is filtered
    // since parent is not a step. The dep resolution via children happens in recomputePlan.
    const afterStep = plan.steps.find((s) => s.ticketId === "after-big-feature")!;
    expect(afterStep.blockedBy).not.toContain("big-feature");
  });

  it("preserves tracks for child tickets", () => {
    const tickets = [
      makeWorkItem({ id: "parent" }),
      makeWorkItem({ id: "parent-types", parent: "parent", deps: [] }),
      makeWorkItem({ id: "parent-impl", parent: "parent", deps: ["parent-types"] }),
    ];

    const plan = computePlan(makeTicketSets(tickets), {}, "test-plan");

    // Children should be grouped in the same track
    const typesStep = plan.steps.find((s) => s.ticketId === "parent-types")!;
    const implStep = plan.steps.find((s) => s.ticketId === "parent-impl")!;

    expect(typesStep.track).toBe(implStep.track);
  });
});

describe("recomputePlan with parent-child rollup", () => {
  it("resolves parent dep when all children are done", () => {
    // Ticket "downstream" depends on "epic" (a parent).
    // "epic" has children "child-a" and "child-b".
    // When both children are done, the parent dep is resolved.
    const tickets = [
      makeWorkItem({ id: "epic" }),
      makeWorkItem({ id: "child-a", parent: "epic", status: "closed" }),
      makeWorkItem({ id: "child-b", parent: "epic", status: "closed" }),
      makeWorkItem({ id: "downstream", deps: ["epic"] }),
    ];

    const plan: Plan = {
      id: "test",
      name: "test",
      status: "executing",
      scope: {},
      steps: [
        { ticketId: "child-a", projectId: "p", status: "done", blockedBy: [], completedAt: "2026-01-01T00:00:00Z" },
        { ticketId: "child-b", projectId: "p", status: "done", blockedBy: [], completedAt: "2026-01-01T00:00:00Z" },
        { ticketId: "downstream", projectId: "p", status: "blocked", blockedBy: ["epic"] },
      ],
      config: {
        maxConcurrentAgents: 3,
        autoStart: false,
        backend: "claude-code",
        worktree: true,
        pauseOnFailure: true,
        ticketTransitions: true,
        autoCommit: true,
        verification: { runTests: true, runOracle: false },
      },
      context: "",
      createdAt: "2026-01-01T00:00:00Z",
      updatedAt: "2026-01-01T00:00:00Z",
    };

    const result = recomputePlan(plan, makeTicketSets(tickets));

    const downstreamStep = result.steps.find((s) => s.ticketId === "downstream")!;
    expect(downstreamStep.status).toBe("ready");
  });

  it("keeps step blocked when parent children are not all done", () => {
    const tickets = [
      makeWorkItem({ id: "epic" }),
      makeWorkItem({ id: "child-a", parent: "epic", status: "closed" }),
      makeWorkItem({ id: "child-b", parent: "epic", status: "open" }),
      makeWorkItem({ id: "downstream", deps: ["epic"] }),
    ];

    const plan: Plan = {
      id: "test",
      name: "test",
      status: "executing",
      scope: {},
      steps: [
        { ticketId: "child-a", projectId: "p", status: "done", blockedBy: [], completedAt: "2026-01-01T00:00:00Z" },
        { ticketId: "child-b", projectId: "p", status: "ready", blockedBy: [] },
        { ticketId: "downstream", projectId: "p", status: "blocked", blockedBy: ["epic"] },
      ],
      config: {
        maxConcurrentAgents: 3,
        autoStart: false,
        backend: "claude-code",
        worktree: true,
        pauseOnFailure: true,
        ticketTransitions: true,
        autoCommit: true,
        verification: { runTests: true, runOracle: false },
      },
      context: "",
      createdAt: "2026-01-01T00:00:00Z",
      updatedAt: "2026-01-01T00:00:00Z",
    };

    const result = recomputePlan(plan, makeTicketSets(tickets));

    const downstreamStep = result.steps.find((s) => s.ticketId === "downstream")!;
    expect(downstreamStep.status).toBe("blocked");
  });

  it("resolves parent dep when children are done via step status", () => {
    // Children not closed as tickets, but their plan steps are done
    const tickets = [
      makeWorkItem({ id: "epic" }),
      makeWorkItem({ id: "child-a", parent: "epic", status: "open" }),
      makeWorkItem({ id: "child-b", parent: "epic", status: "open" }),
      makeWorkItem({ id: "downstream", deps: ["epic"] }),
    ];

    const plan: Plan = {
      id: "test",
      name: "test",
      status: "executing",
      scope: {},
      steps: [
        { ticketId: "child-a", projectId: "p", status: "done", blockedBy: [] },
        { ticketId: "child-b", projectId: "p", status: "skipped", blockedBy: [] },
        { ticketId: "downstream", projectId: "p", status: "blocked", blockedBy: ["epic"] },
      ],
      config: {
        maxConcurrentAgents: 3,
        autoStart: false,
        backend: "claude-code",
        worktree: true,
        pauseOnFailure: true,
        ticketTransitions: true,
        autoCommit: true,
        verification: { runTests: true, runOracle: false },
      },
      context: "",
      createdAt: "2026-01-01T00:00:00Z",
      updatedAt: "2026-01-01T00:00:00Z",
    };

    const result = recomputePlan(plan, makeTicketSets(tickets));

    const downstreamStep = result.steps.find((s) => s.ticketId === "downstream")!;
    expect(downstreamStep.status).toBe("ready");
  });

  it("preserves sticky statuses during recompute", () => {
    const tickets = [
      makeWorkItem({ id: "a", status: "open" }),
    ];

    const plan: Plan = {
      id: "test",
      name: "test",
      status: "executing",
      scope: {},
      steps: [
        { ticketId: "a", projectId: "p", status: "in-progress", blockedBy: [], agentSessionId: "sess-1" },
      ],
      config: {
        maxConcurrentAgents: 3,
        autoStart: false,
        backend: "claude-code",
        worktree: true,
        pauseOnFailure: true,
        ticketTransitions: true,
        autoCommit: true,
        verification: { runTests: true, runOracle: false },
      },
      context: "",
      createdAt: "2026-01-01T00:00:00Z",
      updatedAt: "2026-01-01T00:00:00Z",
    };

    const result = recomputePlan(plan, makeTicketSets(tickets));

    const step = result.steps.find((s) => s.ticketId === "a")!;
    expect(step.status).toBe("in-progress");
    expect(step.agentSessionId).toBe("sess-1");
  });

  it("handles regular dep resolution alongside parent rollup", () => {
    // Mix of regular deps and parent deps
    const tickets = [
      makeWorkItem({ id: "setup", status: "closed" }),
      makeWorkItem({ id: "epic" }),
      makeWorkItem({ id: "child-1", parent: "epic", status: "closed" }),
      makeWorkItem({ id: "child-2", parent: "epic", status: "closed" }),
      makeWorkItem({ id: "final", deps: ["setup", "epic"] }),
    ];

    const plan: Plan = {
      id: "test",
      name: "test",
      status: "executing",
      scope: {},
      steps: [
        { ticketId: "child-1", projectId: "p", status: "done", blockedBy: [] },
        { ticketId: "child-2", projectId: "p", status: "done", blockedBy: [] },
        { ticketId: "final", projectId: "p", status: "blocked", blockedBy: ["setup", "epic"] },
      ],
      config: {
        maxConcurrentAgents: 3,
        autoStart: false,
        backend: "claude-code",
        worktree: true,
        pauseOnFailure: true,
        ticketTransitions: true,
        autoCommit: true,
        verification: { runTests: true, runOracle: false },
      },
      context: "",
      createdAt: "2026-01-01T00:00:00Z",
      updatedAt: "2026-01-01T00:00:00Z",
    };

    const result = recomputePlan(plan, makeTicketSets(tickets));

    const finalStep = result.steps.find((s) => s.ticketId === "final")!;
    // "setup" is closed (resolved), "epic" children are all done (resolved)
    expect(finalStep.status).toBe("ready");
  });
});
