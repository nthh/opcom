"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const renderer_js_1 = require("../../packages/cli/src/tui/renderer.js");
const health_view_js_1 = require("../../packages/cli/src/tui/views/health-view.js");
const health_data_js_1 = require("../../packages/cli/src/tui/health-data.js");
function makeHealthData(overrides = {}) {
    return {
        specCount: 16,
        specsCovered: 10,
        specsPartial: 3,
        specsUncovered: 3,
        specs: [
            { name: "detection", sections: 4, ticketCount: 4, status: "covered" },
            { name: "config", sections: 3, ticketCount: 0, status: "uncovered" },
            { name: "adapters", sections: 6, ticketCount: 6, status: "covered" },
            { name: "orchestrator", sections: 8, ticketCount: 5, status: "partial" },
            { name: "tui", sections: 9, ticketCount: 9, status: "covered" },
        ],
        ticketCount: 68,
        ticketsWithSpec: 53,
        ticketsWithoutSpec: 15,
        brokenLinks: [],
        useCases: [
            { id: "UC-001", title: "First-Run Onboarding", done: 7, total: 14 },
        ],
        ...overrides,
    };
}
function makePanel(overrides = {}) {
    return {
        id: "health",
        x: 0,
        y: 0,
        width: 80,
        height: 30,
        title: "Health",
        ...overrides,
    };
}
function getBufferText(buf, row) {
    // Read the buffer by flushing and capturing
    // Instead, use the writeLine approach by rendering to a buffer then reading
    const lines = [];
    for (let r = 0; r < buf.rows; r++) {
        // Capture line by writing to buffer and checking
        lines.push("");
    }
    return "";
}
// --- formatHealthBar tests ---
(0, vitest_1.describe)("formatHealthBar", () => {
    (0, vitest_1.it)("formats spec coverage percentage", () => {
        const data = makeHealthData();
        const bar = (0, health_data_js_1.formatHealthBar)(data);
        // (10 covered + 3 partial) / 16 = 81%
        (0, vitest_1.expect)(bar).toContain("16 specs (81% covered)");
    });
    (0, vitest_1.it)("formats ticket link percentage", () => {
        const data = makeHealthData();
        const bar = (0, health_data_js_1.formatHealthBar)(data);
        // 53/68 = 78%
        (0, vitest_1.expect)(bar).toContain("68 tickets (78% linked)");
    });
    (0, vitest_1.it)("shows broken link count", () => {
        const data = makeHealthData();
        const bar = (0, health_data_js_1.formatHealthBar)(data);
        (0, vitest_1.expect)(bar).toContain("0 broken");
    });
    (0, vitest_1.it)("shows use case summary when present", () => {
        const data = makeHealthData();
        const bar = (0, health_data_js_1.formatHealthBar)(data);
        // 7/14 = 50%
        (0, vitest_1.expect)(bar).toContain("UC-001: 50%");
    });
    (0, vitest_1.it)("handles zero specs", () => {
        const data = makeHealthData({ specCount: 0, specs: [], specsCovered: 0, specsPartial: 0, specsUncovered: 0 });
        const bar = (0, health_data_js_1.formatHealthBar)(data);
        (0, vitest_1.expect)(bar).toContain("0 specs (0% covered)");
    });
    (0, vitest_1.it)("handles zero tickets", () => {
        const data = makeHealthData({ ticketCount: 0, ticketsWithSpec: 0, ticketsWithoutSpec: 0 });
        const bar = (0, health_data_js_1.formatHealthBar)(data);
        (0, vitest_1.expect)(bar).toContain("0 tickets (0% linked)");
    });
    (0, vitest_1.it)("omits use case when none exist", () => {
        const data = makeHealthData({ useCases: [] });
        const bar = (0, health_data_js_1.formatHealthBar)(data);
        (0, vitest_1.expect)(bar).not.toContain("UC-");
    });
    (0, vitest_1.it)("shows broken count when non-zero", () => {
        const data = makeHealthData({
            brokenLinks: [{ ticket: "t1", link: "spec/foo.md#bar", reason: "file not found" }],
        });
        const bar = (0, health_data_js_1.formatHealthBar)(data);
        (0, vitest_1.expect)(bar).toContain("1 broken");
    });
});
// --- isHealthWarning tests ---
(0, vitest_1.describe)("isHealthWarning", () => {
    (0, vitest_1.it)("returns false when healthy", () => {
        const data = makeHealthData({
            brokenLinks: [],
            ticketCount: 100,
            ticketsWithSpec: 80,
            ticketsWithoutSpec: 20,
        });
        (0, vitest_1.expect)((0, health_data_js_1.isHealthWarning)(data)).toBe(false);
    });
    (0, vitest_1.it)("returns true when broken links exist", () => {
        const data = makeHealthData({
            brokenLinks: [{ ticket: "t1", link: "bad", reason: "not found" }],
        });
        (0, vitest_1.expect)((0, health_data_js_1.isHealthWarning)(data)).toBe(true);
    });
    (0, vitest_1.it)("returns true when > 25% tickets unlinked", () => {
        const data = makeHealthData({
            ticketCount: 100,
            ticketsWithSpec: 70,
            ticketsWithoutSpec: 30,
            brokenLinks: [],
        });
        (0, vitest_1.expect)((0, health_data_js_1.isHealthWarning)(data)).toBe(true);
    });
    (0, vitest_1.it)("returns false at exactly 25% unlinked", () => {
        const data = makeHealthData({
            ticketCount: 100,
            ticketsWithSpec: 75,
            ticketsWithoutSpec: 25,
            brokenLinks: [],
        });
        (0, vitest_1.expect)((0, health_data_js_1.isHealthWarning)(data)).toBe(false);
    });
    (0, vitest_1.it)("returns false with zero tickets", () => {
        const data = makeHealthData({
            ticketCount: 0,
            ticketsWithSpec: 0,
            ticketsWithoutSpec: 0,
            brokenLinks: [],
        });
        (0, vitest_1.expect)((0, health_data_js_1.isHealthWarning)(data)).toBe(false);
    });
});
// --- createHealthViewState tests ---
(0, vitest_1.describe)("createHealthViewState", () => {
    (0, vitest_1.it)("creates initial state with defaults", () => {
        const state = (0, health_view_js_1.createHealthViewState)();
        (0, vitest_1.expect)(state.data).toBeNull();
        (0, vitest_1.expect)(state.selectedIndex).toBe(0);
        (0, vitest_1.expect)(state.scrollOffset).toBe(0);
        (0, vitest_1.expect)(state.drilledSpec).toBeNull();
        (0, vitest_1.expect)(state.sectionCoverage).toBeNull();
    });
});
// --- healthScrollDown / healthScrollUp tests ---
(0, vitest_1.describe)("healthScrollDown", () => {
    (0, vitest_1.it)("increments selectedIndex within spec list", () => {
        const state = (0, health_view_js_1.createHealthViewState)();
        state.data = makeHealthData();
        (0, health_view_js_1.healthScrollDown)(state, 30);
        (0, vitest_1.expect)(state.selectedIndex).toBe(1);
    });
    (0, vitest_1.it)("does not exceed spec list bounds", () => {
        const state = (0, health_view_js_1.createHealthViewState)();
        state.data = makeHealthData(); // 5 specs
        state.selectedIndex = 4;
        (0, health_view_js_1.healthScrollDown)(state, 30);
        (0, vitest_1.expect)(state.selectedIndex).toBe(4);
    });
    (0, vitest_1.it)("scrolls within drill-down when drilled", () => {
        const state = (0, health_view_js_1.createHealthViewState)();
        state.drilledSpec = "tui";
        state.sectionCoverage = [
            { anchor: "a", title: "A", tickets: [] },
            { anchor: "b", title: "B", tickets: [] },
            { anchor: "c", title: "C", tickets: [] },
        ];
        state.drillSelectedIndex = 0;
        (0, health_view_js_1.healthScrollDown)(state, 30);
        (0, vitest_1.expect)(state.drillSelectedIndex).toBe(1);
    });
    (0, vitest_1.it)("does not exceed drill-down bounds", () => {
        const state = (0, health_view_js_1.createHealthViewState)();
        state.drilledSpec = "tui";
        state.sectionCoverage = [
            { anchor: "a", title: "A", tickets: [] },
        ];
        state.drillSelectedIndex = 0;
        (0, health_view_js_1.healthScrollDown)(state, 30);
        (0, vitest_1.expect)(state.drillSelectedIndex).toBe(0);
    });
    (0, vitest_1.it)("does nothing when data is null", () => {
        const state = (0, health_view_js_1.createHealthViewState)();
        (0, health_view_js_1.healthScrollDown)(state, 30);
        (0, vitest_1.expect)(state.selectedIndex).toBe(0);
    });
});
(0, vitest_1.describe)("healthScrollUp", () => {
    (0, vitest_1.it)("decrements selectedIndex", () => {
        const state = (0, health_view_js_1.createHealthViewState)();
        state.data = makeHealthData();
        state.selectedIndex = 3;
        (0, health_view_js_1.healthScrollUp)(state);
        (0, vitest_1.expect)(state.selectedIndex).toBe(2);
    });
    (0, vitest_1.it)("does not go below 0", () => {
        const state = (0, health_view_js_1.createHealthViewState)();
        state.data = makeHealthData();
        state.selectedIndex = 0;
        (0, health_view_js_1.healthScrollUp)(state);
        (0, vitest_1.expect)(state.selectedIndex).toBe(0);
    });
    (0, vitest_1.it)("scrolls within drill-down when drilled", () => {
        const state = (0, health_view_js_1.createHealthViewState)();
        state.drilledSpec = "tui";
        state.sectionCoverage = [
            { anchor: "a", title: "A", tickets: [] },
            { anchor: "b", title: "B", tickets: [] },
        ];
        state.drillSelectedIndex = 1;
        (0, health_view_js_1.healthScrollUp)(state);
        (0, vitest_1.expect)(state.drillSelectedIndex).toBe(0);
    });
});
// --- renderHealthView tests ---
(0, vitest_1.describe)("renderHealthView", () => {
    (0, vitest_1.it)("renders loading state when data is null", () => {
        const buf = new renderer_js_1.ScreenBuffer(80, 30);
        const panel = makePanel();
        const state = (0, health_view_js_1.createHealthViewState)();
        (0, health_view_js_1.renderHealthView)(buf, panel, state);
        buf.flush();
        // Verify no crash — loading state renders
    });
    (0, vitest_1.it)("renders overview with spec coverage section", () => {
        const buf = new renderer_js_1.ScreenBuffer(100, 40);
        const panel = makePanel({ width: 100, height: 39 });
        const state = (0, health_view_js_1.createHealthViewState)();
        state.data = makeHealthData();
        (0, health_view_js_1.renderHealthView)(buf, panel, state);
        buf.flush();
        // Verify no crash — overview renders with data
    });
    (0, vitest_1.it)("renders spec list with correct statuses", () => {
        const buf = new renderer_js_1.ScreenBuffer(100, 40);
        const panel = makePanel({ width: 100, height: 39 });
        const state = (0, health_view_js_1.createHealthViewState)();
        state.data = makeHealthData({
            specs: [
                { name: "detection", sections: 4, ticketCount: 4, status: "covered" },
                { name: "config", sections: 3, ticketCount: 0, status: "uncovered" },
            ],
            specCount: 2,
            specsCovered: 1,
            specsPartial: 0,
            specsUncovered: 1,
        });
        (0, health_view_js_1.renderHealthView)(buf, panel, state);
        buf.flush();
        // Verify no crash with mixed statuses
    });
    (0, vitest_1.it)("renders drill-down when spec is selected", () => {
        const buf = new renderer_js_1.ScreenBuffer(100, 40);
        const panel = makePanel({ width: 100, height: 39 });
        const state = (0, health_view_js_1.createHealthViewState)();
        state.data = makeHealthData();
        state.drilledSpec = "tui";
        state.sectionCoverage = [
            { anchor: "navigation", title: "Navigation", tickets: [{ id: "tui-nav", status: "closed" }] },
            { anchor: "rendering", title: "Rendering", tickets: [] },
        ];
        (0, health_view_js_1.renderHealthView)(buf, panel, state);
        buf.flush();
        // Verify no crash — drill-down renders
    });
    (0, vitest_1.it)("renders broken links section when present", () => {
        const buf = new renderer_js_1.ScreenBuffer(100, 40);
        const panel = makePanel({ width: 100, height: 39 });
        const state = (0, health_view_js_1.createHealthViewState)();
        state.data = makeHealthData({
            brokenLinks: [
                { ticket: "bad-ticket", link: "spec/foo.md#missing", reason: "anchor not found" },
            ],
        });
        (0, health_view_js_1.renderHealthView)(buf, panel, state);
        buf.flush();
        // Verify no crash with broken links
    });
    (0, vitest_1.it)("renders use cases when present", () => {
        const buf = new renderer_js_1.ScreenBuffer(100, 40);
        const panel = makePanel({ width: 100, height: 39 });
        const state = (0, health_view_js_1.createHealthViewState)();
        state.data = makeHealthData({
            useCases: [
                { id: "UC-001", title: "Onboarding", done: 5, total: 10 },
                { id: "UC-002", title: "Orchestration", done: 12, total: 12 },
            ],
        });
        (0, health_view_js_1.renderHealthView)(buf, panel, state);
        buf.flush();
        // Verify no crash with use cases
    });
    (0, vitest_1.it)("handles narrow terminal gracefully", () => {
        const buf = new renderer_js_1.ScreenBuffer(40, 15);
        const panel = makePanel({ width: 40, height: 14 });
        const state = (0, health_view_js_1.createHealthViewState)();
        state.data = makeHealthData();
        (0, health_view_js_1.renderHealthView)(buf, panel, state);
        buf.flush();
        // Verify no crash in narrow terminal
    });
    (0, vitest_1.it)("handles many specs with scrolling", () => {
        const state = (0, health_view_js_1.createHealthViewState)();
        const specs = [];
        for (let i = 0; i < 30; i++) {
            specs.push({ name: `spec-${i}`, sections: i, ticketCount: i, status: i % 3 === 0 ? "covered" : i % 3 === 1 ? "partial" : "uncovered" });
        }
        state.data = makeHealthData({ specs, specCount: 30 });
        // Scroll down several times
        (0, health_view_js_1.healthScrollDown)(state, 20);
        (0, health_view_js_1.healthScrollDown)(state, 20);
        (0, health_view_js_1.healthScrollDown)(state, 20);
        (0, vitest_1.expect)(state.selectedIndex).toBe(3);
        const buf = new renderer_js_1.ScreenBuffer(100, 20);
        const panel = makePanel({ width: 100, height: 19 });
        (0, health_view_js_1.renderHealthView)(buf, panel, state);
        buf.flush();
        // Verify no crash with scroll state
    });
});
// --- Health bar integration tests ---
(0, vitest_1.describe)("health bar formatting edge cases", () => {
    (0, vitest_1.it)("rounds percentages correctly", () => {
        const data = makeHealthData({
            specCount: 3,
            specsCovered: 1,
            specsPartial: 0,
            specsUncovered: 2,
        });
        const bar = (0, health_data_js_1.formatHealthBar)(data);
        // 1/3 = 33%
        (0, vitest_1.expect)(bar).toContain("33% covered");
    });
    (0, vitest_1.it)("shows 100% when fully covered", () => {
        const data = makeHealthData({
            specCount: 5,
            specsCovered: 5,
            specsPartial: 0,
            specsUncovered: 0,
        });
        const bar = (0, health_data_js_1.formatHealthBar)(data);
        (0, vitest_1.expect)(bar).toContain("100% covered");
    });
    (0, vitest_1.it)("includes partial in coverage percentage", () => {
        const data = makeHealthData({
            specCount: 10,
            specsCovered: 3,
            specsPartial: 2,
            specsUncovered: 5,
        });
        const bar = (0, health_data_js_1.formatHealthBar)(data);
        // (3 + 2) / 10 = 50%
        (0, vitest_1.expect)(bar).toContain("50% covered");
    });
});
//# sourceMappingURL=health-view.test.js.map