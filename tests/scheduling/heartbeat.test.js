"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const core_1 = require("@opcom/core");
// Minimal mock of SessionManager
function createMockSessionManager(sessions) {
    return {
        getActiveSessions: () => sessions,
    };
}
function makeSession(overrides = {}) {
    return {
        id: "sess-1",
        backend: "claude-code",
        projectId: "test-project",
        state: "idle",
        startedAt: new Date().toISOString(),
        lastActivity: new Date().toISOString(),
        pid: process.pid, // Use current process PID (known alive)
        ...overrides,
    };
}
(0, vitest_1.describe)("HeartbeatMonitor", () => {
    let monitor;
    (0, vitest_1.afterEach)(() => {
        if (monitor)
            monitor.stop();
    });
    (0, vitest_1.it)("reports healthy session with recent activity and alive PID", () => {
        const sessions = [makeSession()];
        const sm = createMockSessionManager(sessions);
        monitor = new core_1.HeartbeatMonitor(sm);
        const results = monitor.checkAll();
        (0, vitest_1.expect)(results).toHaveLength(1);
        (0, vitest_1.expect)(results[0].sessionId).toBe("sess-1");
        (0, vitest_1.expect)(results[0].status).toBe("healthy");
    });
    (0, vitest_1.it)("reports stale session when lastActivity is old", () => {
        const staleTime = new Date(Date.now() - 120_000).toISOString(); // 2 min ago
        const sessions = [makeSession({ id: "stale-1", lastActivity: staleTime })];
        const sm = createMockSessionManager(sessions);
        monitor = new core_1.HeartbeatMonitor(sm, { checkIntervalMs: 30_000, staleThresholdMs: 60_000, autoRestart: false });
        const results = monitor.checkAll();
        (0, vitest_1.expect)(results).toHaveLength(1);
        (0, vitest_1.expect)(results[0].sessionId).toBe("stale-1");
        (0, vitest_1.expect)(results[0].status).toBe("stale");
    });
    (0, vitest_1.it)("reports dead session when PID does not exist", () => {
        // Use a PID that is almost certainly not running
        const sessions = [makeSession({ id: "dead-1", pid: 999999 })];
        const sm = createMockSessionManager(sessions);
        monitor = new core_1.HeartbeatMonitor(sm);
        const results = monitor.checkAll();
        (0, vitest_1.expect)(results).toHaveLength(1);
        (0, vitest_1.expect)(results[0].sessionId).toBe("dead-1");
        (0, vitest_1.expect)(results[0].status).toBe("dead");
    });
    (0, vitest_1.it)("reports healthy when no lastActivity (but process alive)", () => {
        const sessions = [makeSession({ id: "no-activity", lastActivity: undefined })];
        const sm = createMockSessionManager(sessions);
        monitor = new core_1.HeartbeatMonitor(sm);
        const results = monitor.checkAll();
        (0, vitest_1.expect)(results).toHaveLength(1);
        (0, vitest_1.expect)(results[0].status).toBe("healthy");
    });
    (0, vitest_1.it)("handles empty session list", () => {
        const sm = createMockSessionManager([]);
        monitor = new core_1.HeartbeatMonitor(sm);
        const results = monitor.checkAll();
        (0, vitest_1.expect)(results).toHaveLength(0);
    });
    (0, vitest_1.it)("checks multiple sessions with mixed health", () => {
        const sessions = [
            makeSession({ id: "healthy-1", lastActivity: new Date().toISOString() }),
            makeSession({ id: "stale-1", lastActivity: new Date(Date.now() - 120_000).toISOString() }),
            makeSession({ id: "dead-1", pid: 999999 }),
        ];
        const sm = createMockSessionManager(sessions);
        monitor = new core_1.HeartbeatMonitor(sm, { checkIntervalMs: 30_000, staleThresholdMs: 60_000, autoRestart: false });
        const results = monitor.checkAll();
        (0, vitest_1.expect)(results).toHaveLength(3);
        const statusMap = new Map(results.map((r) => [r.sessionId, r.status]));
        (0, vitest_1.expect)(statusMap.get("healthy-1")).toBe("healthy");
        (0, vitest_1.expect)(statusMap.get("stale-1")).toBe("stale");
        (0, vitest_1.expect)(statusMap.get("dead-1")).toBe("dead");
    });
    (0, vitest_1.it)("calls onCheck handler when started", async () => {
        const sessions = [makeSession()];
        const sm = createMockSessionManager(sessions);
        monitor = new core_1.HeartbeatMonitor(sm, { checkIntervalMs: 50, staleThresholdMs: 60_000, autoRestart: false });
        const handler = vitest_1.vi.fn();
        monitor.onCheck(handler);
        monitor.start();
        // Wait for at least one check
        await new Promise((r) => setTimeout(r, 100));
        monitor.stop();
        (0, vitest_1.expect)(handler).toHaveBeenCalled();
        const firstCallArg = handler.mock.calls[0][0];
        (0, vitest_1.expect)(firstCallArg).toHaveLength(1);
        (0, vitest_1.expect)(firstCallArg[0].status).toBe("healthy");
    });
});
//# sourceMappingURL=heartbeat.test.js.map