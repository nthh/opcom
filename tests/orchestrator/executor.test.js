"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const executor_js_1 = require("../../packages/core/src/orchestrator/executor.js");
const persistence_js_1 = require("../../packages/core/src/orchestrator/persistence.js");
const promises_1 = require("node:fs/promises");
const node_path_1 = require("node:path");
const node_os_1 = require("node:os");
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
    // Simulate an agent writing files (so completion check passes)
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
    // Simulate an agent completing
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
    // Simulate an agent error — emits state_change then session_stopped
    simulateError(sessionId) {
        this.emit("state_change", {
            sessionId,
            oldState: "streaming",
            newState: "error",
        });
        // Error state is non-fatal; the agent stops shortly after
        const session = {
            id: sessionId,
            backend: "claude-code",
            projectId: "test",
            state: "stopped",
            startedAt: new Date().toISOString(),
            stoppedAt: new Date().toISOString(),
        };
        this.emit("session_stopped", session);
    }
}
// Mock the persistence and loader modules
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
        runTests: true,
        runOracle: false,
    })),
}));
vitest_1.vi.mock("../../packages/core/src/orchestrator/smoke-test.js", () => ({
    runSmoke: vitest_1.vi.fn(async () => ({ passed: true, buildPassed: true, testsPassed: true, buildOutput: "", testOutput: "", durationMs: 0 })),
}));
vitest_1.vi.mock("../../packages/core/src/orchestrator/worktree.js", () => {
    return {
        WorktreeManager: vitest_1.vi.fn().mockImplementation(() => ({
            create: vitest_1.vi.fn(),
            remove: vitest_1.vi.fn(),
            hasCommits: vitest_1.vi.fn(),
            merge: vitest_1.vi.fn(),
            attemptRebase: vitest_1.vi.fn(),
            getInfo: vitest_1.vi.fn(),
            restore: vitest_1.vi.fn(),
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
        config: { ...(0, persistence_js_1.defaultConfig)(), worktree: false, ...configOverrides },
        context: "",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
    };
}
(0, vitest_1.describe)("Executor", () => {
    let mockSM;
    (0, vitest_1.beforeEach)(() => {
        mockSM = new MockSessionManager();
        vitest_1.vi.clearAllMocks();
    });
    (0, vitest_1.it)("finds ready steps and starts agents up to concurrency limit", async () => {
        const plan = makePlan([
            { ticketId: "t1", projectId: "p", status: "ready", blockedBy: [] },
            { ticketId: "t2", projectId: "p", status: "ready", blockedBy: [] },
            { ticketId: "t3", projectId: "p", status: "ready", blockedBy: [] },
            { ticketId: "t4", projectId: "p", status: "ready", blockedBy: [] },
        ], { maxConcurrentAgents: 2 });
        const executor = new executor_js_1.Executor(plan, mockSM);
        // Run in background, stop after first batch starts
        const runPromise = executor.run();
        // Give it a tick to start
        await new Promise((r) => setTimeout(r, 50));
        (0, vitest_1.expect)(mockSM.startCalls).toHaveLength(2); // respects concurrency limit
        (0, vitest_1.expect)(plan.steps.filter((s) => s.status === "in-progress")).toHaveLength(2);
        (0, vitest_1.expect)(plan.steps.filter((s) => s.status === "ready")).toHaveLength(2);
        executor.stop();
        await runPromise;
    });
    (0, vitest_1.it)("agent completion → step done → downstream becomes ready", async () => {
        const plan = makePlan([
            { ticketId: "t1", projectId: "p", status: "ready", blockedBy: [] },
            { ticketId: "t2", projectId: "p", status: "blocked", blockedBy: ["t1"] },
        ]);
        const executor = new executor_js_1.Executor(plan, mockSM);
        const completedSteps = [];
        executor.on("step_completed", ({ step }) => completedSteps.push(step.ticketId));
        const runPromise = executor.run();
        await new Promise((r) => setTimeout(r, 50));
        // t1 should be started
        (0, vitest_1.expect)(mockSM.startCalls).toHaveLength(1);
        (0, vitest_1.expect)(mockSM.startCalls[0].ticketId).toBe("t1");
        // Simulate t1 agent writing files then completing
        const sessionId = plan.steps.find((s) => s.ticketId === "t1").agentSessionId;
        mockSM.simulateWrite(sessionId);
        mockSM.simulateCompletion(sessionId);
        await new Promise((r) => setTimeout(r, 50));
        (0, vitest_1.expect)(completedSteps).toContain("t1");
        executor.stop();
        await runPromise;
    });
    (0, vitest_1.it)("agent error → step failed → plan pauses (if pauseOnFailure)", async () => {
        const plan = makePlan([
            { ticketId: "t1", projectId: "p", status: "ready", blockedBy: [] },
        ], { pauseOnFailure: true });
        const executor = new executor_js_1.Executor(plan, mockSM);
        let paused = false;
        executor.on("plan_paused", () => { paused = true; });
        const runPromise = executor.run();
        await new Promise((r) => setTimeout(r, 50));
        // Simulate error
        const sessionId = plan.steps.find((s) => s.ticketId === "t1").agentSessionId;
        mockSM.simulateError(sessionId);
        await new Promise((r) => setTimeout(r, 50));
        (0, vitest_1.expect)(plan.steps.find((s) => s.ticketId === "t1").status).toBe("failed");
        (0, vitest_1.expect)(paused).toBe(true);
        (0, vitest_1.expect)(plan.status).toBe("paused");
        executor.stop();
        await runPromise;
    });
    (0, vitest_1.it)("event loop stays alive while paused — resume works after pauseOnFailure", async () => {
        const plan = makePlan([
            { ticketId: "t1", projectId: "p", status: "ready", blockedBy: [] },
            { ticketId: "t2", projectId: "p", status: "ready", blockedBy: [] },
        ], { pauseOnFailure: true, maxConcurrentAgents: 1 });
        const executor = new executor_js_1.Executor(plan, mockSM);
        let paused = false;
        let resumed = false;
        executor.on("plan_paused", () => { paused = true; });
        executor.on("plan_updated", ({ plan: p }) => {
            if (p.status === "executing" && paused)
                resumed = true;
        });
        const runPromise = executor.run();
        await new Promise((r) => setTimeout(r, 50));
        // t1 started
        (0, vitest_1.expect)(mockSM.startCalls).toHaveLength(1);
        // Simulate t1 failure
        const sessionId = plan.steps.find((s) => s.ticketId === "t1").agentSessionId;
        mockSM.simulateError(sessionId);
        await new Promise((r) => setTimeout(r, 50));
        (0, vitest_1.expect)(paused).toBe(true);
        (0, vitest_1.expect)(plan.status).toBe("paused");
        // t2 should still be ready (not started while paused)
        (0, vitest_1.expect)(plan.steps.find((s) => s.ticketId === "t2").status).toBe("ready");
        // Resume — event loop must still be alive for this to work
        executor.resume();
        await new Promise((r) => setTimeout(r, 200));
        (0, vitest_1.expect)(resumed).toBe(true);
        (0, vitest_1.expect)(executor.getPlan().status).not.toBe("paused");
        // t2 should have been started after resume
        (0, vitest_1.expect)(mockSM.startCalls.length).toBeGreaterThan(1);
        executor.stop();
        await runPromise;
    });
    (0, vitest_1.it)("event loop stays alive when all steps are terminal and plan is paused", async () => {
        // Single step — when it fails with pauseOnFailure, all steps are terminal.
        // The event loop must NOT exit, so resume can re-enter.
        const plan = makePlan([
            { ticketId: "t1", projectId: "p", status: "ready", blockedBy: [] },
        ], { pauseOnFailure: true });
        const executor = new executor_js_1.Executor(plan, mockSM);
        const runPromise = executor.run();
        await new Promise((r) => setTimeout(r, 50));
        // Simulate failure
        const sessionId = plan.steps.find((s) => s.ticketId === "t1").agentSessionId;
        mockSM.simulateError(sessionId);
        await new Promise((r) => setTimeout(r, 50));
        (0, vitest_1.expect)(plan.status).toBe("paused");
        // Verify run() has NOT resolved — the event loop is still alive
        let runResolved = false;
        runPromise.then(() => { runResolved = true; });
        await new Promise((r) => setTimeout(r, 100));
        (0, vitest_1.expect)(runResolved).toBe(false);
        executor.stop();
        await runPromise;
    });
    (0, vitest_1.it)("pause stops new starts, resume recomputes", async () => {
        const plan = makePlan([
            { ticketId: "t1", projectId: "p", status: "ready", blockedBy: [] },
            { ticketId: "t2", projectId: "p", status: "ready", blockedBy: [] },
        ], { maxConcurrentAgents: 1 });
        const executor = new executor_js_1.Executor(plan, mockSM);
        const runPromise = executor.run();
        await new Promise((r) => setTimeout(r, 50));
        (0, vitest_1.expect)(mockSM.startCalls).toHaveLength(1);
        // Pause — should stop running agent and reset step to ready
        executor.pause();
        await new Promise((r) => setTimeout(r, 100));
        (0, vitest_1.expect)(executor.getPlan().status).toBe("paused");
        (0, vitest_1.expect)(executor.getPlan().steps.every((s) => s.status === "ready")).toBe(true);
        const startsBeforeResume = mockSM.startCalls.length;
        // Resume — should restart agents
        executor.resume();
        await new Promise((r) => setTimeout(r, 200));
        // After resume, plan should be executing and agents restarted
        (0, vitest_1.expect)(["executing", "done"]).toContain(executor.getPlan().status);
        (0, vitest_1.expect)(mockSM.startCalls.length).toBeGreaterThan(startsBeforeResume);
        executor.stop();
        await runPromise;
    });
    (0, vitest_1.it)("context injection appends to plan.context", async () => {
        const plan = makePlan([
            { ticketId: "t1", projectId: "p", status: "ready", blockedBy: [] },
        ]);
        const executor = new executor_js_1.Executor(plan, mockSM);
        const runPromise = executor.run();
        await new Promise((r) => setTimeout(r, 50));
        await executor.injectContext("First note");
        (0, vitest_1.expect)(plan.context).toBe("First note");
        await executor.injectContext("Second note");
        (0, vitest_1.expect)(plan.context).toBe("First note\nSecond note");
        executor.stop();
        await runPromise;
    });
    (0, vitest_1.it)("skip step → step becomes skipped, downstream unblocked", async () => {
        const plan = makePlan([
            { ticketId: "t1", projectId: "p", status: "ready", blockedBy: [] },
            { ticketId: "t2", projectId: "p", status: "blocked", blockedBy: ["t1"] },
        ]);
        const executor = new executor_js_1.Executor(plan, mockSM);
        const runPromise = executor.run();
        await new Promise((r) => setTimeout(r, 50));
        // Skip t1 instead of running it
        executor.skipStep("t1");
        await new Promise((r) => setTimeout(r, 50));
        (0, vitest_1.expect)(plan.steps.find((s) => s.ticketId === "t1").status).toBe("skipped");
        executor.stop();
        await runPromise;
    });
});
(0, vitest_1.describe)("Executor plan event logging", () => {
    let mockSM;
    (0, vitest_1.beforeEach)(() => {
        mockSM = new MockSessionManager();
        vitest_1.vi.clearAllMocks();
    });
    (0, vitest_1.it)("logs plan events to EventStore when provided", async () => {
        // Create a mock EventStore
        const planEvents = [];
        const mockEventStore = {
            insertPlanEvent: (planId, eventType, opts) => {
                planEvents.push({ planId, eventType, opts });
            },
        };
        const plan = makePlan([
            { ticketId: "t1", projectId: "p", status: "ready", blockedBy: [] },
        ]);
        const executor = new executor_js_1.Executor(plan, mockSM, mockEventStore);
        const runPromise = executor.run();
        await new Promise((r) => setTimeout(r, 50));
        // Should have logged plan_started and step_started
        (0, vitest_1.expect)(planEvents.some((e) => e.eventType === "plan_started")).toBe(true);
        (0, vitest_1.expect)(planEvents.some((e) => e.eventType === "step_started")).toBe(true);
        // Complete the step with writes
        const sessionId = plan.steps[0].agentSessionId;
        mockSM.simulateWrite(sessionId);
        mockSM.simulateCompletion(sessionId);
        await new Promise((r) => setTimeout(r, 100));
        // Should have logged step_completed and plan_completed
        (0, vitest_1.expect)(planEvents.some((e) => e.eventType === "step_completed")).toBe(true);
        (0, vitest_1.expect)(planEvents.some((e) => e.eventType === "plan_completed")).toBe(true);
        executor.stop();
        await runPromise;
    });
});
(0, vitest_1.describe)("Executor auto-commit", () => {
    let mockSM;
    (0, vitest_1.beforeEach)(() => {
        mockSM = new MockSessionManager();
        vitest_1.vi.clearAllMocks();
    });
    (0, vitest_1.it)("calls commitStepChanges after step completes when autoCommit is true", async () => {
        const plan = makePlan([
            { ticketId: "t1", projectId: "p", status: "ready", blockedBy: [] },
        ], { autoCommit: true });
        const executor = new executor_js_1.Executor(plan, mockSM);
        const runPromise = executor.run();
        await new Promise((r) => setTimeout(r, 50));
        const sessionId = plan.steps[0].agentSessionId;
        mockSM.simulateWrite(sessionId);
        mockSM.simulateCompletion(sessionId);
        await new Promise((r) => setTimeout(r, 100));
        (0, vitest_1.expect)(mockCommitStepChanges).toHaveBeenCalledWith("/tmp/test-p", "t1");
        executor.stop();
        await runPromise;
    });
    (0, vitest_1.it)("does not call commitStepChanges when autoCommit is false", async () => {
        const plan = makePlan([
            { ticketId: "t1", projectId: "p", status: "ready", blockedBy: [] },
        ], { autoCommit: false });
        const executor = new executor_js_1.Executor(plan, mockSM);
        const runPromise = executor.run();
        await new Promise((r) => setTimeout(r, 50));
        const sessionId = plan.steps[0].agentSessionId;
        mockSM.simulateWrite(sessionId);
        mockSM.simulateCompletion(sessionId);
        await new Promise((r) => setTimeout(r, 100));
        (0, vitest_1.expect)(mockCommitStepChanges).not.toHaveBeenCalled();
        executor.stop();
        await runPromise;
    });
});
(0, vitest_1.describe)("Executor allowedTools passthrough", () => {
    let mockSM;
    (0, vitest_1.beforeEach)(() => {
        mockSM = new MockSessionManager();
        vitest_1.vi.clearAllMocks();
    });
    (0, vitest_1.it)("passes derived allowedTools to sessionManager.startSession", async () => {
        const plan = makePlan([
            { ticketId: "t1", projectId: "p", status: "ready", blockedBy: [] },
        ]);
        const executor = new executor_js_1.Executor(plan, mockSM);
        const runPromise = executor.run();
        await new Promise((r) => setTimeout(r, 50));
        (0, vitest_1.expect)(mockSM.startCalls).toHaveLength(1);
        const config = mockSM.startCalls[0].config;
        (0, vitest_1.expect)(config.allowedTools).toBeDefined();
        (0, vitest_1.expect)(Array.isArray(config.allowedTools)).toBe(true);
        // Should include always-safe patterns
        (0, vitest_1.expect)(config.allowedTools).toContain("Bash(git status*)");
        (0, vitest_1.expect)(config.allowedTools).toContain("Bash(git diff*)");
        // Should include npm patterns from the mocked project
        (0, vitest_1.expect)(config.allowedTools).toContain("Bash(npm test*)");
        (0, vitest_1.expect)(config.allowedTools).toContain("Bash(npm run *)");
        (0, vitest_1.expect)(config.allowedTools).toContain("Bash(npx *)");
        // Should include eslint patterns from the mocked project
        (0, vitest_1.expect)(config.allowedTools).toContain("Bash(eslint *)");
        executor.stop();
        await runPromise;
    });
    (0, vitest_1.it)("includes user-provided allowedBashPatterns from plan config", async () => {
        const plan = makePlan([
            { ticketId: "t1", projectId: "p", status: "ready", blockedBy: [] },
        ], { allowedBashPatterns: ["docker compose*", "make *"] });
        const executor = new executor_js_1.Executor(plan, mockSM);
        const runPromise = executor.run();
        await new Promise((r) => setTimeout(r, 50));
        const config = mockSM.startCalls[0].config;
        (0, vitest_1.expect)(config.allowedTools).toContain("Bash(docker compose*)");
        (0, vitest_1.expect)(config.allowedTools).toContain("Bash(make *)");
        executor.stop();
        await runPromise;
    });
});
(0, vitest_1.describe)("updateTicketStatus", () => {
    let tmpDir;
    (0, vitest_1.beforeEach)(async () => {
        tmpDir = await (0, promises_1.mkdtemp)((0, node_path_1.join)((0, node_os_1.tmpdir)(), "opcom-test-"));
    });
    (0, vitest_1.it)("replaces status in YAML frontmatter", async () => {
        const filePath = (0, node_path_1.join)(tmpDir, "ticket.md");
        const content = `---
id: test-ticket
title: Test
status: open
priority: 2
---

# Test Ticket
`;
        await (0, promises_1.writeFile)(filePath, content, "utf-8");
        await (0, executor_js_1.updateTicketStatus)(filePath, "in-progress");
        const updated = await (0, promises_1.readFile)(filePath, "utf-8");
        (0, vitest_1.expect)(updated).toContain("status: in-progress");
        (0, vitest_1.expect)(updated).not.toContain("status: open");
        await (0, promises_1.rm)(tmpDir, { recursive: true });
    });
    (0, vitest_1.it)("preserves all other frontmatter fields", async () => {
        const filePath = (0, node_path_1.join)(tmpDir, "ticket.md");
        const content = `---
id: test-ticket
title: "My Important Ticket"
status: open
priority: 1
type: feature
deps:
  - dep-1
  - dep-2
links:
  - docs/spec/foo.md
---

# Content stays intact
`;
        await (0, promises_1.writeFile)(filePath, content, "utf-8");
        await (0, executor_js_1.updateTicketStatus)(filePath, "closed");
        const updated = await (0, promises_1.readFile)(filePath, "utf-8");
        (0, vitest_1.expect)(updated).toContain("status: closed");
        (0, vitest_1.expect)(updated).toContain('title: "My Important Ticket"');
        (0, vitest_1.expect)(updated).toContain("priority: 1");
        (0, vitest_1.expect)(updated).toContain("type: feature");
        (0, vitest_1.expect)(updated).toContain("- dep-1");
        (0, vitest_1.expect)(updated).toContain("- dep-2");
        (0, vitest_1.expect)(updated).toContain("# Content stays intact");
        await (0, promises_1.rm)(tmpDir, { recursive: true });
    });
    (0, vitest_1.it)("does not write file when status is already the target", async () => {
        const filePath = (0, node_path_1.join)(tmpDir, "ticket.md");
        const content = `---
id: test-ticket
status: closed
---
`;
        await (0, promises_1.writeFile)(filePath, content, "utf-8");
        await (0, executor_js_1.updateTicketStatus)(filePath, "closed");
        const updated = await (0, promises_1.readFile)(filePath, "utf-8");
        (0, vitest_1.expect)(updated).toBe(content);
        await (0, promises_1.rm)(tmpDir, { recursive: true });
    });
    (0, vitest_1.it)("handles status with extra whitespace", async () => {
        const filePath = (0, node_path_1.join)(tmpDir, "ticket.md");
        const content = `---
id: test-ticket
status:   open
---
`;
        await (0, promises_1.writeFile)(filePath, content, "utf-8");
        await (0, executor_js_1.updateTicketStatus)(filePath, "in-progress");
        const updated = await (0, promises_1.readFile)(filePath, "utf-8");
        (0, vitest_1.expect)(updated).toContain("status:   in-progress");
        await (0, promises_1.rm)(tmpDir, { recursive: true });
    });
    (0, vitest_1.it)("transitions from closed back to open", async () => {
        const filePath = (0, node_path_1.join)(tmpDir, "ticket.md");
        const content = `---
id: reopen-ticket
status: closed
priority: 2
---

# Reopened
`;
        await (0, promises_1.writeFile)(filePath, content, "utf-8");
        await (0, executor_js_1.updateTicketStatus)(filePath, "open");
        const updated = await (0, promises_1.readFile)(filePath, "utf-8");
        (0, vitest_1.expect)(updated).toContain("status: open");
        (0, vitest_1.expect)(updated).not.toContain("status: closed");
        await (0, promises_1.rm)(tmpDir, { recursive: true });
    });
});
//# sourceMappingURL=executor.test.js.map