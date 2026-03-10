"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const executor_js_1 = require("../../packages/core/src/orchestrator/executor.js");
const persistence_js_1 = require("../../packages/core/src/orchestrator/persistence.js");
// Oracle response fixtures
const ORACLE_RESPONSE_ALL_MET = `## Criteria
- **Criterion**: Feature is implemented
  - **Met**: YES
  - **Reasoning**: The existing code already satisfies this requirement

- **Criterion**: Tests are included
  - **Met**: YES
  - **Reasoning**: Test coverage already exists

## Concerns
None.
`;
const ORACLE_RESPONSE_UNMET = `## Criteria
- **Criterion**: Feature is implemented
  - **Met**: NO
  - **Reasoning**: The feature has not been implemented

## Concerns
- The agent did not make any changes
`;
class MockSessionManager {
    listeners = new Map();
    startCalls = [];
    stopCalls = [];
    sessionCounter = 0;
    onOracleStart;
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
        const session = {
            id,
            backend: backend,
            projectId,
            state: "streaming",
            startedAt: new Date().toISOString(),
            workItemId,
            pid: 12345,
        };
        if (workItemId?.startsWith("oracle:") && this.onOracleStart) {
            setImmediate(() => this.onOracleStart(session));
        }
        return session;
    }
    async stopSession(sessionId) {
        this.stopCalls.push(sessionId);
    }
    simulateOracleResponse(session, responseText) {
        this.emit("agent_event", {
            sessionId: session.id,
            event: {
                type: "message_delta",
                sessionId: session.id,
                timestamp: new Date().toISOString(),
                data: { text: responseText, role: "assistant" },
            },
        });
        this.emit("session_stopped", {
            ...session,
            state: "stopped",
            stoppedAt: new Date().toISOString(),
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
        testing: null, // No test command — skip test gate
        linting: [],
        services: [],
        git: { branch: "main", remote: null },
    })),
}));
const { mockScanTickets } = vitest_1.vi.hoisted(() => ({
    mockScanTickets: vitest_1.vi.fn(),
}));
vitest_1.vi.mock("../../packages/core/src/detection/tickets.js", () => ({
    scanTickets: mockScanTickets,
}));
vitest_1.vi.mock("../../packages/core/src/agents/context-builder.js", () => ({
    buildContextPacket: vitest_1.vi.fn(async () => ({
        project: { name: "test", path: "/tmp", stack: {}, testing: null, linting: [], services: [] },
        git: { branch: "main", remote: null, clean: true },
    })),
    contextPacketToMarkdown: vitest_1.vi.fn(() => "# Test context"),
}));
const { mockCommitStepChanges, mockCaptureChangeset, mockReadFile, mockWriteFile } = vitest_1.vi.hoisted(() => ({
    mockCommitStepChanges: vitest_1.vi.fn(async () => true),
    mockCaptureChangeset: vitest_1.vi.fn(async () => null),
    mockReadFile: vitest_1.vi.fn(async () => "---\nstatus: in-progress\n---\n"),
    mockWriteFile: vitest_1.vi.fn(async () => { }),
}));
vitest_1.vi.mock("../../packages/core/src/orchestrator/git-ops.js", () => ({
    commitStepChanges: mockCommitStepChanges,
    captureChangeset: mockCaptureChangeset,
}));
vitest_1.vi.mock("node:fs/promises", () => ({
    readFile: mockReadFile,
    writeFile: mockWriteFile,
}));
const { mockResolveRoleConfig } = vitest_1.vi.hoisted(() => ({
    mockResolveRoleConfig: vitest_1.vi.fn(() => ({
        roleId: "engineer",
        name: "Engineer",
        permissionMode: "acceptEdits",
        allowedTools: [],
        disallowedTools: ["EnterPlanMode", "ExitPlanMode", "EnterWorktree"],
        allowedBashPatterns: [],
        instructions: "",
        doneCriteria: "",
        runTests: false,
        runOracle: true,
    })),
}));
vitest_1.vi.mock("../../packages/core/src/config/roles.js", () => ({
    loadRole: vitest_1.vi.fn(async () => ({ id: "engineer", name: "Engineer" })),
    resolveRoleConfig: mockResolveRoleConfig,
}));
const { mockCreate, mockRemove, mockHasCommits, mockMerge, mockWriteLock } = vitest_1.vi.hoisted(() => ({
    mockCreate: vitest_1.vi.fn(),
    mockRemove: vitest_1.vi.fn(),
    mockHasCommits: vitest_1.vi.fn(),
    mockMerge: vitest_1.vi.fn(),
    mockWriteLock: vitest_1.vi.fn(),
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
    }));
    MockManager.cleanupOrphaned = vitest_1.vi.fn(async () => []);
    return { WorktreeManager: MockManager };
});
vitest_1.vi.mock("../../packages/core/src/skills/oracle.js", async (importOriginal) => {
    const mod = await importOriginal();
    return {
        ...mod,
        collectOracleInputs: vitest_1.vi.fn(async () => ({
            ticket: { id: "t1", title: "Test ticket", status: "in-progress", deps: [], links: [], tags: {} },
            gitDiff: "", // Empty diff for zero-commit case
            acceptanceCriteria: ["Feature is implemented", "Tests are included"],
        })),
    };
});
function makePlan(steps, configOverrides) {
    return {
        id: "test-plan",
        name: "Test Plan",
        status: "planning",
        scope: {},
        steps,
        config: {
            ...(0, persistence_js_1.defaultConfig)(),
            worktree: true,
            verification: { runTests: false, runOracle: true, maxRetries: 0 },
            ...configOverrides,
        },
        context: "",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
    };
}
(0, vitest_1.describe)("Zero-commit oracle arbitration", () => {
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
        // Zero commits — agent didn't do anything
        mockHasCommits.mockResolvedValue(false);
        mockMerge.mockResolvedValue({ merged: true, conflict: false });
        mockScanTickets.mockResolvedValue([
            {
                id: "t1", title: "Test ticket", status: "in-progress",
                filePath: "/tmp/test-p/.tickets/impl/t1/README.md",
                deps: [], links: [], tags: {},
            },
        ]);
        mockReadFile.mockResolvedValue("---\nstatus: in-progress\n---\n");
    });
    (0, vitest_1.it)("step completes as done when oracle says criteria are already met (zero commits)", async () => {
        mockSM.onOracleStart = (session) => {
            mockSM.simulateOracleResponse(session, ORACLE_RESPONSE_ALL_MET);
        };
        const plan = makePlan([
            { ticketId: "t1", projectId: "p", status: "ready", blockedBy: [] },
        ]);
        const executor = new executor_js_1.Executor(plan, mockSM);
        const completed = [];
        executor.on("step_completed", ({ step }) => completed.push(step.ticketId));
        const runPromise = executor.run();
        await new Promise((r) => setTimeout(r, 50));
        // Complete the coding agent (which made no commits)
        mockSM.simulateCompletion(plan.steps[0].agentSessionId);
        await new Promise((r) => setTimeout(r, 300));
        (0, vitest_1.expect)(completed).toContain("t1");
        (0, vitest_1.expect)(plan.steps[0].status).toBe("done");
        (0, vitest_1.expect)(plan.steps[0].verification).toBeDefined();
        (0, vitest_1.expect)(plan.steps[0].verification.passed).toBe(true);
        (0, vitest_1.expect)(plan.steps[0].verification.oracle.passed).toBe(true);
        executor.stop();
        await runPromise;
    });
    (0, vitest_1.it)("step fails when oracle says criteria are unmet (zero commits)", async () => {
        mockSM.onOracleStart = (session) => {
            mockSM.simulateOracleResponse(session, ORACLE_RESPONSE_UNMET);
        };
        const plan = makePlan([
            { ticketId: "t1", projectId: "p", status: "ready", blockedBy: [] },
        ], { pauseOnFailure: false });
        const executor = new executor_js_1.Executor(plan, mockSM);
        const failed = [];
        executor.on("step_failed", ({ step }) => failed.push(step.ticketId));
        const runPromise = executor.run();
        await new Promise((r) => setTimeout(r, 50));
        mockSM.simulateCompletion(plan.steps[0].agentSessionId);
        await new Promise((r) => setTimeout(r, 300));
        (0, vitest_1.expect)(failed).toContain("t1");
        (0, vitest_1.expect)(plan.steps[0].status).toBe("failed");
        (0, vitest_1.expect)(plan.steps[0].verification).toBeDefined();
        (0, vitest_1.expect)(plan.steps[0].verification.passed).toBe(false);
        executor.stop();
        await runPromise;
    });
    (0, vitest_1.it)("skips oracle and fails immediately when oracle is disabled (zero commits)", async () => {
        // Override role config to also disable oracle
        mockResolveRoleConfig.mockReturnValueOnce({
            roleId: "engineer",
            name: "Engineer",
            permissionMode: "acceptEdits",
            allowedTools: [],
            disallowedTools: ["EnterPlanMode", "ExitPlanMode", "EnterWorktree"],
            allowedBashPatterns: [],
            instructions: "",
            doneCriteria: "",
            runTests: false,
            runOracle: false,
        });
        const plan = makePlan([
            { ticketId: "t1", projectId: "p", status: "ready", blockedBy: [] },
        ], {
            pauseOnFailure: false,
            verification: { runTests: false, runOracle: false, maxRetries: 0 },
        });
        const executor = new executor_js_1.Executor(plan, mockSM);
        const failed = [];
        executor.on("step_failed", ({ step }) => failed.push(step.ticketId));
        const runPromise = executor.run();
        await new Promise((r) => setTimeout(r, 50));
        mockSM.simulateCompletion(plan.steps[0].agentSessionId);
        await new Promise((r) => setTimeout(r, 200));
        (0, vitest_1.expect)(failed).toContain("t1");
        (0, vitest_1.expect)(plan.steps[0].status).toBe("failed");
        // No oracle session should have been started
        const oracleCalls = mockSM.startCalls.filter((c) => c.ticketId?.startsWith("oracle:"));
        (0, vitest_1.expect)(oracleCalls).toHaveLength(0);
        executor.stop();
        await runPromise;
    });
    (0, vitest_1.it)("enters verifying status while oracle arbitrates zero-commit step", async () => {
        let verifyingObserved = false;
        mockSM.onOracleStart = (session) => {
            setTimeout(() => {
                if (plan.steps[0].status === "verifying") {
                    verifyingObserved = true;
                }
                mockSM.simulateOracleResponse(session, ORACLE_RESPONSE_ALL_MET);
            }, 20);
        };
        const plan = makePlan([
            { ticketId: "t1", projectId: "p", status: "ready", blockedBy: [] },
        ]);
        const executor = new executor_js_1.Executor(plan, mockSM);
        const runPromise = executor.run();
        await new Promise((r) => setTimeout(r, 50));
        mockSM.simulateCompletion(plan.steps[0].agentSessionId);
        await new Promise((r) => setTimeout(r, 300));
        (0, vitest_1.expect)(verifyingObserved).toBe(true);
        executor.stop();
        await runPromise;
    });
    (0, vitest_1.it)("runs oracle with runTests: false for zero-commit case", async () => {
        mockSM.onOracleStart = (session) => {
            mockSM.simulateOracleResponse(session, ORACLE_RESPONSE_ALL_MET);
        };
        const plan = makePlan([
            { ticketId: "t1", projectId: "p", status: "ready", blockedBy: [] },
        ], {
            // Both tests and oracle enabled at plan level
            verification: { runTests: true, runOracle: true, maxRetries: 0 },
        });
        const executor = new executor_js_1.Executor(plan, mockSM);
        const runPromise = executor.run();
        await new Promise((r) => setTimeout(r, 50));
        mockSM.simulateCompletion(plan.steps[0].agentSessionId);
        await new Promise((r) => setTimeout(r, 300));
        // Oracle should have been called (for zero-commit arbitration)
        const oracleCalls = mockSM.startCalls.filter((c) => c.ticketId?.startsWith("oracle:"));
        (0, vitest_1.expect)(oracleCalls).toHaveLength(1);
        // Step should complete successfully (oracle passes)
        (0, vitest_1.expect)(plan.steps[0].status).toBe("done");
        // Test gate should NOT be in the verification result (tests skipped for zero-commit)
        (0, vitest_1.expect)(plan.steps[0].verification.testGate).toBeUndefined();
        executor.stop();
        await runPromise;
    });
    (0, vitest_1.it)("cleans up worktree when zero-commit oracle passes", async () => {
        mockSM.onOracleStart = (session) => {
            mockSM.simulateOracleResponse(session, ORACLE_RESPONSE_ALL_MET);
        };
        const plan = makePlan([
            { ticketId: "t1", projectId: "p", status: "ready", blockedBy: [] },
        ]);
        const executor = new executor_js_1.Executor(plan, mockSM);
        const runPromise = executor.run();
        await new Promise((r) => setTimeout(r, 50));
        mockSM.simulateCompletion(plan.steps[0].agentSessionId);
        await new Promise((r) => setTimeout(r, 300));
        // Worktree should be cleaned up
        (0, vitest_1.expect)(mockRemove).toHaveBeenCalledWith("t1");
        (0, vitest_1.expect)(plan.steps[0].worktreePath).toBeUndefined();
        (0, vitest_1.expect)(plan.steps[0].worktreeBranch).toBeUndefined();
        executor.stop();
        await runPromise;
    });
    (0, vitest_1.it)("does not attempt merge when zero-commit oracle passes", async () => {
        mockSM.onOracleStart = (session) => {
            mockSM.simulateOracleResponse(session, ORACLE_RESPONSE_ALL_MET);
        };
        const plan = makePlan([
            { ticketId: "t1", projectId: "p", status: "ready", blockedBy: [] },
        ]);
        const executor = new executor_js_1.Executor(plan, mockSM);
        const runPromise = executor.run();
        await new Promise((r) => setTimeout(r, 50));
        mockSM.simulateCompletion(plan.steps[0].agentSessionId);
        await new Promise((r) => setTimeout(r, 300));
        // No merge should be attempted — no commits to merge
        (0, vitest_1.expect)(mockMerge).not.toHaveBeenCalled();
        executor.stop();
        await runPromise;
    });
});
//# sourceMappingURL=executor-zero-commit-oracle.test.js.map