"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const dashboard_js_1 = require("../../packages/cli/src/tui/views/dashboard.js");
function makeWorkItem(overrides = {}) {
    return {
        id: "test-item",
        title: "Test item",
        status: "open",
        priority: 2,
        type: "task",
        filePath: "/tmp/test",
        deps: [],
        links: [],
        tags: {},
        ...overrides,
    };
}
function makeDashboardWorkItem(projectId, projectName, overrides = {}) {
    return {
        item: makeWorkItem(overrides),
        projectId,
        projectName,
    };
}
function makeProject(id, name) {
    return {
        id,
        name,
        path: `/tmp/${id}`,
        stack: null,
        git: null,
        workSummary: null,
    };
}
function stateWithItems() {
    const state = (0, dashboard_js_1.createDashboardState)();
    state.projects = [
        makeProject("folia", "folia"),
        makeProject("mtnmap", "mtnmap"),
        makeProject("life", "life"),
    ];
    state.workItems = [
        makeDashboardWorkItem("folia", "folia", { id: "tile-perf", title: "tile server perf", priority: 1 }),
        makeDashboardWorkItem("folia", "folia", { id: "change-det", title: "change detection", priority: 1 }),
        makeDashboardWorkItem("mtnmap", "mtnmap", { id: "auth-mig", title: "auth migration", priority: 0 }),
        makeDashboardWorkItem("mtnmap", "mtnmap", { id: "offline", title: "offline sync", priority: 1 }),
        makeDashboardWorkItem("life", "life", { id: "dentist", title: "dentist appointment", priority: 1 }),
        makeDashboardWorkItem("life", "life", { id: "camping", title: "Big Sur camping trip", priority: 2 }),
        makeDashboardWorkItem("life", "life", { id: "groceries", title: "weekly groceries", priority: 3 }),
    ];
    return state;
}
(0, vitest_1.describe)("DashboardWorkItem", () => {
    (0, vitest_1.it)("createDashboardState initializes projectFilter to null", () => {
        const state = (0, dashboard_js_1.createDashboardState)();
        (0, vitest_1.expect)(state.projectFilter).toBeNull();
    });
    (0, vitest_1.it)("wraps WorkItem with project association", () => {
        const dw = makeDashboardWorkItem("proj1", "My Project", { id: "t1", title: "test" });
        (0, vitest_1.expect)(dw.item.id).toBe("t1");
        (0, vitest_1.expect)(dw.projectId).toBe("proj1");
        (0, vitest_1.expect)(dw.projectName).toBe("My Project");
    });
});
(0, vitest_1.describe)("getFilteredWorkItems", () => {
    (0, vitest_1.it)("returns all items sorted by priority when no filters", () => {
        const state = stateWithItems();
        const result = (0, dashboard_js_1.getFilteredWorkItems)(state);
        (0, vitest_1.expect)(result).toHaveLength(7);
        // P0 first
        (0, vitest_1.expect)(result[0].item.id).toBe("auth-mig");
        // P3 last
        (0, vitest_1.expect)(result[result.length - 1].item.id).toBe("groceries");
    });
    (0, vitest_1.it)("filters by project", () => {
        const state = stateWithItems();
        state.projectFilter = "life";
        const result = (0, dashboard_js_1.getFilteredWorkItems)(state);
        (0, vitest_1.expect)(result).toHaveLength(3);
        (0, vitest_1.expect)(result.every((w) => w.projectId === "life")).toBe(true);
    });
    (0, vitest_1.it)("filters by priority", () => {
        const state = stateWithItems();
        state.priorityFilter = 1;
        const result = (0, dashboard_js_1.getFilteredWorkItems)(state);
        (0, vitest_1.expect)(result).toHaveLength(4);
        (0, vitest_1.expect)(result.every((w) => w.item.priority === 1)).toBe(true);
    });
    (0, vitest_1.it)("combines project and priority filters", () => {
        const state = stateWithItems();
        state.projectFilter = "folia";
        state.priorityFilter = 1;
        const result = (0, dashboard_js_1.getFilteredWorkItems)(state);
        (0, vitest_1.expect)(result).toHaveLength(2);
        (0, vitest_1.expect)(result.every((w) => w.projectId === "folia" && w.item.priority === 1)).toBe(true);
    });
    (0, vitest_1.it)("filters by search query matching title", () => {
        const state = stateWithItems();
        state.searchQuery = "camping";
        const result = (0, dashboard_js_1.getFilteredWorkItems)(state);
        (0, vitest_1.expect)(result).toHaveLength(1);
        (0, vitest_1.expect)(result[0].item.id).toBe("camping");
    });
    (0, vitest_1.it)("filters by search query matching item id", () => {
        const state = stateWithItems();
        state.searchQuery = "auth-mig";
        const result = (0, dashboard_js_1.getFilteredWorkItems)(state);
        (0, vitest_1.expect)(result).toHaveLength(1);
        (0, vitest_1.expect)(result[0].item.id).toBe("auth-mig");
    });
    (0, vitest_1.it)("search matches project name", () => {
        const state = stateWithItems();
        state.searchQuery = "mtnmap";
        const result = (0, dashboard_js_1.getFilteredWorkItems)(state);
        (0, vitest_1.expect)(result).toHaveLength(2);
        (0, vitest_1.expect)(result.every((w) => w.projectName === "mtnmap")).toBe(true);
    });
    (0, vitest_1.it)("combines all three filters", () => {
        const state = stateWithItems();
        state.projectFilter = "life";
        state.priorityFilter = 2;
        state.searchQuery = "camping";
        const result = (0, dashboard_js_1.getFilteredWorkItems)(state);
        (0, vitest_1.expect)(result).toHaveLength(1);
        (0, vitest_1.expect)(result[0].item.id).toBe("camping");
    });
    (0, vitest_1.it)("returns empty when project filter matches nothing", () => {
        const state = stateWithItems();
        state.projectFilter = "nonexistent";
        const result = (0, dashboard_js_1.getFilteredWorkItems)(state);
        (0, vitest_1.expect)(result).toHaveLength(0);
    });
});
(0, vitest_1.describe)("project filter cycling", () => {
    // Simulate the f/F keybinding logic from app.ts
    function cycleForward(state) {
        const projectIds = state.projects.map((p) => p.id);
        if (projectIds.length === 0)
            return;
        if (state.projectFilter === null) {
            state.projectFilter = projectIds[0];
        }
        else {
            const idx = projectIds.indexOf(state.projectFilter);
            if (idx === -1 || idx === projectIds.length - 1) {
                state.projectFilter = null;
            }
            else {
                state.projectFilter = projectIds[idx + 1];
            }
        }
        state.selectedIndex[1] = 0;
        state.scrollOffset[1] = 0;
        (0, dashboard_js_1.clampSelection)(state);
    }
    function clearFilter(state) {
        state.projectFilter = null;
        state.selectedIndex[1] = 0;
        state.scrollOffset[1] = 0;
        (0, dashboard_js_1.clampSelection)(state);
    }
    (0, vitest_1.it)("cycles through projects: null → folia → mtnmap → life → null", () => {
        const state = stateWithItems();
        (0, vitest_1.expect)(state.projectFilter).toBeNull();
        cycleForward(state);
        (0, vitest_1.expect)(state.projectFilter).toBe("folia");
        cycleForward(state);
        (0, vitest_1.expect)(state.projectFilter).toBe("mtnmap");
        cycleForward(state);
        (0, vitest_1.expect)(state.projectFilter).toBe("life");
        cycleForward(state);
        (0, vitest_1.expect)(state.projectFilter).toBeNull();
    });
    (0, vitest_1.it)("F clears project filter", () => {
        const state = stateWithItems();
        state.projectFilter = "mtnmap";
        clearFilter(state);
        (0, vitest_1.expect)(state.projectFilter).toBeNull();
    });
    (0, vitest_1.it)("resets selection when filter changes", () => {
        const state = stateWithItems();
        state.selectedIndex[1] = 3;
        state.scrollOffset[1] = 2;
        cycleForward(state);
        (0, vitest_1.expect)(state.selectedIndex[1]).toBe(0);
        (0, vitest_1.expect)(state.scrollOffset[1]).toBe(0);
    });
    (0, vitest_1.it)("handles cycling with no projects", () => {
        const state = (0, dashboard_js_1.createDashboardState)();
        // No projects
        cycleForward(state);
        (0, vitest_1.expect)(state.projectFilter).toBeNull();
    });
    (0, vitest_1.it)("handles cycling when current filter project no longer exists", () => {
        const state = stateWithItems();
        state.projectFilter = "deleted-project";
        cycleForward(state);
        // idx === -1, so wraps to null
        (0, vitest_1.expect)(state.projectFilter).toBeNull();
    });
});
//# sourceMappingURL=dashboard-project-filter.test.js.map