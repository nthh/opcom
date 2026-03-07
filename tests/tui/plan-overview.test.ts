import { describe, it, expect } from "vitest";
import {
  computePlanSummary,
  computeCriticalPath,
  createPlanOverviewState,
  rebuildDisplayLines,
  scrollUp,
  scrollDown,
  scrollToTop,
  scrollToBottom,
  type PlanOverviewState,
} from "../../packages/cli/src/tui/views/plan-overview.js";
import type { Plan, PlanStep, WorkItem, OrchestratorConfig } from "@opcom/types";

function makeConfig(overrides: Partial<OrchestratorConfig> = {}): OrchestratorConfig {
  return {
    maxConcurrentAgents: 2,
    autoStart: false,
    backend: "claude-code",
    worktree: true,
    pauseOnFailure: true,
    ticketTransitions: true,
    autoCommit: false,
    verification: { runTests: true, runOracle: false },
    ...overrides,
  };
}

function makeStep(overrides: Partial<PlanStep> = {}): PlanStep {
  return {
    ticketId: "step-1",
    projectId: "proj-a",
    status: "ready",
    blockedBy: [],
    ...overrides,
  };
}

function makePlan(steps: PlanStep[], overrides: Partial<Plan> = {}): Plan {
  return {
    id: "plan-abc-123",
    name: "Sprint 1",
    status: "planning",
    scope: {},
    steps,
    config: makeConfig(),
    context: "",
    createdAt: "2026-03-01T10:00:00Z",
    updatedAt: "2026-03-01T10:00:00Z",
    ...overrides,
  };
}

function makeTicket(overrides: Partial<WorkItem> = {}): WorkItem {
  return {
    id: "step-1",
    title: "Step one",
    status: "open",
    priority: 1,
    type: "feature",
    filePath: "/tmp/step-1.md",
    deps: [],
    links: [],
    tags: {},
    ...overrides,
  };
}

// --- computePlanSummary ---

describe("computePlanSummary", () => {
  it("computes step counts for a simple plan", () => {
    const steps = [
      makeStep({ ticketId: "a", status: "ready" }),
      makeStep({ ticketId: "b", status: "blocked", blockedBy: ["a"] }),
      makeStep({ ticketId: "c", status: "ready" }),
    ];
    const plan = makePlan(steps);
    const summary = computePlanSummary(plan);

    expect(summary.totalSteps).toBe(3);
    expect(summary.readyCount).toBe(2);
    expect(summary.blockedCount).toBe(1);
  });

  it("groups steps into tracks", () => {
    const steps = [
      makeStep({ ticketId: "a", track: "backend" }),
      makeStep({ ticketId: "b", track: "backend" }),
      makeStep({ ticketId: "c", track: "frontend" }),
    ];
    const plan = makePlan(steps);
    const summary = computePlanSummary(plan);

    expect(summary.tracks).toHaveLength(2);
    const backend = summary.tracks.find((t) => t.name === "backend");
    const frontend = summary.tracks.find((t) => t.name === "frontend");
    expect(backend?.stepCount).toBe(2);
    expect(backend?.ticketIds).toEqual(["a", "b"]);
    expect(frontend?.stepCount).toBe(1);
  });

  it("uses 'unassigned' for steps without a track", () => {
    const steps = [makeStep({ ticketId: "a" })];
    const plan = makePlan(steps);
    const summary = computePlanSummary(plan);

    expect(summary.tracks).toHaveLength(1);
    expect(summary.tracks[0].name).toBe("unassigned");
  });

  it("computes track-level ready/blocked counts", () => {
    const steps = [
      makeStep({ ticketId: "a", track: "core", status: "ready" }),
      makeStep({ ticketId: "b", track: "core", status: "blocked", blockedBy: ["a"] }),
      makeStep({ ticketId: "c", track: "core", status: "blocked", blockedBy: ["b"] }),
    ];
    const plan = makePlan(steps);
    const summary = computePlanSummary(plan);

    const core = summary.tracks.find((t) => t.name === "core")!;
    expect(core.readyCount).toBe(1);
    expect(core.blockedCount).toBe(2);
  });

  it("computes critical path for a linear chain", () => {
    const steps = [
      makeStep({ ticketId: "a", status: "ready" }),
      makeStep({ ticketId: "b", status: "blocked", blockedBy: ["a"] }),
      makeStep({ ticketId: "c", status: "blocked", blockedBy: ["b"] }),
    ];
    const plan = makePlan(steps);
    const summary = computePlanSummary(plan);

    expect(summary.criticalPathLength).toBe(3);
    expect(summary.criticalPath).toEqual(["a", "b", "c"]);
  });

  it("preserves config from the plan", () => {
    const config = makeConfig({ maxConcurrentAgents: 5, backend: "pi-opus" });
    const plan = makePlan([makeStep()], { config });
    const summary = computePlanSummary(plan);

    expect(summary.config.maxConcurrentAgents).toBe(5);
    expect(summary.config.backend).toBe("pi-opus");
  });

  it("handles empty plan", () => {
    const plan = makePlan([]);
    const summary = computePlanSummary(plan);

    expect(summary.totalSteps).toBe(0);
    expect(summary.readyCount).toBe(0);
    expect(summary.blockedCount).toBe(0);
    expect(summary.tracks).toHaveLength(0);
    expect(summary.criticalPathLength).toBe(0);
  });
});

