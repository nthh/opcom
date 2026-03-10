"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const core_1 = require("@opcom/core");
(0, vitest_1.describe)("EventStore", () => {
    let store;
    (0, vitest_1.beforeEach)(() => {
        // Use in-memory DB for tests
        store = new core_1.EventStore(":memory:");
    });
    (0, vitest_1.afterEach)(() => {
        store.close();
    });
    // --- Session upsert/load ---
    (0, vitest_1.it)("upserts and loads sessions", () => {
        const session = {
            id: "sess-1",
            backend: "claude-code",
            projectId: "proj-1",
            state: "streaming",
            startedAt: "2025-01-01T00:00:00Z",
            pid: 1234,
        };
        store.upsertSession(session);
        const loaded = store.loadAllSessions();
        (0, vitest_1.expect)(loaded).toHaveLength(1);
        (0, vitest_1.expect)(loaded[0].id).toBe("sess-1");
        (0, vitest_1.expect)(loaded[0].backend).toBe("claude-code");
        (0, vitest_1.expect)(loaded[0].projectId).toBe("proj-1");
        (0, vitest_1.expect)(loaded[0].state).toBe("streaming");
        (0, vitest_1.expect)(loaded[0].pid).toBe(1234);
    });
    (0, vitest_1.it)("upsert updates existing session", () => {
        const session = {
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
        (0, vitest_1.expect)(loaded).toHaveLength(1);
        (0, vitest_1.expect)(loaded[0].state).toBe("stopped");
        (0, vitest_1.expect)(loaded[0].stoppedAt).toBe("2025-01-01T01:00:00Z");
    });
    (0, vitest_1.it)("loads sessions filtered by projectId", () => {
        store.upsertSession(makeSession("s1", "proj-a"));
        store.upsertSession(makeSession("s2", "proj-b"));
        store.upsertSession(makeSession("s3", "proj-a"));
        const result = store.loadAllSessions({ projectId: "proj-a" });
        (0, vitest_1.expect)(result).toHaveLength(2);
        (0, vitest_1.expect)(result.every((s) => s.projectId === "proj-a")).toBe(true);
    });
    (0, vitest_1.it)("loads sessions filtered by state", () => {
        const s1 = makeSession("s1", "proj-a");
        s1.state = "stopped";
        const s2 = makeSession("s2", "proj-a");
        s2.state = "streaming";
        store.upsertSession(s1);
        store.upsertSession(s2);
        const result = store.loadAllSessions({ state: "stopped" });
        (0, vitest_1.expect)(result).toHaveLength(1);
        (0, vitest_1.expect)(result[0].id).toBe("s1");
    });
    (0, vitest_1.it)("updateSessionState changes state and stoppedAt", () => {
        store.upsertSession(makeSession("s1", "proj-a"));
        store.updateSessionState("s1", "stopped", "2025-01-01T02:00:00Z");
        const loaded = store.loadAllSessions();
        (0, vitest_1.expect)(loaded[0].state).toBe("stopped");
        (0, vitest_1.expect)(loaded[0].stoppedAt).toBe("2025-01-01T02:00:00Z");
    });
    // --- Event insert/retrieve ---
    (0, vitest_1.it)("inserts and retrieves events", () => {
        const event = {
            type: "message_start",
            sessionId: "sess-1",
            timestamp: "2025-01-01T00:00:01Z",
            data: { text: "Hello", role: "assistant" },
        };
        store.insertEvent("sess-1", event);
        const events = store.loadSessionEvents("sess-1");
        (0, vitest_1.expect)(events).toHaveLength(1);
        (0, vitest_1.expect)(events[0].type).toBe("message_start");
        (0, vitest_1.expect)(events[0].data?.text).toBe("Hello");
        (0, vitest_1.expect)(events[0].data?.role).toBe("assistant");
    });
    (0, vitest_1.it)("inserts events with tool data", () => {
        const event = {
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
        (0, vitest_1.expect)(events[0].data?.toolName).toBe("Read");
        (0, vitest_1.expect)(events[0].data?.toolOutput).toBe("file contents here");
        (0, vitest_1.expect)(events[0].data?.toolSuccess).toBe(true);
    });
    (0, vitest_1.it)("correlates tool_name from tool_start to tool_end", () => {
        const start = {
            type: "tool_start",
            sessionId: "sess-1",
            timestamp: "2025-01-01T00:00:01Z",
            data: { toolName: "Bash" },
        };
        const end = {
            type: "tool_end",
            sessionId: "sess-1",
            timestamp: "2025-01-01T00:00:02Z",
            data: { toolOutput: "output", toolSuccess: true },
            // No toolName here — should be correlated from start
        };
        store.insertEvent("sess-1", start);
        store.insertEvent("sess-1", end);
        const events = store.loadSessionEvents("sess-1");
        (0, vitest_1.expect)(events[1].data?.toolName).toBe("Bash");
    });
    (0, vitest_1.it)("handles events with no data", () => {
        const event = {
            type: "turn_end",
            sessionId: "sess-1",
            timestamp: "2025-01-01T00:00:03Z",
        };
        store.insertEvent("sess-1", event);
        const events = store.loadSessionEvents("sess-1");
        (0, vitest_1.expect)(events).toHaveLength(1);
        (0, vitest_1.expect)(events[0].type).toBe("turn_end");
        (0, vitest_1.expect)(events[0].data).toBeUndefined();
    });
    (0, vitest_1.it)("respects limit and offset on loadSessionEvents", () => {
        for (let i = 0; i < 10; i++) {
            store.insertEvent("sess-1", {
                type: "message_delta",
                sessionId: "sess-1",
                timestamp: `2025-01-01T00:00:${String(i).padStart(2, "0")}Z`,
                data: { text: `msg-${i}` },
            });
        }
        const page1 = store.loadSessionEvents("sess-1", { limit: 3, offset: 0 });
        (0, vitest_1.expect)(page1).toHaveLength(3);
        (0, vitest_1.expect)(page1[0].data?.text).toBe("msg-0");
        const page2 = store.loadSessionEvents("sess-1", { limit: 3, offset: 3 });
        (0, vitest_1.expect)(page2).toHaveLength(3);
        (0, vitest_1.expect)(page2[0].data?.text).toBe("msg-3");
    });
    (0, vitest_1.it)("returns empty array for unknown session events", () => {
        const events = store.loadSessionEvents("nonexistent");
        (0, vitest_1.expect)(events).toHaveLength(0);
    });
    // --- Analytics ---
    (0, vitest_1.it)("computes tool usage stats", () => {
        seedToolEvents(store);
        const stats = store.toolUsageStats();
        (0, vitest_1.expect)(stats.length).toBeGreaterThan(0);
        const readStat = stats.find((s) => s.toolName === "Read");
        (0, vitest_1.expect)(readStat).toBeDefined();
        (0, vitest_1.expect)(readStat.count).toBe(3);
        (0, vitest_1.expect)(readStat.successCount).toBe(3);
        (0, vitest_1.expect)(readStat.successRate).toBe(1);
        const bashStat = stats.find((s) => s.toolName === "Bash");
        (0, vitest_1.expect)(bashStat).toBeDefined();
        (0, vitest_1.expect)(bashStat.count).toBe(2);
        (0, vitest_1.expect)(bashStat.successCount).toBe(1);
        (0, vitest_1.expect)(bashStat.failureCount).toBe(1);
        (0, vitest_1.expect)(bashStat.successRate).toBe(0.5);
    });
    (0, vitest_1.it)("computes tool usage stats filtered by project", () => {
        store.upsertSession(makeSession("sess-a", "proj-1"));
        store.upsertSession(makeSession("sess-b", "proj-2"));
        store.insertEvent("sess-a", makeToolEnd("Read", true, "2025-01-01T00:00:01Z"));
        store.insertEvent("sess-b", makeToolEnd("Read", true, "2025-01-01T00:00:02Z"));
        store.insertEvent("sess-b", makeToolEnd("Read", true, "2025-01-01T00:00:03Z"));
        const stats = store.toolUsageStats({ projectId: "proj-1" });
        const readStat = stats.find((s) => s.toolName === "Read");
        (0, vitest_1.expect)(readStat).toBeDefined();
        (0, vitest_1.expect)(readStat.count).toBe(1);
    });
    (0, vitest_1.it)("computes tool success rates (sorted ascending)", () => {
        seedToolEvents(store);
        const rates = store.toolSuccessRates();
        // Bash has 50% success, Read has 100% — Bash should come first
        (0, vitest_1.expect)(rates[0].toolName).toBe("Bash");
        (0, vitest_1.expect)(rates[rates.length - 1].toolName).toBe("Read");
    });
    (0, vitest_1.it)("computes session stats", () => {
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
        (0, vitest_1.expect)(stats).toHaveLength(1);
        (0, vitest_1.expect)(stats[0].sessionId).toBe("sess-1");
        (0, vitest_1.expect)(stats[0].durationMinutes).toBeCloseTo(90, 0);
        (0, vitest_1.expect)(stats[0].eventCount).toBe(2);
        (0, vitest_1.expect)(stats[0].toolCount).toBe(1);
    });
    (0, vitest_1.it)("computes daily activity", () => {
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
        (0, vitest_1.expect)(activity.length).toBeGreaterThanOrEqual(1);
        const todayActivity = activity.find((a) => a.date === today);
        (0, vitest_1.expect)(todayActivity).toBeDefined();
        (0, vitest_1.expect)(todayActivity.sessions).toBe(1);
        (0, vitest_1.expect)(todayActivity.events).toBe(2);
        (0, vitest_1.expect)(todayActivity.tools).toBe(1);
    });
    (0, vitest_1.it)("handles empty sessions in analytics", () => {
        (0, vitest_1.expect)(store.toolUsageStats()).toEqual([]);
        (0, vitest_1.expect)(store.sessionStats()).toEqual([]);
        (0, vitest_1.expect)(store.dailyActivity()).toEqual([]);
    });
    (0, vitest_1.it)("imports sessions from YAML", () => {
        const sessions = [
            makeSession("old-1", "proj-1"),
            makeSession("old-2", "proj-2"),
        ];
        store.importSessions(sessions);
        const loaded = store.loadAllSessions();
        (0, vitest_1.expect)(loaded).toHaveLength(2);
    });
    (0, vitest_1.it)("handles toolSuccess false correctly", () => {
        const event = {
            type: "tool_end",
            sessionId: "sess-1",
            timestamp: "2025-01-01T00:00:01Z",
            data: { toolName: "Write", toolSuccess: false },
        };
        store.insertEvent("sess-1", event);
        const events = store.loadSessionEvents("sess-1");
        (0, vitest_1.expect)(events[0].data?.toolSuccess).toBe(false);
    });
    (0, vitest_1.it)("stores and retrieves context usage", () => {
        const session = {
            id: "sess-ctx",
            backend: "claude-code",
            projectId: "proj-1",
            state: "streaming",
            startedAt: "2025-01-01T00:00:00Z",
            contextUsage: { tokensUsed: 50000, maxTokens: 200000, percentage: 25 },
        };
        store.upsertSession(session);
        const loaded = store.loadAllSessions();
        (0, vitest_1.expect)(loaded[0].contextUsage).toBeDefined();
        (0, vitest_1.expect)(loaded[0].contextUsage.tokensUsed).toBe(50000);
        (0, vitest_1.expect)(loaded[0].contextUsage.maxTokens).toBe(200000);
        (0, vitest_1.expect)(loaded[0].contextUsage.percentage).toBe(25);
    });
    // --- Plan events ---
    (0, vitest_1.it)("inserts and loads plan events", () => {
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
        (0, vitest_1.expect)(events).toHaveLength(3);
        (0, vitest_1.expect)(events[0].eventType).toBe("plan_started");
        (0, vitest_1.expect)(events[0].planId).toBe("plan-1");
        (0, vitest_1.expect)(events[0].stepTicketId).toBeNull();
        (0, vitest_1.expect)(JSON.parse(events[0].detailJson)).toEqual({ stepCount: 5 });
        (0, vitest_1.expect)(events[1].eventType).toBe("step_started");
        (0, vitest_1.expect)(events[1].stepTicketId).toBe("ticket-a");
        (0, vitest_1.expect)(events[1].agentSessionId).toBe("sess-1");
        (0, vitest_1.expect)(events[2].eventType).toBe("step_completed");
    });
    (0, vitest_1.it)("returns empty array for unknown plan events", () => {
        const events = store.loadPlanEvents("nonexistent");
        (0, vitest_1.expect)(events).toHaveLength(0);
    });
    (0, vitest_1.it)("respects limit and offset on loadPlanEvents", () => {
        for (let i = 0; i < 5; i++) {
            store.insertPlanEvent("plan-2", `event_${i}`);
        }
        const page1 = store.loadPlanEvents("plan-2", { limit: 2, offset: 0 });
        (0, vitest_1.expect)(page1).toHaveLength(2);
        (0, vitest_1.expect)(page1[0].eventType).toBe("event_0");
        const page2 = store.loadPlanEvents("plan-2", { limit: 2, offset: 2 });
        (0, vitest_1.expect)(page2).toHaveLength(2);
        (0, vitest_1.expect)(page2[0].eventType).toBe("event_2");
    });
});
// --- Helpers ---
function makeSession(id, projectId) {
    return {
        id,
        backend: "claude-code",
        projectId,
        state: "streaming",
        startedAt: "2025-01-01T00:00:00Z",
    };
}
function makeToolEnd(toolName, success, timestamp) {
    return {
        type: "tool_end",
        sessionId: "sess-1",
        timestamp,
        data: { toolName, toolSuccess: success },
    };
}
function seedToolEvents(store) {
    store.upsertSession(makeSession("sess-1", "proj-1"));
    // 3 successful Read calls
    store.insertEvent("sess-1", makeToolEnd("Read", true, "2025-01-01T00:00:01Z"));
    store.insertEvent("sess-1", makeToolEnd("Read", true, "2025-01-01T00:00:02Z"));
    store.insertEvent("sess-1", makeToolEnd("Read", true, "2025-01-01T00:00:03Z"));
    // 1 successful + 1 failed Bash call
    store.insertEvent("sess-1", makeToolEnd("Bash", true, "2025-01-01T00:00:04Z"));
    store.insertEvent("sess-1", makeToolEnd("Bash", false, "2025-01-01T00:00:05Z"));
}
//# sourceMappingURL=event-store.test.js.map