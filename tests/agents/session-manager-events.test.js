"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
// Mock the adapter module to return a controllable adapter
vitest_1.vi.mock("../../packages/core/src/agents/adapter.js", () => {
    return {
        createAdapter: vitest_1.vi.fn(),
    };
});
// Mock filesystem operations used by SessionManager
vitest_1.vi.mock("node:fs/promises", () => ({
    readFile: vitest_1.vi.fn().mockResolvedValue(""),
    writeFile: vitest_1.vi.fn().mockResolvedValue(undefined),
    mkdir: vitest_1.vi.fn().mockResolvedValue(undefined),
    readdir: vitest_1.vi.fn().mockResolvedValue([]),
    unlink: vitest_1.vi.fn().mockResolvedValue(undefined),
}));
vitest_1.vi.mock("node:fs", () => ({
    existsSync: vitest_1.vi.fn().mockReturnValue(true),
}));
const adapter_js_1 = require("../../packages/core/src/agents/adapter.js");
const core_1 = require("@opcom/core");
const mockCreateAdapter = vitest_1.vi.mocked(adapter_js_1.createAdapter);
function makeContextPacket() {
    return {
        project: {
            name: "test",
            path: "/tmp/test",
            stack: {
                languages: [],
                frameworks: [],
                packageManagers: [],
                infrastructure: [],
                versionManagers: [],
            },
            testing: null,
            linting: [],
            services: [],
        },
        git: { branch: "main", remote: null, clean: true },
    };
}
function createMockAdapter(events) {
    const session = {
        id: "test-session-1",
        backend: "claude-code",
        projectId: "proj1",
        state: "streaming",
        startedAt: new Date().toISOString(),
        pid: 999,
    };
    return {
        backend: "claude-code",
        start: vitest_1.vi.fn().mockResolvedValue(session),
        stop: vitest_1.vi.fn().mockResolvedValue(undefined),
        prompt: vitest_1.vi.fn().mockResolvedValue(undefined),
        subscribe: vitest_1.vi.fn().mockImplementation(async function* () {
            for (const event of events) {
                yield event;
            }
        }),
    };
}
(0, vitest_1.describe)("SessionManager event ordering", () => {
    let manager;
    (0, vitest_1.beforeEach)(async () => {
        manager = new core_1.SessionManager();
        await manager.init();
    });
    (0, vitest_1.it)("emits session_created before first agent_event", async () => {
        const ts = new Date().toISOString();
        const events = [
            { type: "agent_start", sessionId: "test-session-1", timestamp: ts, data: { reason: "started" } },
            { type: "message_start", sessionId: "test-session-1", timestamp: ts, data: { role: "assistant" } },
        ];
        const adapter = createMockAdapter(events);
        mockCreateAdapter.mockReturnValue(adapter);
        const ordering = [];
        manager.on("session_created", () => ordering.push("session_created"));
        manager.on("agent_event", () => ordering.push("agent_event"));
        await manager.startSession("proj1", "claude-code", {
            projectPath: "/tmp/test",
            contextPacket: makeContextPacket(),
        });
        // Give async generator time to yield
        await new Promise((r) => setTimeout(r, 50));
        (0, vitest_1.expect)(ordering[0]).toBe("session_created");
        (0, vitest_1.expect)(ordering.filter((e) => e === "agent_event").length).toBeGreaterThan(0);
    });
    (0, vitest_1.it)("emits state_change events on state transitions", async () => {
        const ts = new Date().toISOString();
        const events = [
            { type: "message_start", sessionId: "test-session-1", timestamp: ts, data: { role: "assistant" } },
            { type: "message_end", sessionId: "test-session-1", timestamp: ts, data: { role: "assistant" } },
            { type: "turn_end", sessionId: "test-session-1", timestamp: ts },
        ];
        const adapter = createMockAdapter(events);
        mockCreateAdapter.mockReturnValue(adapter);
        const stateChanges = [];
        manager.on("state_change", (change) => {
            stateChanges.push({ oldState: change.oldState, newState: change.newState });
        });
        await manager.startSession("proj1", "claude-code", {
            projectPath: "/tmp/test",
            contextPacket: makeContextPacket(),
        });
        // Give async generator time to yield
        await new Promise((r) => setTimeout(r, 50));
        // Session starts as "streaming", turn_end transitions to "idle"
        (0, vitest_1.expect)(stateChanges.some((c) => c.newState === "idle")).toBe(true);
    });
});
//# sourceMappingURL=session-manager-events.test.js.map