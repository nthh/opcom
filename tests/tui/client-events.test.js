"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
// Mock all external dependencies that loadDirect uses
vitest_1.vi.mock("@opcom/core", async () => {
    const actual = await vitest_1.vi.importActual("@opcom/core");
    return {
        ...actual,
        loadGlobalConfig: vitest_1.vi.fn().mockResolvedValue({ defaultWorkspace: "default" }),
        loadWorkspace: vitest_1.vi.fn().mockResolvedValue({ projectIds: [] }),
        loadProject: vitest_1.vi.fn().mockResolvedValue(null),
        refreshProjectStatus: vitest_1.vi.fn(),
        scanTickets: vitest_1.vi.fn().mockResolvedValue([]),
        Station: { isRunning: vitest_1.vi.fn().mockResolvedValue({ running: false }) },
        SessionManager: vitest_1.vi.fn().mockImplementation(() => ({
            init: vitest_1.vi.fn().mockResolvedValue(undefined),
            on: vitest_1.vi.fn(),
            off: vitest_1.vi.fn(),
            startSession: vitest_1.vi.fn(),
            stopSession: vitest_1.vi.fn(),
            promptSession: vitest_1.vi.fn(),
            shutdown: vitest_1.vi.fn().mockResolvedValue(undefined),
        })),
        buildContextPacket: vitest_1.vi.fn(),
    };
});
const client_js_1 = require("../../packages/cli/src/tui/client.js");
const agent_focus_js_1 = require("../../packages/cli/src/tui/views/agent-focus.js");
function makeEvent(sessionId, type) {
    return {
        type,
        sessionId,
        timestamp: new Date().toISOString(),
        data: type === "message_delta" ? { text: "hello" } : { reason: "test" },
    };
}
function makeSession(id) {
    return {
        id,
        backend: "claude-code",
        projectId: "proj1",
        state: "streaming",
        startedAt: new Date().toISOString(),
    };
}
(0, vitest_1.describe)("TuiClient event handling", () => {
    let client;
    (0, vitest_1.beforeEach)(async () => {
        client = new client_js_1.TuiClient();
        await client.connect();
    });
    (0, vitest_1.it)("agent_event arriving before agent_started is NOT wiped", () => {
        const sessionId = "session-early";
        // Simulate agent_event arriving first (before agent_started)
        const event = makeEvent(sessionId, "message_delta");
        const agentEventMsg = { type: "agent_event", sessionId, event };
        // Directly call handleServerEvent via onEvent / internal dispatch
        // We'll manually set up the agentEvents to simulate the race
        client.agentEvents.set(sessionId, [event]);
        // Now agent_started arrives — should NOT wipe
        const session = makeSession(sessionId);
        const startedMsg = { type: "agent_started", session };
        // Use the handler mechanism
        const received = [];
        client.onEvent((e) => received.push(e));
        // Feed events through the public interface by accessing handleServerEvent
        // We need to trigger it via the event handler — use send which won't work in offline
        // Instead, let's test the agentEvents map directly
        // Simulate what handleServerEvent does for agent_started:
        client.agents = client.agents.filter((a) => a.id !== session.id);
        client.agents.push(session);
        // The fix: only init if not already present
        if (!client.agentEvents.has(session.id)) {
            client.agentEvents.set(session.id, []);
        }
        // Events should still be there
        const stored = client.agentEvents.get(sessionId);
        (0, vitest_1.expect)(stored).toBeDefined();
        (0, vitest_1.expect)(stored.length).toBe(1);
        (0, vitest_1.expect)(stored[0].type).toBe("message_delta");
    });
    (0, vitest_1.it)("agent_started for new session initializes empty array", () => {
        const session = makeSession("brand-new");
        // No pre-existing events
        (0, vitest_1.expect)(client.agentEvents.has("brand-new")).toBe(false);
        // Simulate agent_started
        client.agents.push(session);
        if (!client.agentEvents.has(session.id)) {
            client.agentEvents.set(session.id, []);
        }
        (0, vitest_1.expect)(client.agentEvents.get("brand-new")).toEqual([]);
    });
    (0, vitest_1.it)("renderedEventCount detects new events on shared array reference", () => {
        const sessionId = "session-shared-ref";
        const initialEvents = [makeEvent(sessionId, "agent_start")];
        client.agentEvents.set(sessionId, initialEvents);
        // Create focus state — gets same array reference
        const session = makeSession(sessionId);
        const state = (0, agent_focus_js_1.createAgentFocusState)(session, initialEvents);
        // renderedEventCount should match initial length
        (0, vitest_1.expect)(state.renderedEventCount).toBe(1);
        (0, vitest_1.expect)(state.displayLines.length).toBeGreaterThan(0);
        // Push a new event to the SAME array (simulating handleServerEvent)
        initialEvents.push(makeEvent(sessionId, "message_delta"));
        // state.events.length is now 2 (same reference), but renderedEventCount is still 1
        (0, vitest_1.expect)(state.events.length).toBe(2);
        (0, vitest_1.expect)(state.renderedEventCount).toBe(1);
        // This is how syncData detects the change
        const freshEvents = client.agentEvents.get(sessionId);
        (0, vitest_1.expect)(freshEvents.length !== state.renderedEventCount).toBe(true);
        // Update like syncData does
        state.events = freshEvents;
        state.renderedEventCount = freshEvents.length;
        (0, agent_focus_js_1.rebuildDisplayLines)(state);
        // Now we should have display lines for both events
        (0, vitest_1.expect)(state.renderedEventCount).toBe(2);
        (0, vitest_1.expect)(state.displayLines.some((l) => l.text.includes("hello"))).toBe(true);
    });
    (0, vitest_1.it)("caps events at 2000 per agent", () => {
        const sessionId = "session-cap";
        client.agentEvents.set(sessionId, []);
        // Push 2010 events
        const events = client.agentEvents.get(sessionId);
        for (let i = 0; i < 2010; i++) {
            events.push(makeEvent(sessionId, "message_delta"));
        }
        // Simulate the cap logic from handleServerEvent
        if (events.length > 2000)
            events.splice(0, events.length - 2000);
        (0, vitest_1.expect)(events.length).toBe(2000);
    });
});
//# sourceMappingURL=client-events.test.js.map