// --- computeCriticalPath ---

describe("computeCriticalPath", () => {
  it("returns empty for no steps", () => {
    const result = computeCriticalPath([]);
    expect(result.length).toBe(0);
    expect(result.path).toEqual([]);
  });

  it("returns length 1 for a single step", () => {
    const result = computeCriticalPath([makeStep({ ticketId: "only" })]);
    expect(result.length).toBe(1);
    expect(result.path).toEqual(["only"]);
  });

  it("finds longest chain in a diamond DAG", () => {
    // a -> b -> d
    // a -> c -> d
    const steps = [
      makeStep({ ticketId: "a", blockedBy: [] }),
      makeStep({ ticketId: "b", blockedBy: ["a"] }),
      makeStep({ ticketId: "c", blockedBy: ["a"] }),
      makeStep({ ticketId: "d", blockedBy: ["b", "c"] }),
    ];
    const result = computeCriticalPath(steps);

    expect(result.length).toBe(3); // a -> b -> d or a -> c -> d
    expect(result.path[0]).toBe("a");
    expect(result.path[result.path.length - 1]).toBe("d");
  });

  it("picks the longest of two independent chains", () => {
    // Chain 1: a -> b -> c (length 3)
    // Chain 2: x -> y (length 2)
    const steps = [
      makeStep({ ticketId: "a", blockedBy: [] }),
      makeStep({ ticketId: "b", blockedBy: ["a"] }),
      makeStep({ ticketId: "c", blockedBy: ["b"] }),
      makeStep({ ticketId: "x", blockedBy: [] }),
      makeStep({ ticketId: "y", blockedBy: ["x"] }),
    ];
    const result = computeCriticalPath(steps);

    expect(result.length).toBe(3);
    expect(result.path).toEqual(["a", "b", "c"]);
  });

  it("handles all-parallel steps", () => {
    const steps = [
      makeStep({ ticketId: "a" }),
      makeStep({ ticketId: "b" }),
      makeStep({ ticketId: "c" }),
    ];
    const result = computeCriticalPath(steps);

    expect(result.length).toBe(1);
    expect(result.path).toHaveLength(1);
  });
});

// --- createPlanOverviewState ---

describe("createPlanOverviewState", () => {
  it("creates state with computed summary", () => {
    const steps = [
      makeStep({ ticketId: "a", status: "ready" }),
      makeStep({ ticketId: "b", status: "blocked", blockedBy: ["a"] }),
    ];
    const plan = makePlan(steps);
    const state = createPlanOverviewState(plan);

    expect(state.plan).toBe(plan);
    expect(state.summary.totalSteps).toBe(2);
    expect(state.summary.readyCount).toBe(1);
    expect(state.confirmed).toBeNull();
    expect(state.scrollOffset).toBe(0);
    expect(state.displayLines.length).toBeGreaterThan(0);
  });

  it("starts with confirmed as null (pending)", () => {
    const state = createPlanOverviewState(makePlan([makeStep()]));
    expect(state.confirmed).toBeNull();
  });
});

// --- rebuildDisplayLines ---

