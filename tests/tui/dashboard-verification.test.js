"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const dashboard_js_1 = require("../../packages/cli/src/tui/views/dashboard.js");
const renderer_js_1 = require("../../packages/cli/src/tui/renderer.js");
function makePlanStep(overrides = {}) {
    return {
        ticketId: "tile-perf",
        projectId: "folia",
        status: "done",
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
        },
        context: "",
        createdAt: "2026-03-01T10:00:00Z",
        updatedAt: "2026-03-01T10:00:00Z",
        ...overrides,
    };
}
function makeVerification(overrides = {}) {
    return {
        stepTicketId: "tile-perf",
        passed: true,
        testGate: {
            passed: true,
            testCommand: "npm test",
            totalTests: 10,
            passedTests: 10,
            failedTests: 0,
            output: "all good",
            durationMs: 1500,
        },
        failureReasons: [],
        ...overrides,
    };
}
(0, vitest_1.describe)("formatStepVerificationBadge", () => {
    (0, vitest_1.it)("returns empty string when no verification", () => {
        const step = makePlanStep({ verification: undefined });
        (0, vitest_1.expect)((0, dashboard_js_1.formatStepVerificationBadge)(step)).toBe("");
    });
    (0, vitest_1.it)("shows pass count for passed test gate", () => {
        const step = makePlanStep({
            verification: makeVerification(),
        });
        const badge = (0, renderer_js_1.stripAnsi)((0, dashboard_js_1.formatStepVerificationBadge)(step));
        (0, vitest_1.expect)(badge).toContain("✓");
        (0, vitest_1.expect)(badge).toContain("10/10");
    });
    (0, vitest_1.it)("shows fail count for failed test gate", () => {
        const step = makePlanStep({
            verification: makeVerification({
                passed: false,
                testGate: {
                    passed: false,
                    testCommand: "npm test",
                    totalTests: 10,
                    passedTests: 7,
                    failedTests: 3,
                    output: "3 failed",
                    durationMs: 2000,
                },
                failureReasons: ["Tests failed"],
            }),
        });
        const badge = (0, renderer_js_1.stripAnsi)((0, dashboard_js_1.formatStepVerificationBadge)(step));
        (0, vitest_1.expect)(badge).toContain("✗");
        (0, vitest_1.expect)(badge).toContain("7/10");
    });
    (0, vitest_1.it)("shows oracle failure when tests pass but oracle fails", () => {
        const step = makePlanStep({
            verification: makeVerification({
                passed: false,
                testGate: {
                    passed: true,
                    testCommand: "npm test",
                    totalTests: 10,
                    passedTests: 10,
                    failedTests: 0,
                    output: "ok",
                    durationMs: 1000,
                },
                oracle: {
                    passed: false,
                    criteria: [{ criterion: "handles edge case", met: false, reasoning: "missing" }],
                    concerns: [],
                },
                failureReasons: ["Oracle failed"],
            }),
        });
        const badge = (0, renderer_js_1.stripAnsi)((0, dashboard_js_1.formatStepVerificationBadge)(step));
        (0, vitest_1.expect)(badge).toContain("✗");
        (0, vitest_1.expect)(badge).toContain("oracle");
    });
    (0, vitest_1.it)("shows verified when passed without test gate", () => {
        const step = makePlanStep({
            verification: makeVerification({
                passed: true,
                testGate: undefined,
            }),
        });
        const badge = (0, renderer_js_1.stripAnsi)((0, dashboard_js_1.formatStepVerificationBadge)(step));
        (0, vitest_1.expect)(badge).toContain("✓");
        (0, vitest_1.expect)(badge).toContain("verified");
    });
});
(0, vitest_1.describe)("plan panel verification stats", () => {
    (0, vitest_1.it)("includes verification counts in plan state", () => {
        const steps = [
            makePlanStep({ ticketId: "a", verification: makeVerification({ passed: true }) }),
            makePlanStep({ ticketId: "b", verification: makeVerification({ passed: false, failureReasons: ["x"] }) }),
            makePlanStep({ ticketId: "c", status: "ready" }),
        ];
        const plan = makePlan(steps);
        const state = (0, dashboard_js_1.createDashboardState)();
        state.planPanel = { plan };
        const verified = plan.steps.filter((s) => s.verification?.passed).length;
        const failed = plan.steps.filter((s) => s.verification && !s.verification.passed).length;
        (0, vitest_1.expect)(verified).toBe(1);
        (0, vitest_1.expect)(failed).toBe(1);
    });
    (0, vitest_1.it)("has zero counts when no steps are verified", () => {
        const steps = [
            makePlanStep({ ticketId: "a", status: "ready" }),
            makePlanStep({ ticketId: "b", status: "blocked" }),
        ];
        const plan = makePlan(steps);
        const verified = plan.steps.filter((s) => s.verification?.passed).length;
        const failed = plan.steps.filter((s) => s.verification && !s.verification.passed).length;
        (0, vitest_1.expect)(verified).toBe(0);
        (0, vitest_1.expect)(failed).toBe(0);
    });
});
//# sourceMappingURL=dashboard-verification.test.js.map