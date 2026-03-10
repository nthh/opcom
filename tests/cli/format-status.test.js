"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const format_js_1 = require("../../packages/cli/src/ui/format.js");
// Strip ANSI codes for easier assertion
function strip(s) {
    return s.replace(/\x1b\[[0-9;]*m/g, "");
}
function makeProject(overrides = {}) {
    return {
        id: "proj-1",
        name: "testproject",
        path: "/home/user/testproject",
        stack: { languages: [], frameworks: [], packageManagers: [], infrastructure: [], versionManagers: [] },
        git: { branch: "main", clean: true, uncommittedCount: 0 },
        workSystem: null,
        ...overrides,
    };
}
function makeStatus(projectOverrides = {}, statusOverrides = {}) {
    const project = makeProject(projectOverrides);
    return {
        project,
        workSummary: null,
        gitFresh: project.git,
        ...statusOverrides,
    };
}
function makeWorkItem(overrides = {}) {
    return {
        id: "ticket-1",
        title: "Fix the bug",
        status: "open",
        priority: 2,
        type: "bug",
        filePath: "/path/to/ticket",
        deps: [],
        links: [],
        tags: {},
        ...overrides,
    };
}
function makeAgent(overrides = {}) {
    return {
        id: "agent-1",
        projectId: "proj-1",
        backend: "claude-code",
        state: "streaming",
        startedAt: new Date().toISOString(),
        workItemId: undefined,
        ...overrides,
    };
}
// --- formatStatusDashboard ---
(0, vitest_1.describe)("formatStatusDashboard", () => {
    (0, vitest_1.it)("renders basic project list", () => {
        const s1 = makeStatus({ name: "folia" });
        const s2 = makeStatus({ name: "life", git: null }, { gitFresh: null });
        const output = strip((0, format_js_1.formatStatusDashboard)("personal", [s1, s2]));
        (0, vitest_1.expect)(output).toContain("opcom");
        (0, vitest_1.expect)(output).toContain("personal");
        (0, vitest_1.expect)(output).toContain("PROJECTS (2)");
        (0, vitest_1.expect)(output).toContain("folia");
        (0, vitest_1.expect)(output).toContain("life");
        (0, vitest_1.expect)(output).toContain("(no git)");
    });
    (0, vitest_1.it)("shows ticket summary counts by default", () => {
        const s = makeStatus({ name: "folia" }, { workSummary: { total: 10, open: 5, inProgress: 2, closed: 3, deferred: 0 } });
        const output = strip((0, format_js_1.formatStatusDashboard)("ws", [s]));
        (0, vitest_1.expect)(output).toContain("5 open / 10 total");
    });
    (0, vitest_1.it)("shows full ticket list for single-project view", () => {
        const s = makeStatus({ id: "proj-folia", name: "folia" }, { workSummary: { total: 3, open: 2, inProgress: 1, closed: 0, deferred: 0 } });
        const tickets = [
            makeWorkItem({ id: "auth-bug", title: "Auth migration", priority: 0, status: "in-progress" }),
            makeWorkItem({ id: "perf", title: "Tile server perf", priority: 1 }),
            makeWorkItem({ id: "docs", title: "API docs", priority: 2 }),
        ];
        const projectTickets = new Map([["proj-folia", tickets]]);
        const output = strip((0, format_js_1.formatStatusDashboard)("ws", [s], undefined, {
            projectTickets,
            projectFilter: "folia",
        }));
        (0, vitest_1.expect)(output).toContain("Tickets");
        (0, vitest_1.expect)(output).toContain("Auth migration");
        (0, vitest_1.expect)(output).toContain("Tile server perf");
        (0, vitest_1.expect)(output).toContain("API docs");
        // Should be sorted by priority (P0 first)
        const authIdx = output.indexOf("Auth migration");
        const perfIdx = output.indexOf("Tile server perf");
        const docsIdx = output.indexOf("API docs");
        (0, vitest_1.expect)(authIdx).toBeLessThan(perfIdx);
        (0, vitest_1.expect)(perfIdx).toBeLessThan(docsIdx);
    });
    (0, vitest_1.it)("does not show inline tickets in multi-project view", () => {
        const s = makeStatus({ id: "proj-folia", name: "folia" }, { workSummary: { total: 1, open: 1, inProgress: 0, closed: 0, deferred: 0 } });
        const tickets = [makeWorkItem({ id: "t1", title: "Some ticket" })];
        const projectTickets = new Map([["proj-folia", tickets]]);
        const output = strip((0, format_js_1.formatStatusDashboard)("ws", [s], undefined, {
            projectTickets,
            projectFilter: null,
        }));
        // Inline tickets section should not appear (the work queue summary is separate)
        const projectsSection = output.split("WORK QUEUE")[0];
        (0, vitest_1.expect)(projectsSection).not.toMatch(/P\d\s+.*Some ticket/);
    });
    (0, vitest_1.it)("includes global WORK QUEUE in multi-project view", () => {
        const s1 = makeStatus({ id: "proj-folia", name: "folia" });
        const s2 = makeStatus({ id: "proj-life", name: "life" });
        const projectTickets = new Map([
            ["proj-folia", [
                    makeWorkItem({ id: "t1", title: "Tile server perf", priority: 1 }),
                ]],
            ["proj-life", [
                    makeWorkItem({ id: "t2", title: "Dentist appointment", priority: 1 }),
                    makeWorkItem({ id: "t3", title: "Weekly groceries", priority: 3 }),
                ]],
        ]);
        const output = strip((0, format_js_1.formatStatusDashboard)("ws", [s1, s2], undefined, {
            projectTickets,
            projectFilter: null,
        }));
        (0, vitest_1.expect)(output).toContain("WORK QUEUE (3)");
        (0, vitest_1.expect)(output).toContain("Tile server perf");
        (0, vitest_1.expect)(output).toContain("folia");
        (0, vitest_1.expect)(output).toContain("Dentist appointment");
        (0, vitest_1.expect)(output).toContain("life");
        (0, vitest_1.expect)(output).toContain("Weekly groceries");
    });
    (0, vitest_1.it)("excludes closed items from global work queue", () => {
        const s = makeStatus({ id: "proj-1", name: "myproj" });
        const projectTickets = new Map([
            ["proj-1", [
                    makeWorkItem({ id: "t1", title: "Open task", status: "open" }),
                    makeWorkItem({ id: "t2", title: "Done task", status: "closed" }),
                ]],
        ]);
        const output = strip((0, format_js_1.formatStatusDashboard)("ws", [s], undefined, {
            projectTickets,
            projectFilter: null,
        }));
        (0, vitest_1.expect)(output).toContain("WORK QUEUE (1)");
        (0, vitest_1.expect)(output).toContain("Open task");
        (0, vitest_1.expect)(output).not.toContain("Done task");
    });
    (0, vitest_1.it)("shows agent icon on work items with active agents", () => {
        const s = makeStatus({ id: "proj-1", name: "folia" });
        const agents = [
            makeAgent({ workItemId: "t1", state: "streaming" }),
        ];
        const projectTickets = new Map([
            ["proj-1", [
                    makeWorkItem({ id: "t1", title: "Active task", priority: 1 }),
                    makeWorkItem({ id: "t2", title: "No agent task", priority: 2 }),
                ]],
        ]);
        const output = (0, format_js_1.formatStatusDashboard)("ws", [s], agents, {
            projectTickets,
            projectFilter: null,
        });
        // The active task line should have the robot emoji
        const lines = output.split("\n");
        const activeLine = lines.find((l) => l.includes("Active task"));
        const noAgentLine = lines.find((l) => l.includes("No agent task"));
        (0, vitest_1.expect)(activeLine).toContain("\ud83e\udd16");
        (0, vitest_1.expect)(noAgentLine).not.toContain("\ud83e\udd16");
    });
    (0, vitest_1.it)("does not show WORK QUEUE when no tickets exist", () => {
        const s = makeStatus({ name: "emptyproj" });
        const output = strip((0, format_js_1.formatStatusDashboard)("ws", [s]));
        (0, vitest_1.expect)(output).not.toContain("WORK QUEUE");
    });
    (0, vitest_1.it)("does not show WORK QUEUE for single-project view", () => {
        const s = makeStatus({ id: "proj-1", name: "folia" });
        const projectTickets = new Map([
            ["proj-1", [makeWorkItem({ id: "t1", title: "Some work" })]],
        ]);
        const output = strip((0, format_js_1.formatStatusDashboard)("ws", [s], undefined, {
            projectTickets,
            projectFilter: "folia",
        }));
        (0, vitest_1.expect)(output).not.toContain("WORK QUEUE");
    });
});
// --- formatWorkQueueSummary ---
(0, vitest_1.describe)("formatWorkQueueSummary", () => {
    (0, vitest_1.it)("sorts items by priority", () => {
        const statuses = [
            makeStatus({ id: "p1", name: "proj-a" }),
            makeStatus({ id: "p2", name: "proj-b" }),
        ];
        const projectTickets = new Map([
            ["p1", [makeWorkItem({ id: "low", title: "Low prio", priority: 3 })]],
            ["p2", [makeWorkItem({ id: "high", title: "High prio", priority: 0 })]],
        ]);
        const output = strip((0, format_js_1.formatWorkQueueSummary)(statuses, projectTickets));
        const highIdx = output.indexOf("High prio");
        const lowIdx = output.indexOf("Low prio");
        (0, vitest_1.expect)(highIdx).toBeLessThan(lowIdx);
    });
    (0, vitest_1.it)("shows project name next to each item", () => {
        const statuses = [makeStatus({ id: "p1", name: "folia" })];
        const projectTickets = new Map([
            ["p1", [makeWorkItem({ id: "t1", title: "My task", priority: 1 })]],
        ]);
        const output = strip((0, format_js_1.formatWorkQueueSummary)(statuses, projectTickets));
        (0, vitest_1.expect)(output).toContain("folia");
        (0, vitest_1.expect)(output).toContain("My task");
    });
    (0, vitest_1.it)("shows empty message when no open items", () => {
        const statuses = [makeStatus({ id: "p1", name: "proj" })];
        const projectTickets = new Map([
            ["p1", [makeWorkItem({ status: "closed" })]],
        ]);
        const output = strip((0, format_js_1.formatWorkQueueSummary)(statuses, projectTickets));
        (0, vitest_1.expect)(output).toContain("WORK QUEUE (0)");
        (0, vitest_1.expect)(output).toContain("No open work items");
    });
});
//# sourceMappingURL=format-status.test.js.map