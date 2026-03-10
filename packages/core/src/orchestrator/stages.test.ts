import { describe, it, expect } from "vitest";
import type { WorkItem, PlanStep, Plan, PlanStage } from "@opcom/types";
import {
  computeStages,
  buildExplicitStages,
  validateExplicitStages,
  computeStageSummary,
  computePlan,
  computeTracks,
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

/** Assign tracks to steps using computeTracks (mirrors what computePlan does). */
function assignTracks(steps: PlanStep[]): void {
  const tracks = computeTracks(steps);
  for (const [trackName, stepIds] of tracks) {
    for (const id of stepIds) {
      const step = steps.find((s) => s.ticketId === id);
      if (step) step.track = trackName;
    }
  }
}

// --- computeStages (track-based) ---

describe("computeStages", () => {
  it("puts all independent steps in a single stage", () => {
    const steps = [
      makeStep({ ticketId: "a" }),
      makeStep({ ticketId: "b" }),
      makeStep({ ticketId: "c" }),
    ];
    assignTracks(steps);

    const stages = computeStages(steps);

    // 3 independent single-step tracks all fit in one stage (maxStageSize=6)
    expect(stages).toHaveLength(1);
    expect(stages[0].index).toBe(0);
    expect(stages[0].stepTicketIds).toContain("a");
    expect(stages[0].stepTicketIds).toContain("b");
    expect(stages[0].stepTicketIds).toContain("c");
    expect(stages[0].status).toBe("pending");
  });

  it("groups a dependency chain as a single track in one stage", () => {
    const steps = [
      makeStep({ ticketId: "a", blockedBy: [] }),
      makeStep({ ticketId: "c", blockedBy: ["a"] }),
      makeStep({ ticketId: "d", blockedBy: ["c"] }),
    ];
    assignTracks(steps);

    const stages = computeStages(steps);

    // a → c → d is one track, fits in one stage
    expect(stages).toHaveLength(1);
    expect(stages[0].stepTicketIds).toContain("a");
    expect(stages[0].stepTicketIds).toContain("c");
    expect(stages[0].stepTicketIds).toContain("d");
  });

  it("separates independent tracks into different stages when exceeding maxStageSize", () => {
    const steps = [
      makeStep({ ticketId: "a1" }),
      makeStep({ ticketId: "a2" }),
      makeStep({ ticketId: "a3" }),
      makeStep({ ticketId: "b1" }),
      makeStep({ ticketId: "b2" }),
      makeStep({ ticketId: "b3" }),
    ];
    assignTracks(steps);

    // With maxStageSize=3, each group of 3 independent steps gets its own stage
    // But they're all independent single-step tracks so they batch
    const stages = computeStages(steps, 3);

    // 6 independent tracks, maxStageSize 3 → 2 stages
    expect(stages).toHaveLength(2);
    expect(stages[0].stepTicketIds).toHaveLength(3);
    expect(stages[1].stepTicketIds).toHaveLength(3);
  });

  it("puts truly independent tracks in same stage within maxStageSize", () => {
    // auth track: auth-types → auth-api (connected component)
    // db track: db-types → db-adapter (separate connected component)
    // No bridging ticket → these stay as separate tracks
    const steps = [
      makeStep({ ticketId: "auth-types", blockedBy: [] }),
      makeStep({ ticketId: "auth-api", blockedBy: ["auth-types"] }),
      makeStep({ ticketId: "db-types", blockedBy: [] }),
      makeStep({ ticketId: "db-adapter", blockedBy: ["db-types"] }),
    ];
    assignTracks(steps);

    const stages = computeStages(steps);

    // auth + db tracks are independent, total 4 steps < maxStageSize(6) → one stage
    expect(stages).toHaveLength(1);
    expect(stages[0].stepTicketIds).toContain("auth-types");
    expect(stages[0].stepTicketIds).toContain("auth-api");
    expect(stages[0].stepTicketIds).toContain("db-types");
    expect(stages[0].stepTicketIds).toContain("db-adapter");
  });

  it("splits independent tracks into separate stages when exceeding maxStageSize", () => {
    const steps = [
      makeStep({ ticketId: "auth-types", blockedBy: [] }),
      makeStep({ ticketId: "auth-api", blockedBy: ["auth-types"] }),
      makeStep({ ticketId: "db-types", blockedBy: [] }),
      makeStep({ ticketId: "db-adapter", blockedBy: ["db-types"] }),
    ];
    assignTracks(steps);

    // maxStageSize=2 → each track gets its own stage
    const stages = computeStages(steps, 2);

    expect(stages).toHaveLength(2);
    expect(stages[0].stepTicketIds).toHaveLength(2);
    expect(stages[1].stepTicketIds).toHaveLength(2);
  });

  it("returns empty array for empty steps", () => {
    const stages = computeStages([]);
    expect(stages).toHaveLength(0);
  });

  it("handles single step", () => {
    const steps = [makeStep({ ticketId: "solo" })];
    assignTracks(steps);
    const stages = computeStages(steps);

    expect(stages).toHaveLength(1);
    expect(stages[0].stepTicketIds).toEqual(["solo"]);
  });

  it("assigns stage names from track names", () => {
    // Two independent tracks
    const steps = [
      makeStep({ ticketId: "auth-types", blockedBy: [] }),
      makeStep({ ticketId: "auth-api", blockedBy: ["auth-types"] }),
      makeStep({ ticketId: "db-setup", blockedBy: [] }),
    ];
    assignTracks(steps);

    const stages = computeStages(steps, 2);

    // auth track (2 steps) hits maxStageSize=2, db-setup in next stage
    expect(stages).toHaveLength(2);
    expect(stages[0].name).toBeDefined();
    expect(stages[1].name).toBeDefined();
  });

  it("merges small independent tracks into one stage", () => {
    const steps = [
      makeStep({ ticketId: "fix-typo", track: "fix-typo" }),
      makeStep({ ticketId: "add-lint", track: "add-lint" }),
      makeStep({ ticketId: "bump-deps", track: "bump-deps" }),
    ];

    const stages = computeStages(steps);

    // 3 small tracks fit under maxStageSize=6 → 1 stage
    expect(stages).toHaveLength(1);
    expect(stages[0].stepTicketIds).toHaveLength(3);
    expect(stages[0].name).toContain("fix-typo");
  });

  it("assigns sequential indices", () => {
    // 4 independent steps, maxStageSize=2 → 2 stages
    const steps = [
      makeStep({ ticketId: "a", track: "a" }),
      makeStep({ ticketId: "b", track: "b" }),
      makeStep({ ticketId: "c", track: "c" }),
      makeStep({ ticketId: "d", track: "d" }),
    ];

    const stages = computeStages(steps, 2);

    expect(stages.map((s) => s.index)).toEqual([0, 1]);
  });

  it("respects maxStageSize to split large independent batches", () => {
    // 8 independent steps, maxStageSize=4
    const steps = Array.from({ length: 8 }, (_, i) =>
      makeStep({ ticketId: `t${i}`, track: `t${i}` }),
    );

    const stages = computeStages(steps, 4);

    expect(stages).toHaveLength(2);
    expect(stages[0].stepTicketIds).toHaveLength(4);
    expect(stages[1].stepTicketIds).toHaveLength(4);
  });

  it("handles cyclic deps by placing cyclic track at end", () => {
    const steps = [
      makeStep({ ticketId: "a", blockedBy: ["b"], track: "cyclic" }),
      makeStep({ ticketId: "b", blockedBy: ["a"], track: "cyclic" }),
      makeStep({ ticketId: "c", blockedBy: [], track: "safe" }),
    ];

    const stages = computeStages(steps);

    // All steps should appear in some stage
    const allIds = stages.flatMap((s) => s.stepTicketIds);
    expect(allIds).toContain("a");
    expect(allIds).toContain("b");
    expect(allIds).toContain("c");
  });

  it("keeps inter-track dep ordering across stages", () => {
    // track-a: a1 → a2
    // track-b: b1 → b2, b2 depends on a2
    const steps = [
      makeStep({ ticketId: "a1", blockedBy: [] }),
      makeStep({ ticketId: "a2", blockedBy: ["a1"] }),
      makeStep({ ticketId: "b1", blockedBy: [] }),
      makeStep({ ticketId: "b2", blockedBy: ["b1", "a2"] }),
    ];
    assignTracks(steps);

    const stages = computeStages(steps);

    // a-track and b-track are connected (b2 depends on a2) so they form
    // one track via union-find, ending up in one stage
    // OR if they're separate tracks, b-track must come after a-track
    const allIds = stages.flatMap((s) => s.stepTicketIds);
    expect(allIds).toContain("a1");
    expect(allIds).toContain("a2");
    expect(allIds).toContain("b1");
    expect(allIds).toContain("b2");

    // If they're in separate stages, a-track comes first
    if (stages.length > 1) {
      const a2StageIdx = stages.findIndex((s) => s.stepTicketIds.includes("a2"));
      const b2StageIdx = stages.findIndex((s) => s.stepTicketIds.includes("b2"));
      expect(a2StageIdx).toBeLessThanOrEqual(b2StageIdx);
    }
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
  it("stages group a single dep chain as one track in one stage", () => {
    const tickets = [
      makeWorkItem({ id: "types", deps: [] }),
      makeWorkItem({ id: "core", deps: ["types"] }),
      makeWorkItem({ id: "cli", deps: ["core"] }),
    ];

    const plan = computePlan(makeTicketSets(tickets), {}, "test-plan");
    const stages = computeStages(plan.steps);

    // types → core → cli is one connected track → one stage
    expect(stages).toHaveLength(1);
    expect(stages[0].stepTicketIds).toContain("types");
    expect(stages[0].stepTicketIds).toContain("core");
    expect(stages[0].stepTicketIds).toContain("cli");
  });

  it("puts connected tracks (via integration ticket) in single stage", () => {
    const tickets = [
      makeWorkItem({ id: "auth-types", deps: [] }),
      makeWorkItem({ id: "auth-api", deps: ["auth-types"] }),
      makeWorkItem({ id: "db-types", deps: [] }),
      makeWorkItem({ id: "db-adapter", deps: ["db-types"] }),
      makeWorkItem({ id: "integration", deps: ["auth-api", "db-adapter"] }),
    ];

    const plan = computePlan(makeTicketSets(tickets), {}, "test-plan");
    const stages = computeStages(plan.steps);

    // integration bridges auth and db → all one connected track → one stage
    expect(stages).toHaveLength(1);
    expect(stages[0].stepTicketIds).toContain("auth-types");
    expect(stages[0].stepTicketIds).toContain("auth-api");
    expect(stages[0].stepTicketIds).toContain("db-types");
    expect(stages[0].stepTicketIds).toContain("db-adapter");
    expect(stages[0].stepTicketIds).toContain("integration");
  });

  it("separates truly independent tracks into stages when exceeding maxStageSize", () => {
    const tickets = [
      makeWorkItem({ id: "auth-types", deps: [] }),
      makeWorkItem({ id: "auth-api", deps: ["auth-types"] }),
      makeWorkItem({ id: "db-types", deps: [] }),
      makeWorkItem({ id: "db-adapter", deps: ["db-types"] }),
    ];

    const plan = computePlan(makeTicketSets(tickets), {}, "test-plan");
    const stages = computeStages(plan.steps, 2);

    // auth track (2 steps) and db track (2 steps) are independent
    // maxStageSize=2 → each track gets its own stage
    expect(stages).toHaveLength(2);
    expect(stages[0].stepTicketIds).toHaveLength(2);
    expect(stages[1].stepTicketIds).toHaveLength(2);
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

  it("stage names derive from track names", () => {
    const tickets = [
      makeWorkItem({ id: "geo-pipeline", deps: [] }),
      makeWorkItem({ id: "geo-indexing", deps: ["geo-pipeline"] }),
      makeWorkItem({ id: "ui-dashboard", deps: ["geo-indexing"] }),
    ];

    const plan = computePlan(makeTicketSets(tickets), {}, "test-plan");
    const stages = computeStages(plan.steps);

    // All connected → 1 stage
    expect(stages).toHaveLength(1);
    expect(stages[0].name).toBeDefined();
  });

  it("maxStageSize splits large batches of independent tracks", () => {
    const tickets = Array.from({ length: 10 }, (_, i) =>
      makeWorkItem({ id: `task-${i}`, deps: [] }),
    );

    const plan = computePlan(makeTicketSets(tickets), {}, "test-plan");
    const stages = computeStages(plan.steps, 5);

    // 10 independent single-step tracks, maxStageSize=5 → 2 stages
    expect(stages).toHaveLength(2);
    expect(stages[0].stepTicketIds).toHaveLength(5);
    expect(stages[1].stepTicketIds).toHaveLength(5);
  });
});
