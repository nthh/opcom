"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const executor_js_1 = require("../../packages/core/src/orchestrator/executor.js");
const persistence_js_1 = require("../../packages/core/src/orchestrator/persistence.js");
class MockSessionManager {
    listeners = new Map();
    startCalls = [];
    stopCalls = [];
    sessionCounter = 0;
    getSession(_id) { return undefined; }
    on(event, handler) {
        if (!this.listeners.has(event))
            this.listeners.set(event, new Set());
        this.listeners.get(event).add(handler);
    }
    off(event, handler) {
        this.listeners.get(event)?.delete(handler);
    }
    emit(event, data) {
        const handlers = this.listeners.get(event);
        if (handlers) {
            for (const h of handlers)
                h(data);
        }
    }
    async startSession(projectId, backend, config, workItemId) {
        this.startCalls.push({ projectId, backend, config, ticketId: workItemId });
        const id = `session-${++this.sessionCounter}`;
        return {
            id,
            backend: backend,
            projectId,
            state: "streaming",
            startedAt: new Date().toISOString(),
            workItemId,
        };
    }
    async stopSession(sessionId) {
        this.stopCalls.push(sessionId);
    }
    simulateCompletion(sessionId) {
        const session = {
            id: sessionId,
            backend: "claude-code",
            projectId: "p",
            state: "stopped",
            startedAt: new Date().toISOString(),
            stoppedAt: new Date().toISOString(),
        };
        this.emit("session_stopped", session);
    }
}
// Mock dependencies
vitest_1.vi.mock("../../packages/core/src/orchestrator/persistence.js", async (importOriginal) => {
    const mod = await importOriginal();
    return {
        ...mod,
        savePlan: vitest_1.vi.fn(async () => { }),
        savePlanContext: vitest_1.vi.fn(async () => { }),
    };
});
vitest_1.vi.mock("../../packages/core/src/config/loader.js", () => ({
    loadProject: vitest_1.vi.fn(async (id) => ({
        id,
        name: id,
        path: `/tmp/test-${id}`,
        stack: { languages: [], frameworks: [], packageManagers: [{ name: "npm", sourceFile: "package-lock.json" }], infrastructure: [], versionManagers: [] },
        testing: { framework: "vitest", command: "npm test" },
        linting: [{ name: "eslint", sourceFile: ".eslintrc.json" }],
        services: [],
        docs: { agentConfig: null },
        git: { branch: "main", remote: null, clean: true },
    })),
}));
vitest_1.vi.mock("../../packages/core/src/detection/tickets.js", () => ({
    scanTickets: vitest_1.vi.fn(async () => []),
}));
vitest_1.vi.mock("../../packages/core/src/agents/context-builder.js", () => ({
    buildContextPacket: vitest_1.vi.fn(async () => ({
        project: { name: "test", path: "/tmp", stack: {}, testing: null, linting: [], services: [] },
        git: { branch: "main", remote: null, clean: true },
    })),
    contextPacketToMarkdown: vitest_1.vi.fn((...args) => {
        // Capture stallWarning argument (5th parameter)
        const stallWarning = args[4];
        if (stallWarning)
            return `# Test context\n${stallWarning}`;
        return "# Test context";
    }),
}));
vitest_1.vi.mock("../../packages/core/src/orchestrator/git-ops.js", () => ({
    commitStepChanges: vitest_1.vi.fn(async () => true),
    captureChangeset: vitest_1.vi.fn(async () => null),
}));
vitest_1.vi.mock("../../packages/core/src/config/roles.js", () => ({
    loadRole: vitest_1.vi.fn(async () => ({ id: "engineer", name: "Engineer" })),
    resolveRoleConfig: vitest_1.vi.fn((_roleDef, stackPatterns, planConfig) => ({
        name: "Engineer",
        permissionMode: "acceptEdits",
        allowedTools: [],
        disallowedTools: ["EnterPlanMode", "ExitPlanMode", "EnterWorktree"],
        allowedBashPatterns: [...(stackPatterns ?? []), ...(planConfig?.allowedBashPatterns ?? [])],
        instructions: "",
        doneCriteria: "",
        runTests: true,
        runOracle: false,
    })),
}));
vitest_1.vi.mock("../../packages/core/src/orchestrator/smoke-test.js", () => ({
    runSmoke: vitest_1.vi.fn(async () => ({ passed: true, buildPassed: true, testsPassed: true, buildOutput: "", testOutput: "", durationMs: 0 })),
}));
const mockHasCommits = vitest_1.vi.fn(async () => true);
const mockMerge = vitest_1.vi.fn(async () => ({ merged: true, conflict: false }));
const mockCreate = vitest_1.vi.fn(async (_projectPath, ticketId) => ({
    worktreePath: `/tmp/worktree-${ticketId}`,
    branch: `opcom/${ticketId}`,
}));
const mockRemove = vitest_1.vi.fn(async () => { });
const mockWriteLock = vitest_1.vi.fn(async () => { });
vitest_1.vi.mock("../../packages/core/src/orchestrator/worktree.js", () => {
    return {
        WorktreeManager: vitest_1.vi.fn().mockImplementation(() => ({
            create: mockCreate,
            remove: mockRemove,
            hasCommits: mockHasCommits,
            merge: mockMerge,
            attemptRebase: vitest_1.vi.fn(async () => ({ rebased: false, conflict: false, error: "not implemented" })),
            getInfo: vitest_1.vi.fn(),
            restore: vitest_1.vi.fn(),
            writeLock: mockWriteLock,
        })),
    };
});
vitest_1.vi.mock("../../packages/core/src/agents/allowed-bash.js", () => ({
    deriveAllowedBashTools: vitest_1.vi.fn(() => []),
}));
vitest_1.vi.mock("../../packages/core/src/graph/graph-service.js", () => ({
    ingestTestResults: vitest_1.vi.fn(),
    queryGraphContext: vitest_1.vi.fn(() => null),
}));
function makePlan(steps, configOverrides) {
    return {
        id: "test-plan",
        name: "Test Plan",
        status: "executing",
        scope: {},
        steps,
        config: { ...(0, persistence_js_1.defaultConfig)(), worktree: true, ...configOverrides },
        context: "",
        createdAt: "2026-03-01T00:00:00Z",
        updatedAt: "2026-03-01T00:00:00Z",
    };
}
(0, vitest_1.describe)("Executor stall detection", () => {
    let sm;
    (0, vitest_1.beforeEach)(() => {
        sm = new MockSessionManager();
        vitest_1.vi.clearAllMocks();
    });
    (0, vitest_1.it)("defaultConfig includes stall config with correct defaults", () => {
        const config = (0, persistence_js_1.defaultConfig)();
        (0, vitest_1.expect)(config.stall).toBeDefined();
        (0, vitest_1.expect)(config.stall.enabled).toBe(true);
        (0, vitest_1.expect)(config.stall.agentTimeoutMs).toBe(20 * 60 * 1000);
        (0, vitest_1.expect)(config.stall.planStallTimeoutMs).toBe(30 * 60 * 1000);
        (0, vitest_1.expect)(config.stall.maxIdenticalFailures).toBe(2);
    });
    (0, vitest_1.it)("executor creates a StallDetector from plan config", () => {
        const plan = makePlan([]);
        const executor = new executor_js_1.Executor(plan, sm);
        const detector = executor.getStallDetector();
        (0, vitest_1.expect)(detector).toBeDefined();
    });
    (0, vitest_1.it)("emits stall_detected when agent exceeds timeout", async () => {
        const step = {
            ticketId: "step-1",
            projectId: "p",
            status: "in-progress",
            blockedBy: [],
            startedAt: new Date(Date.now() - 25 * 60 * 1000).toISOString(), // 25 min ago
            agentSessionId: "sess-old",
        };
        // Use very short timeout to trigger stall immediately
        const plan = makePlan([step], {
            stall: { enabled: true, agentTimeoutMs: 1, planStallTimeoutMs: 999999999, maxIdenticalFailures: 2 },
        });
        const executor = new executor_js_1.Executor(plan, sm);
        const stallSignals = [];
        executor.on("stall_detected", ({ signal }) => stallSignals.push(signal));
        // Manually trigger the stall check (rather than waiting for the interval)
        // Access the private method via the event system
        // @ts-expect-error — testing private method
        await executor.runStallChecks();
        (0, vitest_1.expect)(stallSignals.length).toBe(1);
        (0, vitest_1.expect)(stallSignals[0].type).toBe("long-running");
        (0, vitest_1.expect)(stallSignals[0].stepId).toBe("step-1");
    });
    (0, vitest_1.it)("sets stallSignal on step during stall check", async () => {
        const step = {
            ticketId: "step-1",
            projectId: "p",
            status: "in-progress",
            blockedBy: [],
            startedAt: new Date(Date.now() - 25 * 60 * 1000).toISOString(),
            agentSessionId: "sess-old",
        };
        const plan = makePlan([step], {
            stall: { enabled: true, agentTimeoutMs: 1, planStallTimeoutMs: 999999999, maxIdenticalFailures: 2 },
        });
        const executor = new executor_js_1.Executor(plan, sm);
        // @ts-expect-error — testing private method
        await executor.runStallChecks();
        (0, vitest_1.expect)(step.stallSignal).toBeDefined();
        (0, vitest_1.expect)(step.stallSignal.type).toBe("long-running");
    });
    (0, vitest_1.it)("does not emit stall_detected when stall detection is disabled", async () => {
        const step = {
            ticketId: "step-1",
            projectId: "p",
            status: "in-progress",
            blockedBy: [],
            startedAt: new Date(Date.now() - 25 * 60 * 1000).toISOString(),
        };
        const plan = makePlan([step], {
            stall: { enabled: false, agentTimeoutMs: 1, planStallTimeoutMs: 1, maxIdenticalFailures: 2 },
        });
        const executor = new executor_js_1.Executor(plan, sm);
        const stallSignals = [];
        executor.on("stall_detected", ({ signal }) => stallSignals.push(signal));
        // @ts-expect-error — testing private method
        await executor.runStallChecks();
        (0, vitest_1.expect)(stallSignals.length).toBe(0);
    });
    (0, vitest_1.it)("pauses plan on plan-level stall when pauseOnFailure is true", async () => {
        const step = {
            ticketId: "step-1",
            projectId: "p",
            status: "in-progress",
            blockedBy: [],
            startedAt: new Date().toISOString(),
        };
        const plan = makePlan([step], {
            pauseOnFailure: true,
            stall: { enabled: true, agentTimeoutMs: 999999999, planStallTimeoutMs: 1, maxIdenticalFailures: 2 },
        });
        const executor = new executor_js_1.Executor(plan, sm);
        // Force the plan stall timer to be old
        const detector = executor.getStallDetector();
        // @ts-expect-error — testing private field
        detector.lastStepTransitionAt = Date.now() - 35 * 60 * 1000;
        const pauseEvents = [];
        executor.on("plan_paused", ({ plan: p }) => pauseEvents.push(p));
        // @ts-expect-error — testing private method
        await executor.runStallChecks();
        (0, vitest_1.expect)(plan.status).toBe("paused");
        (0, vitest_1.expect)(pauseEvents.length).toBe(1);
    });
    (0, vitest_1.it)("does not set stallSignal on step that already has one", async () => {
        const existingSignal = {
            type: "long-running",
            stepId: "step-1",
            message: "existing",
            suggestion: "existing",
            durationMs: 1000,
        };
        const step = {
            ticketId: "step-1",
            projectId: "p",
            status: "in-progress",
            blockedBy: [],
            startedAt: new Date(Date.now() - 25 * 60 * 1000).toISOString(),
            stallSignal: existingSignal,
        };
        const plan = makePlan([step], {
            stall: { enabled: true, agentTimeoutMs: 1, planStallTimeoutMs: 999999999, maxIdenticalFailures: 2 },
        });
        const executor = new executor_js_1.Executor(plan, sm);
        // @ts-expect-error — testing private method
        await executor.runStallChecks();
        // Should keep the existing signal, not overwrite
        (0, vitest_1.expect)(step.stallSignal).toBe(existingSignal);
    });
    (0, vitest_1.it)("clears stallSignal when step transitions to in-progress", async () => {
        // Simpler test: verify that startStep clears stallSignal
        const step = {
            ticketId: "step-1",
            projectId: "p",
            status: "ready",
            blockedBy: [],
            stallSignal: {
                type: "long-running",
                stepId: "step-1",
                message: "stalled",
                suggestion: "check",
                durationMs: 1000,
            },
        };
        const plan = makePlan([step], {
            verification: { runTests: false, runOracle: false },
        });
        const executor = new executor_js_1.Executor(plan, sm);
        // Run executor in background
        const runPromise = executor.run();
        // Wait for step to start
        await vitest_1.vi.waitFor(() => {
            (0, vitest_1.expect)(sm.startCalls.length).toBeGreaterThan(0);
        });
        // stallSignal should be cleared when step moved to in-progress
        (0, vitest_1.expect)(step.stallSignal).toBeUndefined();
        (0, vitest_1.expect)(step.status).toBe("in-progress");
        // Cleanup
        executor.stop();
        await runPromise;
    });
    (0, vitest_1.it)("injects stall warning into retry context when failures repeat", async () => {
        const { contextPacketToMarkdown } = await import("../../packages/core/src/agents/context-builder.js");
        const mockFn = vitest_1.vi.mocked(contextPacketToMarkdown);
        const failedVerification = {
            stepTicketId: "step-1",
            passed: false,
            failureReasons: ["Tests failed: 3/10 failed"],
            testGate: {
                passed: false,
                testCommand: "npm test",
                totalTests: 10,
                passedTests: 7,
                failedTests: 3,
                output: "FAIL src/test.ts",
                durationMs: 5000,
            },
        };
        const step = {
            ticketId: "step-1",
            projectId: "p",
            status: "ready",
            blockedBy: [],
            attempt: 2,
            previousVerification: failedVerification,
            verification: failedVerification,
        };
        const plan = makePlan([step], {
            verification: { runTests: false, runOracle: false },
        });
        const executor = new executor_js_1.Executor(plan, sm);
        // Run executor
        const runPromise = executor.run();
        // Wait for step to start
        await vitest_1.vi.waitFor(() => {
            (0, vitest_1.expect)(sm.startCalls.length).toBeGreaterThan(0);
        });
        // Check that contextPacketToMarkdown was called with a stall warning
        const lastCall = mockFn.mock.calls[mockFn.mock.calls.length - 1];
        const stallWarningArg = lastCall[4]; // 5th parameter
        (0, vitest_1.expect)(stallWarningArg).toBeDefined();
        (0, vitest_1.expect)(stallWarningArg).toContain("Stall Warning");
        // Cleanup
        executor.stop();
        await runPromise;
    });
});
//# sourceMappingURL=executor-stall.test.js.map