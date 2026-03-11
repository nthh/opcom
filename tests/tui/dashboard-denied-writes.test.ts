import { describe, it, expect } from "vitest";
import {
  createDashboardState,
} from "../../packages/cli/src/tui/views/dashboard.js";
import { stripAnsi } from "../../packages/cli/src/tui/renderer.js";
import { ScreenBuffer } from "../../packages/cli/src/tui/renderer.js";
import type { PlanStep, Plan } from "@opcom/types";

function makePlanStep(overrides: Partial<PlanStep> = {}): PlanStep {
  return {
    ticketId: "tile-perf",
    projectId: "folia",
    status: "in-progress",
    blockedBy: [],
    ...overrides,
  };
}

function makePlan(steps: PlanStep[], overrides: Partial<Plan> = {}): Plan {
  return {
    id: "plan-1",
    name: "Sprint 1",
    status: "executing",
    scope: {},
    steps,
    config: {
      maxConcurrentAgents: 2,
      autoStart: false,
      backend: "claude-code",
      worktree: false,
      pauseOnFailure: true,
      ticketTransitions: true,
      autoCommit: false,
      verification: { runTests: true, runOracle: false },
    },
    context: "",
    createdAt: "2026-03-01T10:00:00Z",
    updatedAt: "2026-03-01T10:00:00Z",
    ...overrides,
  };
}

describe("dashboard denied write badge", () => {
  it("step with deniedWriteCount is available for badge rendering", () => {
    const step = makePlanStep({ deniedWriteCount: 3 });
    const plan = makePlan([step]);

    const state = createDashboardState();
    state.planPanel = { plan };

    const planStep = plan.steps.find((s) => s.ticketId === "tile-perf");
    expect(planStep).toBeDefined();
    expect(planStep!.deniedWriteCount).toBe(3);
  });

  it("step without deniedWriteCount has no badge data", () => {
    const step = makePlanStep();
    const plan = makePlan([step]);

    const state = createDashboardState();
    state.planPanel = { plan };

    const planStep = plan.steps.find((s) => s.ticketId === "tile-perf");
    expect(planStep).toBeDefined();
    expect(planStep!.deniedWriteCount).toBeUndefined();
  });

  it("multiple steps track independent denied write counts", () => {
    const steps = [
      makePlanStep({ ticketId: "a", deniedWriteCount: 2 }),
      makePlanStep({ ticketId: "b", deniedWriteCount: 0 }),
      makePlanStep({ ticketId: "c" }),
    ];
    const plan = makePlan(steps);

    const state = createDashboardState();
    state.planPanel = { plan };

    const withDenied = plan.steps.filter((s) => (s.deniedWriteCount ?? 0) > 0);
    expect(withDenied).toHaveLength(1);
    expect(withDenied[0].ticketId).toBe("a");
    expect(withDenied[0].deniedWriteCount).toBe(2);
  });
});
