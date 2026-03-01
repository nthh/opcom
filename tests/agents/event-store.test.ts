import { describe, it, expect, beforeEach, afterEach } from "vitest";
import type { NormalizedEvent, AgentSession } from "@opcom/types";
import { EventStore } from "@opcom/core";

describe("EventStore", () => {
  let store: EventStore;

  beforeEach(() => {
    // Use in-memory DB for tests
    store = new EventStore(":memory:");
  });

  afterEach(() => {
    store.close();
  });

  // --- Session upsert/load ---

  it("upserts and loads sessions", () => {
    const session: AgentSession = {
      id: "sess-1",
      backend: "claude-code",
      projectId: "proj-1",
      state: "streaming",
      startedAt: "2025-01-01T00:00:00Z",
      pid: 1234,
    };

    store.upsertSession(session);
    const loaded = store.loadAllSessions();
    expect(loaded).toHaveLength(1);
    expect(loaded[0].id).toBe("sess-1");
    expect(loaded[0].backend).toBe("claude-code");
    expect(loaded[0].projectId).toBe("proj-1");
    expect(loaded[0].state).toBe("streaming");
    expect(loaded[0].pid).toBe(1234);
  });

  it("upsert updates existing session", () => {
    const session: AgentSession = {
      id: "sess-1",
      backend: "claude-code",
      projectId: "proj-1",
      state: "streaming",
      startedAt: "2025-01-01T00:00:00Z",
    };

    store.upsertSession(session);
    session.state = "stopped";
    session.stoppedAt = "2025-01-01T01:00:00Z";
    store.upsertSession(session);

    const loaded = store.loadAllSessions();
    expect(loaded).toHaveLength(1);
    expect(loaded[0].state).toBe("stopped");
    expect(loaded[0].stoppedAt).toBe("2025-01-01T01:00:00Z");
  });

  it("loads sessions filtered by projectId", () => {
    store.upsertSession(makeSession("s1", "proj-a"));
    store.upsertSession(makeSession("s2", "proj-b"));
    store.upsertSession(makeSession("s3", "proj-a"));

    const result = store.loadAllSessions({ projectId: "proj-a" });
    expect(result).toHaveLength(2);
    expect(result.every((s) => s.projectId === "proj-a")).toBe(true);
  });

  it("loads sessions filtered by state", () => {
    const s1 = makeSession("s1", "proj-a");
    s1.state = "stopped";
    const s2 = makeSession("s2", "proj-a");
    s2.state = "streaming";

    store.upsertSession(s1);
    store.upsertSession(s2);

    const result = store.loadAllSessions({ state: "stopped" });
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("s1");
  });

  it("updateSessionState changes state and stoppedAt", () => {
    store.upsertSession(makeSession("s1", "proj-a"));
    store.updateSessionState("s1", "stopped", "2025-01-01T02:00:00Z");

    const loaded = store.loadAllSessions();
    expect(loaded[0].state).toBe("stopped");
    expect(loaded[0].stoppedAt).toBe("2025-01-01T02:00:00Z");
  });

  // --- Event insert/retrieve ---

  it("inserts and retrieves events", () => {
    const event: NormalizedEvent = {
      type: "message_start",
      sessionId: "sess-1",
      timestamp: "2025-01-01T00:00:01Z",
      data: { text: "Hello", role: "assistant" },
    };

    store.insertEvent("sess-1", event);

    const events = store.loadSessionEvents("sess-1");
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe("message_start");
    expect(events[0].data?.text).toBe("Hello");
    expect(events[0].data?.role).toBe("assistant");
  });

  it("inserts events with tool data", () => {
    const event: NormalizedEvent = {
      type: "tool_end",
      sessionId: "sess-1",
      timestamp: "2025-01-01T00:00:02Z",
      data: {
        toolName: "Read",
        toolOutput: "file contents here",
        toolSuccess: true,
      },
    };

    store.insertEvent("sess-1", event);

    const events = store.loadSessionEvents("sess-1");
    expect(events[0].data?.toolName).toBe("Read");
    expect(events[0].data?.toolOutput).toBe("file contents here");
    expect(events[0].data?.toolSuccess).toBe(true);
  });

  it("correlates tool_name from tool_start to tool_end", () => {
    const start: NormalizedEvent = {
      type: "tool_start",
      sessionId: "sess-1",
      timestamp: "2025-01-01T00:00:01Z",
      data: { toolName: "Bash" },
    };

    const end: NormalizedEvent = {
      type: "tool_end",
      sessionId: "sess-1",
      timestamp: "2025-01-01T00:00:02Z",
      data: { toolOutput: "output", toolSuccess: true },
      // No toolName here — should be correlated from start
    };

    store.insertEvent("sess-1", start);
    store.insertEvent("sess-1", end);

    const events = store.loadSessionEvents("sess-1");
    expect(events[1].data?.toolName).toBe("Bash");
  });

  it("handles events with no data", () => {
    const event: NormalizedEvent = {
      type: "turn_end",
      sessionId: "sess-1",
      timestamp: "2025-01-01T00:00:03Z",
    };

    store.insertEvent("sess-1", event);

    const events = store.loadSessionEvents("sess-1");
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe("turn_end");
    expect(events[0].data).toBeUndefined();
  });

  it("respects limit and offset on loadSessionEvents", () => {
    for (let i = 0; i < 10; i++) {
      store.insertEvent("sess-1", {
        type: "message_delta",
        sessionId: "sess-1",
        timestamp: `2025-01-01T00:00:${String(i).padStart(2, "0")}Z`,
        data: { text: `msg-${i}` },
      });
    }

    const page1 = store.loadSessionEvents("sess-1", { limit: 3, offset: 0 });
    expect(page1).toHaveLength(3);
    expect(page1[0].data?.text).toBe("msg-0");

    const page2 = store.loadSessionEvents("sess-1", { limit: 3, offset: 3 });
    expect(page2).toHaveLength(3);
    expect(page2[0].data?.text).toBe("msg-3");
  });

  it("returns empty array for unknown session events", () => {
    const events = store.loadSessionEvents("nonexistent");
    expect(events).toHaveLength(0);
  });

  // --- Analytics ---

  it("computes tool usage stats", () => {
    seedToolEvents(store);

    const stats = store.toolUsageStats();
    expect(stats.length).toBeGreaterThan(0);

    const readStat = stats.find((s) => s.toolName === "Read");
    expect(readStat).toBeDefined();
    expect(readStat!.count).toBe(3);
    expect(readStat!.successCount).toBe(3);
    expect(readStat!.successRate).toBe(1);

    const bashStat = stats.find((s) => s.toolName === "Bash");
    expect(bashStat).toBeDefined();
    expect(bashStat!.count).toBe(2);
    expect(bashStat!.successCount).toBe(1);
    expect(bashStat!.failureCount).toBe(1);
    expect(bashStat!.successRate).toBe(0.5);
  });

  it("computes tool usage stats filtered by project", () => {
    store.upsertSession(makeSession("sess-a", "proj-1"));
    store.upsertSession(makeSession("sess-b", "proj-2"));

    store.insertEvent("sess-a", makeToolEnd("Read", true, "2025-01-01T00:00:01Z"));
    store.insertEvent("sess-b", makeToolEnd("Read", true, "2025-01-01T00:00:02Z"));
    store.insertEvent("sess-b", makeToolEnd("Read", true, "2025-01-01T00:00:03Z"));

    const stats = store.toolUsageStats({ projectId: "proj-1" });
    const readStat = stats.find((s) => s.toolName === "Read");
    expect(readStat).toBeDefined();
    expect(readStat!.count).toBe(1);
  });

  it("computes tool success rates (sorted ascending)", () => {
    seedToolEvents(store);

    const rates = store.toolSuccessRates();
    // Bash has 50% success, Read has 100% — Bash should come first
    expect(rates[0].toolName).toBe("Bash");
    expect(rates[rates.length - 1].toolName).toBe("Read");
  });

  it("computes session stats", () => {
    const s = makeSession("sess-1", "proj-1");
    s.stoppedAt = "2025-01-01T01:30:00Z";
    s.state = "stopped";
    store.upsertSession(s);

    store.insertEvent("sess-1", {
      type: "message_start",
      sessionId: "sess-1",
      timestamp: "2025-01-01T00:00:01Z",
      data: { role: "assistant" },
    });
    store.insertEvent("sess-1", makeToolEnd("Read", true, "2025-01-01T00:00:02Z"));

    const stats = store.sessionStats();
    expect(stats).toHaveLength(1);
    expect(stats[0].sessionId).toBe("sess-1");
    expect(stats[0].durationMinutes).toBeCloseTo(90, 0);
    expect(stats[0].eventCount).toBe(2);
    expect(stats[0].toolCount).toBe(1);
  });

  it("computes daily activity", () => {
    store.upsertSession(makeSession("sess-1", "proj-1"));

    const today = new Date().toISOString().split("T")[0];
    store.insertEvent("sess-1", {
      type: "message_start",
      sessionId: "sess-1",
      timestamp: `${today}T10:00:00Z`,
      data: { role: "assistant" },
    });
    store.insertEvent("sess-1", makeToolEnd("Read", true, `${today}T10:00:01Z`));

    const activity = store.dailyActivity({ days: 7 });
    expect(activity.length).toBeGreaterThanOrEqual(1);

    const todayActivity = activity.find((a) => a.date === today);
    expect(todayActivity).toBeDefined();
    expect(todayActivity!.sessions).toBe(1);
    expect(todayActivity!.events).toBe(2);
    expect(todayActivity!.tools).toBe(1);
  });

  it("handles empty sessions in analytics", () => {
    expect(store.toolUsageStats()).toEqual([]);
    expect(store.sessionStats()).toEqual([]);
    expect(store.dailyActivity()).toEqual([]);
  });

  it("imports sessions from YAML", () => {
    const sessions: AgentSession[] = [
      makeSession("old-1", "proj-1"),
      makeSession("old-2", "proj-2"),
    ];

    store.importSessions(sessions);

    const loaded = store.loadAllSessions();
    expect(loaded).toHaveLength(2);
  });

  it("handles toolSuccess false correctly", () => {
    const event: NormalizedEvent = {
      type: "tool_end",
      sessionId: "sess-1",
      timestamp: "2025-01-01T00:00:01Z",
      data: { toolName: "Write", toolSuccess: false },
    };

    store.insertEvent("sess-1", event);

    const events = store.loadSessionEvents("sess-1");
    expect(events[0].data?.toolSuccess).toBe(false);
  });

  it("stores and retrieves context usage", () => {
    const session: AgentSession = {
      id: "sess-ctx",
      backend: "claude-code",
      projectId: "proj-1",
      state: "streaming",
      startedAt: "2025-01-01T00:00:00Z",
      contextUsage: { tokensUsed: 50000, maxTokens: 200000, percentage: 25 },
    };

    store.upsertSession(session);

    const loaded = store.loadAllSessions();
    expect(loaded[0].contextUsage).toBeDefined();
    expect(loaded[0].contextUsage!.tokensUsed).toBe(50000);
    expect(loaded[0].contextUsage!.maxTokens).toBe(200000);
    expect(loaded[0].contextUsage!.percentage).toBe(25);
  });

  // --- Plan events ---

  it("inserts and loads plan events", () => {
    store.insertPlanEvent("plan-1", "plan_started", {
      detail: { stepCount: 5 },
    });
    store.insertPlanEvent("plan-1", "step_started", {
      stepTicketId: "ticket-a",
      agentSessionId: "sess-1",
    });
    store.insertPlanEvent("plan-1", "step_completed", {
      stepTicketId: "ticket-a",
      agentSessionId: "sess-1",
      detail: { writes: 3 },
    });

    const events = store.loadPlanEvents("plan-1");
    expect(events).toHaveLength(3);
    expect(events[0].eventType).toBe("plan_started");
    expect(events[0].planId).toBe("plan-1");
    expect(events[0].stepTicketId).toBeNull();
    expect(JSON.parse(events[0].detailJson!)).toEqual({ stepCount: 5 });

    expect(events[1].eventType).toBe("step_started");
    expect(events[1].stepTicketId).toBe("ticket-a");
    expect(events[1].agentSessionId).toBe("sess-1");

    expect(events[2].eventType).toBe("step_completed");
  });

  it("returns empty array for unknown plan events", () => {
    const events = store.loadPlanEvents("nonexistent");
    expect(events).toHaveLength(0);
  });

  it("respects limit and offset on loadPlanEvents", () => {
    for (let i = 0; i < 5; i++) {
      store.insertPlanEvent("plan-2", `event_${i}`);
    }

    const page1 = store.loadPlanEvents("plan-2", { limit: 2, offset: 0 });
    expect(page1).toHaveLength(2);
    expect(page1[0].eventType).toBe("event_0");

    const page2 = store.loadPlanEvents("plan-2", { limit: 2, offset: 2 });
    expect(page2).toHaveLength(2);
    expect(page2[0].eventType).toBe("event_2");
  });
});

// --- Helpers ---

function makeSession(id: string, projectId: string): AgentSession {
  return {
    id,
    backend: "claude-code",
    projectId,
    state: "streaming",
    startedAt: "2025-01-01T00:00:00Z",
  };
}

function makeToolEnd(toolName: string, success: boolean, timestamp: string): NormalizedEvent {
  return {
    type: "tool_end",
    sessionId: "sess-1",
    timestamp,
    data: { toolName, toolSuccess: success },
  };
}

function seedToolEvents(store: EventStore): void {
  store.upsertSession(makeSession("sess-1", "proj-1"));

  // 3 successful Read calls
  store.insertEvent("sess-1", makeToolEnd("Read", true, "2025-01-01T00:00:01Z"));
  store.insertEvent("sess-1", makeToolEnd("Read", true, "2025-01-01T00:00:02Z"));
  store.insertEvent("sess-1", makeToolEnd("Read", true, "2025-01-01T00:00:03Z"));

  // 1 successful + 1 failed Bash call
  store.insertEvent("sess-1", makeToolEnd("Bash", true, "2025-01-01T00:00:04Z"));
  store.insertEvent("sess-1", makeToolEnd("Bash", false, "2025-01-01T00:00:05Z"));
}