describe("rebuildDisplayLines", () => {
  it("includes plan name", () => {
    const plan = makePlan([makeStep()], { name: "My Test Plan" });
    const state = createPlanOverviewState(plan);
    const hasName = state.displayLines.some((l) => l.includes("My Test Plan"));
    expect(hasName).toBe(true);
  });

  it("includes step counts", () => {
    const steps = [
      makeStep({ ticketId: "a", status: "ready" }),
      makeStep({ ticketId: "b", status: "blocked", blockedBy: ["a"] }),
    ];
    const state = createPlanOverviewState(makePlan(steps));
    const hasTotal = state.displayLines.some((l) => l.includes("2"));
    const hasReady = state.displayLines.some((l) => l.includes("1 ready"));
    expect(hasTotal).toBe(true);
    expect(hasReady).toBe(true);
  });

  it("includes track names", () => {
    const steps = [
      makeStep({ ticketId: "a", track: "auth-flow" }),
      makeStep({ ticketId: "b", track: "data-layer" }),
    ];
    const state = createPlanOverviewState(makePlan(steps));
    const hasAuth = state.displayLines.some((l) => l.includes("auth-flow"));
    const hasData = state.displayLines.some((l) => l.includes("data-layer"));
    expect(hasAuth).toBe(true);
    expect(hasData).toBe(true);
  });

  it("includes ticket IDs in tracks", () => {
    const steps = [
      makeStep({ ticketId: "setup-db", track: "core" }),
      makeStep({ ticketId: "add-api", track: "core", blockedBy: ["setup-db"] }),
    ];
    const state = createPlanOverviewState(makePlan(steps));
    const hasSetup = state.displayLines.some((l) => l.includes("setup-db"));
    const hasApi = state.displayLines.some((l) => l.includes("add-api"));
    expect(hasSetup).toBe(true);
    expect(hasApi).toBe(true);
  });

  it("includes critical path when length > 1", () => {
    const steps = [
      makeStep({ ticketId: "a", status: "ready" }),
      makeStep({ ticketId: "b", status: "blocked", blockedBy: ["a"] }),
      makeStep({ ticketId: "c", status: "blocked", blockedBy: ["b"] }),
    ];
    const state = createPlanOverviewState(makePlan(steps));
    const hasCritical = state.displayLines.some((l) => l.includes("Critical Path"));
    const hasLength = state.displayLines.some((l) => l.includes("3 steps"));
    expect(hasCritical).toBe(true);
    expect(hasLength).toBe(true);
  });

  it("omits critical path section for single-step plans", () => {
    const state = createPlanOverviewState(makePlan([makeStep()]));
    const hasCritical = state.displayLines.some((l) => l.includes("Critical Path"));
    expect(hasCritical).toBe(false);
  });

  it("includes settings", () => {
    const config = makeConfig({ maxConcurrentAgents: 4, backend: "pi-opus", worktree: true });
    const plan = makePlan([makeStep()], { config });
    const state = createPlanOverviewState(plan);

    const hasMax = state.displayLines.some((l) => l.includes("4"));
    const hasBackend = state.displayLines.some((l) => l.includes("pi-opus"));
    const hasWorktree = state.displayLines.some((l) => l.includes("yes"));
    expect(hasMax).toBe(true);
    expect(hasBackend).toBe(true);
    expect(hasWorktree).toBe(true);
  });

  it("includes verification settings", () => {
    const config = makeConfig({
      verification: { runTests: true, runOracle: true, oracleModel: "opus-4" },
    });
    const plan = makePlan([makeStep()], { config });
    const state = createPlanOverviewState(plan);

    const hasTests = state.displayLines.some((l) => l.includes("tests"));
    const hasOracle = state.displayLines.some((l) => l.includes("oracle"));
    const hasModel = state.displayLines.some((l) => l.includes("opus-4"));
    expect(hasTests).toBe(true);
    expect(hasOracle).toBe(true);
    expect(hasModel).toBe(true);
  });

  it("shows confirm prompt when pending", () => {
    const state = createPlanOverviewState(makePlan([makeStep()]));
    expect(state.confirmed).toBeNull();
    const hasPrompt = state.displayLines.some((l) => l.includes("Space to start"));
    expect(hasPrompt).toBe(true);
  });

  it("shows confirmed message after confirmation", () => {
    const state = createPlanOverviewState(makePlan([makeStep()]));
    state.confirmed = true;
    rebuildDisplayLines(state);
    const hasConfirmed = state.displayLines.some((l) => l.includes("execution started"));
    expect(hasConfirmed).toBe(true);
  });

  it("shows cancelled message after cancellation", () => {
    const state = createPlanOverviewState(makePlan([makeStep()]));
    state.confirmed = false;
    rebuildDisplayLines(state);
    const hasCancelled = state.displayLines.some((l) => l.includes("cancelled"));
    expect(hasCancelled).toBe(true);
  });

  it("includes context when present", () => {
    const plan = makePlan([makeStep()], { context: "Focus on auth module first" });
    const state = createPlanOverviewState(plan);
    const hasContext = state.displayLines.some((l) => l.includes("Focus on auth module first"));
    expect(hasContext).toBe(true);
  });

  it("omits context section when empty", () => {
    const plan = makePlan([makeStep()], { context: "" });
    const state = createPlanOverviewState(plan);
    const hasContext = state.displayLines.some((l) => l.includes("Context"));
    expect(hasContext).toBe(false);
  });

  it("re-wraps when width changes", () => {
    const state = createPlanOverviewState(makePlan([makeStep()]));
    const originalWidth = state.wrapWidth;
    rebuildDisplayLines(state, 40);
    expect(state.wrapWidth).toBe(40);
    expect(state.wrapWidth).not.toBe(originalWidth);
  });

  it("shows dependency arrows for blocked steps", () => {
    const steps = [
      makeStep({ ticketId: "setup-db", status: "ready" }),
      makeStep({ ticketId: "add-api", status: "blocked", blockedBy: ["setup-db"] }),
    ];
    const state = createPlanOverviewState(makePlan(steps));
    const hasArrow = state.displayLines.some((l) => l.includes("setup-db") && l.includes("\u2190"));
    expect(hasArrow).toBe(true);
  });
});

