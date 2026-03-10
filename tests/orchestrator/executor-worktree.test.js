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
        stack: { languages: [], frameworks: [], packageManagers: [], infrastructure: [], versionManagers: [] },
        testing: null,
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
    contextPacketToMarkdown: vitest_1.vi.fn(() => "# Test context"),
}));
const { mockCommitStepChanges, mockCaptureChangeset, mockScanTickets, mockWriteFile, mockReadFile, mockExecFile } = vitest_1.vi.hoisted(() => ({
    mockCommitStepChanges: vitest_1.vi.fn(async () => true),
    mockCaptureChangeset: vitest_1.vi.fn(async () => null),
    mockScanTickets: vitest_1.vi.fn(async () => []),
    mockWriteFile: vitest_1.vi.fn(async () => { }),
    mockReadFile: vitest_1.vi.fn(async () => "---\nstatus: in-progress\n---\n"),
    mockExecFile: vitest_1.vi.fn((_cmd, _args, _opts, cb) => {
        cb(null, { stdout: "", stderr: "" });
    }),
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
// Mock WorktreeManager — use vi.hoisted() so these are available when vi.mock is hoisted
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
    // Static method
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
(0, vitest_1.describe)("Executor with worktree isolation", () => {
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
    (0, vitest_1.it)("creates worktree before starting agent when worktree=true", async () => {
        const plan = makePlan([
            { ticketId: "t1", projectId: "p", status: "ready", blockedBy: [] },
        ], { worktree: true });
        const executor = new executor_js_1.Executor(plan, mockSM);
        const runPromise = executor.run();
        await new Promise((r) => setTimeout(r, 50));
        // Worktree should have been created
        (0, vitest_1.expect)(mockCreate).toHaveBeenCalledWith("/tmp/test-p", "t1", "t1");
        // Step should have worktree info
        const step = plan.steps[0];
        (0, vitest_1.expect)(step.worktreePath).toBe("/tmp/test-p/.opcom/worktrees/t1");
        (0, vitest_1.expect)(step.worktreeBranch).toBe("work/t1");
        // Agent should be started with worktree cwd
        (0, vitest_1.expect)(mockSM.startCalls).toHaveLength(1);
        const config = mockSM.startCalls[0].config;
        (0, vitest_1.expect)(config.cwd).toBe("/tmp/test-p/.opcom/worktrees/t1");
        executor.stop();
        await runPromise;
    });
    (0, vitest_1.it)("does NOT create worktree when worktree=false", async () => {
        const plan = makePlan([
            { ticketId: "t1", projectId: "p", status: "ready", blockedBy: [] },
        ], { worktree: false });
        const executor = new executor_js_1.Executor(plan, mockSM);
        const runPromise = executor.run();
        await new Promise((r) => setTimeout(r, 50));
        (0, vitest_1.expect)(mockCreate).not.toHaveBeenCalled();
        executor.stop();
        await runPromise;
    });
    (0, vitest_1.it)("uses hasCommits instead of sessionWrites when worktree=true", async () => {
        mockHasCommits.mockResolvedValue(true);
        mockMerge.mockResolvedValue({ merged: true, conflict: false });
        const plan = makePlan([
            { ticketId: "t1", projectId: "p", status: "ready", blockedBy: [] },
        ], { worktree: true });
        const executor = new executor_js_1.Executor(plan, mockSM);
        const completed = [];
        executor.on("step_completed", ({ step }) => completed.push(step.ticketId));
        const runPromise = executor.run();
        await new Promise((r) => setTimeout(r, 50));
        // Agent completes WITHOUT any write events (worktree mode doesn't need them)
        const sessionId = plan.steps[0].agentSessionId;
        mockSM.simulateCompletion(sessionId);
        await new Promise((r) => setTimeout(r, 100));
        // hasCommits should have been called
        (0, vitest_1.expect)(mockHasCommits).toHaveBeenCalledWith("t1");
        // Step should be completed via worktree merge
        (0, vitest_1.expect)(completed).toContain("t1");
        executor.stop();
        await runPromise;
    });
    (0, vitest_1.it)("marks step as failed when worktree has no commits", async () => {
        mockHasCommits.mockResolvedValue(false);
        const plan = makePlan([
            { ticketId: "t1", projectId: "p", status: "ready", blockedBy: [] },
        ], { worktree: true, pauseOnFailure: false });
        const executor = new executor_js_1.Executor(plan, mockSM);
        const failed = [];
        executor.on("step_failed", ({ step }) => failed.push(step.ticketId));
        const runPromise = executor.run();
        await new Promise((r) => setTimeout(r, 50));
        const sessionId = plan.steps[0].agentSessionId;
        mockSM.simulateCompletion(sessionId);
        await new Promise((r) => setTimeout(r, 100));
        (0, vitest_1.expect)(failed).toContain("t1");
        (0, vitest_1.expect)(plan.steps[0].error).toContain("without making any commits");
        // Worktree should have been cleaned up
        (0, vitest_1.expect)(mockRemove).toHaveBeenCalledWith("t1");
        executor.stop();
        await runPromise;
    });
    (0, vitest_1.it)("auto-commits uncommitted changes before checking hasCommits", async () => {
        // Simulate: agent wrote files but didn't commit. Auto-commit creates
        // a commit, so hasCommits returns true on the second call.
        let commitCalled = false;
        mockCommitStepChanges.mockImplementation(async () => {
            commitCalled = true;
            return true;
        });
        mockHasCommits.mockImplementation(async () => commitCalled);
        mockMerge.mockResolvedValue({ merged: true, conflict: false });
        const plan = makePlan([
            { ticketId: "t1", projectId: "p", status: "ready", blockedBy: [] },
        ], { worktree: true, autoCommit: true, pauseOnFailure: false });
        const executor = new executor_js_1.Executor(plan, mockSM);
        const completed = [];
        executor.on("step_completed", ({ step }) => completed.push(step.ticketId));
        const runPromise = executor.run();
        await new Promise((r) => setTimeout(r, 50));
        const sessionId = plan.steps[0].agentSessionId;
        mockSM.simulateCompletion(sessionId);
        await new Promise((r) => setTimeout(r, 100));
        // commitStepChanges should have been called with the worktree path
        (0, vitest_1.expect)(mockCommitStepChanges).toHaveBeenCalled();
        // Step should succeed because auto-commit created a commit
        (0, vitest_1.expect)(completed).toContain("t1");
        executor.stop();
        await runPromise;
    });
    (0, vitest_1.it)("merges worktree branch after successful completion", async () => {
        mockHasCommits.mockResolvedValue(true);
        mockMerge.mockResolvedValue({ merged: true, conflict: false });
        const plan = makePlan([
            { ticketId: "t1", projectId: "p", status: "ready", blockedBy: [] },
        ], { worktree: true });
        const executor = new executor_js_1.Executor(plan, mockSM);
        const runPromise = executor.run();
        await new Promise((r) => setTimeout(r, 50));
        const sessionId = plan.steps[0].agentSessionId;
        mockSM.simulateCompletion(sessionId);
        await new Promise((r) => setTimeout(r, 100));
        (0, vitest_1.expect)(mockMerge).toHaveBeenCalledWith("t1");
        (0, vitest_1.expect)(mockRemove).toHaveBeenCalledWith("t1");
        (0, vitest_1.expect)(plan.steps[0].status).toBe("done");
        // Worktree fields should be cleared after cleanup
        (0, vitest_1.expect)(plan.steps[0].worktreePath).toBeUndefined();
        (0, vitest_1.expect)(plan.steps[0].worktreeBranch).toBeUndefined();
        executor.stop();
        await runPromise;
    });
    (0, vitest_1.it)("marks step as needs-rebase on merge conflict", async () => {
        mockHasCommits.mockResolvedValue(true);
        mockMerge.mockResolvedValue({ merged: false, conflict: true, error: "CONFLICT in file.ts" });
        const plan = makePlan([
            { ticketId: "t1", projectId: "p", status: "ready", blockedBy: [] },
        ], { worktree: true, pauseOnFailure: true, verification: { ...(0, persistence_js_1.defaultConfig)().verification, autoRebase: false } });
        const executor = new executor_js_1.Executor(plan, mockSM);
        const needsRebase = [];
        executor.on("step_needs_rebase", ({ step }) => needsRebase.push(step.ticketId));
        let paused = false;
        executor.on("plan_paused", () => { paused = true; });
        const runPromise = executor.run();
        await new Promise((r) => setTimeout(r, 50));
        const sessionId = plan.steps[0].agentSessionId;
        mockSM.simulateCompletion(sessionId);
        await new Promise((r) => setTimeout(r, 100));
        (0, vitest_1.expect)(needsRebase).toContain("t1");
        (0, vitest_1.expect)(plan.steps[0].status).toBe("needs-rebase");
        (0, vitest_1.expect)(plan.steps[0].error).toContain("Merge conflict");
        (0, vitest_1.expect)(paused).toBe(true);
        // Worktree should NOT be removed — kept for manual rebase
        (0, vitest_1.expect)(mockRemove).not.toHaveBeenCalled();
        executor.stop();
        await runPromise;
    });
    (0, vitest_1.it)("marks step as needs-rebase on non-conflict merge failure", async () => {
        mockHasCommits.mockResolvedValue(true);
        mockMerge.mockResolvedValue({ merged: false, conflict: false, error: "git error" });
        const plan = makePlan([
            { ticketId: "t1", projectId: "p", status: "ready", blockedBy: [] },
        ], { worktree: true, pauseOnFailure: false });
        const executor = new executor_js_1.Executor(plan, mockSM);
        const runPromise = executor.run();
        await new Promise((r) => setTimeout(r, 50));
        const sessionId = plan.steps[0].agentSessionId;
        mockSM.simulateCompletion(sessionId);
        await new Promise((r) => setTimeout(r, 100));
        (0, vitest_1.expect)(plan.steps[0].status).toBe("needs-rebase");
        (0, vitest_1.expect)(plan.steps[0].error).toContain("Merge failed");
        // Worktree should NOT be removed — kept for retry
        (0, vitest_1.expect)(mockRemove).not.toHaveBeenCalled();
        executor.stop();
        await runPromise;
    });
    (0, vitest_1.it)("cleans up orphaned worktrees on startup", async () => {
        mockCleanupOrphaned.mockResolvedValue(["old-step"]);
        const plan = makePlan([
            { ticketId: "t1", projectId: "p", status: "ready", blockedBy: [] },
        ], { worktree: true });
        const executor = new executor_js_1.Executor(plan, mockSM);
        const runPromise = executor.run();
        await new Promise((r) => setTimeout(r, 50));
        (0, vitest_1.expect)(mockCleanupOrphaned).toHaveBeenCalledWith("/tmp/test-p", vitest_1.expect.any(Set));
        executor.stop();
        await runPromise;
    });
    (0, vitest_1.it)("writes lock file with agent PID after session starts", async () => {
        const plan = makePlan([
            { ticketId: "t1", projectId: "p", status: "ready", blockedBy: [] },
        ], { worktree: true });
        const executor = new executor_js_1.Executor(plan, mockSM);
        const runPromise = executor.run();
        await new Promise((r) => setTimeout(r, 50));
        // writeLock should have been called with the ticketId and the session PID
        (0, vitest_1.expect)(mockWriteLock).toHaveBeenCalledWith("t1", 12345);
        executor.stop();
        await runPromise;
    });
    (0, vitest_1.it)("needs-rebase is terminal — plan completes when all steps are terminal", async () => {
        mockHasCommits.mockResolvedValue(true);
        mockMerge.mockResolvedValue({ merged: false, conflict: true, error: "CONFLICT" });
        const plan = makePlan([
            { ticketId: "t1", projectId: "p", status: "ready", blockedBy: [] },
        ], { worktree: true, pauseOnFailure: false, verification: { ...(0, persistence_js_1.defaultConfig)().verification, autoRebase: false } });
        const executor = new executor_js_1.Executor(plan, mockSM);
        let planDone = false;
        executor.on("plan_completed", () => { planDone = true; });
        const runPromise = executor.run();
        await new Promise((r) => setTimeout(r, 50));
        const sessionId = plan.steps[0].agentSessionId;
        mockSM.simulateCompletion(sessionId);
        await new Promise((r) => setTimeout(r, 200));
        (0, vitest_1.expect)(plan.steps[0].status).toBe("needs-rebase");
        (0, vitest_1.expect)(planDone).toBe(true);
        executor.stop();
        await runPromise;
    });
    (0, vitest_1.it)("cleans up empty worktree on agent failure, keeps worktree with commits", async () => {
        mockHasCommits.mockResolvedValue(false);
        const plan = makePlan([
            { ticketId: "t1", projectId: "p", status: "ready", blockedBy: [] },
        ], { worktree: true, pauseOnFailure: false });
        const executor = new executor_js_1.Executor(plan, mockSM);
        const runPromise = executor.run();
        await new Promise((r) => setTimeout(r, 50));
        // Step should have worktree info from creation
        (0, vitest_1.expect)(plan.steps[0].worktreePath).toBe("/tmp/test-p/.opcom/worktrees/t1");
        // Simulate error then stop — error state is non-fatal, agent stops after
        const sessionId = plan.steps[0].agentSessionId;
        mockSM.emit("state_change", {
            sessionId,
            oldState: "streaming",
            newState: "error",
        });
        mockSM.emit("session_stopped", {
            id: sessionId, backend: "claude-code", projectId: "test",
            state: "stopped", startedAt: new Date().toISOString(), stoppedAt: new Date().toISOString(),
        });
        await new Promise((r) => setTimeout(r, 100));
        (0, vitest_1.expect)(plan.steps[0].status).toBe("failed");
        // Empty worktree (no commits, no uncommitted changes) gets cleaned up
        (0, vitest_1.expect)(mockRemove).toHaveBeenCalledWith("t1");
        executor.stop();
        await runPromise;
    });
    (0, vitest_1.it)("resets ticket to open when step fails with ticketTransitions enabled", async () => {
        mockHasCommits.mockResolvedValue(false);
        mockScanTickets.mockResolvedValue([
            { id: "t1", title: "Test", status: "in-progress", filePath: "/tmp/test-p/.tickets/impl/t1/README.md" },
        ]);
        const plan = makePlan([
            { ticketId: "t1", projectId: "p", status: "ready", blockedBy: [] },
        ], { worktree: true, ticketTransitions: true, pauseOnFailure: false });
        const executor = new executor_js_1.Executor(plan, mockSM);
        const runPromise = executor.run();
        await new Promise((r) => setTimeout(r, 50));
        const sessionId = plan.steps[0].agentSessionId;
        mockSM.simulateCompletion(sessionId);
        await new Promise((r) => setTimeout(r, 100));
        (0, vitest_1.expect)(plan.steps[0].status).toBe("failed");
        // updateTicketStatus should have written "open" back to the ticket file
        (0, vitest_1.expect)(mockWriteFile).toHaveBeenCalledWith("/tmp/test-p/.tickets/impl/t1/README.md", vitest_1.expect.stringContaining("status: open"), "utf-8");
        executor.stop();
        await runPromise;
    });
    (0, vitest_1.it)("resets ticket to open on agent_failed event with ticketTransitions", async () => {
        mockScanTickets.mockResolvedValue([
            { id: "t1", title: "Test", status: "in-progress", filePath: "/tmp/test-p/.tickets/impl/t1/README.md" },
        ]);
        const plan = makePlan([
            { ticketId: "t1", projectId: "p", status: "ready", blockedBy: [] },
        ], { worktree: true, ticketTransitions: true, pauseOnFailure: false });
        const executor = new executor_js_1.Executor(plan, mockSM);
        const runPromise = executor.run();
        await new Promise((r) => setTimeout(r, 50));
        // Simulate agent error then stop
        const sessionId = plan.steps[0].agentSessionId;
        mockSM.emit("state_change", {
            sessionId,
            oldState: "streaming",
            newState: "error",
        });
        mockSM.emit("session_stopped", {
            id: sessionId, backend: "claude-code", projectId: "test",
            state: "stopped", startedAt: new Date().toISOString(), stoppedAt: new Date().toISOString(),
        });
        await new Promise((r) => setTimeout(r, 100));
        (0, vitest_1.expect)(plan.steps[0].status).toBe("failed");
        (0, vitest_1.expect)(mockWriteFile).toHaveBeenCalledWith("/tmp/test-p/.tickets/impl/t1/README.md", vitest_1.expect.stringContaining("status: open"), "utf-8");
        executor.stop();
        await runPromise;
    });
    (0, vitest_1.it)("does NOT reset ticket when ticketTransitions is disabled", async () => {
        mockHasCommits.mockResolvedValue(false);
        mockScanTickets.mockResolvedValue([
            { id: "t1", title: "Test", status: "in-progress", filePath: "/tmp/test-p/.tickets/impl/t1/README.md" },
        ]);
        const plan = makePlan([
            { ticketId: "t1", projectId: "p", status: "ready", blockedBy: [] },
        ], { worktree: true, ticketTransitions: false, pauseOnFailure: false });
        const executor = new executor_js_1.Executor(plan, mockSM);
        const runPromise = executor.run();
        await new Promise((r) => setTimeout(r, 50));
        const sessionId = plan.steps[0].agentSessionId;
        mockSM.simulateCompletion(sessionId);
        await new Promise((r) => setTimeout(r, 100));
        (0, vitest_1.expect)(plan.steps[0].status).toBe("failed");
        // writeFile should NOT have been called since ticketTransitions is off
        (0, vitest_1.expect)(mockWriteFile).not.toHaveBeenCalled();
        executor.stop();
        await runPromise;
    });
    (0, vitest_1.it)("commits ticket status change after writing it", async () => {
        mockHasCommits.mockResolvedValue(false);
        mockScanTickets.mockResolvedValue([
            { id: "t1", title: "Test", status: "in-progress", filePath: "/tmp/test-p/.tickets/impl/t1/README.md" },
        ]);
        const plan = makePlan([
            { ticketId: "t1", projectId: "p", status: "ready", blockedBy: [] },
        ], { worktree: true, ticketTransitions: true, pauseOnFailure: false });
        const executor = new executor_js_1.Executor(plan, mockSM);
        const runPromise = executor.run();
        await new Promise((r) => setTimeout(r, 50));
        const sessionId = plan.steps[0].agentSessionId;
        mockSM.simulateCompletion(sessionId);
        await new Promise((r) => setTimeout(r, 100));
        // Ticket status was written
        (0, vitest_1.expect)(mockWriteFile).toHaveBeenCalledWith("/tmp/test-p/.tickets/impl/t1/README.md", vitest_1.expect.stringContaining("status: open"), "utf-8");
        // git add and git commit were called for the ticket file
        const execCalls = mockExecFile.mock.calls;
        const gitAddCall = execCalls.find((c) => c[0] === "git" && c[1][0] === "add" && c[1][1] === "/tmp/test-p/.tickets/impl/t1/README.md");
        const gitCommitCall = execCalls.find((c) => c[0] === "git" && c[1][0] === "commit" && c[1].some((a) => a.includes("open") && a.includes("t1")));
        (0, vitest_1.expect)(gitAddCall).toBeDefined();
        (0, vitest_1.expect)(gitCommitCall).toBeDefined();
        executor.stop();
        await runPromise;
    });
    (0, vitest_1.it)("commits ticket status as closed after successful worktree merge", async () => {
        mockHasCommits.mockResolvedValue(true);
        mockMerge.mockResolvedValue({ merged: true, conflict: false });
        mockScanTickets.mockResolvedValue([
            { id: "t1", title: "Test", status: "in-progress", filePath: "/tmp/test-p/.tickets/impl/t1/README.md" },
        ]);
        const plan = makePlan([
            { ticketId: "t1", projectId: "p", status: "ready", blockedBy: [] },
        ], {
            worktree: true,
            ticketTransitions: true,
            pauseOnFailure: false,
            verification: { runTests: false, runOracle: false, maxRetries: 0 },
        });
        const executor = new executor_js_1.Executor(plan, mockSM);
        const runPromise = executor.run();
        await new Promise((r) => setTimeout(r, 50));
        const sessionId = plan.steps[0].agentSessionId;
        mockSM.simulateCompletion(sessionId);
        await new Promise((r) => setTimeout(r, 100));
        (0, vitest_1.expect)(plan.steps[0].status).toBe("done");
        // Ticket status was written as closed
        (0, vitest_1.expect)(mockWriteFile).toHaveBeenCalledWith("/tmp/test-p/.tickets/impl/t1/README.md", vitest_1.expect.stringContaining("status: closed"), "utf-8");
        // git add and git commit were called for the ticket file
        const execCalls = mockExecFile.mock.calls;
        const gitAddCall = execCalls.find((c) => c[0] === "git" && c[1][0] === "add" && c[1][1] === "/tmp/test-p/.tickets/impl/t1/README.md");
        const gitCommitCall = execCalls.find((c) => c[0] === "git" && c[1][0] === "commit" && c[1].some((a) => a.includes("closed") && a.includes("t1")));
        (0, vitest_1.expect)(gitAddCall).toBeDefined();
        (0, vitest_1.expect)(gitCommitCall).toBeDefined();
        executor.stop();
        await runPromise;
    });
    (0, vitest_1.it)("does not break if git commit fails after ticket status write", async () => {
        mockHasCommits.mockResolvedValue(false);
        mockScanTickets.mockResolvedValue([
            { id: "t1", title: "Test", status: "in-progress", filePath: "/tmp/test-p/.tickets/impl/t1/README.md" },
        ]);
        // Make git commands fail
        mockExecFile.mockImplementation((_cmd, _args, _opts, cb) => {
            cb(new Error("git failed"));
        });
        const plan = makePlan([
            { ticketId: "t1", projectId: "p", status: "ready", blockedBy: [] },
        ], { worktree: true, ticketTransitions: true, pauseOnFailure: false });
        const executor = new executor_js_1.Executor(plan, mockSM);
        const runPromise = executor.run();
        await new Promise((r) => setTimeout(r, 50));
        const sessionId = plan.steps[0].agentSessionId;
        mockSM.simulateCompletion(sessionId);
        await new Promise((r) => setTimeout(r, 100));
        // Step still completed its normal flow despite git commit failure
        (0, vitest_1.expect)(plan.steps[0].status).toBe("failed");
        // Ticket status was still written (writeFile succeeded)
        (0, vitest_1.expect)(mockWriteFile).toHaveBeenCalledWith("/tmp/test-p/.tickets/impl/t1/README.md", vitest_1.expect.stringContaining("status: open"), "utf-8");
        executor.stop();
        await runPromise;
    });
});
//# sourceMappingURL=executor-worktree.test.js.map