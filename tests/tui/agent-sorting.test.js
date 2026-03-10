"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const dashboard_js_1 = require("../../packages/cli/src/tui/views/dashboard.js");
function makeAgent(overrides = {}) {
    return {
        id: "agent-1",
        backend: "claude-code",
        projectId: "proj-1",
        state: "streaming",
        startedAt: new Date().toISOString(),
        ...overrides,
    };
}
function makePlan(steps) {
    return {
        id: "plan-1",
        name: "Test Plan",
        status: "executing",
        scope: {},
        steps: steps.map((s) => ({
            ticketId: "ticket-1",
            projectId: "proj-1",
            status: "ready",
            blockedBy: [],
            ...s,
        })),
        config: {
            maxConcurrentAgents: 2,
            autoStart: true,
            backend: "claude-code",
            worktree: false,
            pauseOnFailure: false,
            ticketTransitions: true,
            autoCommit: false,
            verification: { runTests: true, runOracle: false },
        },
        context: "",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
    };
}
(0, vitest_1.describe)("getAgentSortTier", () => {
    (0, vitest_1.it)("returns 3 for stopped agents", () => {
        const agent = makeAgent({ state: "stopped" });
        (0, vitest_1.expect)((0, dashboard_js_1.getAgentSortTier)(agent, null)).toBe(3);
    });
    (0, vitest_1.it)("returns 2 for idle agents", () => {
        const agent = makeAgent({ state: "idle" });
        (0, vitest_1.expect)((0, dashboard_js_1.getAgentSortTier)(agent, null)).toBe(2);
    });
    (0, vitest_1.it)("returns 1 for active agents without a plan step", () => {
        const agent = makeAgent({ state: "streaming" });
        (0, vitest_1.expect)((0, dashboard_js_1.getAgentSortTier)(agent, null)).toBe(1);
    });
    (0, vitest_1.it)("returns 0 for plan-active agents", () => {
        const agent = makeAgent({ id: "a1", state: "streaming" });
        const plan = makePlan([{ agentSessionId: "a1", status: "in-progress" }]);
        (0, vitest_1.expect)((0, dashboard_js_1.getAgentSortTier)(agent, plan)).toBe(0);
    });
    (0, vitest_1.it)("returns 1 for active agent whose plan step is done (not in-progress)", () => {
        const agent = makeAgent({ id: "a1", state: "streaming" });
        const plan = makePlan([{ agentSessionId: "a1", status: "done" }]);
        (0, vitest_1.expect)((0, dashboard_js_1.getAgentSortTier)(agent, plan)).toBe(1);
    });
    (0, vitest_1.it)("returns 1 for waiting state without plan step", () => {
        const agent = makeAgent({ state: "waiting" });
        (0, vitest_1.expect)((0, dashboard_js_1.getAgentSortTier)(agent, null)).toBe(1);
    });
    (0, vitest_1.it)("returns 1 for error state without plan step", () => {
        const agent = makeAgent({ state: "error" });
        (0, vitest_1.expect)((0, dashboard_js_1.getAgentSortTier)(agent, null)).toBe(1);
    });
});
(0, vitest_1.describe)("getPlanStepForAgent", () => {
    (0, vitest_1.it)("returns undefined when no plan", () => {
        const agent = makeAgent({ id: "a1" });
        (0, vitest_1.expect)((0, dashboard_js_1.getPlanStepForAgent)(agent, null)).toBeUndefined();
    });
    (0, vitest_1.it)("returns the matching in-progress step", () => {
        const agent = makeAgent({ id: "a1" });
        const plan = makePlan([
            { ticketId: "t1", agentSessionId: "a1", status: "in-progress" },
            { ticketId: "t2", agentSessionId: "a2", status: "in-progress" },
        ]);
        const step = (0, dashboard_js_1.getPlanStepForAgent)(agent, plan);
        (0, vitest_1.expect)(step).toBeDefined();
        (0, vitest_1.expect)(step.ticketId).toBe("t1");
    });
    (0, vitest_1.it)("returns undefined when agent step is not in-progress", () => {
        const agent = makeAgent({ id: "a1" });
        const plan = makePlan([
            { ticketId: "t1", agentSessionId: "a1", status: "done" },
        ]);
        (0, vitest_1.expect)((0, dashboard_js_1.getPlanStepForAgent)(agent, plan)).toBeUndefined();
    });
    (0, vitest_1.it)("returns undefined when no step matches agent id", () => {
        const agent = makeAgent({ id: "a1" });
        const plan = makePlan([
            { ticketId: "t1", agentSessionId: "a-other", status: "in-progress" },
        ]);
        (0, vitest_1.expect)((0, dashboard_js_1.getPlanStepForAgent)(agent, plan)).toBeUndefined();
    });
});
(0, vitest_1.describe)("sortAgents", () => {
    (0, vitest_1.it)("sorts plan-active before other-active", () => {
        const planActive = makeAgent({ id: "pa", state: "streaming" });
        const otherActive = makeAgent({ id: "oa", state: "streaming" });
        const plan = makePlan([{ agentSessionId: "pa", status: "in-progress" }]);
        const sorted = (0, dashboard_js_1.sortAgents)([otherActive, planActive], plan);
        (0, vitest_1.expect)(sorted[0].id).toBe("pa");
        (0, vitest_1.expect)(sorted[1].id).toBe("oa");
    });
    (0, vitest_1.it)("sorts other-active before idle", () => {
        const active = makeAgent({ id: "act", state: "streaming" });
        const idle = makeAgent({ id: "idl", state: "idle" });
        const sorted = (0, dashboard_js_1.sortAgents)([idle, active], null);
        (0, vitest_1.expect)(sorted[0].id).toBe("act");
        (0, vitest_1.expect)(sorted[1].id).toBe("idl");
    });
    (0, vitest_1.it)("sorts idle before stopped", () => {
        const idle = makeAgent({ id: "idl", state: "idle" });
        const stopped = makeAgent({ id: "stp", state: "stopped" });
        const sorted = (0, dashboard_js_1.sortAgents)([stopped, idle], null);
        (0, vitest_1.expect)(sorted[0].id).toBe("idl");
        (0, vitest_1.expect)(sorted[1].id).toBe("stp");
    });
    (0, vitest_1.it)("full four-tier sort with mixed agents", () => {
        const stopped = makeAgent({ id: "stopped-1", state: "stopped" });
        const idle = makeAgent({ id: "idle-1", state: "idle" });
        const active = makeAgent({ id: "active-1", state: "streaming" });
        const planActive = makeAgent({ id: "plan-1", state: "streaming" });
        const plan = makePlan([{ agentSessionId: "plan-1", status: "in-progress" }]);
        // Deliberately scrambled input order
        const sorted = (0, dashboard_js_1.sortAgents)([stopped, active, idle, planActive], plan);
        (0, vitest_1.expect)(sorted.map((a) => a.id)).toEqual([
            "plan-1", // tier 0: plan-active
            "active-1", // tier 1: other-active
            "idle-1", // tier 2: idle
            "stopped-1", // tier 3: stopped
        ]);
    });
    (0, vitest_1.it)("preserves creation order within the same tier (stable sort)", () => {
        const a1 = makeAgent({ id: "a1", state: "streaming", startedAt: "2026-01-01T00:00:00Z" });
        const a2 = makeAgent({ id: "a2", state: "streaming", startedAt: "2026-01-01T01:00:00Z" });
        const a3 = makeAgent({ id: "a3", state: "streaming", startedAt: "2026-01-01T02:00:00Z" });
        const sorted = (0, dashboard_js_1.sortAgents)([a1, a2, a3], null);
        (0, vitest_1.expect)(sorted.map((a) => a.id)).toEqual(["a1", "a2", "a3"]);
    });
    (0, vitest_1.it)("handles empty agent list", () => {
        (0, vitest_1.expect)((0, dashboard_js_1.sortAgents)([], null)).toEqual([]);
    });
    (0, vitest_1.it)("handles all agents in same tier", () => {
        const a = makeAgent({ id: "a", state: "idle" });
        const b = makeAgent({ id: "b", state: "idle" });
        const sorted = (0, dashboard_js_1.sortAgents)([a, b], null);
        (0, vitest_1.expect)(sorted.map((s) => s.id)).toEqual(["a", "b"]);
    });
    (0, vitest_1.it)("multiple plan-active agents sort before non-plan agents", () => {
        const pa1 = makeAgent({ id: "pa1", state: "streaming" });
        const pa2 = makeAgent({ id: "pa2", state: "waiting" });
        const other = makeAgent({ id: "other", state: "streaming" });
        const plan = makePlan([
            { agentSessionId: "pa1", status: "in-progress", ticketId: "t1" },
            { agentSessionId: "pa2", status: "in-progress", ticketId: "t2" },
        ]);
        const sorted = (0, dashboard_js_1.sortAgents)([other, pa2, pa1], plan);
        (0, vitest_1.expect)(sorted[0].id).toBe("pa2");
        (0, vitest_1.expect)(sorted[1].id).toBe("pa1");
        (0, vitest_1.expect)(sorted[2].id).toBe("other");
    });
});
//# sourceMappingURL=agent-sorting.test.js.map