"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const executor_js_1 = require("../../packages/core/src/orchestrator/executor.js");
const persistence_js_1 = require("../../packages/core/src/orchestrator/persistence.js");
const ORACLE_RESPONSE_ALL_MET = `## Criteria
- **Criterion**: Feature is implemented
  - **Met**: YES
  - **Reasoning**: The diff shows a complete implementation

- **Criterion**: Tests are included
  - **Met**: YES
  - **Reasoning**: Test file is present

## Concerns
None.
`;
const ORACLE_RESPONSE_UNMET = `## Criteria
- **Criterion**: Feature is implemented
  - **Met**: YES
  - **Reasoning**: Implementation looks correct

- **Criterion**: Tests are included
  - **Met**: NO
  - **Reasoning**: No test file found in the diff

## Concerns
- Missing test coverage for the new feature
`;
class MockSessionManager {
    listeners = new Map();
    startCalls = [];
    stopCalls = [];
    sessionCounter = 0;
    /** Callback to auto-simulate oracle sessions. Set by individual tests. */
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
        // If this is an oracle session, auto-simulate its lifecycle
        if (workItemId?.startsWith("oracle:") && this.onOracleStart) {
            // Defer to next tick so the caller can set up event listeners first
            setImmediate(() => this.onOracleStart(session));
        }
        return session;
    }
    async stopSession(sessionId) {
        this.stopCalls.push(sessionId);
    }
    simulateOracleResponse(session, responseText) {
        // Emit message_delta events with the response text
        this.emit("agent_event", {
            sessionId: session.id,
            event: {
                type: "message_delta",
                sessionId: session.id,
                timestamp: new Date().toISOString(),
                data: { text: responseText, role: "assistant" },
            },
        });
        // Then emit session_stopped
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
vitest_1.vi.mock("../../packages/core/src/config/roles.js", () => ({
    loadRole: vitest_1.vi.fn(async () => ({ id: "engineer", name: "Engineer" })),
    resolveRoleConfig: vitest_1.vi.fn(() => ({
        roleId: "engineer",
        name: "Engineer",
        permissionMode: "acceptEdits",
        allowedTools: [],
        disallowedTools: ["EnterPlanMode", "ExitPlanMode", "EnterWorktree"],
        allowedBashPatterns: [],
        instructions: "",
        doneCriteria: "",
        runTests: false,
        runOracle: true, // Oracle enabled for these tests
    })),
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
// Oracle skill mocks — collectOracleInputs, formatOraclePrompt, parseOracleResponse
// parseOracleResponse is called by the executor on the oracle agent's text output
vitest_1.vi.mock("../../packages/core/src/skills/oracle.js", async (importOriginal) => {
    const mod = await importOriginal();
    return {
        ...mod,
        collectOracleInputs: vitest_1.vi.fn(async () => ({
            ticket: { id: "t1", title: "Test ticket", status: "in-progress", deps: [], links: [], tags: {} },
            gitDiff: "diff --git a/file.ts b/file.ts\n+new code",
            acceptanceCriteria: ["Feature is implemented", "Tests are included"],
        })),
        // Keep real formatOraclePrompt and parseOracleResponse
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
(0, vitest_1.describe)("Executor oracle agent session", () => {
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
        mockHasCommits.mockResolvedValue(true);
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
    (0, vitest_1.it)("starts oracle agent via SessionManager with correct config", async () => {
        // Auto-respond when oracle starts
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
        // Complete the coding agent
        const codingSessionId = plan.steps[0].agentSessionId;
        mockSM.simulateCompletion(codingSessionId);
        await new Promise((r) => setTimeout(r, 200));
        // Should have started 2 sessions: coding agent + oracle agent
        (0, vitest_1.expect)(mockSM.startCalls.length).toBe(2);
        // Verify oracle session config
        const oracleCall = mockSM.startCalls[1];
        (0, vitest_1.expect)(oracleCall.ticketId).toBe("oracle:t1");
        (0, vitest_1.expect)(oracleCall.backend).toBe("claude-code");
        (0, vitest_1.expect)(oracleCall.config.systemPrompt).toBeDefined();
        (0, vitest_1.expect)(oracleCall.config.systemPrompt).toContain("Acceptance Criteria");
        (0, vitest_1.expect)(oracleCall.config.permissionMode).toBe("default");
        (0, vitest_1.expect)(oracleCall.config.disableAllTools).toBe(true);
        executor.stop();
        await runPromise;
    });
    (0, vitest_1.it)("uses plan's configured backend for oracle session", async () => {
        mockSM.onOracleStart = (session) => {
            mockSM.simulateOracleResponse(session, ORACLE_RESPONSE_ALL_MET);
        };
        const plan = makePlan([
            { ticketId: "t1", projectId: "p", status: "ready", blockedBy: [] },
        ]);
        plan.config.backend = "opencode";
        const executor = new executor_js_1.Executor(plan, mockSM);
        const runPromise = executor.run();
        await new Promise((r) => setTimeout(r, 50));
        mockSM.simulateCompletion(plan.steps[0].agentSessionId);
        await new Promise((r) => setTimeout(r, 200));
        const oracleCall = mockSM.startCalls.find((c) => c.ticketId?.startsWith("oracle:"));
        (0, vitest_1.expect)(oracleCall).toBeDefined();
        (0, vitest_1.expect)(oracleCall.backend).toBe("opencode");
        executor.stop();
        await runPromise;
    });
    (0, vitest_1.it)("stores oracleSessionId on VerificationResult when oracle passes", async () => {
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
        await new Promise((r) => setTimeout(r, 200));
        const step = plan.steps[0];
        (0, vitest_1.expect)(step.verification).toBeDefined();
        (0, vitest_1.expect)(step.verification.oracleSessionId).toBeDefined();
        (0, vitest_1.expect)(step.verification.oracleSessionId).toMatch(/^session-/);
        (0, vitest_1.expect)(step.verification.passed).toBe(true);
        executor.stop();
        await runPromise;
    });
    (0, vitest_1.it)("step completes when oracle criteria are all met", async () => {
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
        mockSM.simulateCompletion(plan.steps[0].agentSessionId);
        await new Promise((r) => setTimeout(r, 200));
        (0, vitest_1.expect)(completed).toContain("t1");
        (0, vitest_1.expect)(plan.steps[0].status).toBe("done");
        (0, vitest_1.expect)(plan.steps[0].verification.oracle.passed).toBe(true);
        (0, vitest_1.expect)(plan.steps[0].verification.oracle.criteria).toHaveLength(2);
        executor.stop();
        await runPromise;
    });
    (0, vitest_1.it)("step fails when oracle criteria are not met (maxRetries: 0)", async () => {
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
        await new Promise((r) => setTimeout(r, 200));
        (0, vitest_1.expect)(failed).toContain("t1");
        (0, vitest_1.expect)(plan.steps[0].status).toBe("failed");
        (0, vitest_1.expect)(plan.steps[0].verification.passed).toBe(false);
        (0, vitest_1.expect)(plan.steps[0].verification.oracle.passed).toBe(false);
        (0, vitest_1.expect)(plan.steps[0].verification.failureReasons.some((r) => r.includes("Oracle"))).toBe(true);
        executor.stop();
        await runPromise;
    });
    (0, vitest_1.it)("handles empty oracle response as failure", async () => {
        mockSM.onOracleStart = (session) => {
            // Oracle produces empty response then stops
            mockSM.emit("session_stopped", {
                ...session,
                state: "stopped",
                stoppedAt: new Date().toISOString(),
            });
        };
        const plan = makePlan([
            { ticketId: "t1", projectId: "p", status: "ready", blockedBy: [] },
        ], { pauseOnFailure: false });
        const executor = new executor_js_1.Executor(plan, mockSM);
        const runPromise = executor.run();
        await new Promise((r) => setTimeout(r, 50));
        mockSM.simulateCompletion(plan.steps[0].agentSessionId);
        await new Promise((r) => setTimeout(r, 200));
        const step = plan.steps[0];
        (0, vitest_1.expect)(step.status).toBe("failed");
        (0, vitest_1.expect)(step.verification.oracleError).toContain("no response");
        executor.stop();
        await runPromise;
    });
    (0, vitest_1.it)("oracle prompt is delivered via systemPrompt (not CLI arg)", async () => {
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
        await new Promise((r) => setTimeout(r, 200));
        const oracleCall = mockSM.startCalls.find((c) => c.ticketId?.startsWith("oracle:"));
        // Prompt is delivered via systemPrompt, not as a CLI argument
        (0, vitest_1.expect)(oracleCall.config.systemPrompt).toBeTruthy();
        // systemPrompt should contain the formatted oracle evaluation prompt
        (0, vitest_1.expect)(oracleCall.config.systemPrompt.length).toBeGreaterThan(100);
        executor.stop();
        await runPromise;
    });
    (0, vitest_1.it)("passes oracleModel to session config when configured", async () => {
        mockSM.onOracleStart = (session) => {
            mockSM.simulateOracleResponse(session, ORACLE_RESPONSE_ALL_MET);
        };
        const plan = makePlan([
            { ticketId: "t1", projectId: "p", status: "ready", blockedBy: [] },
        ]);
        plan.config.verification.oracleModel = "claude-haiku-4-5-20251001";
        const executor = new executor_js_1.Executor(plan, mockSM);
        const runPromise = executor.run();
        await new Promise((r) => setTimeout(r, 50));
        mockSM.simulateCompletion(plan.steps[0].agentSessionId);
        await new Promise((r) => setTimeout(r, 200));
        const oracleCall = mockSM.startCalls.find((c) => c.ticketId?.startsWith("oracle:"));
        (0, vitest_1.expect)(oracleCall.config.model).toBe("claude-haiku-4-5-20251001");
        executor.stop();
        await runPromise;
    });
    (0, vitest_1.it)("oracle collects response text from message_delta events", async () => {
        // Simulate streaming: multiple message_delta events
        mockSM.onOracleStart = (session) => {
            // First chunk
            mockSM.emit("agent_event", {
                sessionId: session.id,
                event: {
                    type: "message_delta",
                    sessionId: session.id,
                    timestamp: new Date().toISOString(),
                    data: { text: "## Criteria\n- **Criterion**: Feature is implemented\n  - **Met**: YES\n  - **Reasoning**: Done\n\n" },
                },
            });
            // Second chunk
            mockSM.emit("agent_event", {
                sessionId: session.id,
                event: {
                    type: "message_delta",
                    sessionId: session.id,
                    timestamp: new Date().toISOString(),
                    data: { text: "## Concerns\nNone.\n" },
                },
            });
            // Session stops
            mockSM.emit("session_stopped", {
                ...session,
                state: "stopped",
                stoppedAt: new Date().toISOString(),
            });
        };
        const plan = makePlan([
            { ticketId: "t1", projectId: "p", status: "ready", blockedBy: [] },
        ]);
        const executor = new executor_js_1.Executor(plan, mockSM);
        const runPromise = executor.run();
        await new Promise((r) => setTimeout(r, 50));
        mockSM.simulateCompletion(plan.steps[0].agentSessionId);
        await new Promise((r) => setTimeout(r, 200));
        // Response was assembled from two chunks and parsed correctly
        const step = plan.steps[0];
        (0, vitest_1.expect)(step.verification.oracle).toBeDefined();
        (0, vitest_1.expect)(step.verification.oracle.criteria).toHaveLength(1);
        (0, vitest_1.expect)(step.verification.oracle.criteria[0].met).toBe(true);
        executor.stop();
        await runPromise;
    });
    (0, vitest_1.it)("step enters verifying status while oracle runs", async () => {
        let verifyingObserved = false;
        // Delay oracle response to observe verifying state
        mockSM.onOracleStart = (session) => {
            // Check step status synchronously before responding
            setTimeout(() => {
                const step = plan.steps[0];
                if (step.status === "verifying") {
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
        (0, vitest_1.expect)(plan.steps[0].status).toBe("done");
        executor.stop();
        await runPromise;
    });
});
//# sourceMappingURL=executor-oracle.test.js.map