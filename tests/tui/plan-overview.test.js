"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const plan_overview_js_1 = require("../../packages/cli/src/tui/views/plan-overview.js");
function makeConfig(overrides = {}) {
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
function makeStep(overrides = {}) {
    return {
        ticketId: "step-1",
        projectId: "proj-a",
        status: "ready",
        blockedBy: [],
        ...overrides,
    };
}
function makePlan(steps, overrides = {}) {
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
function makeTicket(overrides = {}) {
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
(0, vitest_1.describe)("computePlanSummary", () => {
    (0, vitest_1.it)("computes step counts for a simple plan", () => {
        const steps = [
            makeStep({ ticketId: "a", status: "ready" }),
            makeStep({ ticketId: "b", status: "blocked", blockedBy: ["a"] }),
            makeStep({ ticketId: "c", status: "ready" }),
        ];
        const plan = makePlan(steps);
        const summary = (0, plan_overview_js_1.computePlanSummary)(plan);
        (0, vitest_1.expect)(summary.totalSteps).toBe(3);
        (0, vitest_1.expect)(summary.readyCount).toBe(2);
        (0, vitest_1.expect)(summary.blockedCount).toBe(1);
    });
    (0, vitest_1.it)("groups steps into tracks", () => {
        const steps = [
            makeStep({ ticketId: "a", track: "backend" }),
            makeStep({ ticketId: "b", track: "backend" }),
            makeStep({ ticketId: "c", track: "frontend" }),
        ];
        const plan = makePlan(steps);
        const summary = (0, plan_overview_js_1.computePlanSummary)(plan);
        (0, vitest_1.expect)(summary.tracks).toHaveLength(2);
        const backend = summary.tracks.find((t) => t.name === "backend");
        const frontend = summary.tracks.find((t) => t.name === "frontend");
        (0, vitest_1.expect)(backend?.stepCount).toBe(2);
        (0, vitest_1.expect)(backend?.ticketIds).toEqual(["a", "b"]);
        (0, vitest_1.expect)(frontend?.stepCount).toBe(1);
    });
    (0, vitest_1.it)("uses 'unassigned' for steps without a track", () => {
        const steps = [makeStep({ ticketId: "a" })];
        const plan = makePlan(steps);
        const summary = (0, plan_overview_js_1.computePlanSummary)(plan);
        (0, vitest_1.expect)(summary.tracks).toHaveLength(1);
        (0, vitest_1.expect)(summary.tracks[0].name).toBe("unassigned");
    });
    (0, vitest_1.it)("computes track-level ready/blocked counts", () => {
        const steps = [
            makeStep({ ticketId: "a", track: "core", status: "ready" }),
            makeStep({ ticketId: "b", track: "core", status: "blocked", blockedBy: ["a"] }),
            makeStep({ ticketId: "c", track: "core", status: "blocked", blockedBy: ["b"] }),
        ];
        const plan = makePlan(steps);
        const summary = (0, plan_overview_js_1.computePlanSummary)(plan);
        const core = summary.tracks.find((t) => t.name === "core");
        (0, vitest_1.expect)(core.readyCount).toBe(1);
        (0, vitest_1.expect)(core.blockedCount).toBe(2);
    });
    (0, vitest_1.it)("computes critical path for a linear chain", () => {
        const steps = [
            makeStep({ ticketId: "a", status: "ready" }),
            makeStep({ ticketId: "b", status: "blocked", blockedBy: ["a"] }),
            makeStep({ ticketId: "c", status: "blocked", blockedBy: ["b"] }),
        ];
        const plan = makePlan(steps);
        const summary = (0, plan_overview_js_1.computePlanSummary)(plan);
        (0, vitest_1.expect)(summary.criticalPathLength).toBe(3);
        (0, vitest_1.expect)(summary.criticalPath).toEqual(["a", "b", "c"]);
    });
    (0, vitest_1.it)("preserves config from the plan", () => {
        const config = makeConfig({ maxConcurrentAgents: 5, backend: "pi-opus" });
        const plan = makePlan([makeStep()], { config });
        const summary = (0, plan_overview_js_1.computePlanSummary)(plan);
        (0, vitest_1.expect)(summary.config.maxConcurrentAgents).toBe(5);
        (0, vitest_1.expect)(summary.config.backend).toBe("pi-opus");
    });
    (0, vitest_1.it)("handles empty plan", () => {
        const plan = makePlan([]);
        const summary = (0, plan_overview_js_1.computePlanSummary)(plan);
        (0, vitest_1.expect)(summary.totalSteps).toBe(0);
        (0, vitest_1.expect)(summary.readyCount).toBe(0);
        (0, vitest_1.expect)(summary.blockedCount).toBe(0);
        (0, vitest_1.expect)(summary.tracks).toHaveLength(0);
        (0, vitest_1.expect)(summary.criticalPathLength).toBe(0);
    });
});
// --- computeCriticalPath ---
(0, vitest_1.describe)("computeCriticalPath", () => {
    (0, vitest_1.it)("returns empty for no steps", () => {
        const result = (0, plan_overview_js_1.computeCriticalPath)([]);
        (0, vitest_1.expect)(result.length).toBe(0);
        (0, vitest_1.expect)(result.path).toEqual([]);
    });
    (0, vitest_1.it)("returns length 1 for a single step", () => {
        const result = (0, plan_overview_js_1.computeCriticalPath)([makeStep({ ticketId: "only" })]);
        (0, vitest_1.expect)(result.length).toBe(1);
        (0, vitest_1.expect)(result.path).toEqual(["only"]);
    });
    (0, vitest_1.it)("finds longest chain in a diamond DAG", () => {
        // a -> b -> d
        // a -> c -> d
        const steps = [
            makeStep({ ticketId: "a", blockedBy: [] }),
            makeStep({ ticketId: "b", blockedBy: ["a"] }),
            makeStep({ ticketId: "c", blockedBy: ["a"] }),
            makeStep({ ticketId: "d", blockedBy: ["b", "c"] }),
        ];
        const result = (0, plan_overview_js_1.computeCriticalPath)(steps);
        (0, vitest_1.expect)(result.length).toBe(3); // a -> b -> d or a -> c -> d
        (0, vitest_1.expect)(result.path[0]).toBe("a");
        (0, vitest_1.expect)(result.path[result.path.length - 1]).toBe("d");
    });
    (0, vitest_1.it)("picks the longest of two independent chains", () => {
        // Chain 1: a -> b -> c (length 3)
        // Chain 2: x -> y (length 2)
        const steps = [
            makeStep({ ticketId: "a", blockedBy: [] }),
            makeStep({ ticketId: "b", blockedBy: ["a"] }),
            makeStep({ ticketId: "c", blockedBy: ["b"] }),
            makeStep({ ticketId: "x", blockedBy: [] }),
            makeStep({ ticketId: "y", blockedBy: ["x"] }),
        ];
        const result = (0, plan_overview_js_1.computeCriticalPath)(steps);
        (0, vitest_1.expect)(result.length).toBe(3);
        (0, vitest_1.expect)(result.path).toEqual(["a", "b", "c"]);
    });
    (0, vitest_1.it)("handles all-parallel steps", () => {
        const steps = [
            makeStep({ ticketId: "a" }),
            makeStep({ ticketId: "b" }),
            makeStep({ ticketId: "c" }),
        ];
        const result = (0, plan_overview_js_1.computeCriticalPath)(steps);
        (0, vitest_1.expect)(result.length).toBe(1);
        (0, vitest_1.expect)(result.path).toHaveLength(1);
    });
});
// --- createPlanOverviewState ---
(0, vitest_1.describe)("createPlanOverviewState", () => {
    (0, vitest_1.it)("creates state with computed summary", () => {
        const steps = [
            makeStep({ ticketId: "a", status: "ready" }),
            makeStep({ ticketId: "b", status: "blocked", blockedBy: ["a"] }),
        ];
        const plan = makePlan(steps);
        const state = (0, plan_overview_js_1.createPlanOverviewState)(plan);
        (0, vitest_1.expect)(state.plan).toBe(plan);
        (0, vitest_1.expect)(state.summary.totalSteps).toBe(2);
        (0, vitest_1.expect)(state.summary.readyCount).toBe(1);
        (0, vitest_1.expect)(state.confirmed).toBeNull();
        (0, vitest_1.expect)(state.scrollOffset).toBe(0);
        (0, vitest_1.expect)(state.displayLines.length).toBeGreaterThan(0);
    });
    (0, vitest_1.it)("starts with confirmed as null (pending)", () => {
        const state = (0, plan_overview_js_1.createPlanOverviewState)(makePlan([makeStep()]));
        (0, vitest_1.expect)(state.confirmed).toBeNull();
    });
});
// --- rebuildDisplayLines ---
(0, vitest_1.describe)("rebuildDisplayLines", () => {
    (0, vitest_1.it)("includes plan name", () => {
        const plan = makePlan([makeStep()], { name: "My Test Plan" });
        const state = (0, plan_overview_js_1.createPlanOverviewState)(plan);
        const hasName = state.displayLines.some((l) => l.includes("My Test Plan"));
        (0, vitest_1.expect)(hasName).toBe(true);
    });
    (0, vitest_1.it)("includes step counts", () => {
        const steps = [
            makeStep({ ticketId: "a", status: "ready" }),
            makeStep({ ticketId: "b", status: "blocked", blockedBy: ["a"] }),
        ];
        const state = (0, plan_overview_js_1.createPlanOverviewState)(makePlan(steps));
        const hasTotal = state.displayLines.some((l) => l.includes("2"));
        const hasReady = state.displayLines.some((l) => l.includes("1 ready"));
        (0, vitest_1.expect)(hasTotal).toBe(true);
        (0, vitest_1.expect)(hasReady).toBe(true);
    });
    (0, vitest_1.it)("includes track names", () => {
        const steps = [
            makeStep({ ticketId: "a", track: "auth-flow" }),
            makeStep({ ticketId: "b", track: "data-layer" }),
        ];
        const state = (0, plan_overview_js_1.createPlanOverviewState)(makePlan(steps));
        const hasAuth = state.displayLines.some((l) => l.includes("auth-flow"));
        const hasData = state.displayLines.some((l) => l.includes("data-layer"));
        (0, vitest_1.expect)(hasAuth).toBe(true);
        (0, vitest_1.expect)(hasData).toBe(true);
    });
    (0, vitest_1.it)("includes ticket IDs in tracks", () => {
        const steps = [
            makeStep({ ticketId: "setup-db", track: "core" }),
            makeStep({ ticketId: "add-api", track: "core", blockedBy: ["setup-db"] }),
        ];
        const state = (0, plan_overview_js_1.createPlanOverviewState)(makePlan(steps));
        const hasSetup = state.displayLines.some((l) => l.includes("setup-db"));
        const hasApi = state.displayLines.some((l) => l.includes("add-api"));
        (0, vitest_1.expect)(hasSetup).toBe(true);
        (0, vitest_1.expect)(hasApi).toBe(true);
    });
    (0, vitest_1.it)("includes critical path when length > 1", () => {
        const steps = [
            makeStep({ ticketId: "a", status: "ready" }),
            makeStep({ ticketId: "b", status: "blocked", blockedBy: ["a"] }),
            makeStep({ ticketId: "c", status: "blocked", blockedBy: ["b"] }),
        ];
        const state = (0, plan_overview_js_1.createPlanOverviewState)(makePlan(steps));
        const hasCritical = state.displayLines.some((l) => l.includes("Critical Path"));
        const hasLength = state.displayLines.some((l) => l.includes("3 steps"));
        (0, vitest_1.expect)(hasCritical).toBe(true);
        (0, vitest_1.expect)(hasLength).toBe(true);
    });
    (0, vitest_1.it)("omits critical path section for single-step plans", () => {
        const state = (0, plan_overview_js_1.createPlanOverviewState)(makePlan([makeStep()]));
        const hasCritical = state.displayLines.some((l) => l.includes("Critical Path"));
        (0, vitest_1.expect)(hasCritical).toBe(false);
    });
    (0, vitest_1.it)("includes settings", () => {
        const config = makeConfig({ maxConcurrentAgents: 4, backend: "pi-opus", worktree: true });
        const plan = makePlan([makeStep()], { config });
        const state = (0, plan_overview_js_1.createPlanOverviewState)(plan);
        const hasMax = state.displayLines.some((l) => l.includes("4"));
        const hasBackend = state.displayLines.some((l) => l.includes("pi-opus"));
        const hasWorktree = state.displayLines.some((l) => l.includes("yes"));
        (0, vitest_1.expect)(hasMax).toBe(true);
        (0, vitest_1.expect)(hasBackend).toBe(true);
        (0, vitest_1.expect)(hasWorktree).toBe(true);
    });
    (0, vitest_1.it)("includes verification settings", () => {
        const config = makeConfig({
            verification: { runTests: true, runOracle: true, oracleModel: "opus-4" },
        });
        const plan = makePlan([makeStep()], { config });
        const state = (0, plan_overview_js_1.createPlanOverviewState)(plan);
        const hasTests = state.displayLines.some((l) => l.includes("tests"));
        const hasOracle = state.displayLines.some((l) => l.includes("oracle"));
        const hasModel = state.displayLines.some((l) => l.includes("opus-4"));
        (0, vitest_1.expect)(hasTests).toBe(true);
        (0, vitest_1.expect)(hasOracle).toBe(true);
        (0, vitest_1.expect)(hasModel).toBe(true);
    });
    (0, vitest_1.it)("shows confirm prompt when pending", () => {
        const state = (0, plan_overview_js_1.createPlanOverviewState)(makePlan([makeStep()]));
        (0, vitest_1.expect)(state.confirmed).toBeNull();
        const hasPrompt = state.displayLines.some((l) => l.includes("Space to start"));
        (0, vitest_1.expect)(hasPrompt).toBe(true);
    });
    (0, vitest_1.it)("shows confirmed message after confirmation", () => {
        const state = (0, plan_overview_js_1.createPlanOverviewState)(makePlan([makeStep()]));
        state.confirmed = true;
        (0, plan_overview_js_1.rebuildDisplayLines)(state);
        const hasConfirmed = state.displayLines.some((l) => l.includes("execution started"));
        (0, vitest_1.expect)(hasConfirmed).toBe(true);
    });
    (0, vitest_1.it)("shows cancelled message after cancellation", () => {
        const state = (0, plan_overview_js_1.createPlanOverviewState)(makePlan([makeStep()]));
        state.confirmed = false;
        (0, plan_overview_js_1.rebuildDisplayLines)(state);
        const hasCancelled = state.displayLines.some((l) => l.includes("cancelled"));
        (0, vitest_1.expect)(hasCancelled).toBe(true);
    });
    (0, vitest_1.it)("includes context when present", () => {
        const plan = makePlan([makeStep()], { context: "Focus on auth module first" });
        const state = (0, plan_overview_js_1.createPlanOverviewState)(plan);
        const hasContext = state.displayLines.some((l) => l.includes("Focus on auth module first"));
        (0, vitest_1.expect)(hasContext).toBe(true);
    });
    (0, vitest_1.it)("omits context section when empty", () => {
        const plan = makePlan([makeStep()], { context: "" });
        const state = (0, plan_overview_js_1.createPlanOverviewState)(plan);
        const hasContext = state.displayLines.some((l) => l.includes("Context"));
        (0, vitest_1.expect)(hasContext).toBe(false);
    });
    (0, vitest_1.it)("re-wraps when width changes", () => {
        const state = (0, plan_overview_js_1.createPlanOverviewState)(makePlan([makeStep()]));
        const originalWidth = state.wrapWidth;
        (0, plan_overview_js_1.rebuildDisplayLines)(state, 40);
        (0, vitest_1.expect)(state.wrapWidth).toBe(40);
        (0, vitest_1.expect)(state.wrapWidth).not.toBe(originalWidth);
    });
    (0, vitest_1.it)("shows dependency arrows for blocked steps", () => {
        const steps = [
            makeStep({ ticketId: "setup-db", status: "ready" }),
            makeStep({ ticketId: "add-api", status: "blocked", blockedBy: ["setup-db"] }),
        ];
        const state = (0, plan_overview_js_1.createPlanOverviewState)(makePlan(steps));
        const hasArrow = state.displayLines.some((l) => l.includes("setup-db") && l.includes("\u2190"));
        (0, vitest_1.expect)(hasArrow).toBe(true);
    });
});
// --- scroll navigation ---
(0, vitest_1.describe)("scroll navigation", () => {
    function makeLargeState() {
        const steps = [];
        for (let i = 0; i < 20; i++) {
            steps.push(makeStep({
                ticketId: `step-${i}`,
                track: `track-${i % 3}`,
                status: i % 2 === 0 ? "ready" : "blocked",
                blockedBy: i > 0 ? [`step-${i - 1}`] : [],
            }));
        }
        return (0, plan_overview_js_1.createPlanOverviewState)(makePlan(steps));
    }
    (0, vitest_1.it)("scrollDown increases offset", () => {
        const state = makeLargeState();
        (0, vitest_1.expect)(state.scrollOffset).toBe(0);
        (0, plan_overview_js_1.scrollDown)(state, 3, 5);
        (0, vitest_1.expect)(state.scrollOffset).toBe(3);
    });
    (0, vitest_1.it)("scrollUp decreases offset", () => {
        const state = makeLargeState();
        state.scrollOffset = 5;
        (0, plan_overview_js_1.scrollUp)(state, 2);
        (0, vitest_1.expect)(state.scrollOffset).toBe(3);
    });
    (0, vitest_1.it)("scrollUp does not go below 0", () => {
        const state = makeLargeState();
        state.scrollOffset = 1;
        (0, plan_overview_js_1.scrollUp)(state, 5);
        (0, vitest_1.expect)(state.scrollOffset).toBe(0);
    });
    (0, vitest_1.it)("scrollDown does not exceed max", () => {
        const state = makeLargeState();
        const totalLines = state.displayLines.length;
        const viewHeight = 5;
        (0, plan_overview_js_1.scrollDown)(state, totalLines + 100, viewHeight);
        (0, vitest_1.expect)(state.scrollOffset).toBe(Math.max(0, totalLines - viewHeight));
    });
    (0, vitest_1.it)("scrollToTop resets to 0", () => {
        const state = makeLargeState();
        state.scrollOffset = 10;
        (0, plan_overview_js_1.scrollToTop)(state);
        (0, vitest_1.expect)(state.scrollOffset).toBe(0);
    });
    (0, vitest_1.it)("scrollToBottom jumps to end", () => {
        const state = makeLargeState();
        const viewHeight = 5;
        (0, plan_overview_js_1.scrollToBottom)(state, viewHeight);
        (0, vitest_1.expect)(state.scrollOffset).toBe(Math.max(0, state.displayLines.length - viewHeight));
    });
});
// --- rendering edge cases ---
(0, vitest_1.describe)("plan overview rendering edge cases", () => {
    (0, vitest_1.it)("handles plan with mixed statuses", () => {
        const steps = [
            makeStep({ ticketId: "a", status: "done" }),
            makeStep({ ticketId: "b", status: "in-progress" }),
            makeStep({ ticketId: "c", status: "failed" }),
            makeStep({ ticketId: "d", status: "skipped" }),
            makeStep({ ticketId: "e", status: "ready" }),
            makeStep({ ticketId: "f", status: "blocked", blockedBy: ["e"] }),
        ];
        const plan = makePlan(steps);
        const summary = (0, plan_overview_js_1.computePlanSummary)(plan);
        // ready + blocked should only count exact matches
        (0, vitest_1.expect)(summary.readyCount).toBe(1);
        (0, vitest_1.expect)(summary.blockedCount).toBe(1);
        // Other 4 are done/in-progress/failed/skipped
        const other = summary.totalSteps - summary.readyCount - summary.blockedCount;
        (0, vitest_1.expect)(other).toBe(4);
    });
    (0, vitest_1.it)("handles plan with all steps done", () => {
        const steps = [
            makeStep({ ticketId: "a", status: "done" }),
            makeStep({ ticketId: "b", status: "done" }),
        ];
        const plan = makePlan(steps, { status: "done" });
        const summary = (0, plan_overview_js_1.computePlanSummary)(plan);
        (0, vitest_1.expect)(summary.readyCount).toBe(0);
        (0, vitest_1.expect)(summary.blockedCount).toBe(0);
    });
    (0, vitest_1.it)("includes plan ID in display lines", () => {
        const plan = makePlan([makeStep()], { id: "plan-xyz-full-uuid" });
        const state = (0, plan_overview_js_1.createPlanOverviewState)(plan);
        const hasId = state.displayLines.some((l) => l.includes("plan-xyz"));
        (0, vitest_1.expect)(hasId).toBe(true);
    });
});
//# sourceMappingURL=plan-overview.test.js.map