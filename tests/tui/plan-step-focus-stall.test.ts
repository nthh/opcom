import { describe, it, expect } from "vitest";
import {
  createPlanStepFocusState,
  rebuildDisplayLines,
} from "../../packages/cli/src/tui/views/plan-step-focus.js";
import type { PlanStep, Plan, WorkItem, StallSignal } from "@opcom/types";

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

function makeWorkItem(overrides: Partial<WorkItem> = {}): WorkItem {
  return {
    id: "tile-perf",
    title: "Tile server performance",
    status: "open",
    priority: 1,
    type: "feature",
    filePath: "/tmp/tile-perf.md",
    deps: [],
    links: [],
    tags: {},
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

describe("plan step focus stall warning section", () => {
  it("shows Stall Warning section when stallSignal is present", () => {
    const step = makePlanStep({
      stallSignal: makeStallSignal(),
    });
    const plan = makePlan([step]);
    const ticket = makeWorkItem();

    const state = createPlanStepFocusState(step, plan, ticket, null, [ticket], []);

    const hasStallWarning = state.displayLines.some((l) => l.includes("Stall Warning"));
    expect(hasStallWarning).toBe(true);
  });

  it("shows stall signal type", () => {
    const step = makePlanStep({
      stallSignal: makeStallSignal({ type: "long-running" }),
    });
    const plan = makePlan([step]);

    const state = createPlanStepFocusState(step, plan, null, null, [], []);

    const hasType = state.displayLines.some((l) => l.includes("long-running"));
    expect(hasType).toBe(true);
  });

  it("shows stall signal message", () => {
    const step = makePlanStep({
      stallSignal: makeStallSignal({ message: "Agent has been running for 25m without producing commits" }),
    });
    const plan = makePlan([step]);

    const state = createPlanStepFocusState(step, plan, null, null, [], []);

    const hasMessage = state.displayLines.some((l) => l.includes("25m without producing commits"));
    expect(hasMessage).toBe(true);
  });

  it("shows stall signal suggestion", () => {
    const step = makePlanStep({
      stallSignal: makeStallSignal({ suggestion: "Consider stopping the agent" }),
    });
    const plan = makePlan([step]);

    const state = createPlanStepFocusState(step, plan, null, null, [], []);

    const hasSuggestion = state.displayLines.some((l) => l.includes("Consider stopping the agent"));
    expect(hasSuggestion).toBe(true);
  });

  it("does not show Stall Warning when stallSignal is undefined", () => {
    const step = makePlanStep({ stallSignal: undefined });
    const plan = makePlan([step]);

    const state = createPlanStepFocusState(step, plan, null, null, [], []);

    const hasStallWarning = state.displayLines.some((l) => l.includes("Stall Warning"));
    expect(hasStallWarning).toBe(false);
  });

  it("shows repeated-failure stall signal correctly", () => {
    const step = makePlanStep({
      stallSignal: makeStallSignal({
        type: "repeated-failure",
        message: "Step has failed 3 times with the same error pattern",
        suggestion: "The agent is repeating the same mistake. Consider skipping this step.",
      }),
    });
    const plan = makePlan([step]);

    const state = createPlanStepFocusState(step, plan, null, null, [], []);

    const hasType = state.displayLines.some((l) => l.includes("repeated-failure"));
    const hasMessage = state.displayLines.some((l) => l.includes("failed 3 times"));
    const hasSuggestion = state.displayLines.some((l) => l.includes("repeating the same mistake"));
    expect(hasType).toBe(true);
    expect(hasMessage).toBe(true);
    expect(hasSuggestion).toBe(true);
  });

  it("updates stall section when stallSignal changes via rebuild", () => {
    const step = makePlanStep({
      stallSignal: makeStallSignal({ message: "first stall" }),
    });
    const plan = makePlan([step]);

    const state = createPlanStepFocusState(step, plan, null, null, [], []);
    const hasFirst = state.displayLines.some((l) => l.includes("first stall"));
    expect(hasFirst).toBe(true);

    // Update signal
    state.step = { ...step, stallSignal: makeStallSignal({ message: "second stall" }) };
    rebuildDisplayLines(state, 80);

    const hasSecond = state.displayLines.some((l) => l.includes("second stall"));
    expect(hasSecond).toBe(true);
    const stillHasFirst = state.displayLines.some((l) => l.includes("first stall"));
    expect(stillHasFirst).toBe(false);
  });

  it("removes stall section when stallSignal is cleared via rebuild", () => {
    const step = makePlanStep({
      stallSignal: makeStallSignal(),
    });
    const plan = makePlan([step]);

    const state = createPlanStepFocusState(step, plan, null, null, [], []);
    expect(state.displayLines.some((l) => l.includes("Stall Warning"))).toBe(true);

    // Clear signal
    state.step = { ...step, stallSignal: undefined };
    rebuildDisplayLines(state, 80);

    expect(state.displayLines.some((l) => l.includes("Stall Warning"))).toBe(false);
  });
});
