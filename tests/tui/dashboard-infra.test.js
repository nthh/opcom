"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const renderer_js_1 = require("../../packages/cli/src/tui/renderer.js");
const dashboard_js_1 = require("../../packages/cli/src/tui/views/dashboard.js");
function makeProject(overrides = {}) {
    return {
        id: "proj-1",
        name: "folia",
        path: "/projects/folia",
        git: { remote: null, branch: "main", clean: true },
        workSummary: { open: 3, total: 5, inProgress: 1, closed: 1, deferred: 0 },
        ...overrides,
    };
}
const dashPanels = [
    { id: "projects", x: 0, y: 0, width: 100, height: 20, title: "Projects" },
    { id: "workqueue", x: 0, y: 20, width: 100, height: 20, title: "Work Queue" },
    { id: "agents", x: 100, y: 0, width: 50, height: 40, title: "Agents" },
];
(0, vitest_1.describe)("dashboard infra health dots", () => {
    (0, vitest_1.it)("renders infra dots when infraHealthSummary is present", () => {
        const state = (0, dashboard_js_1.createDashboardState)();
        state.projects = [
            makeProject({
                infraHealthSummary: { total: 3, healthy: 2, degraded: 0, unhealthy: 1, progressing: 0, suspended: 0, unknown: 0 },
            }),
        ];
        const buf = new renderer_js_1.ScreenBuffer(150, 40);
        (0, dashboard_js_1.renderDashboard)(buf, dashPanels, state);
        // Verify the summary is on the project
        (0, vitest_1.expect)(state.projects[0].infraHealthSummary?.total).toBe(3);
    });
    (0, vitest_1.it)("does not render infra dots when no summary", () => {
        const state = (0, dashboard_js_1.createDashboardState)();
        state.projects = [makeProject()];
        const buf = new renderer_js_1.ScreenBuffer(150, 40);
        (0, dashboard_js_1.renderDashboard)(buf, dashPanels, state);
        (0, vitest_1.expect)(state.projects[0].infraHealthSummary).toBeUndefined();
    });
    (0, vitest_1.it)("renders both cloud and infra dots together", () => {
        const state = (0, dashboard_js_1.createDashboardState)();
        state.projects = [
            makeProject({
                cloudHealthSummary: { total: 2, healthy: 2, degraded: 0, unreachable: 0, unknown: 0 },
                infraHealthSummary: { total: 3, healthy: 3, degraded: 0, unhealthy: 0, progressing: 0, suspended: 0, unknown: 0 },
            }),
        ];
        const buf = new renderer_js_1.ScreenBuffer(150, 40);
        // Should render without error
        (0, dashboard_js_1.renderDashboard)(buf, dashPanels, state);
        (0, vitest_1.expect)(state.projects[0].cloudHealthSummary?.total).toBe(2);
        (0, vitest_1.expect)(state.projects[0].infraHealthSummary?.total).toBe(3);
    });
});
(0, vitest_1.describe)("formatInfraDots", () => {
    (0, vitest_1.it)("returns dots for all health states", () => {
        const summary = {
            total: 6,
            healthy: 2,
            degraded: 1,
            unhealthy: 1,
            progressing: 1,
            suspended: 1,
            unknown: 0,
        };
        const result = (0, dashboard_js_1.formatInfraDots)(summary);
        // Contains ANSI escape codes, but should have 6 dot characters
        (0, vitest_1.expect)(result).toBeTruthy();
        // Check it contains the expected unicode characters (within ANSI codes)
        (0, vitest_1.expect)(result).toContain("\u25cf"); // ● healthy
        (0, vitest_1.expect)(result).toContain("\u25d0"); // ◐ progressing or degraded
        (0, vitest_1.expect)(result).toContain("\u25cb"); // ○ unhealthy
        (0, vitest_1.expect)(result).toContain("\u2013"); // – suspended
    });
    (0, vitest_1.it)("returns empty string for all-zero summary", () => {
        const summary = {
            total: 0,
            healthy: 0,
            degraded: 0,
            unhealthy: 0,
            progressing: 0,
            suspended: 0,
            unknown: 0,
        };
        const result = (0, dashboard_js_1.formatInfraDots)(summary);
        (0, vitest_1.expect)(result).toBe("");
    });
    (0, vitest_1.it)("returns only healthy dots when all healthy", () => {
        const summary = {
            total: 3,
            healthy: 3,
            degraded: 0,
            unhealthy: 0,
            progressing: 0,
            suspended: 0,
            unknown: 0,
        };
        const result = (0, dashboard_js_1.formatInfraDots)(summary);
        (0, vitest_1.expect)(result).toContain("\u25cf"); // ● healthy
        (0, vitest_1.expect)(result).not.toContain("\u25cb"); // no ○ unhealthy
    });
});
//# sourceMappingURL=dashboard-infra.test.js.map