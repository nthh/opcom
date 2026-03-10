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
    simulateWrite(sessionId) {
        this.emit("agent_event", {
            sessionId,
            event: {
                type: "tool_end",
                sessionId,
                timestamp: new Date().toISOString(),
                data: { toolName: "Edit", toolSuccess: true },
            },
        });
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
    contextPacketToMarkdown: vitest_1.vi.fn(() => "# Test context"),
}));
const mockCommitStepChanges = vitest_1.vi.fn(async () => true);
const mockCaptureChangeset = vitest_1.vi.fn(async () => null);
vitest_1.vi.mock("../../packages/core/src/orchestrator/git-ops.js", () => ({
    commitStepChanges: (...args) => mockCommitStepChanges(...args),
    captureChangeset: (...args) => mockCaptureChangeset(...args),
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
        runTests: false,
        runOracle: false,
    })),
}));
// Mock worktree manager
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
vitest_1.vi.mock("../../packages/core/src/skills/oracle.js", () => ({
    collectOracleInputs: vitest_1.vi.fn(async () => ({})),
    formatOraclePrompt: vitest_1.vi.fn(() => "oracle prompt"),
    parseOracleResponse: vitest_1.vi.fn(() => ({ passed: true, criteria: [], concerns: [] })),
}));
vitest_1.vi.mock("../../packages/core/src/graph/graph-service.js", () => ({
    queryGraphContext: vitest_1.vi.fn(() => null),
    ingestTestResults: vitest_1.vi.fn(),
}));
const mockUpdateProjectSummary = vitest_1.vi.fn(async () => { });
vitest_1.vi.mock("../../packages/core/src/config/summary.js", () => ({
    readProjectSummary: vitest_1.vi.fn(async () => null),
    writeProjectSummary: vitest_1.vi.fn(async () => { }),
    updateProjectSummary: (...args) => mockUpdateProjectSummary(...args),
    createInitialSummaryFromDescription: vitest_1.vi.fn(() => ""),
}));
// Mock smoke test — this is the key mock for these tests
const mockRunSmoke = vitest_1.vi.fn();
vitest_1.vi.mock("../../packages/core/src/orchestrator/smoke-test.js", () => ({
    runSmoke: (...args) => mockRunSmoke(...args),
}));
function makePlan(steps, configOverrides) {
    return {
        id: "test-plan",
        name: "Test Plan",
        status: "planning",
        scope: {},
        steps,
        config: { ...(0, persistence_js_1.defaultConfig)(), worktree: true, verification: { runTests: false, runOracle: false }, ...configOverrides },
        context: "",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
    };
}
function makeStagedPlan(steps, stages, configOverrides) {
    return {
        ...makePlan(steps, configOverrides),
        stages,
        currentStage: 0,
    };
}
(0, vitest_1.describe)("Executor smoke tests — plan completion", () => {
    let mockSM;
    (0, vitest_1.beforeEach)(() => {
        mockSM = new MockSessionManager();
        vitest_1.vi.clearAllMocks();
        mockHasCommits.mockResolvedValue(true);
        mockMerge.mockResolvedValue({ merged: true, conflict: false });
    });
    (0, vitest_1.it)("runs final smoke test when plan completes", async () => {
        mockRunSmoke.mockResolvedValue({
            passed: true,
            buildPassed: true,
            testsPassed: true,
            buildOutput: "Build OK",
            testOutput: "Tests OK",
            durationMs: 3000,
        });
        const plan = makePlan([
            { ticketId: "t1", projectId: "p", status: "ready", blockedBy: [] },
        ]);
        const planEvents = [];
        const mockEventStore = {
            insertPlanEvent: (planId, eventType, opts) => {
                planEvents.push({ planId, eventType, opts });
            },
            insertChangeset: vitest_1.vi.fn(),
        };
        const executor = new executor_js_1.Executor(plan, mockSM, mockEventStore);
        const smokeEvents = [];
        executor.on("smoke_test", (data) => smokeEvents.push(data));
        const runPromise = executor.run();
        await new Promise((r) => setTimeout(r, 50));
        // Complete the step
        const sessionId = plan.steps[0].agentSessionId;
        mockSM.simulateWrite(sessionId);
        mockSM.simulateCompletion(sessionId);
        await new Promise((r) => setTimeout(r, 200));
        const currentPlan = executor.getPlan();
        (0, vitest_1.expect)(currentPlan.status).toBe("done");
        (0, vitest_1.expect)(mockRunSmoke).toHaveBeenCalled();
        (0, vitest_1.expect)(currentPlan.smokeTestResult).toBeDefined();
        (0, vitest_1.expect)(currentPlan.smokeTestResult.passed).toBe(true);
        // Smoke test event emitted
        (0, vitest_1.expect)(smokeEvents).toHaveLength(1);
        (0, vitest_1.expect)(smokeEvents[0].trigger).toBe("plan_completion");
        // Event store logged
        (0, vitest_1.expect)(planEvents.some((e) => e.eventType === "smoke_test")).toBe(true);
        executor.stop();
        await runPromise;
    });
    (0, vitest_1.it)("includes smoke test result in plan_completed event detail", async () => {
        mockRunSmoke.mockResolvedValue({
            passed: false,
            buildPassed: true,
            testsPassed: false,
            buildOutput: "Build OK",
            testOutput: "FAIL some.test.ts",
            durationMs: 5000,
        });
        const plan = makePlan([
            { ticketId: "t1", projectId: "p", status: "ready", blockedBy: [] },
        ]);
        const planEvents = [];
        const mockEventStore = {
            insertPlanEvent: (planId, eventType, opts) => {
                planEvents.push({ planId, eventType, opts });
            },
            insertChangeset: vitest_1.vi.fn(),
        };
        const executor = new executor_js_1.Executor(plan, mockSM, mockEventStore);
        const runPromise = executor.run();
        await new Promise((r) => setTimeout(r, 50));
        const sessionId = plan.steps[0].agentSessionId;
        mockSM.simulateWrite(sessionId);
        mockSM.simulateCompletion(sessionId);
        await new Promise((r) => setTimeout(r, 200));
        // Plan still completes (smoke test is non-fatal at plan completion)
        const currentPlan = executor.getPlan();
        (0, vitest_1.expect)(currentPlan.status).toBe("done");
        (0, vitest_1.expect)(currentPlan.smokeTestResult).toBeDefined();
        (0, vitest_1.expect)(currentPlan.smokeTestResult.passed).toBe(false);
        (0, vitest_1.expect)(currentPlan.smokeTestResult.testsPassed).toBe(false);
        // plan_completed event includes smoke test detail
        const completedEvent = planEvents.find((e) => e.eventType === "plan_completed");
        (0, vitest_1.expect)(completedEvent).toBeDefined();
        const detail = completedEvent.opts.detail;
        (0, vitest_1.expect)(detail.smokeTest).toBeDefined();
        executor.stop();
        await runPromise;
    });
});
(0, vitest_1.describe)("Executor smoke tests — stage completion", () => {
    let mockSM;
    (0, vitest_1.beforeEach)(() => {
        mockSM = new MockSessionManager();
        vitest_1.vi.clearAllMocks();
        mockHasCommits.mockResolvedValue(true);
        mockMerge.mockResolvedValue({ merged: true, conflict: false });
    });
    (0, vitest_1.it)("runs smoke test after stage completes", async () => {
        mockRunSmoke.mockResolvedValue({
            passed: true,
            buildPassed: true,
            testsPassed: true,
            buildOutput: "Build OK",
            testOutput: "Tests OK",
            durationMs: 2000,
        });
        const plan = makeStagedPlan([
            { ticketId: "t1", projectId: "p", status: "ready", blockedBy: [] },
            { ticketId: "t2", projectId: "p", status: "blocked", blockedBy: ["t1"] },
        ], [
            { index: 0, stepTicketIds: ["t1"], status: "executing", startedAt: new Date().toISOString() },
            { index: 1, stepTicketIds: ["t2"], status: "pending" },
        ], { autoContinue: true });
        const smokeEvents = [];
        const executor = new executor_js_1.Executor(plan, mockSM);
        executor.on("smoke_test", (data) => smokeEvents.push(data));
        const runPromise = executor.run();
        await new Promise((r) => setTimeout(r, 50));
        // Complete t1 (stage 0)
        const sessionId = plan.steps[0].agentSessionId;
        mockSM.simulateWrite(sessionId);
        mockSM.simulateCompletion(sessionId);
        await new Promise((r) => setTimeout(r, 200));
        // Smoke test should have been called for stage 0
        (0, vitest_1.expect)(smokeEvents.some((e) => e.trigger === "stage" && e.stageIndex === 0)).toBe(true);
        // Stage 0 summary should have smoke test result
        (0, vitest_1.expect)(plan.stages[0].summary?.smokeTest).toBeDefined();
        (0, vitest_1.expect)(plan.stages[0].summary?.smokeTest?.passed).toBe(true);
        executor.stop();
        await runPromise;
    });
    (0, vitest_1.it)("pauses plan when smoke test fails after stage", async () => {
        mockRunSmoke.mockResolvedValue({
            passed: false,
            buildPassed: false,
            testsPassed: false,
            buildOutput: "error TS2322: type mismatch",
            testOutput: "",
            durationMs: 1500,
        });
        const plan = makeStagedPlan([
            { ticketId: "t1", projectId: "p", status: "ready", blockedBy: [] },
            { ticketId: "t2", projectId: "p", status: "blocked", blockedBy: ["t1"] },
        ], [
            { index: 0, stepTicketIds: ["t1"], status: "executing", startedAt: new Date().toISOString() },
            { index: 1, stepTicketIds: ["t2"], status: "pending" },
        ], { autoContinue: true });
        let paused = false;
        const executor = new executor_js_1.Executor(plan, mockSM);
        executor.on("plan_paused", () => { paused = true; });
        const runPromise = executor.run();
        await new Promise((r) => setTimeout(r, 50));
        // Complete t1
        const sessionId = plan.steps[0].agentSessionId;
        mockSM.simulateWrite(sessionId);
        mockSM.simulateCompletion(sessionId);
        await new Promise((r) => setTimeout(r, 200));
        // Plan should be paused because smoke test failed
        (0, vitest_1.expect)(paused).toBe(true);
        (0, vitest_1.expect)(executor.getPlan().status).toBe("paused");
        // Stage 1 should NOT have started
        (0, vitest_1.expect)(executor.getPlan().stages[1].status).toBe("pending");
        executor.stop();
        await runPromise;
    });
    (0, vitest_1.it)("reports build failure distinctly from test failure in pause reason", async () => {
        // Test failure (build passes, tests fail)
        mockRunSmoke.mockResolvedValue({
            passed: false,
            buildPassed: true,
            testsPassed: false,
            buildOutput: "Build OK",
            testOutput: "FAIL src/utils.test.ts",
            durationMs: 3000,
        });
        const planEvents = [];
        const mockEventStore = {
            insertPlanEvent: (planId, eventType, opts) => {
                planEvents.push({ planId, eventType, opts });
            },
            insertChangeset: vitest_1.vi.fn(),
        };
        const plan = makeStagedPlan([
            { ticketId: "t1", projectId: "p", status: "ready", blockedBy: [] },
            { ticketId: "t2", projectId: "p", status: "blocked", blockedBy: ["t1"] },
        ], [
            { index: 0, stepTicketIds: ["t1"], status: "executing", startedAt: new Date().toISOString() },
            { index: 1, stepTicketIds: ["t2"], status: "pending" },
        ], { autoContinue: true });
        const executor = new executor_js_1.Executor(plan, mockSM, mockEventStore);
        const runPromise = executor.run();
        await new Promise((r) => setTimeout(r, 50));
        const sessionId = plan.steps[0].agentSessionId;
        mockSM.simulateWrite(sessionId);
        mockSM.simulateCompletion(sessionId);
        await new Promise((r) => setTimeout(r, 200));
        // Should have a plan_paused event with test failure reason
        const pausedEvent = planEvents.find((e) => e.eventType === "plan_paused");
        (0, vitest_1.expect)(pausedEvent).toBeDefined();
        const detail = pausedEvent.opts.detail;
        (0, vitest_1.expect)(detail.reason).toContain("tests failed");
        executor.stop();
        await runPromise;
    });
    (0, vitest_1.it)("stores smoke test results in event store", async () => {
        mockRunSmoke.mockResolvedValue({
            passed: true,
            buildPassed: true,
            testsPassed: true,
            buildOutput: "OK",
            testOutput: "OK",
            durationMs: 1000,
        });
        const planEvents = [];
        const mockEventStore = {
            insertPlanEvent: (planId, eventType, opts) => {
                planEvents.push({ planId, eventType, opts });
            },
            insertChangeset: vitest_1.vi.fn(),
        };
        const plan = makeStagedPlan([
            { ticketId: "t1", projectId: "p", status: "ready", blockedBy: [] },
        ], [
            { index: 0, stepTicketIds: ["t1"], status: "executing", startedAt: new Date().toISOString() },
        ]);
        const executor = new executor_js_1.Executor(plan, mockSM, mockEventStore);
        const runPromise = executor.run();
        await new Promise((r) => setTimeout(r, 50));
        const sessionId = plan.steps[0].agentSessionId;
        mockSM.simulateWrite(sessionId);
        mockSM.simulateCompletion(sessionId);
        await new Promise((r) => setTimeout(r, 200));
        // smoke_test events should be in the event store
        const smokeEvents = planEvents.filter((e) => e.eventType === "smoke_test");
        (0, vitest_1.expect)(smokeEvents.length).toBeGreaterThanOrEqual(1);
        // Verify structure
        const smokeEvent = smokeEvents[0];
        const detail = smokeEvent.opts.detail;
        (0, vitest_1.expect)(detail.result).toBeDefined();
        (0, vitest_1.expect)(detail.result.passed).toBe(true);
        executor.stop();
        await runPromise;
    });
});
(0, vitest_1.describe)("Executor smoke tests — non-staged plans", () => {
    let mockSM;
    (0, vitest_1.beforeEach)(() => {
        mockSM = new MockSessionManager();
        vitest_1.vi.clearAllMocks();
        mockHasCommits.mockResolvedValue(true);
        mockMerge.mockResolvedValue({ merged: true, conflict: false });
    });
    (0, vitest_1.it)("runs final smoke test on plan completion even without stages", async () => {
        mockRunSmoke.mockResolvedValue({
            passed: true,
            buildPassed: true,
            testsPassed: true,
            buildOutput: "Build OK",
            testOutput: "Tests OK",
            durationMs: 2000,
        });
        const plan = makePlan([
            { ticketId: "t1", projectId: "p", status: "ready", blockedBy: [] },
            { ticketId: "t2", projectId: "p", status: "ready", blockedBy: [] },
        ], { maxConcurrentAgents: 2 });
        const executor = new executor_js_1.Executor(plan, mockSM);
        const runPromise = executor.run();
        await new Promise((r) => setTimeout(r, 50));
        // Complete both steps
        for (const step of plan.steps) {
            const sid = step.agentSessionId;
            mockSM.simulateWrite(sid);
            mockSM.simulateCompletion(sid);
        }
        await new Promise((r) => setTimeout(r, 200));
        const currentPlan = executor.getPlan();
        (0, vitest_1.expect)(currentPlan.status).toBe("done");
        (0, vitest_1.expect)(mockRunSmoke).toHaveBeenCalled();
        (0, vitest_1.expect)(currentPlan.smokeTestResult).toBeDefined();
        (0, vitest_1.expect)(currentPlan.smokeTestResult.passed).toBe(true);
        executor.stop();
        await runPromise;
    });
});
(0, vitest_1.describe)("Executor — project summary updates", () => {
    let mockSM;
    (0, vitest_1.beforeEach)(() => {
        mockSM = new MockSessionManager();
        vitest_1.vi.clearAllMocks();
        mockHasCommits.mockResolvedValue(true);
        mockMerge.mockResolvedValue({ merged: true, conflict: false });
    });
    (0, vitest_1.it)("calls updateProjectSummary after step completion", async () => {
        const plan = makePlan([
            { ticketId: "t1", projectId: "p", status: "ready", blockedBy: [] },
        ]);
        const executor = new executor_js_1.Executor(plan, mockSM);
        const runPromise = executor.run();
        await new Promise((r) => setTimeout(r, 50));
        const sessionId = plan.steps[0].agentSessionId;
        mockSM.simulateWrite(sessionId);
        mockSM.simulateCompletion(sessionId);
        await new Promise((r) => setTimeout(r, 200));
        (0, vitest_1.expect)(mockUpdateProjectSummary).toHaveBeenCalledWith("p", "p", vitest_1.expect.objectContaining({
            completedTicketId: "t1",
        }));
        executor.stop();
        await runPromise;
    });
    (0, vitest_1.it)("calls updateProjectSummary for each step in multi-step plan", async () => {
        const plan = makePlan([
            { ticketId: "t1", projectId: "p", status: "ready", blockedBy: [] },
            { ticketId: "t2", projectId: "p", status: "ready", blockedBy: [] },
        ], { maxConcurrentAgents: 2 });
        const executor = new executor_js_1.Executor(plan, mockSM);
        const runPromise = executor.run();
        await new Promise((r) => setTimeout(r, 50));
        for (const step of plan.steps) {
            const sid = step.agentSessionId;
            mockSM.simulateWrite(sid);
            mockSM.simulateCompletion(sid);
        }
        await new Promise((r) => setTimeout(r, 200));
        (0, vitest_1.expect)(mockUpdateProjectSummary).toHaveBeenCalledTimes(2);
        (0, vitest_1.expect)(mockUpdateProjectSummary).toHaveBeenCalledWith("p", "p", vitest_1.expect.objectContaining({ completedTicketId: "t1" }));
        (0, vitest_1.expect)(mockUpdateProjectSummary).toHaveBeenCalledWith("p", "p", vitest_1.expect.objectContaining({ completedTicketId: "t2" }));
        executor.stop();
        await runPromise;
    });
});
//# sourceMappingURL=executor-smoke-test.test.js.map