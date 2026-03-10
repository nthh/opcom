"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const plan_step_focus_js_1 = require("../../packages/cli/src/tui/views/plan-step-focus.js");
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
function makeWorkItem(overrides = {}) {
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
(0, vitest_1.describe)("plan step focus stall warning section", () => {
    (0, vitest_1.it)("shows Stall Warning section when stallSignal is present", () => {
        const step = makePlanStep({
            stallSignal: makeStallSignal(),
        });
        const plan = makePlan([step]);
        const ticket = makeWorkItem();
        const state = (0, plan_step_focus_js_1.createPlanStepFocusState)(step, plan, ticket, null, [ticket], []);
        const hasStallWarning = state.displayLines.some((l) => l.includes("Stall Warning"));
        (0, vitest_1.expect)(hasStallWarning).toBe(true);
    });
    (0, vitest_1.it)("shows stall signal type", () => {
        const step = makePlanStep({
            stallSignal: makeStallSignal({ type: "long-running" }),
        });
        const plan = makePlan([step]);
        const state = (0, plan_step_focus_js_1.createPlanStepFocusState)(step, plan, null, null, [], []);
        const hasType = state.displayLines.some((l) => l.includes("long-running"));
        (0, vitest_1.expect)(hasType).toBe(true);
    });
    (0, vitest_1.it)("shows stall signal message", () => {
        const step = makePlanStep({
            stallSignal: makeStallSignal({ message: "Agent has been running for 25m without producing commits" }),
        });
        const plan = makePlan([step]);
        const state = (0, plan_step_focus_js_1.createPlanStepFocusState)(step, plan, null, null, [], []);
        const hasMessage = state.displayLines.some((l) => l.includes("25m without producing commits"));
        (0, vitest_1.expect)(hasMessage).toBe(true);
    });
    (0, vitest_1.it)("shows stall signal suggestion", () => {
        const step = makePlanStep({
            stallSignal: makeStallSignal({ suggestion: "Consider stopping the agent" }),
        });
        const plan = makePlan([step]);
        const state = (0, plan_step_focus_js_1.createPlanStepFocusState)(step, plan, null, null, [], []);
        const hasSuggestion = state.displayLines.some((l) => l.includes("Consider stopping the agent"));
        (0, vitest_1.expect)(hasSuggestion).toBe(true);
    });
    (0, vitest_1.it)("does not show Stall Warning when stallSignal is undefined", () => {
        const step = makePlanStep({ stallSignal: undefined });
        const plan = makePlan([step]);
        const state = (0, plan_step_focus_js_1.createPlanStepFocusState)(step, plan, null, null, [], []);
        const hasStallWarning = state.displayLines.some((l) => l.includes("Stall Warning"));
        (0, vitest_1.expect)(hasStallWarning).toBe(false);
    });
    (0, vitest_1.it)("shows repeated-failure stall signal correctly", () => {
        const step = makePlanStep({
            stallSignal: makeStallSignal({
                type: "repeated-failure",
                message: "Step has failed 3 times with the same error pattern",
                suggestion: "The agent is repeating the same mistake. Consider skipping this step.",
            }),
        });
        const plan = makePlan([step]);
        const state = (0, plan_step_focus_js_1.createPlanStepFocusState)(step, plan, null, null, [], []);
        const hasType = state.displayLines.some((l) => l.includes("repeated-failure"));
        const hasMessage = state.displayLines.some((l) => l.includes("failed 3 times"));
        const hasSuggestion = state.displayLines.some((l) => l.includes("repeating the same mistake"));
        (0, vitest_1.expect)(hasType).toBe(true);
        (0, vitest_1.expect)(hasMessage).toBe(true);
        (0, vitest_1.expect)(hasSuggestion).toBe(true);
    });
    (0, vitest_1.it)("updates stall section when stallSignal changes via rebuild", () => {
        const step = makePlanStep({
            stallSignal: makeStallSignal({ message: "first stall" }),
        });
        const plan = makePlan([step]);
        const state = (0, plan_step_focus_js_1.createPlanStepFocusState)(step, plan, null, null, [], []);
        const hasFirst = state.displayLines.some((l) => l.includes("first stall"));
        (0, vitest_1.expect)(hasFirst).toBe(true);
        // Update signal
        state.step = { ...step, stallSignal: makeStallSignal({ message: "second stall" }) };
        (0, plan_step_focus_js_1.rebuildDisplayLines)(state, 80);
        const hasSecond = state.displayLines.some((l) => l.includes("second stall"));
        (0, vitest_1.expect)(hasSecond).toBe(true);
        const stillHasFirst = state.displayLines.some((l) => l.includes("first stall"));
        (0, vitest_1.expect)(stillHasFirst).toBe(false);
    });
    (0, vitest_1.it)("removes stall section when stallSignal is cleared via rebuild", () => {
        const step = makePlanStep({
            stallSignal: makeStallSignal(),
        });
        const plan = makePlan([step]);
        const state = (0, plan_step_focus_js_1.createPlanStepFocusState)(step, plan, null, null, [], []);
        (0, vitest_1.expect)(state.displayLines.some((l) => l.includes("Stall Warning"))).toBe(true);
        // Clear signal
        state.step = { ...step, stallSignal: undefined };
        (0, plan_step_focus_js_1.rebuildDisplayLines)(state, 80);
        (0, vitest_1.expect)(state.displayLines.some((l) => l.includes("Stall Warning"))).toBe(false);
    });
});
//# sourceMappingURL=plan-step-focus-stall.test.js.map