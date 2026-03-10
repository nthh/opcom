"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const stall_detector_js_1 = require("../../packages/core/src/orchestrator/stall-detector.js");
function makeConfig(overrides = {}) {
    return {
        enabled: true,
        agentTimeoutMs: 20 * 60 * 1000, // 20 min
        planStallTimeoutMs: 30 * 60 * 1000, // 30 min
        maxIdenticalFailures: 2,
        ...overrides,
    };
}
function makeStep(overrides = {}) {
    return {
        ticketId: "test-step",
        projectId: "test-project",
        status: "in-progress",
        blockedBy: [],
        startedAt: new Date().toISOString(),
        ...overrides,
    };
}
function makePlan(steps, status = "executing") {
    return {
        id: "test-plan",
        name: "Test",
        status,
        scope: {},
        steps,
        config: {
            maxConcurrentAgents: 3,
            autoStart: false,
            backend: "claude-code",
            worktree: true,
            pauseOnFailure: true,
            ticketTransitions: true,
            autoCommit: true,
            verification: { runTests: true, runOracle: false },
            stall: makeConfig(),
        },
        context: "",
        createdAt: "2026-03-01T00:00:00Z",
        updatedAt: "2026-03-01T00:00:00Z",
    };
}
function makeVerification(overrides = {}) {
    return {
        stepTicketId: "test-step",
        passed: false,
        failureReasons: ["Tests failed: 3/10 failed"],
        ...overrides,
    };
}
(0, vitest_1.describe)("StallDetector", () => {
    let detector;
    (0, vitest_1.beforeEach)(() => {
        detector = new stall_detector_js_1.StallDetector(makeConfig());
    });
    (0, vitest_1.describe)("checkAgentStall", () => {
        (0, vitest_1.it)("returns null for steps under the timeout threshold", () => {
            const step = makeStep({ startedAt: new Date().toISOString() });
            (0, vitest_1.expect)(detector.checkAgentStall(step)).toBeNull();
        });
        (0, vitest_1.it)("detects an agent running past the timeout", () => {
            const pastTimeout = new Date(Date.now() - 25 * 60 * 1000).toISOString(); // 25 min ago
            const step = makeStep({ startedAt: pastTimeout, agentSessionId: "sess-1" });
            const signal = detector.checkAgentStall(step);
            (0, vitest_1.expect)(signal).not.toBeNull();
            (0, vitest_1.expect)(signal.type).toBe("long-running");
            (0, vitest_1.expect)(signal.stepId).toBe("test-step");
            (0, vitest_1.expect)(signal.sessionId).toBe("sess-1");
            (0, vitest_1.expect)(signal.durationMs).toBeGreaterThan(20 * 60 * 1000);
            (0, vitest_1.expect)(signal.message).toContain("25m");
        });
        (0, vitest_1.it)("returns null for non-in-progress steps", () => {
            const step = makeStep({ status: "done", startedAt: new Date(Date.now() - 25 * 60 * 1000).toISOString() });
            (0, vitest_1.expect)(detector.checkAgentStall(step)).toBeNull();
        });
        (0, vitest_1.it)("returns null when disabled", () => {
            detector = new stall_detector_js_1.StallDetector(makeConfig({ enabled: false }));
            const step = makeStep({ startedAt: new Date(Date.now() - 25 * 60 * 1000).toISOString() });
            (0, vitest_1.expect)(detector.checkAgentStall(step)).toBeNull();
        });
        (0, vitest_1.it)("returns null when step has no startedAt", () => {
            const step = makeStep({ startedAt: undefined });
            (0, vitest_1.expect)(detector.checkAgentStall(step)).toBeNull();
        });
        (0, vitest_1.it)("uses custom timeout from config", () => {
            detector = new stall_detector_js_1.StallDetector(makeConfig({ agentTimeoutMs: 5 * 60 * 1000 })); // 5 min
            const step = makeStep({ startedAt: new Date(Date.now() - 6 * 60 * 1000).toISOString() });
            (0, vitest_1.expect)(detector.checkAgentStall(step)).not.toBeNull();
        });
    });
    (0, vitest_1.describe)("checkStepStall", () => {
        (0, vitest_1.it)("detects repeated identical failures", () => {
            const verification = makeVerification({ failureReasons: ["Tests failed: 3/10 failed"] });
            const step = makeStep({
                attempt: 2,
                previousVerification: verification,
                verification: makeVerification({ failureReasons: ["Tests failed: 3/10 failed"] }),
            });
            const signal = detector.checkStepStall(step);
            (0, vitest_1.expect)(signal).not.toBeNull();
            (0, vitest_1.expect)(signal.type).toBe("repeated-failure");
            (0, vitest_1.expect)(signal.message).toContain("2 times");
        });
        (0, vitest_1.it)("returns null when failures differ", () => {
            const step = makeStep({
                attempt: 2,
                previousVerification: makeVerification({ failureReasons: ["Tests failed: 3/10 failed"] }),
                verification: makeVerification({ failureReasons: ["Oracle: 1 criteria unmet"] }),
            });
            (0, vitest_1.expect)(detector.checkStepStall(step)).toBeNull();
        });
        (0, vitest_1.it)("returns null when previous verification passed", () => {
            const step = makeStep({
                previousVerification: makeVerification({ passed: true }),
                verification: makeVerification({ failureReasons: ["Tests failed: 3/10 failed"] }),
            });
            (0, vitest_1.expect)(detector.checkStepStall(step)).toBeNull();
        });
        (0, vitest_1.it)("returns null when current verification passed", () => {
            const step = makeStep({
                previousVerification: makeVerification({ failureReasons: ["Tests failed: 3/10 failed"] }),
                verification: makeVerification({ passed: true }),
            });
            (0, vitest_1.expect)(detector.checkStepStall(step)).toBeNull();
        });
        (0, vitest_1.it)("returns null when no previous verification", () => {
            const step = makeStep({ verification: makeVerification() });
            (0, vitest_1.expect)(detector.checkStepStall(step)).toBeNull();
        });
        (0, vitest_1.it)("returns null when disabled", () => {
            detector = new stall_detector_js_1.StallDetector(makeConfig({ enabled: false }));
            const step = makeStep({
                attempt: 2,
                previousVerification: makeVerification({ failureReasons: ["Tests failed"] }),
                verification: makeVerification({ failureReasons: ["Tests failed"] }),
            });
            (0, vitest_1.expect)(detector.checkStepStall(step)).toBeNull();
        });
    });
    (0, vitest_1.describe)("checkPlanStall", () => {
        (0, vitest_1.it)("detects plan with no step transitions for too long", () => {
            // Force lastStepTransitionAt to be way in the past
            detector.recordStepTransition();
            // @ts-expect-error — testing private field
            detector.lastStepTransitionAt = Date.now() - 35 * 60 * 1000; // 35 min ago
            const plan = makePlan([
                makeStep({ status: "in-progress" }),
            ]);
            const signal = detector.checkPlanStall(plan);
            (0, vitest_1.expect)(signal).not.toBeNull();
            (0, vitest_1.expect)(signal.type).toBe("plan-stall");
            (0, vitest_1.expect)(signal.message).toContain("35m");
        });
        (0, vitest_1.it)("returns null when transitions are recent", () => {
            detector.recordStepTransition(); // just now
            const plan = makePlan([
                makeStep({ status: "in-progress" }),
            ]);
            (0, vitest_1.expect)(detector.checkPlanStall(plan)).toBeNull();
        });
        (0, vitest_1.it)("returns null when plan is not executing", () => {
            // @ts-expect-error — testing private field
            detector.lastStepTransitionAt = Date.now() - 35 * 60 * 1000;
            const plan = makePlan([makeStep({ status: "in-progress" })], "paused");
            (0, vitest_1.expect)(detector.checkPlanStall(plan)).toBeNull();
        });
        (0, vitest_1.it)("returns null when no active steps", () => {
            // @ts-expect-error — testing private field
            detector.lastStepTransitionAt = Date.now() - 35 * 60 * 1000;
            const plan = makePlan([
                makeStep({ status: "ready" }),
                makeStep({ ticketId: "step-2", status: "blocked" }),
            ]);
            (0, vitest_1.expect)(detector.checkPlanStall(plan)).toBeNull();
        });
        (0, vitest_1.it)("returns null when disabled", () => {
            detector = new stall_detector_js_1.StallDetector(makeConfig({ enabled: false }));
            // @ts-expect-error — testing private field
            detector.lastStepTransitionAt = Date.now() - 35 * 60 * 1000;
            const plan = makePlan([makeStep({ status: "in-progress" })]);
            (0, vitest_1.expect)(detector.checkPlanStall(plan)).toBeNull();
        });
    });
    (0, vitest_1.describe)("checkAll", () => {
        (0, vitest_1.it)("returns all detected signals", () => {
            // @ts-expect-error — testing private field
            detector.lastStepTransitionAt = Date.now() - 35 * 60 * 1000;
            const plan = makePlan([
                makeStep({
                    ticketId: "step-1",
                    status: "in-progress",
                    startedAt: new Date(Date.now() - 25 * 60 * 1000).toISOString(),
                }),
            ]);
            const signals = detector.checkAll(plan);
            (0, vitest_1.expect)(signals.length).toBe(2); // long-running + plan-stall
            (0, vitest_1.expect)(signals.map((s) => s.type)).toContain("long-running");
            (0, vitest_1.expect)(signals.map((s) => s.type)).toContain("plan-stall");
        });
        (0, vitest_1.it)("returns empty when disabled", () => {
            detector = new stall_detector_js_1.StallDetector(makeConfig({ enabled: false }));
            const plan = makePlan([
                makeStep({
                    status: "in-progress",
                    startedAt: new Date(Date.now() - 25 * 60 * 1000).toISOString(),
                }),
            ]);
            (0, vitest_1.expect)(detector.checkAll(plan)).toEqual([]);
        });
        (0, vitest_1.it)("skips non-in-progress steps", () => {
            const plan = makePlan([
                makeStep({ status: "done" }),
                makeStep({ ticketId: "step-2", status: "ready" }),
            ]);
            (0, vitest_1.expect)(detector.checkAll(plan)).toEqual([]);
        });
    });
    (0, vitest_1.describe)("buildStallWarning", () => {
        (0, vitest_1.it)("generates warning for repeated identical failures", () => {
            const verification = makeVerification({
                failureReasons: ["Tests failed: 3/10 failed"],
                testGate: {
                    passed: false,
                    testCommand: "npm test",
                    totalTests: 10,
                    passedTests: 7,
                    failedTests: 3,
                    output: "FAIL src/test.ts\nExpected true, got false",
                    durationMs: 5000,
                },
            });
            const step = makeStep({
                attempt: 3,
                previousVerification: verification,
                verification: makeVerification({
                    failureReasons: ["Tests failed: 3/10 failed"],
                    testGate: verification.testGate,
                }),
            });
            const warning = detector.buildStallWarning(step);
            (0, vitest_1.expect)(warning).not.toBeNull();
            (0, vitest_1.expect)(warning).toContain("Stall Warning");
            (0, vitest_1.expect)(warning).toContain("3 times");
            (0, vitest_1.expect)(warning).toContain("repeating the same mistake");
            (0, vitest_1.expect)(warning).toContain("fundamentally different approach");
        });
        (0, vitest_1.it)("returns null when failures differ", () => {
            const step = makeStep({
                previousVerification: makeVerification({ failureReasons: ["Tests failed: 3/10 failed"] }),
                verification: makeVerification({ failureReasons: ["Oracle: 1 criteria unmet"] }),
            });
            (0, vitest_1.expect)(detector.buildStallWarning(step)).toBeNull();
        });
        (0, vitest_1.it)("returns null when no previous verification", () => {
            const step = makeStep({
                verification: makeVerification(),
            });
            (0, vitest_1.expect)(detector.buildStallWarning(step)).toBeNull();
        });
        (0, vitest_1.it)("returns null when disabled", () => {
            detector = new stall_detector_js_1.StallDetector(makeConfig({ enabled: false }));
            const verification = makeVerification({ failureReasons: ["Tests failed"] });
            const step = makeStep({
                attempt: 2,
                previousVerification: verification,
                verification: makeVerification({ failureReasons: ["Tests failed"] }),
            });
            (0, vitest_1.expect)(detector.buildStallWarning(step)).toBeNull();
        });
    });
    (0, vitest_1.describe)("recordStepTransition", () => {
        (0, vitest_1.it)("resets the plan stall timer", () => {
            // @ts-expect-error — testing private field
            detector.lastStepTransitionAt = Date.now() - 35 * 60 * 1000;
            const plan = makePlan([makeStep({ status: "in-progress" })]);
            (0, vitest_1.expect)(detector.checkPlanStall(plan)).not.toBeNull();
            detector.recordStepTransition();
            (0, vitest_1.expect)(detector.checkPlanStall(plan)).toBeNull();
        });
    });
});
//# sourceMappingURL=stall-detector.test.js.map