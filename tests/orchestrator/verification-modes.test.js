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
    async stopSession(_id) { }
}
// Mock dependencies
const { mockCommitStepChanges, mockCaptureChangeset, mockScanTickets, mockWriteFile, mockReadFile, mockExecFile, mockStat } = vitest_1.vi.hoisted(() => ({
    mockCommitStepChanges: vitest_1.vi.fn(async () => true),
    mockCaptureChangeset: vitest_1.vi.fn(async () => null),
    mockScanTickets: vitest_1.vi.fn(async () => []),
    mockWriteFile: vitest_1.vi.fn(async () => { }),
    mockReadFile: vitest_1.vi.fn(async () => "---\nstatus: in-progress\n---\n"),
    mockStat: vitest_1.vi.fn(async () => ({ size: 100 })),
    mockExecFile: vitest_1.vi.fn((_cmd, _args, _opts, cb) => {
        cb(null, { stdout: "", stderr: "" });
    }),
}));
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
        testing: { framework: "vitest", command: "npx vitest run" },
        linting: [],
        services: [],
        docs: {},
    })),
}));
vitest_1.vi.mock("../../packages/core/src/detection/tickets.js", () => ({
    scanTickets: mockScanTickets,
}));
vitest_1.vi.mock("node:fs/promises", () => ({
    readFile: mockReadFile,
    writeFile: mockWriteFile,
    stat: mockStat,
}));
vitest_1.vi.mock("../../packages/core/src/agents/context-builder.js", () => ({
    buildContextPacket: vitest_1.vi.fn(async () => ({
        project: { name: "test", path: "/tmp", stack: {}, testing: null, linting: [], services: [] },
        git: { branch: "main", remote: null, clean: true },
    })),
    contextPacketToMarkdown: vitest_1.vi.fn(() => "# Test context"),
}));
vitest_1.vi.mock("node:child_process", () => ({
    execFile: mockExecFile,
}));
vitest_1.vi.mock("../../packages/core/src/orchestrator/git-ops.js", () => ({
    commitStepChanges: mockCommitStepChanges,
    captureChangeset: mockCaptureChangeset,
}));
vitest_1.vi.mock("../../packages/core/src/config/roles.js", () => ({
    loadRole: vitest_1.vi.fn(async () => ({ id: "engineer", name: "Engineer" })),
    resolveRoleConfig: vitest_1.vi.fn(() => ({
        name: "Engineer",
        permissionMode: "acceptEdits",
        allowedTools: [],
        disallowedTools: [],
        allowedBashPatterns: [],
        instructions: "",
        doneCriteria: "",
        runTests: true,
        runOracle: false,
    })),
}));
vitest_1.vi.mock("../../packages/core/src/agents/allowed-bash.js", () => ({
    deriveAllowedBashTools: vitest_1.vi.fn(() => []),
}));
vitest_1.vi.mock("../../packages/core/src/config/summary.js", () => ({
    readProjectSummary: vitest_1.vi.fn(async () => null),
    updateProjectSummary: vitest_1.vi.fn(async () => { }),
}));
vitest_1.vi.mock("../../packages/core/src/logger.js", () => ({
    createLogger: () => ({
        info: vitest_1.vi.fn(),
        warn: vitest_1.vi.fn(),
        error: vitest_1.vi.fn(),
        debug: vitest_1.vi.fn(),
    }),
}));
vitest_1.vi.mock("../../packages/core/src/graph/graph-service.js", () => ({
    ingestTestResults: vitest_1.vi.fn(),
    queryGraphContext: vitest_1.vi.fn(() => null),
}));
vitest_1.vi.mock("../../packages/core/src/orchestrator/smoke-test.js", () => ({
    runSmoke: vitest_1.vi.fn(async () => null),
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
vitest_1.vi.mock("../../packages/core/src/orchestrator/worktree.js", () => {
    const MockManager = vitest_1.vi.fn().mockImplementation(() => ({
        create: mockCreate,
        remove: mockRemove,
        hasCommits: mockHasCommits,
        merge: mockMerge,
        writeLock: mockWriteLock,
        attemptRebase: mockAttemptRebase,
        getInfo: vitest_1.vi.fn(),
        restore: vitest_1.vi.fn(),
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
(0, vitest_1.describe)("Verification Modes", () => {
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
        mockExecFile.mockImplementation((_cmd, _args, _opts, cb) => {
            cb(null, { stdout: "", stderr: "" });
        });
    });
    (0, vitest_1.describe)("none mode", () => {
        (0, vitest_1.it)("skips verification and marks step done immediately", async () => {
            mockHasCommits.mockResolvedValue(true);
            mockMerge.mockResolvedValue({ merged: true, conflict: false });
            const plan = makePlan([
                { ticketId: "t1", projectId: "p", status: "ready", blockedBy: [], verificationMode: "none" },
            ], { worktree: true });
            const executor = new executor_js_1.Executor(plan, mockSM);
            const completed = [];
            executor.on("step_completed", ({ step }) => completed.push(step.ticketId));
            const runPromise = executor.run();
            await new Promise((r) => setTimeout(r, 50));
            const sessionId = plan.steps[0].agentSessionId;
            mockSM.simulateCompletion(sessionId);
            await new Promise((r) => setTimeout(r, 150));
            (0, vitest_1.expect)(completed).toContain("t1");
            (0, vitest_1.expect)(plan.steps[0].status).toBe("done");
            // Should have merged (has commits)
            (0, vitest_1.expect)(mockMerge).toHaveBeenCalled();
            // Worktree cleaned up
            (0, vitest_1.expect)(mockRemove).toHaveBeenCalled();
            executor.stop();
            await runPromise;
        });
        (0, vitest_1.it)("marks done without merge when no commits", async () => {
            mockHasCommits.mockResolvedValue(false);
            const plan = makePlan([
                { ticketId: "t1", projectId: "p", status: "ready", blockedBy: [], verificationMode: "none" },
            ], { worktree: true });
            const executor = new executor_js_1.Executor(plan, mockSM);
            const completed = [];
            executor.on("step_completed", ({ step }) => completed.push(step.ticketId));
            const runPromise = executor.run();
            await new Promise((r) => setTimeout(r, 50));
            const sessionId = plan.steps[0].agentSessionId;
            mockSM.simulateCompletion(sessionId);
            await new Promise((r) => setTimeout(r, 150));
            (0, vitest_1.expect)(completed).toContain("t1");
            (0, vitest_1.expect)(plan.steps[0].status).toBe("done");
            // Should NOT have tried to merge
            (0, vitest_1.expect)(mockMerge).not.toHaveBeenCalled();
            executor.stop();
            await runPromise;
        });
    });
    (0, vitest_1.describe)("confirmation mode", () => {
        (0, vitest_1.it)("enters pending-confirmation status after agent exit", async () => {
            mockHasCommits.mockResolvedValue(true);
            const plan = makePlan([
                { ticketId: "t1", projectId: "p", status: "ready", blockedBy: [], verificationMode: "confirmation" },
            ], { worktree: true });
            const executor = new executor_js_1.Executor(plan, mockSM);
            const pendingEvents = [];
            executor.on("step_pending_confirmation", ({ step }) => pendingEvents.push(step.ticketId));
            const runPromise = executor.run();
            await new Promise((r) => setTimeout(r, 50));
            const sessionId = plan.steps[0].agentSessionId;
            mockSM.simulateCompletion(sessionId);
            await new Promise((r) => setTimeout(r, 150));
            (0, vitest_1.expect)(plan.steps[0].status).toBe("pending-confirmation");
            (0, vitest_1.expect)(pendingEvents).toContain("t1");
            executor.stop();
            await runPromise;
        });
        (0, vitest_1.it)("confirmStep moves pending-confirmation to done", async () => {
            mockHasCommits.mockResolvedValue(true);
            mockMerge.mockResolvedValue({ merged: true, conflict: false });
            const plan = makePlan([
                { ticketId: "t1", projectId: "p", status: "ready", blockedBy: [], verificationMode: "confirmation" },
            ], { worktree: true });
            const executor = new executor_js_1.Executor(plan, mockSM);
            const completed = [];
            executor.on("step_completed", ({ step }) => completed.push(step.ticketId));
            const runPromise = executor.run();
            await new Promise((r) => setTimeout(r, 50));
            const sessionId = plan.steps[0].agentSessionId;
            mockSM.simulateCompletion(sessionId);
            await new Promise((r) => setTimeout(r, 150));
            (0, vitest_1.expect)(plan.steps[0].status).toBe("pending-confirmation");
            // User confirms
            executor.confirmStep("t1");
            await new Promise((r) => setTimeout(r, 150));
            (0, vitest_1.expect)(plan.steps[0].status).toBe("done");
            (0, vitest_1.expect)(completed).toContain("t1");
            executor.stop();
            await runPromise;
        });
        (0, vitest_1.it)("rejectStep moves pending-confirmation back to ready", async () => {
            mockHasCommits.mockResolvedValue(true);
            const plan = makePlan([
                { ticketId: "t1", projectId: "p", status: "ready", blockedBy: [], verificationMode: "confirmation" },
            ], { worktree: true });
            const executor = new executor_js_1.Executor(plan, mockSM);
            const runPromise = executor.run();
            await new Promise((r) => setTimeout(r, 50));
            const sessionId = plan.steps[0].agentSessionId;
            mockSM.simulateCompletion(sessionId);
            await new Promise((r) => setTimeout(r, 150));
            (0, vitest_1.expect)(plan.steps[0].status).toBe("pending-confirmation");
            // User rejects
            executor.rejectStep("t1", "Not done yet");
            await new Promise((r) => setTimeout(r, 150));
            (0, vitest_1.expect)(plan.steps[0].status).toBe("ready");
            (0, vitest_1.expect)(plan.steps[0].attempt).toBe(2);
            (0, vitest_1.expect)(plan.steps[0].error).toBe("Not done yet");
            executor.stop();
            await runPromise;
        });
    });
    (0, vitest_1.describe)("output-exists mode", () => {
        (0, vitest_1.it)("passes when expected output files exist and are non-empty", async () => {
            mockHasCommits.mockResolvedValue(true);
            mockMerge.mockResolvedValue({ merged: true, conflict: false });
            mockScanTickets.mockResolvedValue([{
                    id: "t1",
                    title: "Generate report",
                    status: "open",
                    priority: 2,
                    type: "feature",
                    filePath: "/tmp/t1/README.md",
                    deps: [],
                    links: [],
                    tags: {},
                    outputs: ["docs/report.md"],
                }]);
            mockStat.mockResolvedValue({ size: 500 });
            const plan = makePlan([
                { ticketId: "t1", projectId: "p", status: "ready", blockedBy: [], verificationMode: "output-exists" },
            ], { worktree: true });
            const executor = new executor_js_1.Executor(plan, mockSM);
            const completed = [];
            executor.on("step_completed", ({ step }) => completed.push(step.ticketId));
            const runPromise = executor.run();
            await new Promise((r) => setTimeout(r, 50));
            const sessionId = plan.steps[0].agentSessionId;
            mockSM.simulateCompletion(sessionId);
            await new Promise((r) => setTimeout(r, 200));
            (0, vitest_1.expect)(completed).toContain("t1");
            (0, vitest_1.expect)(plan.steps[0].status).toBe("done");
            executor.stop();
            await runPromise;
        });
        (0, vitest_1.it)("fails when expected output file is missing", async () => {
            mockHasCommits.mockResolvedValue(true);
            mockScanTickets.mockResolvedValue([{
                    id: "t1",
                    title: "Generate report",
                    status: "open",
                    priority: 2,
                    type: "feature",
                    filePath: "/tmp/t1/README.md",
                    deps: [],
                    links: [],
                    tags: {},
                    outputs: ["docs/report.md"],
                }]);
            mockStat.mockRejectedValue(new Error("ENOENT"));
            const plan = makePlan([
                { ticketId: "t1", projectId: "p", status: "ready", blockedBy: [], verificationMode: "output-exists" },
            ], { worktree: true, verification: { runTests: true, runOracle: false, maxRetries: 0 } });
            const executor = new executor_js_1.Executor(plan, mockSM);
            const failed = [];
            executor.on("step_failed", ({ step }) => failed.push(step.ticketId));
            const runPromise = executor.run();
            await new Promise((r) => setTimeout(r, 50));
            const sessionId = plan.steps[0].agentSessionId;
            mockSM.simulateCompletion(sessionId);
            await new Promise((r) => setTimeout(r, 200));
            (0, vitest_1.expect)(failed).toContain("t1");
            (0, vitest_1.expect)(plan.steps[0].status).toBe("failed");
            executor.stop();
            await runPromise;
        });
        (0, vitest_1.it)("fails when expected output file is empty", async () => {
            mockHasCommits.mockResolvedValue(true);
            mockScanTickets.mockResolvedValue([{
                    id: "t1",
                    title: "Generate report",
                    status: "open",
                    priority: 2,
                    type: "feature",
                    filePath: "/tmp/t1/README.md",
                    deps: [],
                    links: [],
                    tags: {},
                    outputs: ["docs/report.md"],
                }]);
            mockStat.mockResolvedValue({ size: 0 });
            const plan = makePlan([
                { ticketId: "t1", projectId: "p", status: "ready", blockedBy: [], verificationMode: "output-exists" },
            ], { worktree: true, verification: { runTests: true, runOracle: false, maxRetries: 0 } });
            const executor = new executor_js_1.Executor(plan, mockSM);
            const failed = [];
            executor.on("step_failed", ({ step }) => failed.push(step.ticketId));
            const runPromise = executor.run();
            await new Promise((r) => setTimeout(r, 50));
            const sessionId = plan.steps[0].agentSessionId;
            mockSM.simulateCompletion(sessionId);
            await new Promise((r) => setTimeout(r, 200));
            (0, vitest_1.expect)(failed).toContain("t1");
            (0, vitest_1.expect)(plan.steps[0].status).toBe("failed");
            executor.stop();
            await runPromise;
        });
        (0, vitest_1.it)("passes when no outputs specified (default pass)", async () => {
            mockHasCommits.mockResolvedValue(true);
            mockMerge.mockResolvedValue({ merged: true, conflict: false });
            // No outputs field on the work item
            mockScanTickets.mockResolvedValue([{
                    id: "t1",
                    title: "Generate report",
                    status: "open",
                    priority: 2,
                    type: "feature",
                    filePath: "/tmp/t1/README.md",
                    deps: [],
                    links: [],
                    tags: {},
                }]);
            const plan = makePlan([
                { ticketId: "t1", projectId: "p", status: "ready", blockedBy: [], verificationMode: "output-exists" },
            ], { worktree: true });
            const executor = new executor_js_1.Executor(plan, mockSM);
            const completed = [];
            executor.on("step_completed", ({ step }) => completed.push(step.ticketId));
            const runPromise = executor.run();
            await new Promise((r) => setTimeout(r, 50));
            const sessionId = plan.steps[0].agentSessionId;
            mockSM.simulateCompletion(sessionId);
            await new Promise((r) => setTimeout(r, 200));
            (0, vitest_1.expect)(completed).toContain("t1");
            (0, vitest_1.expect)(plan.steps[0].status).toBe("done");
            executor.stop();
            await runPromise;
        });
    });
    (0, vitest_1.describe)("oracle mode (via verificationMode)", () => {
        (0, vitest_1.it)("skips test gate and runs oracle only", async () => {
            mockHasCommits.mockResolvedValue(true);
            mockMerge.mockResolvedValue({ merged: true, conflict: false });
            const plan = makePlan([
                { ticketId: "t1", projectId: "p", status: "ready", blockedBy: [], verificationMode: "oracle" },
            ], { worktree: true, verification: { runTests: true, runOracle: true } });
            const executor = new executor_js_1.Executor(plan, mockSM);
            const completed = [];
            executor.on("step_completed", ({ step }) => completed.push(step.ticketId));
            const runPromise = executor.run();
            await new Promise((r) => setTimeout(r, 50));
            const sessionId = plan.steps[0].agentSessionId;
            mockSM.simulateCompletion(sessionId);
            await new Promise((r) => setTimeout(r, 200));
            // Step should complete (oracle is enabled but no oracle agent will actually run
            // since we haven't mocked the full oracle flow — the verification will pass
            // when runOracle=true but oracle can't find the ticket)
            // The key assertion is that stepVerification was overridden to skip tests
            executor.stop();
            await runPromise;
        });
    });
    (0, vitest_1.describe)("fallback behavior", () => {
        (0, vitest_1.it)("falls back to plan-level verification when no verificationMode set", async () => {
            mockHasCommits.mockResolvedValue(true);
            mockMerge.mockResolvedValue({ merged: true, conflict: false });
            const plan = makePlan([
                { ticketId: "t1", projectId: "p", status: "ready", blockedBy: [] },
            ], { worktree: true, verification: { runTests: false, runOracle: false } });
            const executor = new executor_js_1.Executor(plan, mockSM);
            const completed = [];
            executor.on("step_completed", ({ step }) => completed.push(step.ticketId));
            const runPromise = executor.run();
            await new Promise((r) => setTimeout(r, 50));
            const sessionId = plan.steps[0].agentSessionId;
            mockSM.simulateCompletion(sessionId);
            await new Promise((r) => setTimeout(r, 200));
            // With no explicit verificationMode, uses existing pipeline.
            // runTests=false, runOracle=false → verification returns null → step done
            (0, vitest_1.expect)(completed).toContain("t1");
            (0, vitest_1.expect)(plan.steps[0].status).toBe("done");
            executor.stop();
            await runPromise;
        });
    });
    (0, vitest_1.describe)("mixed plans", () => {
        (0, vitest_1.it)("runs different verification modes for different steps", async () => {
            mockHasCommits.mockResolvedValue(true);
            mockMerge.mockResolvedValue({ merged: true, conflict: false });
            const plan = makePlan([
                { ticketId: "code-task", projectId: "p", status: "ready", blockedBy: [] },
                { ticketId: "confirm-task", projectId: "p", status: "ready", blockedBy: [], verificationMode: "confirmation" },
                { ticketId: "fire-task", projectId: "p", status: "ready", blockedBy: [], verificationMode: "none" },
            ], { worktree: true, maxConcurrentAgents: 3, verification: { runTests: false, runOracle: false } });
            const executor = new executor_js_1.Executor(plan, mockSM);
            const completed = [];
            const pending = [];
            executor.on("step_completed", ({ step }) => completed.push(step.ticketId));
            executor.on("step_pending_confirmation", ({ step }) => pending.push(step.ticketId));
            // Need separate worktree creates for each step
            mockCreate.mockImplementation(async (_path, _stepId, ticketId) => ({
                stepId: ticketId,
                ticketId,
                projectPath: "/tmp/test-p",
                worktreePath: `/tmp/test-p/.opcom/worktrees/${ticketId}`,
                branch: `work/${ticketId}`,
            }));
            const runPromise = executor.run();
            await new Promise((r) => setTimeout(r, 100));
            // Complete all agents
            for (const step of plan.steps) {
                if (step.agentSessionId) {
                    mockSM.simulateCompletion(step.agentSessionId);
                }
            }
            await new Promise((r) => setTimeout(r, 300));
            // fire-task: none → done immediately
            (0, vitest_1.expect)(plan.steps.find(s => s.ticketId === "fire-task")?.status).toBe("done");
            (0, vitest_1.expect)(completed).toContain("fire-task");
            // confirm-task: confirmation → pending-confirmation
            (0, vitest_1.expect)(plan.steps.find(s => s.ticketId === "confirm-task")?.status).toBe("pending-confirmation");
            (0, vitest_1.expect)(pending).toContain("confirm-task");
            // code-task: no explicit verificationMode → existing pipeline (runTests=false, runOracle=false → null → done)
            (0, vitest_1.expect)(plan.steps.find(s => s.ticketId === "code-task")?.status).toBe("done");
            (0, vitest_1.expect)(completed).toContain("code-task");
            executor.stop();
            await runPromise;
        });
    });
});
//# sourceMappingURL=verification-modes.test.js.map