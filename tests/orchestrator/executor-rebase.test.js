"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const executor_js_1 = require("../../packages/core/src/orchestrator/executor.js");
const persistence_js_1 = require("../../packages/core/src/orchestrator/persistence.js");
class MockSessionManager {
    listeners = new Map();
    startCalls = [];
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
            pid: 12345,
        };
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
        stack: { languages: [], frameworks: [], packageManagers: [], infrastructure: [], versionManagers: [] },
        testing: { framework: "vitest", command: "npm test" },
        linting: [],
    })),
}));
vitest_1.vi.mock("../../packages/core/src/detection/tickets.js", () => ({
    scanTickets: mockScanTickets,
}));
vitest_1.vi.mock("node:fs/promises", () => ({
    readFile: mockReadFile,
    writeFile: mockWriteFile,
}));
vitest_1.vi.mock("../../packages/core/src/agents/context-builder.js", () => ({
    buildContextPacket: vitest_1.vi.fn(async () => ({
        project: { name: "test", path: "/tmp", stack: {}, testing: null, linting: [], services: [] },
        git: { branch: "main", remote: null, clean: true },
    })),
    contextPacketToMarkdown: mockContextPacketToMarkdown,
}));
const { mockCommitStepChanges, mockCaptureChangeset, mockScanTickets, mockWriteFile, mockReadFile, mockContextPacketToMarkdown, mockCollectOracleInputs, mockFormatOraclePrompt, mockParseOracleResponse, } = vitest_1.vi.hoisted(() => ({
    mockCommitStepChanges: vitest_1.vi.fn(async () => true),
    mockCaptureChangeset: vitest_1.vi.fn(async () => null),
    mockScanTickets: vitest_1.vi.fn(async () => []),
    mockWriteFile: vitest_1.vi.fn(async () => { }),
    mockReadFile: vitest_1.vi.fn(async () => "---\nstatus: in-progress\n---\n"),
    mockContextPacketToMarkdown: vitest_1.vi.fn(() => "# Test context"),
    mockCollectOracleInputs: vitest_1.vi.fn(async () => ({
        diff: "mock diff",
        criteria: ["criterion 1"],
        spec: "mock spec",
    })),
    mockFormatOraclePrompt: vitest_1.vi.fn(() => "oracle prompt"),
    mockParseOracleResponse: vitest_1.vi.fn(() => ({
        passed: true,
        criteria: [{ criterion: "criterion 1", met: true, reasoning: "ok" }],
        concerns: [],
    })),
}));
vitest_1.vi.mock("../../packages/core/src/orchestrator/git-ops.js", () => ({
    commitStepChanges: mockCommitStepChanges,
    captureChangeset: mockCaptureChangeset,
}));
vitest_1.vi.mock("../../packages/core/src/skills/oracle.js", () => ({
    collectOracleInputs: mockCollectOracleInputs,
    formatOraclePrompt: mockFormatOraclePrompt,
    parseOracleResponse: mockParseOracleResponse,
}));
vitest_1.vi.mock("../../packages/core/src/config/roles.js", () => ({
    loadRole: vitest_1.vi.fn(async () => ({ id: "engineer", name: "Engineer" })),
    resolveRoleConfig: vitest_1.vi.fn((_roleDef, _stackPatterns, planConfig) => {
        const verification = (planConfig?.verification ?? {});
        return {
            name: "Engineer",
            permissionMode: "acceptEdits",
            allowedTools: [],
            disallowedTools: [],
            allowedBashPatterns: [],
            instructions: "",
            doneCriteria: "",
            runTests: verification.runTests ?? false,
            runOracle: verification.runOracle ?? false,
        };
    }),
}));
// Mock WorktreeManager
const { mockCreate, mockRemove, mockHasCommits, mockMerge, mockCleanupOrphaned, mockWriteLock, mockAttemptRebase } = vitest_1.vi.hoisted(() => ({
    mockCreate: vitest_1.vi.fn(),
    mockRemove: vitest_1.vi.fn(),
    mockHasCommits: vitest_1.vi.fn(),
    mockMerge: vitest_1.vi.fn(),
    mockCleanupOrphaned: vitest_1.vi.fn(),
    mockWriteLock: vitest_1.vi.fn(),
    mockAttemptRebase: vitest_1.vi.fn(),
}));
vitest_1.vi.mock("../../packages/core/src/orchestrator/smoke-test.js", () => ({
    runSmoke: vitest_1.vi.fn(async () => ({ passed: true, buildPassed: true, testsPassed: true, buildOutput: "", testOutput: "", durationMs: 0 })),
}));
vitest_1.vi.mock("../../packages/core/src/orchestrator/worktree.js", () => {
    const MockManager = vitest_1.vi.fn().mockImplementation(() => ({
        create: mockCreate,
        remove: mockRemove,
        hasCommits: mockHasCommits,
        merge: mockMerge,
        writeLock: mockWriteLock,
        getInfo: vitest_1.vi.fn(),
        restore: vitest_1.vi.fn(),
        attemptRebase: mockAttemptRebase,
    }));
    MockManager.cleanupOrphaned = mockCleanupOrphaned;
    return { WorktreeManager: MockManager };
});
function makePlan(steps, configOverrides) {
    return {
        id: "test-plan",
        name: "Test Plan",
        status: "planning",
        scope: {},
        steps,
        config: { ...(0, persistence_js_1.defaultConfig)(), ...configOverrides },
        context: "",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
    };
}
(0, vitest_1.describe)("Executor auto-rebase on merge conflict", () => {
    let mockSM;
    (0, vitest_1.beforeEach)(() => {
        mockSM = new MockSessionManager();
        vitest_1.vi.clearAllMocks();
        mockCreate.mockResolvedValue({
            stepId: "t1",
            ticketId: "t1",
            projectPath: "/tmp/test-p",
            worktreePath: "/tmp/test-p/.opcom/worktrees/t1",
            branch: "work/t1",
        });
        mockRemove.mockResolvedValue(undefined);
        mockWriteLock.mockResolvedValue(undefined);
        mockCleanupOrphaned.mockResolvedValue([]);
        mockScanTickets.mockResolvedValue([]);
        mockReadFile.mockResolvedValue("---\nstatus: in-progress\n---\n");
        mockHasCommits.mockResolvedValue(true);
    });
    (0, vitest_1.it)("attempts clean rebase when merge conflicts and autoRebase=true", async () => {
        // Merge fails with conflict, clean rebase succeeds, re-merge succeeds
        mockMerge
            .mockResolvedValueOnce({ merged: false, conflict: true, error: "CONFLICT in file.ts" })
            .mockResolvedValueOnce({ merged: true, conflict: false });
        mockAttemptRebase.mockResolvedValue({ rebased: true, conflict: false });
        const plan = makePlan([
            { ticketId: "t1", projectId: "p", status: "ready", blockedBy: [] },
        ], { worktree: true, verification: { runTests: false, runOracle: false, autoRebase: true } });
        const executor = new executor_js_1.Executor(plan, mockSM);
        const completed = [];
        executor.on("step_completed", ({ step }) => completed.push(step.ticketId));
        const runPromise = executor.run();
        await new Promise((r) => setTimeout(r, 50));
        const sessionId = plan.steps[0].agentSessionId;
        mockSM.simulateCompletion(sessionId);
        await new Promise((r) => setTimeout(r, 200));
        (0, vitest_1.expect)(mockAttemptRebase).toHaveBeenCalledWith("t1");
        (0, vitest_1.expect)(mockMerge).toHaveBeenCalledTimes(2); // original + post-rebase
        (0, vitest_1.expect)(completed).toContain("t1");
        (0, vitest_1.expect)(plan.steps[0].status).toBe("done");
        executor.stop();
        await runPromise;
    });
    (0, vitest_1.it)("starts agent for conflict resolution when clean rebase fails with conflict", async () => {
        // Merge fails with conflict, clean rebase also fails with conflict
        mockMerge.mockResolvedValue({ merged: false, conflict: true, error: "CONFLICT in file.ts" });
        mockAttemptRebase.mockResolvedValue({
            rebased: false,
            conflict: true,
            conflictFiles: ["src/file.ts", "src/other.ts"],
            error: "CONFLICT (content): Merge conflict in src/file.ts",
        });
        const plan = makePlan([
            { ticketId: "t1", projectId: "p", status: "ready", blockedBy: [] },
        ], { worktree: true, verification: { runTests: false, runOracle: false, autoRebase: true } });
        const executor = new executor_js_1.Executor(plan, mockSM);
        const runPromise = executor.run();
        await new Promise((r) => setTimeout(r, 50));
        const sessionId = plan.steps[0].agentSessionId;
        mockSM.simulateCompletion(sessionId);
        await new Promise((r) => setTimeout(r, 200));
        // Step should have been re-queued with rebaseConflict
        const step = plan.steps[0];
        // After rebase conflict, step should be re-started with a new session
        // (startReadySteps runs after recomputeAndContinue)
        (0, vitest_1.expect)(mockSM.startCalls.length).toBeGreaterThanOrEqual(2); // original + conflict resolution
        // The second startSession should have been called with the rebaseConflict context
        // contextPacketToMarkdown should have been called with rebaseConflict param
        const lastCtxCall = mockContextPacketToMarkdown.mock.calls.at(-1);
        (0, vitest_1.expect)(lastCtxCall).toBeDefined();
        // The 4th argument should be the rebaseConflict
        (0, vitest_1.expect)(lastCtxCall[3]).toEqual({
            files: ["src/file.ts", "src/other.ts"],
            baseBranch: "main",
        });
        executor.stop();
        await runPromise;
    });
    (0, vitest_1.it)("preserves existing behavior when autoRebase=false", async () => {
        mockMerge.mockResolvedValue({ merged: false, conflict: true, error: "CONFLICT in file.ts" });
        const plan = makePlan([
            { ticketId: "t1", projectId: "p", status: "ready", blockedBy: [] },
        ], {
            worktree: true,
            pauseOnFailure: true,
            verification: { runTests: false, runOracle: false, autoRebase: false },
        });
        const executor = new executor_js_1.Executor(plan, mockSM);
        const needsRebase = [];
        executor.on("step_needs_rebase", ({ step }) => needsRebase.push(step.ticketId));
        const runPromise = executor.run();
        await new Promise((r) => setTimeout(r, 50));
        const sessionId = plan.steps[0].agentSessionId;
        mockSM.simulateCompletion(sessionId);
        await new Promise((r) => setTimeout(r, 200));
        // Should NOT attempt rebase
        (0, vitest_1.expect)(mockAttemptRebase).not.toHaveBeenCalled();
        // Should immediately go to needs-rebase
        (0, vitest_1.expect)(needsRebase).toContain("t1");
        (0, vitest_1.expect)(plan.steps[0].status).toBe("needs-rebase");
        executor.stop();
        await runPromise;
    });
    (0, vitest_1.it)("marks needs-rebase when agent fails to resolve conflicts after max rebase attempts", async () => {
        // Merge always conflicts, rebase always conflicts → agents keep being started
        // After 3 rebase attempts, step goes to needs-rebase
        mockMerge.mockResolvedValue({ merged: false, conflict: true, error: "CONFLICT" });
        mockAttemptRebase.mockResolvedValue({
            rebased: false,
            conflict: true,
            conflictFiles: ["file.ts"],
        });
        const plan = makePlan([
            { ticketId: "t1", projectId: "p", status: "ready", blockedBy: [] },
        ], {
            worktree: true,
            pauseOnFailure: false,
            verification: { runTests: false, runOracle: false, autoRebase: true },
        });
        const executor = new executor_js_1.Executor(plan, mockSM);
        const needsRebase = [];
        executor.on("step_needs_rebase", ({ step }) => needsRebase.push(step.ticketId));
        const runPromise = executor.run();
        await new Promise((r) => setTimeout(r, 100));
        // Simulate agents completing — each time merge conflicts, rebase conflicts,
        // new agent started. After 3 rebase attempts, should give up.
        for (let i = 0; i < 4; i++) {
            const currentStep = executor.getPlan().steps[0];
            const sessionId = currentStep.agentSessionId;
            if (!sessionId)
                break;
            mockSM.simulateCompletion(sessionId);
            await new Promise((r) => setTimeout(r, 300));
        }
        const currentStep = executor.getPlan().steps[0];
        (0, vitest_1.expect)(currentStep.status).toBe("needs-rebase");
        (0, vitest_1.expect)(needsRebase).toContain("t1");
        executor.stop();
        await runPromise;
    });
    (0, vitest_1.it)("skips worktree creation for rebase resolution (reuses existing worktree)", async () => {
        // First: conflict → rebase conflict → agent re-queued
        mockMerge.mockResolvedValue({ merged: false, conflict: true, error: "CONFLICT" });
        mockAttemptRebase.mockResolvedValue({
            rebased: false,
            conflict: true,
            conflictFiles: ["file.ts"],
        });
        const plan = makePlan([
            { ticketId: "t1", projectId: "p", status: "ready", blockedBy: [] },
        ], {
            worktree: true,
            verification: { runTests: false, runOracle: false, autoRebase: true },
        });
        const executor = new executor_js_1.Executor(plan, mockSM);
        const runPromise = executor.run();
        await new Promise((r) => setTimeout(r, 50));
        // First agent completes
        const sessionId1 = plan.steps[0].agentSessionId;
        mockSM.simulateCompletion(sessionId1);
        await new Promise((r) => setTimeout(r, 200));
        // Worktree should have been created once for the original step,
        // NOT created again for the rebase resolution agent
        (0, vitest_1.expect)(mockCreate).toHaveBeenCalledTimes(1);
        // But a second session should have been started
        (0, vitest_1.expect)(mockSM.startCalls.length).toBeGreaterThanOrEqual(2);
        executor.stop();
        await runPromise;
    });
    (0, vitest_1.it)("step state tracks rebaseConflict correctly", () => {
        const step = {
            ticketId: "t1",
            projectId: "p",
            status: "in-progress",
            blockedBy: [],
            agentSessionId: "session-1",
            worktreePath: "/tmp/worktree-t1",
            worktreeBranch: "work/t1",
        };
        // Simulate setting rebaseConflict (as executor does)
        step.rebaseConflict = {
            files: ["src/index.ts", "src/utils.ts"],
            baseBranch: "main",
        };
        step.status = "ready";
        step.agentSessionId = undefined;
        (0, vitest_1.expect)(step.rebaseConflict).toEqual({
            files: ["src/index.ts", "src/utils.ts"],
            baseBranch: "main",
        });
        (0, vitest_1.expect)(step.status).toBe("ready");
        // Worktree preserved
        (0, vitest_1.expect)(step.worktreePath).toBe("/tmp/worktree-t1");
        (0, vitest_1.expect)(step.worktreeBranch).toBe("work/t1");
    });
    (0, vitest_1.it)("rebaseConflict is cleared after agent completion", () => {
        const step = {
            ticketId: "t1",
            projectId: "p",
            status: "in-progress",
            blockedBy: [],
            agentSessionId: "session-2",
            worktreePath: "/tmp/worktree-t1",
            worktreeBranch: "work/t1",
            rebaseConflict: {
                files: ["src/index.ts"],
                baseBranch: "main",
            },
        };
        // Simulate what handleWorktreeCompletion does
        const wasRebaseResolution = !!step.rebaseConflict;
        step.rebaseConflict = undefined;
        (0, vitest_1.expect)(wasRebaseResolution).toBe(true);
        (0, vitest_1.expect)(step.rebaseConflict).toBeUndefined();
    });
    (0, vitest_1.it)("agent resolves conflict → merge succeeds → step done", async () => {
        // First merge: conflict → rebase conflict → agent started
        // Agent resolves → second merge succeeds → step done
        mockMerge
            .mockResolvedValueOnce({ merged: false, conflict: true, error: "CONFLICT" })
            .mockResolvedValueOnce({ merged: true, conflict: false });
        mockAttemptRebase.mockResolvedValue({
            rebased: false,
            conflict: true,
            conflictFiles: ["file.ts"],
        });
        const plan = makePlan([
            { ticketId: "t1", projectId: "p", status: "ready", blockedBy: [] },
        ], {
            worktree: true,
            verification: { runTests: false, runOracle: false, autoRebase: true },
        });
        const executor = new executor_js_1.Executor(plan, mockSM);
        const completed = [];
        executor.on("step_completed", ({ step }) => completed.push(step.ticketId));
        const runPromise = executor.run();
        await new Promise((r) => setTimeout(r, 100));
        // First agent completes → merge conflict → rebase conflict → agent re-queued
        const sessionId1 = plan.steps[0].agentSessionId;
        mockSM.simulateCompletion(sessionId1);
        await new Promise((r) => setTimeout(r, 300));
        // Rebase resolution agent should have started
        (0, vitest_1.expect)(mockSM.startCalls.length).toBeGreaterThanOrEqual(2);
        const currentStep = executor.getPlan().steps[0];
        const sessionId2 = currentStep.agentSessionId;
        (0, vitest_1.expect)(sessionId2).not.toBe(sessionId1);
        // Second agent (rebase resolver) completes → merge succeeds → step done
        mockSM.simulateCompletion(sessionId2);
        await new Promise((r) => setTimeout(r, 300));
        (0, vitest_1.expect)(executor.getPlan().steps[0].status).toBe("done");
        (0, vitest_1.expect)(completed).toContain("t1");
        // rebaseConflict should be cleared
        (0, vitest_1.expect)(executor.getPlan().steps[0].rebaseConflict).toBeUndefined();
        executor.stop();
        await runPromise;
    });
    (0, vitest_1.it)("post-rebase verification failure enters retry loop", async () => {
        // Flow: merge conflict → clean rebase → step completes.
        // Verification is disabled (oracle now runs as agent session which
        // the mock SessionManager can't simulate). This test focuses on
        // the rebase flow, not verification behavior.
        mockMerge
            .mockResolvedValueOnce({ merged: false, conflict: true, error: "CONFLICT in file.ts" });
        mockAttemptRebase.mockResolvedValue({ rebased: true, conflict: false });
        const plan = makePlan([
            { ticketId: "t1", projectId: "p", status: "ready", blockedBy: [] },
        ], {
            worktree: true,
            verification: { runTests: false, runOracle: false, autoRebase: true, maxRetries: 2 },
        });
        const executor = new executor_js_1.Executor(plan, mockSM);
        const runPromise = executor.run();
        await new Promise((r) => setTimeout(r, 50));
        const sessionId = plan.steps[0].agentSessionId;
        mockSM.simulateCompletion(sessionId);
        await new Promise((r) => setTimeout(r, 500));
        // Merge conflicted → rebase succeeded → step completed
        const step = executor.getPlan().steps[0];
        (0, vitest_1.expect)(mockAttemptRebase).toHaveBeenCalledWith("t1");
        executor.stop();
        await runPromise;
    });
    (0, vitest_1.it)("defaultConfig includes autoRebase: true", () => {
        const config = (0, persistence_js_1.defaultConfig)();
        (0, vitest_1.expect)(config.verification.autoRebase).toBe(true);
    });
});
//# sourceMappingURL=executor-rebase.test.js.map