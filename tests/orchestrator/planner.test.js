"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const planner_js_1 = require("../../packages/core/src/orchestrator/planner.js");
function makeTicket(overrides) {
    return {
        title: overrides.id,
        status: "open",
        priority: 2,
        type: "task",
        filePath: `/project/.tickets/${overrides.id}.md`,
        deps: [],
        links: [],
        tags: {},
        ...overrides,
    };
}
(0, vitest_1.describe)("computePlan", () => {
    (0, vitest_1.it)("creates steps from tickets and computes blocked/ready from deps", () => {
        const tickets = [
            {
                projectId: "proj-a",
                tickets: [
                    makeTicket({ id: "setup-db", deps: [] }),
                    makeTicket({ id: "add-api", deps: ["setup-db"] }),
                    makeTicket({ id: "add-ui", deps: ["add-api"] }),
                ],
            },
        ];
        const plan = (0, planner_js_1.computePlan)(tickets, {}, "test-plan");
        (0, vitest_1.expect)(plan.steps).toHaveLength(3);
        (0, vitest_1.expect)(plan.name).toBe("test-plan");
        (0, vitest_1.expect)(plan.status).toBe("planning");
        const dbStep = plan.steps.find((s) => s.ticketId === "setup-db");
        const apiStep = plan.steps.find((s) => s.ticketId === "add-api");
        const uiStep = plan.steps.find((s) => s.ticketId === "add-ui");
        (0, vitest_1.expect)(dbStep.status).toBe("ready");
        (0, vitest_1.expect)(dbStep.blockedBy).toEqual([]);
        (0, vitest_1.expect)(apiStep.status).toBe("blocked");
        (0, vitest_1.expect)(apiStep.blockedBy).toEqual(["setup-db"]);
        (0, vitest_1.expect)(uiStep.status).toBe("blocked");
        (0, vitest_1.expect)(uiStep.blockedBy).toEqual(["add-api"]);
    });
    (0, vitest_1.it)("with no deps → all steps ready", () => {
        const tickets = [
            {
                projectId: "proj-a",
                tickets: [
                    makeTicket({ id: "task-1" }),
                    makeTicket({ id: "task-2" }),
                    makeTicket({ id: "task-3" }),
                ],
            },
        ];
        const plan = (0, planner_js_1.computePlan)(tickets, {}, "parallel-plan");
        (0, vitest_1.expect)(plan.steps.every((s) => s.status === "ready")).toBe(true);
    });
    (0, vitest_1.it)("sorts steps by priority (P1 before P3)", () => {
        const tickets = [
            {
                projectId: "proj-a",
                tickets: [
                    makeTicket({ id: "low-pri", priority: 4 }),
                    makeTicket({ id: "high-pri", priority: 1 }),
                    makeTicket({ id: "mid-pri", priority: 2 }),
                ],
            },
        ];
        const plan = (0, planner_js_1.computePlan)(tickets, {}, "priority-plan");
        const ids = plan.steps.map((s) => s.ticketId);
        (0, vitest_1.expect)(ids).toEqual(["high-pri", "mid-pri", "low-pri"]);
    });
    (0, vitest_1.it)("propagates role from ticket to step", () => {
        const tickets = [
            {
                projectId: "proj-a",
                tickets: [
                    makeTicket({ id: "deploy-infra", role: "devops" }),
                    makeTicket({ id: "review-code", role: "reviewer" }),
                    makeTicket({ id: "write-feature" }),
                ],
            },
        ];
        const plan = (0, planner_js_1.computePlan)(tickets, {}, "role-plan");
        const deployStep = plan.steps.find((s) => s.ticketId === "deploy-infra");
        const reviewStep = plan.steps.find((s) => s.ticketId === "review-code");
        const featureStep = plan.steps.find((s) => s.ticketId === "write-feature");
        (0, vitest_1.expect)(deployStep.role).toBe("devops");
        (0, vitest_1.expect)(reviewStep.role).toBe("reviewer");
        (0, vitest_1.expect)(featureStep.role).toBeUndefined();
    });
    (0, vitest_1.it)("filters closed and deferred tickets", () => {
        const tickets = [
            {
                projectId: "proj-a",
                tickets: [
                    makeTicket({ id: "open-1" }),
                    makeTicket({ id: "closed-1", status: "closed" }),
                    makeTicket({ id: "deferred-1", status: "deferred" }),
                    makeTicket({ id: "in-progress-1", status: "in-progress" }),
                ],
            },
        ];
        const plan = (0, planner_js_1.computePlan)(tickets, {}, "filter-plan");
        const ids = plan.steps.map((s) => s.ticketId);
        (0, vitest_1.expect)(ids).toContain("open-1");
        (0, vitest_1.expect)(ids).toContain("in-progress-1");
        (0, vitest_1.expect)(ids).not.toContain("closed-1");
        (0, vitest_1.expect)(ids).not.toContain("deferred-1");
    });
});
(0, vitest_1.describe)("resolveScope", () => {
    const tickets = [
        {
            projectId: "proj-a",
            tickets: [
                makeTicket({ id: "a-1" }),
                makeTicket({ id: "a-2", priority: 1 }),
            ],
        },
        {
            projectId: "proj-b",
            tickets: [
                makeTicket({ id: "b-1" }),
            ],
        },
    ];
    (0, vitest_1.it)("filters by projectIds", () => {
        const result = (0, planner_js_1.resolveScope)(tickets, { projectIds: ["proj-a"] });
        (0, vitest_1.expect)(result).toHaveLength(1);
        (0, vitest_1.expect)(result[0].projectId).toBe("proj-a");
    });
    (0, vitest_1.it)("filters by ticketIds", () => {
        const result = (0, planner_js_1.resolveScope)(tickets, { ticketIds: ["a-1", "b-1"] });
        const allIds = result.flatMap((ts) => ts.tickets.map((t) => t.id));
        (0, vitest_1.expect)(allIds).toEqual(["a-1", "b-1"]);
    });
    (0, vitest_1.it)("filters by query", () => {
        const result = (0, planner_js_1.resolveScope)(tickets, { query: "priority:1" });
        const allIds = result.flatMap((ts) => ts.tickets.map((t) => t.id));
        (0, vitest_1.expect)(allIds).toEqual(["a-2"]);
    });
});
(0, vitest_1.describe)("detectCycles", () => {
    (0, vitest_1.it)("detects simple A→B→A cycle", () => {
        const steps = [
            { ticketId: "a", projectId: "p", status: "blocked", blockedBy: ["b"] },
            { ticketId: "b", projectId: "p", status: "blocked", blockedBy: ["a"] },
        ];
        const cycles = (0, planner_js_1.detectCycles)(steps);
        (0, vitest_1.expect)(cycles.length).toBeGreaterThan(0);
        // The cycle should contain both a and b
        const flat = cycles.flat();
        (0, vitest_1.expect)(flat).toContain("a");
        (0, vitest_1.expect)(flat).toContain("b");
    });
    (0, vitest_1.it)("no false positives on DAG", () => {
        const steps = [
            { ticketId: "a", projectId: "p", status: "ready", blockedBy: [] },
            { ticketId: "b", projectId: "p", status: "blocked", blockedBy: ["a"] },
            { ticketId: "c", projectId: "p", status: "blocked", blockedBy: ["a"] },
            { ticketId: "d", projectId: "p", status: "blocked", blockedBy: ["b", "c"] },
        ];
        const cycles = (0, planner_js_1.detectCycles)(steps);
        (0, vitest_1.expect)(cycles).toHaveLength(0);
    });
});
(0, vitest_1.describe)("computeTracks", () => {
    (0, vitest_1.it)("independent tickets → separate tracks", () => {
        const steps = [
            { ticketId: "auth-setup", projectId: "p", status: "ready", blockedBy: [] },
            { ticketId: "ui-design", projectId: "p", status: "ready", blockedBy: [] },
        ];
        const tracks = (0, planner_js_1.computeTracks)(steps);
        (0, vitest_1.expect)(tracks.size).toBe(2);
    });
    (0, vitest_1.it)("dep chains → same track", () => {
        const steps = [
            { ticketId: "auth-setup", projectId: "p", status: "ready", blockedBy: [] },
            { ticketId: "auth-api", projectId: "p", status: "blocked", blockedBy: ["auth-setup"] },
            { ticketId: "auth-ui", projectId: "p", status: "blocked", blockedBy: ["auth-api"] },
        ];
        const tracks = (0, planner_js_1.computeTracks)(steps);
        (0, vitest_1.expect)(tracks.size).toBe(1);
        // All three should be in same track
        const members = [...tracks.values()][0];
        (0, vitest_1.expect)(members).toHaveLength(3);
    });
    (0, vitest_1.it)("names tracks by common prefix", () => {
        const steps = [
            { ticketId: "auth-setup", projectId: "p", status: "ready", blockedBy: [] },
            { ticketId: "auth-api", projectId: "p", status: "blocked", blockedBy: ["auth-setup"] },
        ];
        const tracks = (0, planner_js_1.computeTracks)(steps);
        const names = [...tracks.keys()];
        (0, vitest_1.expect)(names[0]).toBe("auth");
    });
    (0, vitest_1.it)("falls back to track-N when no common prefix", () => {
        const steps = [
            { ticketId: "setup", projectId: "p", status: "ready", blockedBy: [] },
            { ticketId: "deploy", projectId: "p", status: "blocked", blockedBy: ["setup"] },
        ];
        const tracks = (0, planner_js_1.computeTracks)(steps);
        const names = [...tracks.keys()];
        // No common prefix, should use track-N
        (0, vitest_1.expect)(names[0]).toMatch(/^track-\d+$/);
    });
});
(0, vitest_1.describe)("recomputePlan", () => {
    (0, vitest_1.it)("preserves in-progress/done/failed status", () => {
        const plan = {
            id: "p1",
            name: "test",
            status: "executing",
            scope: {},
            steps: [
                { ticketId: "a", projectId: "p", status: "done", blockedBy: [] },
                { ticketId: "b", projectId: "p", status: "in-progress", blockedBy: ["a"], agentSessionId: "s1" },
                { ticketId: "c", projectId: "p", status: "blocked", blockedBy: ["b"] },
            ],
            config: {
                maxConcurrentAgents: 3, autoStart: false, backend: "claude-code",
                worktree: false, pauseOnFailure: true, ticketTransitions: true,
            },
            context: "",
            createdAt: "2025-01-01",
            updatedAt: "2025-01-01",
        };
        const ticketSets = [
            {
                projectId: "p",
                tickets: [
                    makeTicket({ id: "a", status: "closed" }),
                    makeTicket({ id: "b", status: "in-progress", deps: ["a"] }),
                    makeTicket({ id: "c", status: "open", deps: ["b"] }),
                ],
            },
        ];
        const updated = (0, planner_js_1.recomputePlan)(plan, ticketSets);
        (0, vitest_1.expect)(updated.steps.find((s) => s.ticketId === "a").status).toBe("done");
        (0, vitest_1.expect)(updated.steps.find((s) => s.ticketId === "b").status).toBe("in-progress");
        (0, vitest_1.expect)(updated.steps.find((s) => s.ticketId === "b").agentSessionId).toBe("s1");
        (0, vitest_1.expect)(updated.steps.find((s) => s.ticketId === "c").status).toBe("blocked");
    });
    (0, vitest_1.it)("newly-closed dep → blocked→ready transition", () => {
        const plan = {
            id: "p1",
            name: "test",
            status: "executing",
            scope: {},
            steps: [
                { ticketId: "a", projectId: "p", status: "done", blockedBy: [] },
                { ticketId: "b", projectId: "p", status: "blocked", blockedBy: ["a"] },
            ],
            config: {
                maxConcurrentAgents: 3, autoStart: false, backend: "claude-code",
                worktree: false, pauseOnFailure: true, ticketTransitions: true,
            },
            context: "",
            createdAt: "2025-01-01",
            updatedAt: "2025-01-01",
        };
        const ticketSets = [
            {
                projectId: "p",
                tickets: [
                    makeTicket({ id: "a", status: "closed" }),
                    makeTicket({ id: "b", status: "open", deps: ["a"] }),
                ],
            },
        ];
        const updated = (0, planner_js_1.recomputePlan)(plan, ticketSets);
        // Step A's dep is done, so B should transition to ready
        (0, vitest_1.expect)(updated.steps.find((s) => s.ticketId === "b").status).toBe("ready");
    });
});
(0, vitest_1.describe)("applyQuery", () => {
    const tickets = [
        makeTicket({ id: "t1", status: "open", priority: 1, type: "bug" }),
        makeTicket({ id: "t2", status: "open", priority: 3, type: "feature" }),
        makeTicket({ id: "t3", status: "closed", priority: 2, type: "task" }),
    ];
    (0, vitest_1.it)("filters by status", () => {
        const result = (0, planner_js_1.applyQuery)(tickets, "status:open");
        (0, vitest_1.expect)(result.map((t) => t.id)).toEqual(["t1", "t2"]);
    });
    (0, vitest_1.it)("filters by priority with operator", () => {
        const result = (0, planner_js_1.applyQuery)(tickets, "priority:<=2");
        (0, vitest_1.expect)(result.map((t) => t.id)).toEqual(["t1", "t3"]);
    });
    (0, vitest_1.it)("combines multiple filters", () => {
        const result = (0, planner_js_1.applyQuery)(tickets, "status:open priority:<=2");
        (0, vitest_1.expect)(result.map((t) => t.id)).toEqual(["t1"]);
    });
});
//# sourceMappingURL=planner.test.js.map