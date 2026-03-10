"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
/**
 * Tests for TUI health view rendering with workspace health data.
 */
const vitest_1 = require("vitest");
const renderer_js_1 = require("../../packages/cli/src/tui/renderer.js");
const health_view_js_1 = require("../../packages/cli/src/tui/views/health-view.js");
function makePanel(width = 80, height = 40) {
    return { id: "health", x: 0, y: 0, width, height, title: "Health" };
}
function makeHealthData() {
    return {
        specCount: 5,
        specsCovered: 3,
        specsPartial: 1,
        specsUncovered: 1,
        specs: [
            { name: "detection", sections: 4, ticketCount: 4, status: "covered" },
            { name: "config", sections: 2, ticketCount: 2, status: "covered" },
            { name: "adapters", sections: 8, ticketCount: 5, status: "partial" },
            { name: "cicd", sections: 5, ticketCount: 0, status: "uncovered" },
            { name: "tui", sections: 6, ticketCount: 6, status: "covered" },
        ],
        ticketCount: 20,
        ticketsWithSpec: 16,
        ticketsWithoutSpec: 4,
        brokenLinks: [],
        useCases: [],
    };
}
function makeWorkspaceHealth() {
    return {
        projects: [
            {
                projectName: "folia",
                totalNodes: 428,
                totalEdges: 273,
                driftSignalCount: 12,
                topDriftType: "file_no_tests",
                testHealth: { total: 100, passed: 95, failed: 5, flaky: 1 },
            },
            {
                projectName: "mtnmap",
                totalNodes: 200,
                totalEdges: 120,
                driftSignalCount: 0,
                topDriftType: null,
                testHealth: { total: 50, passed: 50, failed: 0, flaky: 0 },
            },
        ],
        totalSignals: 12,
        sharedPatterns: [
            {
                patternId: "file_no_tests:connector",
                type: "file_no_tests",
                description: "connector files have \"file no tests\" across 2 projects: folia, mtnmap",
                projects: ["folia", "mtnmap"],
                signalCount: 5,
                suggestedAction: "Consider creating a shared test template for these files",
            },
        ],
    };
}
(0, vitest_1.describe)("Health view with workspace health", () => {
    (0, vitest_1.it)("renders without workspace health (backward compatible)", () => {
        const buf = new renderer_js_1.ScreenBuffer(80, 40);
        const panel = makePanel();
        const state = (0, health_view_js_1.createHealthViewState)();
        state.data = makeHealthData();
        // Should not throw
        (0, health_view_js_1.renderHealthView)(buf, panel, state);
        const output = buf.toString();
        (0, vitest_1.expect)(output).toContain("SPEC COVERAGE");
        (0, vitest_1.expect)(output).toContain("TICKET HEALTH");
    });
    (0, vitest_1.it)("renders workspace health section when data is available", () => {
        const buf = new renderer_js_1.ScreenBuffer(100, 50);
        const panel = makePanel(100, 50);
        const state = (0, health_view_js_1.createHealthViewState)();
        state.data = makeHealthData();
        state.workspaceHealth = makeWorkspaceHealth();
        (0, health_view_js_1.renderHealthView)(buf, panel, state);
        const output = buf.toString();
        (0, vitest_1.expect)(output).toContain("WORKSPACE");
        (0, vitest_1.expect)(output).toContain("folia");
        (0, vitest_1.expect)(output).toContain("mtnmap");
    });
    (0, vitest_1.it)("shows shared patterns in workspace section", () => {
        const buf = new renderer_js_1.ScreenBuffer(120, 60);
        const panel = makePanel(120, 60);
        const state = (0, health_view_js_1.createHealthViewState)();
        state.data = makeHealthData();
        state.workspaceHealth = makeWorkspaceHealth();
        (0, health_view_js_1.renderHealthView)(buf, panel, state);
        const output = buf.toString();
        (0, vitest_1.expect)(output).toContain("Shared patterns");
        (0, vitest_1.expect)(output).toContain("connector");
    });
    (0, vitest_1.it)("does not render workspace section when no projects have graphs", () => {
        const buf = new renderer_js_1.ScreenBuffer(80, 40);
        const panel = makePanel();
        const state = (0, health_view_js_1.createHealthViewState)();
        state.data = makeHealthData();
        state.workspaceHealth = { projects: [], totalSignals: 0, sharedPatterns: [] };
        (0, health_view_js_1.renderHealthView)(buf, panel, state);
        const output = buf.toString();
        // Empty workspace health should not add workspace section
        (0, vitest_1.expect)(output).not.toContain("WORKSPACE");
    });
    (0, vitest_1.it)("createHealthViewState initializes workspaceHealth to null", () => {
        const state = (0, health_view_js_1.createHealthViewState)();
        (0, vitest_1.expect)(state.workspaceHealth).toBeNull();
    });
    (0, vitest_1.it)("renders drift status per project", () => {
        const buf = new renderer_js_1.ScreenBuffer(120, 60);
        const panel = makePanel(120, 60);
        const state = (0, health_view_js_1.createHealthViewState)();
        state.data = makeHealthData();
        state.workspaceHealth = makeWorkspaceHealth();
        (0, health_view_js_1.renderHealthView)(buf, panel, state);
        const output = buf.toString();
        // folia has drift signals, mtnmap is clean
        (0, vitest_1.expect)(output).toContain("12 drift");
        (0, vitest_1.expect)(output).toContain("clean");
    });
    (0, vitest_1.it)("renders test health per project", () => {
        const buf = new renderer_js_1.ScreenBuffer(120, 60);
        const panel = makePanel(120, 60);
        const state = (0, health_view_js_1.createHealthViewState)();
        state.data = makeHealthData();
        state.workspaceHealth = makeWorkspaceHealth();
        (0, health_view_js_1.renderHealthView)(buf, panel, state);
        const output = buf.toString();
        (0, vitest_1.expect)(output).toContain("95/100 tests");
        (0, vitest_1.expect)(output).toContain("50/50 tests");
    });
});
//# sourceMappingURL=health-view-workspace.test.js.map