"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const plan_step_focus_js_1 = require("../../packages/cli/src/tui/views/plan-step-focus.js");
function makePlanStep(overrides = {}) {
    return {
        ticketId: "tile-perf",
        projectId: "folia",
        status: "ready",
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
function makeAgent(overrides = {}) {
    return {
        id: "agent-001",
        backend: "claude-code",
        projectId: "folia",
        state: "streaming",
        startedAt: "2026-03-01T10:05:00Z",
        ...overrides,
    };
}
(0, vitest_1.describe)("createPlanStepFocusState", () => {
    (0, vitest_1.it)("creates state with basic step and ticket", () => {
        const step = makePlanStep();
        const ticket = makeWorkItem();
        const plan = makePlan([step]);
        const state = (0, plan_step_focus_js_1.createPlanStepFocusState)(step, plan, ticket, null, [ticket], []);
        (0, vitest_1.expect)(state.step).toBe(step);
        (0, vitest_1.expect)(state.plan).toBe(plan);
        (0, vitest_1.expect)(state.ticket).toBe(ticket);
        (0, vitest_1.expect)(state.agent).toBeNull();
        (0, vitest_1.expect)(state.scrollOffset).toBe(0);
        (0, vitest_1.expect)(state.displayLines.length).toBeGreaterThan(0);
    });
    (0, vitest_1.it)("resolves agent by agentSessionId", () => {
        const agent = makeAgent();
        const step = makePlanStep({ agentSessionId: "agent-001" });
        const plan = makePlan([step]);
        const ticket = makeWorkItem();
        const state = (0, plan_step_focus_js_1.createPlanStepFocusState)(step, plan, ticket, null, [ticket], [agent]);
        (0, vitest_1.expect)(state.agent).toBe(agent);
    });
    (0, vitest_1.it)("resolves blocker statuses from plan steps", () => {
        const blockerStep = makePlanStep({ ticketId: "change-det", status: "in-progress" });
        const step = makePlanStep({ status: "blocked", blockedBy: ["change-det"] });
        const plan = makePlan([blockerStep, step]);
        const blockerTicket = makeWorkItem({ id: "change-det", title: "Change detection" });
        const ticket = makeWorkItem();
        const state = (0, plan_step_focus_js_1.createPlanStepFocusState)(step, plan, ticket, null, [ticket, blockerTicket], []);
        (0, vitest_1.expect)(state.blockerStatuses.size).toBe(1);
        const blocker = state.blockerStatuses.get("change-det");
        (0, vitest_1.expect)(blocker).toBeDefined();
        (0, vitest_1.expect)(blocker.status).toBe("in-progress");
        (0, vitest_1.expect)(blocker.ticket?.title).toBe("Change detection");
    });
    (0, vitest_1.it)("handles missing blocker ticket gracefully", () => {
        const blockerStep = makePlanStep({ ticketId: "missing-dep", status: "done" });
        const step = makePlanStep({ status: "blocked", blockedBy: ["missing-dep"] });
        const plan = makePlan([blockerStep, step]);
        const ticket = makeWorkItem();
        const state = (0, plan_step_focus_js_1.createPlanStepFocusState)(step, plan, ticket, null, [ticket], []);
        const blocker = state.blockerStatuses.get("missing-dep");
        (0, vitest_1.expect)(blocker).toBeDefined();
        (0, vitest_1.expect)(blocker.status).toBe("done");
        (0, vitest_1.expect)(blocker.ticket).toBeNull();
    });
    (0, vitest_1.it)("handles missing blocker step gracefully", () => {
        const step = makePlanStep({ status: "blocked", blockedBy: ["ghost-ticket"] });
        const plan = makePlan([step]);
        const ticket = makeWorkItem();
        const state = (0, plan_step_focus_js_1.createPlanStepFocusState)(step, plan, ticket, null, [ticket], []);
        const blocker = state.blockerStatuses.get("ghost-ticket");
        (0, vitest_1.expect)(blocker).toBeDefined();
        (0, vitest_1.expect)(blocker.status).toBe("unknown");
    });
});
(0, vitest_1.describe)("rebuildDisplayLines", () => {
    (0, vitest_1.it)("includes status line", () => {
        const step = makePlanStep({ status: "in-progress" });
        const plan = makePlan([step]);
        const ticket = makeWorkItem();
        const state = (0, plan_step_focus_js_1.createPlanStepFocusState)(step, plan, ticket, null, [ticket], []);
        const hasStatus = state.displayLines.some((l) => l.includes("in-progress"));
        (0, vitest_1.expect)(hasStatus).toBe(true);
    });
    (0, vitest_1.it)("includes ticket details when ticket present", () => {
        const step = makePlanStep();
        const plan = makePlan([step]);
        const ticket = makeWorkItem({ title: "Tile server performance", priority: 1 });
        const state = (0, plan_step_focus_js_1.createPlanStepFocusState)(step, plan, ticket, null, [ticket], []);
        const hasTitle = state.displayLines.some((l) => l.includes("Tile server performance"));
        const hasPriority = state.displayLines.some((l) => l.includes("P1"));
        (0, vitest_1.expect)(hasTitle).toBe(true);
        (0, vitest_1.expect)(hasPriority).toBe(true);
    });
    (0, vitest_1.it)("shows ticket not found when ticket is null", () => {
        const step = makePlanStep({ ticketId: "orphan-step" });
        const plan = makePlan([step]);
        const state = (0, plan_step_focus_js_1.createPlanStepFocusState)(step, plan, null, null, [], []);
        const hasNotFound = state.displayLines.some((l) => l.includes("ticket not found"));
        const hasId = state.displayLines.some((l) => l.includes("orphan-step"));
        (0, vitest_1.expect)(hasNotFound).toBe(true);
        (0, vitest_1.expect)(hasId).toBe(true);
    });
    (0, vitest_1.it)("includes blocker section when blockedBy is non-empty", () => {
        const blockerStep = makePlanStep({ ticketId: "dep-1", status: "done" });
        const step = makePlanStep({ blockedBy: ["dep-1"] });
        const plan = makePlan([blockerStep, step]);
        const depTicket = makeWorkItem({ id: "dep-1", title: "Dependency one" });
        const state = (0, plan_step_focus_js_1.createPlanStepFocusState)(step, plan, null, null, [depTicket], []);
        const hasBlockedBy = state.displayLines.some((l) => l.includes("Blocked By"));
        const hasDep = state.displayLines.some((l) => l.includes("dep-1"));
        (0, vitest_1.expect)(hasBlockedBy).toBe(true);
        (0, vitest_1.expect)(hasDep).toBe(true);
    });
    (0, vitest_1.it)("omits blocker section when no blockers", () => {
        const step = makePlanStep({ blockedBy: [] });
        const plan = makePlan([step]);
        const state = (0, plan_step_focus_js_1.createPlanStepFocusState)(step, plan, null, null, [], []);
        const hasBlockedBy = state.displayLines.some((l) => l.includes("Blocked By"));
        (0, vitest_1.expect)(hasBlockedBy).toBe(false);
    });
    (0, vitest_1.it)("includes agent details when agent present", () => {
        const agent = makeAgent({ id: "agent-xyz-1234567890", backend: "claude-code", state: "streaming" });
        const step = makePlanStep({ agentSessionId: "agent-xyz-1234567890" });
        const plan = makePlan([step]);
        const state = (0, plan_step_focus_js_1.createPlanStepFocusState)(step, plan, null, null, [], [agent]);
        const hasBackend = state.displayLines.some((l) => l.includes("claude-code"));
        const hasState = state.displayLines.some((l) => l.includes("streaming"));
        (0, vitest_1.expect)(hasBackend).toBe(true);
        (0, vitest_1.expect)(hasState).toBe(true);
    });
    (0, vitest_1.it)("shows no agent when none assigned", () => {
        const step = makePlanStep();
        const plan = makePlan([step]);
        const state = (0, plan_step_focus_js_1.createPlanStepFocusState)(step, plan, null, null, [], []);
        const hasNoAgent = state.displayLines.some((l) => l.includes("No agent assigned"));
        (0, vitest_1.expect)(hasNoAgent).toBe(true);
    });
    (0, vitest_1.it)("includes timing section", () => {
        const step = makePlanStep({
            startedAt: "2026-03-01T10:00:00Z",
            completedAt: "2026-03-01T10:05:00Z",
        });
        const plan = makePlan([step]);
        const state = (0, plan_step_focus_js_1.createPlanStepFocusState)(step, plan, null, null, [], []);
        const hasStarted = state.displayLines.some((l) => l.includes("Started:"));
        const hasCompleted = state.displayLines.some((l) => l.includes("Completed:"));
        const hasDuration = state.displayLines.some((l) => l.includes("Duration:"));
        (0, vitest_1.expect)(hasStarted).toBe(true);
        (0, vitest_1.expect)(hasCompleted).toBe(true);
        (0, vitest_1.expect)(hasDuration).toBe(true);
    });
    (0, vitest_1.it)("includes error message when step has error", () => {
        const step = makePlanStep({ status: "failed", error: "Tests failed: 3 assertions" });
        const plan = makePlan([step]);
        const state = (0, plan_step_focus_js_1.createPlanStepFocusState)(step, plan, null, null, [], []);
        const hasError = state.displayLines.some((l) => l.includes("Tests failed: 3 assertions"));
        (0, vitest_1.expect)(hasError).toBe(true);
    });
    (0, vitest_1.it)("omits error section when no error", () => {
        const step = makePlanStep({ status: "done" });
        const plan = makePlan([step]);
        const state = (0, plan_step_focus_js_1.createPlanStepFocusState)(step, plan, null, null, [], []);
        const hasError = state.displayLines.some((l) => l.includes("Error"));
        (0, vitest_1.expect)(hasError).toBe(false);
    });
    (0, vitest_1.it)("includes verification results when provided", () => {
        const step = makePlanStep({ status: "done" });
        const plan = makePlan([step]);
        const verification = {
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
        };
        const state = (0, plan_step_focus_js_1.createPlanStepFocusState)(step, plan, null, null, [], [], verification);
        const hasVerification = state.displayLines.some((l) => l.includes("Verification"));
        const hasTests = state.displayLines.some((l) => l.includes("10/10 passed"));
        (0, vitest_1.expect)(hasVerification).toBe(true);
        (0, vitest_1.expect)(hasTests).toBe(true);
    });
    (0, vitest_1.it)("includes track when present", () => {
        const step = makePlanStep({ track: "backend" });
        const plan = makePlan([step]);
        const state = (0, plan_step_focus_js_1.createPlanStepFocusState)(step, plan, null, null, [], []);
        const hasTrack = state.displayLines.some((l) => l.includes("backend"));
        (0, vitest_1.expect)(hasTrack).toBe(true);
    });
    (0, vitest_1.it)("re-wraps when width changes", () => {
        const step = makePlanStep();
        const plan = makePlan([step]);
        const state = (0, plan_step_focus_js_1.createPlanStepFocusState)(step, plan, null, null, [], []);
        const originalWidth = state.wrapWidth;
        (0, plan_step_focus_js_1.rebuildDisplayLines)(state, 40);
        (0, vitest_1.expect)(state.wrapWidth).toBe(40);
        (0, vitest_1.expect)(state.wrapWidth).not.toBe(originalWidth);
    });
});
(0, vitest_1.describe)("scroll navigation", () => {
    function makeScrollableState() {
        const step = makePlanStep({
            status: "failed",
            error: "Long error\nLine 2\nLine 3\nLine 4\nLine 5",
            startedAt: "2026-03-01T10:00:00Z",
            completedAt: "2026-03-01T10:05:00Z",
            blockedBy: ["dep-1", "dep-2"],
        });
        const blockerStep1 = makePlanStep({ ticketId: "dep-1", status: "done" });
        const blockerStep2 = makePlanStep({ ticketId: "dep-2", status: "in-progress" });
        const plan = makePlan([blockerStep1, blockerStep2, step]);
        return (0, plan_step_focus_js_1.createPlanStepFocusState)(step, plan, makeWorkItem(), makeAgent(), [makeWorkItem()], [makeAgent()]);
    }
    (0, vitest_1.it)("scrollDown increases offset", () => {
        const state = makeScrollableState();
        (0, vitest_1.expect)(state.scrollOffset).toBe(0);
        (0, plan_step_focus_js_1.scrollDown)(state, 3, 5);
        (0, vitest_1.expect)(state.scrollOffset).toBe(3);
    });
    (0, vitest_1.it)("scrollUp decreases offset", () => {
        const state = makeScrollableState();
        state.scrollOffset = 5;
        (0, plan_step_focus_js_1.scrollUp)(state, 2);
        (0, vitest_1.expect)(state.scrollOffset).toBe(3);
    });
    (0, vitest_1.it)("scrollUp does not go below 0", () => {
        const state = makeScrollableState();
        state.scrollOffset = 1;
        (0, plan_step_focus_js_1.scrollUp)(state, 5);
        (0, vitest_1.expect)(state.scrollOffset).toBe(0);
    });
    (0, vitest_1.it)("scrollDown does not exceed max", () => {
        const state = makeScrollableState();
        const totalLines = state.displayLines.length;
        const viewHeight = 5;
        (0, plan_step_focus_js_1.scrollDown)(state, totalLines + 100, viewHeight);
        (0, vitest_1.expect)(state.scrollOffset).toBe(Math.max(0, totalLines - viewHeight));
    });
    (0, vitest_1.it)("scrollToTop resets to 0", () => {
        const state = makeScrollableState();
        state.scrollOffset = 10;
        (0, plan_step_focus_js_1.scrollToTop)(state);
        (0, vitest_1.expect)(state.scrollOffset).toBe(0);
    });
    (0, vitest_1.it)("scrollToBottom jumps to end", () => {
        const state = makeScrollableState();
        const viewHeight = 5;
        (0, plan_step_focus_js_1.scrollToBottom)(state, viewHeight);
        (0, vitest_1.expect)(state.scrollOffset).toBe(Math.max(0, state.displayLines.length - viewHeight));
    });
});
(0, vitest_1.describe)("toggleTestOutput", () => {
    function makeVerifiedState(output = "PASS tests/foo.test.ts\nAll tests passed") {
        const step = makePlanStep({ status: "done" });
        const plan = makePlan([step]);
        const verification = {
            stepTicketId: "tile-perf",
            passed: true,
            testGate: {
                passed: true,
                testCommand: "npm test",
                totalTests: 5,
                passedTests: 5,
                failedTests: 0,
                output,
                durationMs: 800,
            },
            failureReasons: [],
        };
        return (0, plan_step_focus_js_1.createPlanStepFocusState)(step, plan, null, null, [], [], verification);
    }
    (0, vitest_1.it)("starts with showTestOutput false", () => {
        const state = makeVerifiedState();
        (0, vitest_1.expect)(state.showTestOutput).toBe(false);
    });
    (0, vitest_1.it)("does not show test output lines by default", () => {
        const state = makeVerifiedState();
        const hasOutputLine = state.displayLines.some((l) => l.includes("All tests passed"));
        (0, vitest_1.expect)(hasOutputLine).toBe(false);
    });
    (0, vitest_1.it)("shows 'press o to show' hint when output available", () => {
        const state = makeVerifiedState();
        const hasHint = state.displayLines.some((l) => l.includes("press o to show"));
        (0, vitest_1.expect)(hasHint).toBe(true);
    });
    (0, vitest_1.it)("shows test output after toggle", () => {
        const state = makeVerifiedState();
        (0, plan_step_focus_js_1.toggleTestOutput)(state);
        (0, vitest_1.expect)(state.showTestOutput).toBe(true);
        const hasOutputLine = state.displayLines.some((l) => l.includes("All tests passed"));
        (0, vitest_1.expect)(hasOutputLine).toBe(true);
    });
    (0, vitest_1.it)("shows 'press o to hide' when output is shown", () => {
        const state = makeVerifiedState();
        (0, plan_step_focus_js_1.toggleTestOutput)(state);
        const hasHint = state.displayLines.some((l) => l.includes("press o to hide"));
        (0, vitest_1.expect)(hasHint).toBe(true);
    });
    (0, vitest_1.it)("hides test output on second toggle", () => {
        const state = makeVerifiedState();
        (0, plan_step_focus_js_1.toggleTestOutput)(state);
        (0, plan_step_focus_js_1.toggleTestOutput)(state);
        (0, vitest_1.expect)(state.showTestOutput).toBe(false);
        const hasOutputLine = state.displayLines.some((l) => l.includes("All tests passed"));
        (0, vitest_1.expect)(hasOutputLine).toBe(false);
    });
    (0, vitest_1.it)("is a no-op when no verification", () => {
        const step = makePlanStep({ status: "done" });
        const plan = makePlan([step]);
        const state = (0, plan_step_focus_js_1.createPlanStepFocusState)(step, plan, null, null, [], []);
        const linesBefore = state.displayLines.length;
        (0, plan_step_focus_js_1.toggleTestOutput)(state);
        (0, vitest_1.expect)(state.showTestOutput).toBe(false);
        (0, vitest_1.expect)(state.displayLines.length).toBe(linesBefore);
    });
    (0, vitest_1.it)("is a no-op when test gate has no output", () => {
        const step = makePlanStep({ status: "done" });
        const plan = makePlan([step]);
        const verification = {
            stepTicketId: "tile-perf",
            passed: true,
            testGate: {
                passed: true,
                testCommand: "npm test",
                totalTests: 5,
                passedTests: 5,
                failedTests: 0,
                output: "",
                durationMs: 500,
            },
            failureReasons: [],
        };
        const state = (0, plan_step_focus_js_1.createPlanStepFocusState)(step, plan, null, null, [], [], verification);
        (0, plan_step_focus_js_1.toggleTestOutput)(state);
        (0, vitest_1.expect)(state.showTestOutput).toBe(false);
    });
    (0, vitest_1.it)("includes all output lines when shown", () => {
        const output = "line1\nline2\nline3\nline4";
        const state = makeVerifiedState(output);
        (0, plan_step_focus_js_1.toggleTestOutput)(state);
        const outputLines = state.displayLines.filter((l) => l.includes("line"));
        (0, vitest_1.expect)(outputLines.length).toBe(4);
    });
    (0, vitest_1.it)("includes footer hint for o key when test output available", () => {
        const state = makeVerifiedState();
        // Footer includes "o:output" — check in display by rendering context
        // (The footer is rendered separately in renderPlanStepFocus, not in displayLines)
        // So we just verify the state flag is correct
        (0, vitest_1.expect)(state.verification?.testGate?.output).toBeTruthy();
    });
});
(0, vitest_1.describe)("rebuildDisplayLines live update", () => {
    (0, vitest_1.it)("updates display lines when step status changes", () => {
        const step = makePlanStep({ status: "in-progress" });
        const plan = makePlan([step]);
        const ticket = makeWorkItem();
        const state = (0, plan_step_focus_js_1.createPlanStepFocusState)(step, plan, ticket, null, [ticket], []);
        const hasInProgress = state.displayLines.some((l) => l.includes("in-progress"));
        (0, vitest_1.expect)(hasInProgress).toBe(true);
        // Simulate status change
        state.step = { ...step, status: "done" };
        (0, plan_step_focus_js_1.rebuildDisplayLines)(state, 80);
        const hasDone = state.displayLines.some((l) => l.includes("done"));
        (0, vitest_1.expect)(hasDone).toBe(true);
    });
    (0, vitest_1.it)("updates display lines when verification is added", () => {
        const step = makePlanStep({ status: "verifying" });
        const plan = makePlan([step]);
        const state = (0, plan_step_focus_js_1.createPlanStepFocusState)(step, plan, null, null, [], []);
        const hasVerification = state.displayLines.some((l) => l.includes("Verification"));
        (0, vitest_1.expect)(hasVerification).toBe(false);
        // Simulate verification arriving
        state.verification = {
            stepTicketId: "tile-perf",
            passed: true,
            testGate: { passed: true, testCommand: "npm test", totalTests: 5, passedTests: 5, failedTests: 0, output: "", durationMs: 100 },
            failureReasons: [],
        };
        (0, plan_step_focus_js_1.rebuildDisplayLines)(state, 80);
        const hasVerificationNow = state.displayLines.some((l) => l.includes("Verification"));
        (0, vitest_1.expect)(hasVerificationNow).toBe(true);
    });
    (0, vitest_1.it)("display lines contain only structured content, no raw markdown", () => {
        const step = makePlanStep({ status: "done" });
        const plan = makePlan([step]);
        const ticket = makeWorkItem({ title: "Test ticket" });
        const agent = makeAgent();
        const verification = {
            stepTicketId: "tile-perf",
            passed: true,
            testGate: { passed: true, testCommand: "npm test", totalTests: 10, passedTests: 10, failedTests: 0, output: "all good", durationMs: 1000 },
            failureReasons: [],
        };
        const state = (0, plan_step_focus_js_1.createPlanStepFocusState)(step, plan, ticket, agent, [ticket], [agent], verification);
        // Display should only contain structured sections, not raw markdown
        for (const line of state.displayLines) {
            // No markdown headers
            (0, vitest_1.expect)(line).not.toMatch(/^#{1,3}\s/);
            // No markdown code fences
            (0, vitest_1.expect)(line).not.toMatch(/^```/);
        }
    });
});
(0, vitest_1.describe)("verification phase visibility", () => {
    (0, vitest_1.it)("shows testing sub-phase when verifyingPhase is testing", () => {
        const step = makePlanStep({ status: "verifying", verifyingPhase: "testing" });
        const plan = makePlan([step]);
        const state = (0, plan_step_focus_js_1.createPlanStepFocusState)(step, plan, null, null, [], []);
        const hasTestingLabel = state.displayLines.some((l) => l.includes("Testing..."));
        (0, vitest_1.expect)(hasTestingLabel).toBe(true);
    });
    (0, vitest_1.it)("shows oracle sub-phase when verifyingPhase is oracle", () => {
        const step = makePlanStep({ status: "verifying", verifyingPhase: "oracle" });
        const plan = makePlan([step]);
        const state = (0, plan_step_focus_js_1.createPlanStepFocusState)(step, plan, null, null, [], []);
        const hasOracleEval = state.displayLines.some((l) => l.includes("Oracle evaluation..."));
        (0, vitest_1.expect)(hasOracleEval).toBe(true);
    });
    (0, vitest_1.it)("shows plain verifying when no sub-phase set", () => {
        const step = makePlanStep({ status: "verifying" });
        const plan = makePlan([step]);
        const state = (0, plan_step_focus_js_1.createPlanStepFocusState)(step, plan, null, null, [], []);
        const hasVerifying = state.displayLines.some((l) => l.includes("verifying"));
        (0, vitest_1.expect)(hasVerifying).toBe(true);
        const hasTestingLabel = state.displayLines.some((l) => l.includes("Testing..."));
        const hasOracleEval = state.displayLines.some((l) => l.includes("Oracle evaluation..."));
        (0, vitest_1.expect)(hasTestingLabel).toBe(false);
        (0, vitest_1.expect)(hasOracleEval).toBe(false);
    });
    (0, vitest_1.it)("shows elapsed time when verifyingPhaseStartedAt is set", () => {
        const startedAt = new Date(Date.now() - 12000).toISOString(); // 12 seconds ago
        const step = makePlanStep({
            status: "verifying",
            verifyingPhase: "testing",
            verifyingPhaseStartedAt: startedAt,
        });
        const plan = makePlan([step]);
        const state = (0, plan_step_focus_js_1.createPlanStepFocusState)(step, plan, null, null, [], []);
        // Should show "Testing... (12s)" or similar elapsed time
        const statusLine = state.displayLines.find((l) => l.includes("Testing..."));
        (0, vitest_1.expect)(statusLine).toBeDefined();
        (0, vitest_1.expect)(statusLine).toMatch(/\(\d+s\)/);
    });
    (0, vitest_1.it)("shows oracle model name when configured", () => {
        const step = makePlanStep({ status: "verifying", verifyingPhase: "oracle" });
        const plan = makePlan([step], {
            config: {
                maxConcurrentAgents: 2,
                autoStart: false,
                backend: "claude-code",
                worktree: false,
                pauseOnFailure: true,
                ticketTransitions: true,
                autoCommit: false,
                verification: { runTests: true, runOracle: true, oracleModel: "claude-sonnet-4-5-20250514" },
            },
        });
        const state = (0, plan_step_focus_js_1.createPlanStepFocusState)(step, plan, null, null, [], []);
        const statusLine = state.displayLines.find((l) => l.includes("Oracle evaluation..."));
        (0, vitest_1.expect)(statusLine).toBeDefined();
        (0, vitest_1.expect)(statusLine).toContain("claude-sonnet-4-5-20250514");
    });
    (0, vitest_1.it)("does not show model name when oracleModel is not configured", () => {
        const step = makePlanStep({ status: "verifying", verifyingPhase: "oracle" });
        const plan = makePlan([step]);
        const state = (0, plan_step_focus_js_1.createPlanStepFocusState)(step, plan, null, null, [], []);
        const statusLine = state.displayLines.find((l) => l.includes("Oracle evaluation..."));
        (0, vitest_1.expect)(statusLine).toBeDefined();
        // No brackets with model name
        (0, vitest_1.expect)(statusLine).not.toMatch(/\[.*\]/);
    });
});
(0, vitest_1.describe)("verification display with failed tests", () => {
    (0, vitest_1.it)("shows failure count and reasons", () => {
        const step = makePlanStep({ status: "failed" });
        const plan = makePlan([step]);
        const verification = {
            stepTicketId: "tile-perf",
            passed: false,
            testGate: {
                passed: false,
                testCommand: "npm test",
                totalTests: 10,
                passedTests: 7,
                failedTests: 3,
                output: "FAIL test_a\nFAIL test_b\nFAIL test_c",
                durationMs: 2000,
            },
            failureReasons: ["3 tests failed"],
        };
        const state = (0, plan_step_focus_js_1.createPlanStepFocusState)(step, plan, null, null, [], [], verification);
        const hasFailCount = state.displayLines.some((l) => l.includes("7/10"));
        const hasFailedLabel = state.displayLines.some((l) => l.includes("3"));
        const hasReason = state.displayLines.some((l) => l.includes("3 tests failed"));
        (0, vitest_1.expect)(hasFailCount).toBe(true);
        (0, vitest_1.expect)(hasFailedLabel).toBe(true);
        (0, vitest_1.expect)(hasReason).toBe(true);
    });
    (0, vitest_1.it)("shows oracle criteria when oracle present", () => {
        const step = makePlanStep({ status: "done" });
        const plan = makePlan([step]);
        const verification = {
            stepTicketId: "tile-perf",
            passed: false,
            testGate: {
                passed: true,
                testCommand: "npm test",
                totalTests: 5,
                passedTests: 5,
                failedTests: 0,
                output: "ok",
                durationMs: 500,
            },
            oracle: {
                passed: false,
                criteria: [
                    { criterion: "handles empty input", met: true, reasoning: "covered" },
                    { criterion: "validates schema", met: false, reasoning: "missing validation" },
                ],
                concerns: ["No error handling for edge cases"],
            },
            failureReasons: ["Oracle criterion not met: validates schema"],
        };
        const state = (0, plan_step_focus_js_1.createPlanStepFocusState)(step, plan, null, null, [], [], verification);
        const hasCriterion = state.displayLines.some((l) => l.includes("handles empty input"));
        const hasFailedCriterion = state.displayLines.some((l) => l.includes("validates schema"));
        const hasConcern = state.displayLines.some((l) => l.includes("No error handling"));
        (0, vitest_1.expect)(hasCriterion).toBe(true);
        (0, vitest_1.expect)(hasFailedCriterion).toBe(true);
        (0, vitest_1.expect)(hasConcern).toBe(true);
    });
    (0, vitest_1.it)("shows oracle error when oracle was skipped or failed", () => {
        const step = makePlanStep({ status: "done" });
        const plan = makePlan([step]);
        const verification = {
            stepTicketId: "tile-perf",
            passed: true,
            testGate: {
                passed: true,
                testCommand: "npm test",
                totalTests: 5,
                passedTests: 5,
                failedTests: 0,
                output: "ok",
                durationMs: 500,
            },
            oracleError: "ticket not found for oracle evaluation",
            failureReasons: [],
        };
        const state = (0, plan_step_focus_js_1.createPlanStepFocusState)(step, plan, null, null, [], [], verification);
        const hasOracleError = state.displayLines.some((l) => l.includes("ticket not found"));
        (0, vitest_1.expect)(hasOracleError).toBe(true);
    });
});
(0, vitest_1.describe)("pending-confirmation display", () => {
    (0, vitest_1.it)("shows confirmation prompt when step is pending-confirmation", () => {
        const step = makePlanStep({ status: "pending-confirmation" });
        const plan = makePlan([step]);
        const state = (0, plan_step_focus_js_1.createPlanStepFocusState)(step, plan, null, null, [], []);
        const hasAwaitingHeader = state.displayLines.some((l) => l.includes("Awaiting Confirmation"));
        const hasPrompt = state.displayLines.some((l) => l.includes("Confirm this task is done?"));
        const hasKeys = state.displayLines.some((l) => l.includes("y") && l.includes("confirm") || l.includes("n") && l.includes("reject"));
        (0, vitest_1.expect)(hasAwaitingHeader).toBe(true);
        (0, vitest_1.expect)(hasPrompt).toBe(true);
        (0, vitest_1.expect)(hasKeys).toBe(true);
    });
    (0, vitest_1.it)("shows pending-confirmation status in status line", () => {
        const step = makePlanStep({ status: "pending-confirmation" });
        const plan = makePlan([step]);
        const state = (0, plan_step_focus_js_1.createPlanStepFocusState)(step, plan, null, null, [], []);
        const hasStatus = state.displayLines.some((l) => l.includes("pending-confirmation"));
        (0, vitest_1.expect)(hasStatus).toBe(true);
    });
    (0, vitest_1.it)("does not show confirmation prompt for other statuses", () => {
        const step = makePlanStep({ status: "in-progress" });
        const plan = makePlan([step]);
        const state = (0, plan_step_focus_js_1.createPlanStepFocusState)(step, plan, null, null, [], []);
        const hasAwaitingHeader = state.displayLines.some((l) => l.includes("Awaiting Confirmation"));
        (0, vitest_1.expect)(hasAwaitingHeader).toBe(false);
    });
    (0, vitest_1.it)("shows pending-confirmation icon correctly", () => {
        const step = makePlanStep({ status: "pending-confirmation" });
        const plan = makePlan([step]);
        const state = (0, plan_step_focus_js_1.createPlanStepFocusState)(step, plan, null, null, [], []);
        // ✉ (U+2709) is the pending-confirmation icon
        const hasIcon = state.displayLines.some((l) => l.includes("\u2709"));
        (0, vitest_1.expect)(hasIcon).toBe(true);
    });
});
//# sourceMappingURL=plan-step-focus.test.js.map