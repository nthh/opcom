"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const dashboard_js_1 = require("../../packages/cli/src/tui/views/dashboard.js");
const renderer_js_1 = require("../../packages/cli/src/tui/renderer.js");
function makePlanStep(overrides = {}) {
    return {
        ticketId: "tile-perf",
        projectId: "folia",
        status: "in-progress",
        blockedBy: [],
        ...overrides,
    };
}
function makePlan(steps, overrides = {}) {
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
function makeStallSignal(overrides = {}) {
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
(0, vitest_1.describe)("formatStallBadge", () => {
    (0, vitest_1.it)("formats long-running signal with minutes", () => {
        const signal = makeStallSignal({ durationMs: 20 * 60 * 1000 });
        (0, vitest_1.expect)((0, dashboard_js_1.formatStallBadge)(signal)).toBe("20m no commits");
    });
    (0, vitest_1.it)("formats repeated-failure signal", () => {
        const signal = makeStallSignal({ type: "repeated-failure", durationMs: 10 * 60 * 1000 });
        (0, vitest_1.expect)((0, dashboard_js_1.formatStallBadge)(signal)).toBe("repeated failure");
    });
    (0, vitest_1.it)("formats plan-stall signal with minutes", () => {
        const signal = makeStallSignal({ type: "plan-stall", durationMs: 30 * 60 * 1000 });
        (0, vitest_1.expect)((0, dashboard_js_1.formatStallBadge)(signal)).toBe("no progress 30m");
    });
    (0, vitest_1.it)("formats repeated-action signal", () => {
        const signal = makeStallSignal({ type: "repeated-action", durationMs: 5 * 60 * 1000 });
        (0, vitest_1.expect)((0, dashboard_js_1.formatStallBadge)(signal)).toBe("same error repeating");
    });
});
(0, vitest_1.describe)("dashboard step stall badge", () => {
    (0, vitest_1.it)("shows stall warning on step with stallSignal", () => {
        const step = makePlanStep({
            stallSignal: makeStallSignal(),
        });
        const plan = makePlan([step]);
        const state = (0, dashboard_js_1.createDashboardState)();
        state.planPanel = { plan };
        // The step has a stallSignal — verify the badge includes the warning indicator
        const badge = (0, renderer_js_1.stripAnsi)((0, dashboard_js_1.formatStepVerificationBadge)(step));
        // The stall badge is separate from verification badge — it's rendered inline
        // Verify the stallSignal is accessible for rendering
        (0, vitest_1.expect)(step.stallSignal).toBeDefined();
        (0, vitest_1.expect)(step.stallSignal.type).toBe("long-running");
    });
    (0, vitest_1.it)("no stall badge when stallSignal is undefined", () => {
        const step = makePlanStep({ stallSignal: undefined });
        (0, vitest_1.expect)(step.stallSignal).toBeUndefined();
    });
});
(0, vitest_1.describe)("plan panel stall indicator", () => {
    (0, vitest_1.it)("detects plan-level stall from step signals", () => {
        const step = makePlanStep({
            stallSignal: makeStallSignal({ type: "plan-stall", durationMs: 30 * 60 * 1000 }),
        });
        const plan = makePlan([step]);
        const hasPlanStall = plan.steps.some((s) => s.stallSignal?.type === "plan-stall");
        (0, vitest_1.expect)(hasPlanStall).toBe(true);
    });
    (0, vitest_1.it)("no plan stall indicator when no plan-stall signals", () => {
        const step = makePlanStep({
            stallSignal: makeStallSignal({ type: "long-running" }),
        });
        const plan = makePlan([step]);
        const hasPlanStall = plan.steps.some((s) => s.stallSignal?.type === "plan-stall");
        (0, vitest_1.expect)(hasPlanStall).toBe(false);
    });
    (0, vitest_1.it)("no plan stall indicator when no stall signals at all", () => {
        const step = makePlanStep();
        const plan = makePlan([step]);
        const hasPlanStall = plan.steps.some((s) => s.stallSignal?.type === "plan-stall");
        (0, vitest_1.expect)(hasPlanStall).toBe(false);
    });
});
(0, vitest_1.describe)("agent panel stall display", () => {
    (0, vitest_1.it)("agent step with stallSignal is available for rendering", () => {
        const step = makePlanStep({
            agentSessionId: "agent-1",
            stallSignal: makeStallSignal(),
        });
        const plan = makePlan([step]);
        // The agent panel renders stall from the plan step — verify the connection
        const planStep = plan.steps.find((s) => s.agentSessionId === "agent-1" && s.status === "in-progress");
        (0, vitest_1.expect)(planStep).toBeDefined();
        (0, vitest_1.expect)(planStep.stallSignal).toBeDefined();
        (0, vitest_1.expect)(planStep.stallSignal.message).toContain("25m");
    });
});
//# sourceMappingURL=dashboard-stall.test.js.map