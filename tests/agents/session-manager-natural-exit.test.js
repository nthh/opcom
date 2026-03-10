"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const session_manager_js_1 = require("../../packages/core/src/agents/session-manager.js");
// Mock the adapter to produce a controllable event stream
vitest_1.vi.mock("../../packages/core/src/agents/adapter.js", () => ({
    createAdapter: vitest_1.vi.fn(() => ({
        start: vitest_1.vi.fn(async (config) => ({
            id: "test-session-1",
            backend: "claude-code",
            projectId: "",
            state: "streaming",
            startedAt: new Date().toISOString(),
            pid: process.pid,
        })),
        stop: vitest_1.vi.fn(async () => { }),
        subscribe: vitest_1.vi.fn((sessionId) => {
            // Return an async iterable that emits agent_end then closes
            return {
                [Symbol.asyncIterator]() {
                    let done = false;
                    return {
                        async next() {
                            if (done)
                                return { value: undefined, done: true };
                            done = true;
                            const event = {
                                type: "agent_end",
                                sessionId,
                                timestamp: new Date().toISOString(),
                            };
                            return { value: event, done: false };
                        },
                    };
                },
            };
        }),
        prompt: vitest_1.vi.fn(async () => { }),
    })),
}));
// Mock persistence
vitest_1.vi.mock("../../packages/core/src/config/paths.js", () => ({
    opcomRoot: () => "/tmp/opcom-test-natural-exit",
}));
vitest_1.vi.mock("node:fs/promises", async (importOriginal) => {
    const mod = await importOriginal();
    return {
        ...mod,
        mkdir: vitest_1.vi.fn(async () => { }),
        writeFile: vitest_1.vi.fn(async () => { }),
        readdir: vitest_1.vi.fn(async () => []),
        readFile: vitest_1.vi.fn(async () => ""),
    };
});
vitest_1.vi.mock("node:fs", () => ({
    existsSync: vitest_1.vi.fn(() => true),
}));
(0, vitest_1.describe)("SessionManager natural exit", () => {
    let sm;
    (0, vitest_1.beforeEach)(() => {
        vitest_1.vi.clearAllMocks();
        sm = new session_manager_js_1.SessionManager();
    });
    (0, vitest_1.it)("emits session_stopped when agent exits naturally via agent_end", async () => {
        await sm.init();
        const stoppedSessions = [];
        sm.on("session_stopped", (session) => {
            stoppedSessions.push(session);
        });
        const stateChanges = [];
        sm.on("state_change", (data) => {
            stateChanges.push({ sessionId: data.sessionId, newState: data.newState });
        });
        const session = await sm.startSession("proj1", "claude-code", {
            projectPath: "/tmp/test",
        });
        // Give consumeEvents time to process the agent_end event
        await new Promise((r) => setTimeout(r, 100));
        // Should have emitted state_change to stopped
        (0, vitest_1.expect)(stateChanges.some((c) => c.newState === "stopped")).toBe(true);
        // Should have emitted session_stopped (the fix!)
        (0, vitest_1.expect)(stoppedSessions).toHaveLength(1);
        (0, vitest_1.expect)(stoppedSessions[0].id).toBe(session.id);
        (0, vitest_1.expect)(stoppedSessions[0].state).toBe("stopped");
    });
});
//# sourceMappingURL=session-manager-natural-exit.test.js.map