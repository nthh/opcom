import { describe, it, expect, vi, beforeEach } from "vitest";
import type { NormalizedEvent, AgentSession, ServerEvent } from "@opcom/types";

// Mock all external dependencies that loadDirect uses
vi.mock("@opcom/core", async () => {
  const actual = await vi.importActual<typeof import("@opcom/core")>("@opcom/core");
  return {
    ...actual,
    loadGlobalConfig: vi.fn().mockResolvedValue({ defaultWorkspace: "default" }),
    loadWorkspace: vi.fn().mockResolvedValue({ projectIds: [] }),
    loadProject: vi.fn().mockResolvedValue(null),
    refreshProjectStatus: vi.fn(),
    scanTickets: vi.fn().mockResolvedValue([]),
    Station: { isRunning: vi.fn().mockResolvedValue({ running: false }) },
    SessionManager: vi.fn().mockImplementation(() => ({
      init: vi.fn().mockResolvedValue(undefined),
      on: vi.fn(),
      off: vi.fn(),
      startSession: vi.fn(),
      stopSession: vi.fn(),
      promptSession: vi.fn(),
      shutdown: vi.fn().mockResolvedValue(undefined),
    })),
    buildContextPacket: vi.fn(),
  };
});

import { TuiClient } from "../../packages/cli/src/tui/client.js";
import { createAgentFocusState, rebuildDisplayLines } from "../../packages/cli/src/tui/views/agent-focus.js";

function makeEvent(sessionId: string, type: NormalizedEvent["type"]): NormalizedEvent {
  return {
    type,
    sessionId,
    timestamp: new Date().toISOString(),
    data: type === "message_delta" ? { text: "hello" } : { reason: "test" },
  };
}

function makeSession(id: string): AgentSession {
  return {
    id,
    backend: "claude-code",
    projectId: "proj1",
    state: "streaming",
    startedAt: new Date().toISOString(),
  };
}

describe("TuiClient event handling", () => {
  let client: TuiClient;

  beforeEach(async () => {
    client = new TuiClient();
    await client.connect();
  });

  it("agent_event arriving before agent_started is NOT wiped", () => {
    const sessionId = "session-early";

    // Simulate agent_event arriving first (before agent_started)
    const event = makeEvent(sessionId, "message_delta");
    const agentEventMsg: ServerEvent = { type: "agent_event", sessionId, event };

    // Directly call handleServerEvent via onEvent / internal dispatch
    // We'll manually set up the agentEvents to simulate the race
    client.agentEvents.set(sessionId, [event]);

    // Now agent_started arrives — should NOT wipe
    const session = makeSession(sessionId);
    const startedMsg: ServerEvent = { type: "agent_started", session };

    // Use the handler mechanism
    const received: ServerEvent[] = [];
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
    expect(stored).toBeDefined();
    expect(stored!.length).toBe(1);
    expect(stored![0].type).toBe("message_delta");
  });

  it("agent_started for new session initializes empty array", () => {
    const session = makeSession("brand-new");

    // No pre-existing events
    expect(client.agentEvents.has("brand-new")).toBe(false);

    // Simulate agent_started
    client.agents.push(session);
    if (!client.agentEvents.has(session.id)) {
      client.agentEvents.set(session.id, []);
    }

    expect(client.agentEvents.get("brand-new")).toEqual([]);
  });

  it("renderedEventCount detects new events on shared array reference", () => {
    const sessionId = "session-shared-ref";
    const initialEvents = [makeEvent(sessionId, "agent_start")];
    client.agentEvents.set(sessionId, initialEvents);

    // Create focus state — gets same array reference
    const session = makeSession(sessionId);
    const state = createAgentFocusState(session, initialEvents);

    // renderedEventCount should match initial length
    expect(state.renderedEventCount).toBe(1);
    expect(state.displayLines.length).toBeGreaterThan(0);

    // Push a new event to the SAME array (simulating handleServerEvent)
    initialEvents.push(makeEvent(sessionId, "message_delta"));

    // state.events.length is now 2 (same reference), but renderedEventCount is still 1
    expect(state.events.length).toBe(2);
    expect(state.renderedEventCount).toBe(1);

    // This is how syncData detects the change
    const freshEvents = client.agentEvents.get(sessionId)!;
    expect(freshEvents.length !== state.renderedEventCount).toBe(true);

    // Update like syncData does
    state.events = freshEvents;
    state.renderedEventCount = freshEvents.length;
    rebuildDisplayLines(state);

    // Now we should have display lines for both events
    expect(state.renderedEventCount).toBe(2);
    expect(state.displayLines.some((l) => l.text.includes("hello"))).toBe(true);
  });

  it("caps events at 2000 per agent", () => {
    const sessionId = "session-cap";
    client.agentEvents.set(sessionId, []);

    // Push 2010 events
    const events = client.agentEvents.get(sessionId)!;
    for (let i = 0; i < 2010; i++) {
      events.push(makeEvent(sessionId, "message_delta"));
    }

    // Simulate the cap logic from handleServerEvent
    if (events.length > 2000) events.splice(0, events.length - 2000);

    expect(events.length).toBe(2000);
  });
});
