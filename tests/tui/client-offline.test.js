"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
// Track SessionManager instances and their event handlers
const sessionManagerHandlers = new Map();
const mockStartSession = vitest_1.vi.fn();
const mockStopSession = vitest_1.vi.fn();
const mockPromptSession = vitest_1.vi.fn();
const mockExecutorPause = vitest_1.vi.fn();
const mockExecutorResume = vitest_1.vi.fn();
let resolveExecutorRun;
const mockExecutorRun = vitest_1.vi.fn().mockImplementation(() => new Promise((resolve) => { resolveExecutorRun = resolve; }));
const mockExecutorOn = vitest_1.vi.fn();
vitest_1.vi.mock("@opcom/core", async () => {
    const actual = await vitest_1.vi.importActual("@opcom/core");
    return {
        ...actual,
        loadGlobalConfig: vitest_1.vi.fn().mockResolvedValue({ defaultWorkspace: "default" }),
        loadWorkspace: vitest_1.vi.fn().mockResolvedValue({ projectIds: ["proj1"] }),
        loadProject: vitest_1.vi.fn().mockImplementation((id) => {
            if (id === "proj1") {
                return Promise.resolve({
                    id: "proj1",
                    name: "Test Project",
                    path: "/tmp/test",
                    stack: {
                        languages: [{ name: "typescript", version: "5.0", sourceFile: "package.json" }],
                        frameworks: [],
                        packageManagers: [],
                        infrastructure: [],
                        versionManagers: [],
                    },
                    testing: null,
                    linting: [],
                    services: [],
                    docs: { agentConfig: null },
                    git: { branch: "main", remote: null, clean: true },
                    workSystem: null,
                });
            }
            return Promise.resolve(null);
        }),
        refreshProjectStatus: vitest_1.vi.fn().mockResolvedValue({
            gitFresh: { branch: "main", remote: null, clean: true },
            workSummary: null,
        }),
        scanTickets: vitest_1.vi.fn().mockResolvedValue([]),
        Station: { isRunning: vitest_1.vi.fn().mockResolvedValue({ running: false }) },
        SessionManager: vitest_1.vi.fn().mockImplementation(() => ({
            init: vitest_1.vi.fn().mockResolvedValue(undefined),
            on: vitest_1.vi.fn().mockImplementation((event, handler) => {
                sessionManagerHandlers.set(event, handler);
            }),
            off: vitest_1.vi.fn(),
            startSession: mockStartSession.mockImplementation(async () => {
                const session = {
                    id: "new-session",
                    backend: "claude-code",
                    projectId: "proj1",
                    state: "streaming",
                    startedAt: new Date().toISOString(),
                };
                // Simulate session_created event
                const handler = sessionManagerHandlers.get("session_created");
                if (handler)
                    handler(session);
                return session;
            }),
            stopSession: mockStopSession.mockResolvedValue(undefined),
            promptSession: mockPromptSession.mockResolvedValue(undefined),
            shutdown: vitest_1.vi.fn().mockResolvedValue(undefined),
        })),
        buildContextPacket: vitest_1.vi.fn().mockResolvedValue({
            project: {
                name: "Test Project",
                path: "/tmp/test",
                stack: { languages: [], frameworks: [], packageManagers: [], infrastructure: [], versionManagers: [] },
                testing: null,
                linting: [],
                services: [],
            },
            git: { branch: "main", remote: null, clean: true },
        }),
        createLogger: vitest_1.vi.fn().mockReturnValue({
            debug: vitest_1.vi.fn(),
            info: vitest_1.vi.fn(),
            warn: vitest_1.vi.fn(),
            error: vitest_1.vi.fn(),
        }),
        Executor: vitest_1.vi.fn().mockImplementation(() => ({
            pause: mockExecutorPause,
            resume: mockExecutorResume,
            run: mockExecutorRun,
            on: mockExecutorOn,
        })),
        savePlan: vitest_1.vi.fn().mockResolvedValue(undefined),
    };
});
const client_js_1 = require("../../packages/cli/src/tui/client.js");
(0, vitest_1.describe)("TuiClient offline mode", () => {
    let client;
    (0, vitest_1.beforeEach)(async () => {
        sessionManagerHandlers.clear();
        mockStartSession.mockClear();
        mockStopSession.mockClear();
        mockPromptSession.mockClear();
        mockExecutorPause.mockClear();
        mockExecutorResume.mockClear();
        mockExecutorRun.mockClear();
        mockExecutorOn.mockClear();
        client = new client_js_1.TuiClient();
        await client.connect();
    });
    (0, vitest_1.it)("is not in daemon mode when no server is running", () => {
        (0, vitest_1.expect)(client.daemonMode).toBe(false);
    });
    (0, vitest_1.it)("send start_agent in offline mode triggers local session manager", async () => {
        client.send({ type: "start_agent", projectId: "proj1" });
        // Wait for async handleLocalCommand
        await new Promise((r) => setTimeout(r, 50));
        (0, vitest_1.expect)(mockStartSession).toHaveBeenCalledTimes(1);
        (0, vitest_1.expect)(mockStartSession).toHaveBeenCalledWith("proj1", "claude-code", vitest_1.expect.objectContaining({ projectPath: "/tmp/test" }), undefined);
    });
    (0, vitest_1.it)("agent events from local session manager flow through to agentEvents map", async () => {
        client.send({ type: "start_agent", projectId: "proj1" });
        await new Promise((r) => setTimeout(r, 50));
        // session_created handler should have pushed to agents
        (0, vitest_1.expect)(client.agents.some((a) => a.id === "new-session")).toBe(true);
        // Simulate an agent_event from the session manager
        const eventHandler = sessionManagerHandlers.get("agent_event");
        if (eventHandler) {
            const event = {
                type: "message_delta",
                sessionId: "new-session",
                timestamp: new Date().toISOString(),
                data: { text: "working..." },
            };
            eventHandler({ sessionId: "new-session", event });
        }
        const events = client.agentEvents.get("new-session");
        (0, vitest_1.expect)(events).toBeDefined();
        (0, vitest_1.expect)(events.length).toBeGreaterThan(0);
        (0, vitest_1.expect)(events[events.length - 1].data?.text).toBe("working...");
    });
    (0, vitest_1.it)("send stop_agent in offline mode calls session manager", async () => {
        client.send({ type: "stop_agent", agentId: "session-1" });
        await new Promise((r) => setTimeout(r, 50));
        (0, vitest_1.expect)(mockStopSession).toHaveBeenCalledWith("session-1");
    });
    (0, vitest_1.it)("send prompt in offline mode calls session manager", async () => {
        client.send({ type: "prompt", agentId: "session-1", text: "hello" });
        await new Promise((r) => setTimeout(r, 50));
        (0, vitest_1.expect)(mockPromptSession).toHaveBeenCalledWith("session-1", "hello");
    });
    (0, vitest_1.it)("destroy shuts down local session manager", () => {
        client.destroy();
        // Should not throw
        (0, vitest_1.expect)(client.connected).toBe(false);
    });
    (0, vitest_1.describe)("plan pause/resume in offline mode", () => {
        const fakePlan = {
            id: "plan-1",
            name: "test plan",
            status: "planning",
            scope: { projectIds: ["proj1"], query: "" },
            steps: [{ ticketId: "t1", projectId: "proj1", status: "ready" }],
            config: { worktree: false, pauseOnFailure: false, ticketTransitions: true, verification: { enabled: false, testCommand: "", autoRebase: false } },
            createdAt: new Date().toISOString(),
            context: "",
        };
        async function startExecutor() {
            client.activePlan = { ...fakePlan, status: "planning" };
            await client.executePlan("plan-1");
            await new Promise((r) => setTimeout(r, 50));
        }
        (0, vitest_1.it)("executePlan creates an executor in offline mode", async () => {
            await startExecutor();
            const { Executor } = await import("@opcom/core");
            (0, vitest_1.expect)(Executor).toHaveBeenCalledTimes(1);
            (0, vitest_1.expect)(mockExecutorRun).toHaveBeenCalledTimes(1);
        });
        (0, vitest_1.it)("pause_plan calls executor.pause() in offline mode", async () => {
            await startExecutor();
            client.send({ type: "pause_plan", planId: "plan-1" });
            await new Promise((r) => setTimeout(r, 50));
            (0, vitest_1.expect)(mockExecutorPause).toHaveBeenCalledTimes(1);
        });
        (0, vitest_1.it)("resume_plan calls executor.resume() in offline mode", async () => {
            await startExecutor();
            client.send({ type: "resume_plan", planId: "plan-1" });
            await new Promise((r) => setTimeout(r, 50));
            (0, vitest_1.expect)(mockExecutorResume).toHaveBeenCalledTimes(1);
        });
        (0, vitest_1.it)("pause_plan is a no-op when no executor is active", async () => {
            client.send({ type: "pause_plan", planId: "plan-1" });
            await new Promise((r) => setTimeout(r, 50));
            (0, vitest_1.expect)(mockExecutorPause).not.toHaveBeenCalled();
        });
        (0, vitest_1.it)("resume_plan is a no-op when no executor and no paused plan", async () => {
            client.send({ type: "resume_plan", planId: "plan-1" });
            await new Promise((r) => setTimeout(r, 50));
            (0, vitest_1.expect)(mockExecutorResume).not.toHaveBeenCalled();
            (0, vitest_1.expect)(mockExecutorRun).not.toHaveBeenCalled();
        });
        (0, vitest_1.it)("resume_plan re-creates executor when plan is paused but executor is dead", async () => {
            // Simulate a plan that was paused in a previous session (no executor running)
            client.activePlan = { ...fakePlan, status: "paused" };
            client.send({ type: "resume_plan", planId: "plan-1" });
            await new Promise((r) => setTimeout(r, 50));
            // Should have created a new executor via executePlan
            const { Executor } = await import("@opcom/core");
            (0, vitest_1.expect)(Executor).toHaveBeenCalled();
            (0, vitest_1.expect)(mockExecutorRun).toHaveBeenCalled();
        });
    });
});
//# sourceMappingURL=client-offline.test.js.map