// --- scroll navigation ---

describe("scroll navigation", () => {
  function makeLargeState(): PlanOverviewState {
    const steps: PlanStep[] = [];
    for (let i = 0; i < 20; i++) {
      steps.push(makeStep({
        ticketId: `step-${i}`,
        track: `track-${i % 3}`,
        status: i % 2 === 0 ? "ready" : "blocked",
        blockedBy: i > 0 ? [`step-${i - 1}`] : [],
      }));
    }
    return createPlanOverviewState(makePlan(steps));
  }

  it("scrollDown increases offset", () => {
    const state = makeLargeState();
    expect(state.scrollOffset).toBe(0);
    scrollDown(state, 3, 5);
    expect(state.scrollOffset).toBe(3);
  });

  it("scrollUp decreases offset", () => {
    const state = makeLargeState();
    state.scrollOffset = 5;
    scrollUp(state, 2);
    expect(state.scrollOffset).toBe(3);
  });

  it("scrollUp does not go below 0", () => {
    const state = makeLargeState();
    state.scrollOffset = 1;
    scrollUp(state, 5);
    expect(state.scrollOffset).toBe(0);
  });

  it("scrollDown does not exceed max", () => {
    const state = makeLargeState();
    const totalLines = state.displayLines.length;
    const viewHeight = 5;
    scrollDown(state, totalLines + 100, viewHeight);
    expect(state.scrollOffset).toBe(Math.max(0, totalLines - viewHeight));
  });

  it("scrollToTop resets to 0", () => {
    const state = makeLargeState();
    state.scrollOffset = 10;
    scrollToTop(state);
    expect(state.scrollOffset).toBe(0);
  });

  it("scrollToBottom jumps to end", () => {
    const state = makeLargeState();
    const viewHeight = 5;
    scrollToBottom(state, viewHeight);
    expect(state.scrollOffset).toBe(Math.max(0, state.displayLines.length - viewHeight));
  });
});

// --- rendering edge cases ---

describe("plan overview rendering edge cases", () => {
  it("handles plan with mixed statuses", () => {
    const steps = [
      makeStep({ ticketId: "a", status: "done" }),
      makeStep({ ticketId: "b", status: "in-progress" }),
      makeStep({ ticketId: "c", status: "failed" }),
      makeStep({ ticketId: "d", status: "skipped" }),
      makeStep({ ticketId: "e", status: "ready" }),
      makeStep({ ticketId: "f", status: "blocked", blockedBy: ["e"] }),
    ];
    const plan = makePlan(steps);
    const summary = computePlanSummary(plan);

    // ready + blocked should only count exact matches
    expect(summary.readyCount).toBe(1);
    expect(summary.blockedCount).toBe(1);
    // Other 4 are done/in-progress/failed/skipped
    const other = summary.totalSteps - summary.readyCount - summary.blockedCount;
    expect(other).toBe(4);
  });

  it("handles plan with all steps done", () => {
    const steps = [
      makeStep({ ticketId: "a", status: "done" }),
      makeStep({ ticketId: "b", status: "done" }),
    ];
    const plan = makePlan(steps, { status: "done" });
    const summary = computePlanSummary(plan);

    expect(summary.readyCount).toBe(0);
    expect(summary.blockedCount).toBe(0);
  });

  it("includes plan ID in display lines", () => {
    const plan = makePlan([makeStep()], { id: "plan-xyz-full-uuid" });
    const state = createPlanOverviewState(plan);
    const hasId = state.displayLines.some((l) => l.includes("plan-xyz"));
    expect(hasId).toBe(true);
  });
});
