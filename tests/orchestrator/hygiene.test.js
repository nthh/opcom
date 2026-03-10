"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const hygiene_js_1 = require("../../packages/core/src/orchestrator/hygiene.js");
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
function makeSession(overrides) {
    return {
        backend: "claude-code",
        projectId: "proj-a",
        state: "idle",
        startedAt: "2025-01-01T00:00:00Z",
        ...overrides,
    };
}
(0, vitest_1.describe)("checkHygiene", () => {
    (0, vitest_1.it)("detects orphan deps", () => {
        const ticketSets = [
            {
                projectId: "proj-a",
                tickets: [
                    makeTicket({ id: "task-1", deps: ["nonexistent-ticket"] }),
                    makeTicket({ id: "task-2" }),
                ],
            },
        ];
        const report = (0, hygiene_js_1.checkHygiene)(ticketSets, []);
        (0, vitest_1.expect)(report.orphanDeps).toContain("task-1");
        (0, vitest_1.expect)(report.issues.some((i) => i.category === "orphan-dep" && i.ticketId === "task-1")).toBe(true);
    });
    (0, vitest_1.it)("detects cycles", () => {
        const ticketSets = [
            {
                projectId: "proj-a",
                tickets: [
                    makeTicket({ id: "a", deps: ["b"] }),
                    makeTicket({ id: "b", deps: ["a"] }),
                ],
            },
        ];
        const report = (0, hygiene_js_1.checkHygiene)(ticketSets, []);
        (0, vitest_1.expect)(report.cycles.length).toBeGreaterThan(0);
        const flat = report.cycles.flat();
        (0, vitest_1.expect)(flat).toContain("a");
        (0, vitest_1.expect)(flat).toContain("b");
        (0, vitest_1.expect)(report.issues.some((i) => i.category === "cycle")).toBe(true);
    });
    (0, vitest_1.it)("detects unblocked tickets (all deps closed)", () => {
        const ticketSets = [
            {
                projectId: "proj-a",
                tickets: [
                    makeTicket({ id: "dep-1", status: "closed" }),
                    makeTicket({ id: "dep-2", status: "closed" }),
                    makeTicket({ id: "task-1", status: "open", deps: ["dep-1", "dep-2"] }),
                ],
            },
        ];
        const report = (0, hygiene_js_1.checkHygiene)(ticketSets, []);
        (0, vitest_1.expect)(report.unblockedTickets).toContain("task-1");
        (0, vitest_1.expect)(report.issues.some((i) => i.category === "unblocked" && i.ticketId === "task-1")).toBe(true);
    });
    (0, vitest_1.it)("detects abandoned in-progress tickets", () => {
        const ticketSets = [
            {
                projectId: "proj-a",
                tickets: [
                    makeTicket({ id: "abandoned-1", status: "in-progress" }),
                ],
            },
        ];
        // No running agents
        const report = (0, hygiene_js_1.checkHygiene)(ticketSets, []);
        (0, vitest_1.expect)(report.abandonedTickets).toContain("abandoned-1");
        (0, vitest_1.expect)(report.issues.some((i) => i.category === "abandoned" && i.ticketId === "abandoned-1")).toBe(true);
    });
    (0, vitest_1.it)("does not flag in-progress ticket with active agent", () => {
        const ticketSets = [
            {
                projectId: "proj-a",
                tickets: [
                    makeTicket({ id: "working-1", status: "in-progress" }),
                ],
            },
        ];
        const sessions = [
            makeSession({ id: "s1", state: "streaming", workItemId: "working-1" }),
        ];
        const report = (0, hygiene_js_1.checkHygiene)(ticketSets, sessions);
        (0, vitest_1.expect)(report.abandonedTickets).not.toContain("working-1");
    });
    (0, vitest_1.it)("detects stale open tickets", () => {
        const thirtyDaysAgo = new Date("2026-01-01");
        const now = new Date("2026-02-15");
        const ticketSets = [
            {
                projectId: "proj-a",
                tickets: [
                    makeTicket({ id: "old-task", created: thirtyDaysAgo.toISOString() }),
                    makeTicket({ id: "new-task", created: "2026-02-10" }),
                ],
            },
        ];
        const report = (0, hygiene_js_1.checkHygiene)(ticketSets, [], { now });
        (0, vitest_1.expect)(report.staleTickets).toContain("old-task");
        (0, vitest_1.expect)(report.staleTickets).not.toContain("new-task");
        (0, vitest_1.expect)(report.issues.some((i) => i.category === "stale" && i.ticketId === "old-task")).toBe(true);
    });
    (0, vitest_1.it)("does not flag closed tickets as stale", () => {
        const now = new Date("2026-03-01");
        const ticketSets = [
            {
                projectId: "proj-a",
                tickets: [
                    makeTicket({ id: "done-task", status: "closed", created: "2025-01-01" }),
                ],
            },
        ];
        const report = (0, hygiene_js_1.checkHygiene)(ticketSets, [], { now });
        (0, vitest_1.expect)(report.staleTickets).not.toContain("done-task");
    });
    (0, vitest_1.it)("respects custom staleDays option", () => {
        const now = new Date("2026-03-01");
        const ticketSets = [
            {
                projectId: "proj-a",
                tickets: [
                    makeTicket({ id: "recent", created: "2026-02-25" }), // 4 days old
                ],
            },
        ];
        // Default 14 days — not stale
        const report1 = (0, hygiene_js_1.checkHygiene)(ticketSets, [], { now });
        (0, vitest_1.expect)(report1.staleTickets).not.toContain("recent");
        // Custom 3 days — stale
        const report2 = (0, hygiene_js_1.checkHygiene)(ticketSets, [], { now, staleDays: 3 });
        (0, vitest_1.expect)(report2.staleTickets).toContain("recent");
    });
    (0, vitest_1.it)("skips tickets without created date for staleness check", () => {
        const now = new Date("2026-03-01");
        const ticketSets = [
            {
                projectId: "proj-a",
                tickets: [
                    makeTicket({ id: "no-date" }), // no created field
                ],
            },
        ];
        const report = (0, hygiene_js_1.checkHygiene)(ticketSets, [], { now });
        (0, vitest_1.expect)(report.staleTickets).not.toContain("no-date");
    });
    (0, vitest_1.it)("reports clean when all tickets are healthy", () => {
        const ticketSets = [
            {
                projectId: "proj-a",
                tickets: [
                    makeTicket({ id: "task-1" }),
                    makeTicket({ id: "task-2" }),
                    makeTicket({ id: "task-3", deps: ["task-1"] }),
                ],
            },
        ];
        const report = (0, hygiene_js_1.checkHygiene)(ticketSets, []);
        (0, vitest_1.expect)(report.issues).toHaveLength(0);
        (0, vitest_1.expect)(report.orphanDeps).toHaveLength(0);
        (0, vitest_1.expect)(report.cycles).toHaveLength(0);
        (0, vitest_1.expect)(report.unblockedTickets).toHaveLength(0);
        (0, vitest_1.expect)(report.abandonedTickets).toHaveLength(0);
    });
    // --- Dep Validation Edge Cases ---
    (0, vitest_1.it)("detects self-referential dependency as a cycle", () => {
        const ticketSets = [
            {
                projectId: "proj-a",
                tickets: [makeTicket({ id: "self-dep", deps: ["self-dep"] })],
            },
        ];
        const report = (0, hygiene_js_1.checkHygiene)(ticketSets, []);
        (0, vitest_1.expect)(report.cycles.length).toBe(1);
        (0, vitest_1.expect)(report.cycles[0]).toContain("self-dep");
        (0, vitest_1.expect)(report.issues.some((i) => i.category === "cycle" && i.ticketId === "self-dep")).toBe(true);
    });
    (0, vitest_1.it)("detects 3-node cycle", () => {
        const ticketSets = [
            {
                projectId: "proj-a",
                tickets: [
                    makeTicket({ id: "a", deps: ["b"] }),
                    makeTicket({ id: "b", deps: ["c"] }),
                    makeTicket({ id: "c", deps: ["a"] }),
                ],
            },
        ];
        const report = (0, hygiene_js_1.checkHygiene)(ticketSets, []);
        (0, vitest_1.expect)(report.cycles.length).toBeGreaterThan(0);
        const flat = report.cycles.flat();
        (0, vitest_1.expect)(flat).toContain("a");
        (0, vitest_1.expect)(flat).toContain("b");
        (0, vitest_1.expect)(flat).toContain("c");
    });
    (0, vitest_1.it)("detects two disjoint cycles", () => {
        const ticketSets = [
            {
                projectId: "proj-a",
                tickets: [
                    makeTicket({ id: "a", deps: ["b"] }),
                    makeTicket({ id: "b", deps: ["a"] }),
                    makeTicket({ id: "x", deps: ["y"] }),
                    makeTicket({ id: "y", deps: ["x"] }),
                ],
            },
        ];
        const report = (0, hygiene_js_1.checkHygiene)(ticketSets, []);
        (0, vitest_1.expect)(report.cycles.length).toBe(2);
    });
    (0, vitest_1.it)("reports multiple orphan deps on the same ticket", () => {
        const ticketSets = [
            {
                projectId: "proj-a",
                tickets: [
                    makeTicket({ id: "task-1", deps: ["ghost-1", "ghost-2"] }),
                ],
            },
        ];
        const report = (0, hygiene_js_1.checkHygiene)(ticketSets, []);
        // Should have two orphan-dep issues for the same ticket
        const orphanIssues = report.issues.filter((i) => i.category === "orphan-dep" && i.ticketId === "task-1");
        (0, vitest_1.expect)(orphanIssues).toHaveLength(2);
        (0, vitest_1.expect)(orphanIssues[0].message).toContain("ghost-1");
        (0, vitest_1.expect)(orphanIssues[1].message).toContain("ghost-2");
    });
    (0, vitest_1.it)("does not flag unblocked when some deps are orphans", () => {
        const ticketSets = [
            {
                projectId: "proj-a",
                tickets: [
                    makeTicket({ id: "dep-1", status: "closed" }),
                    makeTicket({ id: "task-1", deps: ["dep-1", "nonexistent"] }),
                ],
            },
        ];
        const report = (0, hygiene_js_1.checkHygiene)(ticketSets, []);
        // Has orphan dep, so should NOT be flagged as unblocked
        (0, vitest_1.expect)(report.unblockedTickets).not.toContain("task-1");
        // But should have orphan dep issue
        (0, vitest_1.expect)(report.orphanDeps).toContain("task-1");
    });
    // --- Cross-Project ---
    (0, vitest_1.it)("validates deps across multiple projects", () => {
        const ticketSets = [
            {
                projectId: "proj-a",
                tickets: [makeTicket({ id: "a-task", deps: ["b-task"] })],
            },
            {
                projectId: "proj-b",
                tickets: [makeTicket({ id: "b-task" })],
            },
        ];
        const report = (0, hygiene_js_1.checkHygiene)(ticketSets, []);
        // b-task exists in proj-b, so no orphan dep
        (0, vitest_1.expect)(report.orphanDeps).not.toContain("a-task");
        (0, vitest_1.expect)(report.issues.filter((i) => i.category === "orphan-dep")).toHaveLength(0);
    });
    (0, vitest_1.it)("detects cross-project unblocked tickets", () => {
        const ticketSets = [
            {
                projectId: "proj-a",
                tickets: [makeTicket({ id: "a-task", deps: ["b-dep"] })],
            },
            {
                projectId: "proj-b",
                tickets: [makeTicket({ id: "b-dep", status: "closed" })],
            },
        ];
        const report = (0, hygiene_js_1.checkHygiene)(ticketSets, []);
        (0, vitest_1.expect)(report.unblockedTickets).toContain("a-task");
    });
    (0, vitest_1.it)("detects cross-project cycles", () => {
        const ticketSets = [
            {
                projectId: "proj-a",
                tickets: [makeTicket({ id: "a", deps: ["b"] })],
            },
            {
                projectId: "proj-b",
                tickets: [makeTicket({ id: "b", deps: ["a"] })],
            },
        ];
        const report = (0, hygiene_js_1.checkHygiene)(ticketSets, []);
        (0, vitest_1.expect)(report.cycles.length).toBeGreaterThan(0);
    });
    // --- Status Handling ---
    (0, vitest_1.it)("does not flag deferred tickets as stale", () => {
        const now = new Date("2026-03-01");
        const ticketSets = [
            {
                projectId: "proj-a",
                tickets: [
                    makeTicket({ id: "deferred-1", status: "deferred", created: "2025-01-01" }),
                ],
            },
        ];
        const report = (0, hygiene_js_1.checkHygiene)(ticketSets, [], { now });
        (0, vitest_1.expect)(report.staleTickets).not.toContain("deferred-1");
    });
    (0, vitest_1.it)("does not flag in-progress tickets as stale", () => {
        const now = new Date("2026-03-01");
        const ticketSets = [
            {
                projectId: "proj-a",
                tickets: [
                    makeTicket({ id: "wip", status: "in-progress", created: "2025-01-01" }),
                ],
            },
        ];
        const report = (0, hygiene_js_1.checkHygiene)(ticketSets, [], { now });
        (0, vitest_1.expect)(report.staleTickets).not.toContain("wip");
    });
    (0, vitest_1.it)("does not flag closed ticket with open deps as unblocked", () => {
        const ticketSets = [
            {
                projectId: "proj-a",
                tickets: [
                    makeTicket({ id: "dep-1", status: "open" }),
                    makeTicket({ id: "task-1", status: "closed", deps: ["dep-1"] }),
                ],
            },
        ];
        const report = (0, hygiene_js_1.checkHygiene)(ticketSets, []);
        (0, vitest_1.expect)(report.unblockedTickets).not.toContain("task-1");
    });
    (0, vitest_1.it)("does not flag ticket with no deps as unblocked", () => {
        const ticketSets = [
            {
                projectId: "proj-a",
                tickets: [makeTicket({ id: "standalone" })],
            },
        ];
        const report = (0, hygiene_js_1.checkHygiene)(ticketSets, []);
        (0, vitest_1.expect)(report.unblockedTickets).not.toContain("standalone");
    });
    // --- Session Handling ---
    (0, vitest_1.it)("treats stopped sessions as inactive for abandonment check", () => {
        const ticketSets = [
            {
                projectId: "proj-a",
                tickets: [makeTicket({ id: "t1", status: "in-progress" })],
            },
        ];
        const sessions = [
            makeSession({ id: "s1", state: "stopped", workItemId: "t1" }),
        ];
        const report = (0, hygiene_js_1.checkHygiene)(ticketSets, sessions);
        (0, vitest_1.expect)(report.abandonedTickets).toContain("t1");
    });
    (0, vitest_1.it)("recognizes various active agent states", () => {
        const ticketSets = [
            {
                projectId: "proj-a",
                tickets: [
                    makeTicket({ id: "t1", status: "in-progress" }),
                    makeTicket({ id: "t2", status: "in-progress" }),
                    makeTicket({ id: "t3", status: "in-progress" }),
                ],
            },
        ];
        const sessions = [
            makeSession({ id: "s1", state: "idle", workItemId: "t1" }),
            makeSession({ id: "s2", state: "waiting", workItemId: "t2" }),
            makeSession({ id: "s3", state: "error", workItemId: "t3" }),
        ];
        const report = (0, hygiene_js_1.checkHygiene)(ticketSets, sessions);
        // All have active (non-stopped) sessions, none should be abandoned
        (0, vitest_1.expect)(report.abandonedTickets).toHaveLength(0);
    });
    // --- Edge Cases ---
    (0, vitest_1.it)("handles empty ticket sets", () => {
        const report = (0, hygiene_js_1.checkHygiene)([], []);
        (0, vitest_1.expect)(report.issues).toHaveLength(0);
        (0, vitest_1.expect)(report.cycles).toHaveLength(0);
        (0, vitest_1.expect)(report.orphanDeps).toHaveLength(0);
        (0, vitest_1.expect)(report.staleTickets).toHaveLength(0);
        (0, vitest_1.expect)(report.unblockedTickets).toHaveLength(0);
        (0, vitest_1.expect)(report.abandonedTickets).toHaveLength(0);
    });
    (0, vitest_1.it)("handles ticket set with empty tickets array", () => {
        const ticketSets = [
            { projectId: "proj-a", tickets: [] },
        ];
        const report = (0, hygiene_js_1.checkHygiene)(ticketSets, []);
        (0, vitest_1.expect)(report.issues).toHaveLength(0);
    });
    (0, vitest_1.it)("a ticket can have multiple issue categories simultaneously", () => {
        const now = new Date("2026-03-01");
        const ticketSets = [
            {
                projectId: "proj-a",
                tickets: [
                    // This ticket is stale AND has an orphan dep
                    makeTicket({
                        id: "multi-issue",
                        created: "2025-01-01",
                        deps: ["nonexistent"],
                    }),
                ],
            },
        ];
        const report = (0, hygiene_js_1.checkHygiene)(ticketSets, [], { now });
        (0, vitest_1.expect)(report.staleTickets).toContain("multi-issue");
        (0, vitest_1.expect)(report.orphanDeps).toContain("multi-issue");
        const categories = report.issues
            .filter((i) => i.ticketId === "multi-issue")
            .map((i) => i.category);
        (0, vitest_1.expect)(categories).toContain("stale");
        (0, vitest_1.expect)(categories).toContain("orphan-dep");
    });
    (0, vitest_1.it)("cycle issues have error severity", () => {
        const ticketSets = [
            {
                projectId: "proj-a",
                tickets: [
                    makeTicket({ id: "a", deps: ["b"] }),
                    makeTicket({ id: "b", deps: ["a"] }),
                ],
            },
        ];
        const report = (0, hygiene_js_1.checkHygiene)(ticketSets, []);
        const cycleIssues = report.issues.filter((i) => i.category === "cycle");
        (0, vitest_1.expect)(cycleIssues.length).toBeGreaterThan(0);
        for (const issue of cycleIssues) {
            (0, vitest_1.expect)(issue.severity).toBe("error");
        }
    });
    (0, vitest_1.it)("orphan dep issues have warning severity", () => {
        const ticketSets = [
            {
                projectId: "proj-a",
                tickets: [makeTicket({ id: "t1", deps: ["missing"] })],
            },
        ];
        const report = (0, hygiene_js_1.checkHygiene)(ticketSets, []);
        const orphanIssues = report.issues.filter((i) => i.category === "orphan-dep");
        (0, vitest_1.expect)(orphanIssues).toHaveLength(1);
        (0, vitest_1.expect)(orphanIssues[0].severity).toBe("warning");
    });
    (0, vitest_1.it)("unblocked issues have info severity", () => {
        const ticketSets = [
            {
                projectId: "proj-a",
                tickets: [
                    makeTicket({ id: "dep-1", status: "closed" }),
                    makeTicket({ id: "t1", deps: ["dep-1"] }),
                ],
            },
        ];
        const report = (0, hygiene_js_1.checkHygiene)(ticketSets, []);
        const unblockedIssues = report.issues.filter((i) => i.category === "unblocked");
        (0, vitest_1.expect)(unblockedIssues).toHaveLength(1);
        (0, vitest_1.expect)(unblockedIssues[0].severity).toBe("info");
    });
    (0, vitest_1.it)("issues include actionable suggestions", () => {
        const now = new Date("2026-03-01");
        const ticketSets = [
            {
                projectId: "proj-a",
                tickets: [
                    makeTicket({ id: "orphan-t", deps: ["missing"] }),
                    makeTicket({ id: "dep-closed", status: "closed" }),
                    makeTicket({ id: "unblocked-t", deps: ["dep-closed"] }),
                    makeTicket({ id: "abandoned-t", status: "in-progress" }),
                    makeTicket({ id: "stale-t", created: "2025-01-01" }),
                    makeTicket({ id: "cycle-a", deps: ["cycle-b"] }),
                    makeTicket({ id: "cycle-b", deps: ["cycle-a"] }),
                ],
            },
        ];
        const report = (0, hygiene_js_1.checkHygiene)(ticketSets, [], { now });
        // Every issue should have a non-empty suggestion
        for (const issue of report.issues) {
            (0, vitest_1.expect)(issue.suggestion).toBeTruthy();
            (0, vitest_1.expect)(issue.suggestion.length).toBeGreaterThan(0);
        }
    });
    (0, vitest_1.it)("handles diamond dependency pattern without false positives", () => {
        const ticketSets = [
            {
                projectId: "proj-a",
                tickets: [
                    makeTicket({ id: "root" }),
                    makeTicket({ id: "left", deps: ["root"] }),
                    makeTicket({ id: "right", deps: ["root"] }),
                    makeTicket({ id: "bottom", deps: ["left", "right"] }),
                ],
            },
        ];
        const report = (0, hygiene_js_1.checkHygiene)(ticketSets, []);
        // No cycles in a diamond
        (0, vitest_1.expect)(report.cycles).toHaveLength(0);
        (0, vitest_1.expect)(report.orphanDeps).toHaveLength(0);
    });
    (0, vitest_1.it)("does not flag unblocked when some deps are still open", () => {
        const ticketSets = [
            {
                projectId: "proj-a",
                tickets: [
                    makeTicket({ id: "dep-done", status: "closed" }),
                    makeTicket({ id: "dep-pending", status: "open" }),
                    makeTicket({ id: "task-1", deps: ["dep-done", "dep-pending"] }),
                ],
            },
        ];
        const report = (0, hygiene_js_1.checkHygiene)(ticketSets, []);
        (0, vitest_1.expect)(report.unblockedTickets).not.toContain("task-1");
    });
});
//# sourceMappingURL=hygiene.test.js.map