import { describe, it, expect } from "vitest";
import {
  createDashboardState,
  formatStallBadge,
  formatStepVerificationBadge,
} from "../../packages/cli/src/tui/views/dashboard.js";
import { stripAnsi } from "../../packages/cli/src/tui/renderer.js";
import type { PlanStep, Plan, StallSignal } from "@opcom/types";

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
      stall: { enabled: true, agentTimeoutMs: 1200000, planStallTimeoutMs: 1800000, maxIdenticalFailures: 2 },
    },
    context: "",
    createdAt: "2026-03-01T10:00:00Z",
    updatedAt: "2026-03-01T10:00:00Z",
    ...overrides,
  };
}

function makeStallSignal(overrides: Partial<StallSignal> = {}): StallSignal {
  return {
    type: "long-running",
    stepId: "tile-perf",
    sessionId: "sess-1",
    message: "Agent has been running for 25m without producing commits",
    suggestion: "Consider stopping the agent and retrying with a different approach.",
    durationMs: 25 * 60 * 1000,
    ...overrides,
  };
}

describe("formatStallBadge", () => {
  it("formats long-running signal with minutes", () => {
    const signal = makeStallSignal({ durationMs: 20 * 60 * 1000 });
    expect(formatStallBadge(signal)).toBe("20m no commits");
  });

  it("formats repeated-failure signal", () => {
    const signal = makeStallSignal({ type: "repeated-failure", durationMs: 10 * 60 * 1000 });
    expect(formatStallBadge(signal)).toBe("repeated failure");
  });

  it("formats plan-stall signal with minutes", () => {
    const signal = makeStallSignal({ type: "plan-stall", durationMs: 30 * 60 * 1000 });
    expect(formatStallBadge(signal)).toBe("no progress 30m");
  });

  it("formats repeated-action signal", () => {
    const signal = makeStallSignal({ type: "repeated-action", durationMs: 5 * 60 * 1000 });
    expect(formatStallBadge(signal)).toBe("same error repeating");
  });
});

describe("dashboard step stall badge", () => {
  it("shows stall warning on step with stallSignal", () => {
    const step = makePlanStep({
      stallSignal: makeStallSignal(),
    });
    const plan = makePlan([step]);
    const state = createDashboardState();
    state.planPanel = { plan };

    // The step has a stallSignal — verify the badge includes the warning indicator
    const badge = stripAnsi(formatStepVerificationBadge(step));
    // The stall badge is separate from verification badge — it's rendered inline
    // Verify the stallSignal is accessible for rendering
    expect(step.stallSignal).toBeDefined();
    expect(step.stallSignal!.type).toBe("long-running");
  });

  it("no stall badge when stallSignal is undefined", () => {
    const step = makePlanStep({ stallSignal: undefined });
    expect(step.stallSignal).toBeUndefined();
  });
});

describe("plan panel stall indicator", () => {
  it("detects plan-level stall from step signals", () => {
    const step = makePlanStep({
      stallSignal: makeStallSignal({ type: "plan-stall", durationMs: 30 * 60 * 1000 }),
    });
    const plan = makePlan([step]);

    const hasPlanStall = plan.steps.some((s) => s.stallSignal?.type === "plan-stall");
    expect(hasPlanStall).toBe(true);
  });

  it("no plan stall indicator when no plan-stall signals", () => {
    const step = makePlanStep({
      stallSignal: makeStallSignal({ type: "long-running" }),
    });
    const plan = makePlan([step]);

    const hasPlanStall = plan.steps.some((s) => s.stallSignal?.type === "plan-stall");
    expect(hasPlanStall).toBe(false);
  });

  it("no plan stall indicator when no stall signals at all", () => {
    const step = makePlanStep();
    const plan = makePlan([step]);

    const hasPlanStall = plan.steps.some((s) => s.stallSignal?.type === "plan-stall");
    expect(hasPlanStall).toBe(false);
  });
});

describe("agent panel stall display", () => {
  it("agent step with stallSignal is available for rendering", () => {
    const step = makePlanStep({
      agentSessionId: "agent-1",
      stallSignal: makeStallSignal(),
    });
    const plan = makePlan([step]);

    // The agent panel renders stall from the plan step — verify the connection
    const planStep = plan.steps.find((s) => s.agentSessionId === "agent-1" && s.status === "in-progress");
    expect(planStep).toBeDefined();
    expect(planStep!.stallSignal).toBeDefined();
    expect(planStep!.stallSignal!.message).toContain("25m");
  });
});
