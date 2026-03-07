import { describe, it, expect } from "vitest";
import type { WorkItem, PlanStep, Plan, PlanStage } from "@opcom/types";
import {
  computeStages,
  buildExplicitStages,
  validateExplicitStages,
  computeStageSummary,
  computePlan,
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

function makeStep(overrides: Partial<PlanStep> = {}): PlanStep {
  return {
    ticketId: "step",
    projectId: "proj",
    status: "ready",
    blockedBy: [],
    ...overrides,
  };
}

function makeTicketSets(tickets: WorkItem[]): TicketSet[] {
  return [{ projectId: "opcom", tickets }];
}

// --- computeStages ---

describe("computeStages", () => {
  it("puts all independent steps in stage 0", () => {
    const steps = [
      makeStep({ ticketId: "a" }),
      makeStep({ ticketId: "b" }),
      makeStep({ ticketId: "c" }),
    ];

    const stages = computeStages(steps);

    expect(stages).toHaveLength(1);
    expect(stages[0].index).toBe(0);
    expect(stages[0].stepTicketIds).toEqual(["a", "b", "c"]);
    expect(stages[0].status).toBe("pending");
  });

  it("groups steps by dependency depth", () => {
    const steps = [
      makeStep({ ticketId: "a", blockedBy: [] }),
      makeStep({ ticketId: "b", blockedBy: [] }),
      makeStep({ ticketId: "c", blockedBy: ["a"] }),
      makeStep({ ticketId: "d", blockedBy: ["c"] }),
    ];

    const stages = computeStages(steps);

    expect(stages).toHaveLength(3);
    expect(stages[0].stepTicketIds).toEqual(["a", "b"]);
    expect(stages[1].stepTicketIds).toEqual(["c"]);
    expect(stages[2].stepTicketIds).toEqual(["d"]);
  });

  it("handles diamond dependencies", () => {
    // a → c, b → c, c → d
    const steps = [
      makeStep({ ticketId: "a", blockedBy: [] }),
      makeStep({ ticketId: "b", blockedBy: [] }),
      makeStep({ ticketId: "c", blockedBy: ["a", "b"] }),
      makeStep({ ticketId: "d", blockedBy: ["c"] }),
    ];

    const stages = computeStages(steps);

    expect(stages).toHaveLength(3);
    expect(stages[0].stepTicketIds).toContain("a");
    expect(stages[0].stepTicketIds).toContain("b");
    expect(stages[1].stepTicketIds).toEqual(["c"]);
    expect(stages[2].stepTicketIds).toEqual(["d"]);
  });

  it("returns empty array for empty steps", () => {
    const stages = computeStages([]);
    expect(stages).toHaveLength(0);
  });

  it("handles single step", () => {
    const steps = [makeStep({ ticketId: "solo" })];
    const stages = computeStages(steps);

    expect(stages).toHaveLength(1);
    expect(stages[0].stepTicketIds).toEqual(["solo"]);
  });

  it("ignores deps pointing to tickets not in the step list", () => {
    const steps = [
      makeStep({ ticketId: "a", blockedBy: ["external-dep"] }),
      makeStep({ ticketId: "b", blockedBy: ["a"] }),
    ];

    const stages = computeStages(steps);

    expect(stages).toHaveLength(2);
    expect(stages[0].stepTicketIds).toEqual(["a"]);
    expect(stages[1].stepTicketIds).toEqual(["b"]);
  });

  it("puts cyclic deps in a final catch-all stage", () => {
    const steps = [
      makeStep({ ticketId: "a", blockedBy: ["b"] }),
      makeStep({ ticketId: "b", blockedBy: ["a"] }),
      makeStep({ ticketId: "c", blockedBy: [] }),
    ];

    const stages = computeStages(steps);

    // c goes in stage 0, a and b are cyclic so they end up in a catch-all
    expect(stages.length).toBeGreaterThanOrEqual(2);
    expect(stages[0].stepTicketIds).toContain("c");
    // The cyclic pair should appear in a later stage
    const cyclicStage = stages.find(
      (s) => s.stepTicketIds.includes("a") && s.stepTicketIds.includes("b"),
    );
    expect(cyclicStage).toBeDefined();
  });

  it("assigns sequential indices", () => {
    const steps = [
      makeStep({ ticketId: "a", blockedBy: [] }),
      makeStep({ ticketId: "b", blockedBy: ["a"] }),
      makeStep({ ticketId: "c", blockedBy: ["b"] }),
    ];

    const stages = computeStages(steps);

    expect(stages.map((s) => s.index)).toEqual([0, 1, 2]);
  });

  it("computes correctly for wide and deep DAGs", () => {
    // Wide: many independent roots, one sink
    const steps = [
      makeStep({ ticketId: "r1", blockedBy: [] }),
      makeStep({ ticketId: "r2", blockedBy: [] }),
      makeStep({ ticketId: "r3", blockedBy: [] }),
      makeStep({ ticketId: "r4", blockedBy: [] }),
      makeStep({ ticketId: "sink", blockedBy: ["r1", "r2", "r3", "r4"] }),
    ];

    const stages = computeStages(steps);

    expect(stages).toHaveLength(2);
    expect(stages[0].stepTicketIds).toHaveLength(4);
    expect(stages[1].stepTicketIds).toEqual(["sink"]);
  });
});

// --- validateExplicitStages ---

describe("validateExplicitStages", () => {
  it("returns no errors for valid stage definitions", () => {
    const steps = [
      makeStep({ ticketId: "a", blockedBy: [] }),
      makeStep({ ticketId: "b", blockedBy: [] }),
      makeStep({ ticketId: "c", blockedBy: ["a"] }),
    ];

    const errors = validateExplicitStages(steps, [["a", "b"], ["c"]]);
    expect(errors).toHaveLength(0);
  });

  it("errors when ticket is not a plan step", () => {
    const steps = [makeStep({ ticketId: "a" })];
    const errors = validateExplicitStages(steps, [["a", "nonexistent"]]);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain("nonexistent");
    expect(errors[0]).toContain("not a plan step");
  });

  it("errors when ticket appears in multiple stages", () => {
    const steps = [
      makeStep({ ticketId: "a" }),
      makeStep({ ticketId: "b" }),
    ];
    const errors = validateExplicitStages(steps, [["a", "b"], ["a"]]);
    expect(errors.some((e) => e.includes("multiple stages"))).toBe(true);
  });

  it("errors when dep is in same or later stage", () => {
    const steps = [
      makeStep({ ticketId: "a", blockedBy: [] }),
      makeStep({ ticketId: "b", blockedBy: ["a"] }),
    ];

    // b depends on a, but they're in the same stage
    const errors = validateExplicitStages(steps, [["a", "b"]]);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain("depends on");
    expect(errors[0]).toContain("must be earlier");
  });

  it("errors when dep is in later stage", () => {
    const steps = [
      makeStep({ ticketId: "a", blockedBy: [] }),
      makeStep({ ticketId: "b", blockedBy: ["a"] }),
    ];

    // b first, then a — wrong order
    const errors = validateExplicitStages(steps, [["b"], ["a"]]);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain("depends on");
  });

  it("allows deps not in any stage (external deps)", () => {
    const steps = [
      makeStep({ ticketId: "a", blockedBy: ["external"] }),
    ];
    const errors = validateExplicitStages(steps, [["a"]]);
    expect(errors).toHaveLength(0);
  });
});

// --- buildExplicitStages ---

describe("buildExplicitStages", () => {
  it("builds stages from definitions", () => {
    const steps = [
      makeStep({ ticketId: "a" }),
      makeStep({ ticketId: "b" }),
      makeStep({ ticketId: "c", blockedBy: ["a"] }),
    ];

    const stages = buildExplicitStages(steps, [["a", "b"], ["c"]]);

    expect(stages).toHaveLength(2);
    expect(stages[0].stepTicketIds).toEqual(["a", "b"]);
    expect(stages[1].stepTicketIds).toEqual(["c"]);
  });

  it("puts unlisted steps in final auto-stage", () => {
    const steps = [
      makeStep({ ticketId: "a" }),
      makeStep({ ticketId: "b" }),
      makeStep({ ticketId: "c" }),
    ];

    const stages = buildExplicitStages(steps, [["a"]]);

    expect(stages).toHaveLength(2);
    expect(stages[0].stepTicketIds).toEqual(["a"]);
    expect(stages[1].stepTicketIds).toContain("b");
    expect(stages[1].stepTicketIds).toContain("c");
  });

  it("throws on invalid definitions", () => {
    const steps = [
      makeStep({ ticketId: "a", blockedBy: [] }),
      makeStep({ ticketId: "b", blockedBy: ["a"] }),
    ];

    expect(() => buildExplicitStages(steps, [["a", "b"]])).toThrow(
      "Invalid stage definitions",
    );
  });
});

// --- computeStageSummary ---

describe("computeStageSummary", () => {
  it("computes summary from completed stage steps", () => {
    const stage: PlanStage = {
      index: 0,
      stepTicketIds: ["a", "b", "c"],
      status: "completed",
      startedAt: "2026-03-06T10:00:00Z",
      completedAt: "2026-03-06T10:30:00Z",
    };

    const steps = [
      makeStep({ ticketId: "a", status: "done" }),
      makeStep({ ticketId: "b", status: "done" }),
      makeStep({ ticketId: "c", status: "skipped" }),
      makeStep({ ticketId: "d", status: "blocked" }), // not in this stage
    ];

    const summary = computeStageSummary(stage, steps);

    expect(summary.completed).toBe(2);
    expect(summary.failed).toBe(0);
    expect(summary.skipped).toBe(1);
    expect(summary.durationMs).toBe(30 * 60 * 1000);
    expect(summary.testResults).toBeUndefined();
  });

  it("includes test results when steps have verification", () => {
    const stage: PlanStage = {
      index: 0,
      stepTicketIds: ["a", "b"],
      status: "completed",
      startedAt: "2026-03-06T10:00:00Z",
      completedAt: "2026-03-06T10:15:00Z",
    };

    const steps = [
      makeStep({
        ticketId: "a",
        status: "done",
        verification: {
          stepTicketId: "a",
          passed: true,
          failureReasons: [],
          testGate: {
            passed: true,
            testCommand: "npm test",
            totalTests: 50,
            passedTests: 50,
            failedTests: 0,
            output: "",
            durationMs: 1000,
          },
        },
      }),
      makeStep({
        ticketId: "b",
        status: "failed",
        verification: {
          stepTicketId: "b",
          passed: false,
          failureReasons: ["Tests failed"],
          testGate: {
            passed: false,
            testCommand: "npm test",
            totalTests: 30,
            passedTests: 28,
            failedTests: 2,
            output: "",
            durationMs: 500,
          },
        },
      }),
    ];

    const summary = computeStageSummary(stage, steps);

    expect(summary.completed).toBe(1);
    expect(summary.failed).toBe(1);
    expect(summary.testResults).toEqual({ passed: 78, failed: 2 });
  });

  it("counts needs-rebase as failed", () => {
    const stage: PlanStage = {
      index: 0,
      stepTicketIds: ["a"],
      status: "failed",
      startedAt: "2026-03-06T10:00:00Z",
      completedAt: "2026-03-06T10:10:00Z",
    };

    const steps = [
      makeStep({ ticketId: "a", status: "needs-rebase" }),
    ];

    const summary = computeStageSummary(stage, steps);
    expect(summary.failed).toBe(1);
  });
});

// --- Integration: computePlan + stages ---

describe("computePlan with stages", () => {
  it("stages can be computed from a plan's steps", () => {
    const tickets = [
      makeWorkItem({ id: "types", deps: [] }),
      makeWorkItem({ id: "core", deps: ["types"] }),
      makeWorkItem({ id: "cli", deps: ["core"] }),
    ];

    const plan = computePlan(makeTicketSets(tickets), {}, "test-plan");
    const stages = computeStages(plan.steps);

    expect(stages).toHaveLength(3);
    expect(stages[0].stepTicketIds).toEqual(["types"]);
    expect(stages[1].stepTicketIds).toEqual(["core"]);
    expect(stages[2].stepTicketIds).toEqual(["cli"]);
  });

  it("computes stages for a plan with parallel independent tracks", () => {
    const tickets = [
      makeWorkItem({ id: "auth-types", deps: [] }),
      makeWorkItem({ id: "auth-api", deps: ["auth-types"] }),
      makeWorkItem({ id: "db-types", deps: [] }),
      makeWorkItem({ id: "db-adapter", deps: ["db-types"] }),
      makeWorkItem({ id: "integration", deps: ["auth-api", "db-adapter"] }),
    ];

    const plan = computePlan(makeTicketSets(tickets), {}, "test-plan");
    const stages = computeStages(plan.steps);

    expect(stages).toHaveLength(3);
    // Stage 0: both types tickets
    expect(stages[0].stepTicketIds).toContain("auth-types");
    expect(stages[0].stepTicketIds).toContain("db-types");
    // Stage 1: both dependent tickets
    expect(stages[1].stepTicketIds).toContain("auth-api");
    expect(stages[1].stepTicketIds).toContain("db-adapter");
    // Stage 2: integration
    expect(stages[2].stepTicketIds).toEqual(["integration"]);
  });

  it("explicit stages in config override auto-staging", () => {
    const tickets = [
      makeWorkItem({ id: "a", deps: [] }),
      makeWorkItem({ id: "b", deps: [] }),
      makeWorkItem({ id: "c", deps: ["a"] }),
    ];

    const plan = computePlan(makeTicketSets(tickets), {}, "test-plan");

    // Explicit stages: put a alone, then b and c together
    const stages = buildExplicitStages(plan.steps, [["a"], ["b", "c"]]);

    expect(stages).toHaveLength(2);
    expect(stages[0].stepTicketIds).toEqual(["a"]);
    expect(stages[1].stepTicketIds).toEqual(["b", "c"]);
  });
});
