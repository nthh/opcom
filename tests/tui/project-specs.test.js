"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const renderer_js_1 = require("../../packages/cli/src/tui/renderer.js");
const project_detail_js_1 = require("../../packages/cli/src/tui/views/project-detail.js");
const health_data_js_1 = require("../../packages/cli/src/tui/health-data.js");
const layout_js_1 = require("../../packages/cli/src/tui/layout.js");
function makeProject() {
    return {
        id: "proj-1",
        name: "opcom",
        path: "/projects/opcom",
        git: { remote: null, branch: "main", clean: true },
        workSummary: { open: 10, total: 15, inProgress: 2, closed: 3, deferred: 0 },
    };
}
function makeTicket(overrides) {
    return {
        id: overrides.id ?? "ticket-1",
        title: overrides.title ?? "Test ticket",
        status: overrides.status ?? "open",
        priority: overrides.priority ?? 1,
        type: overrides.type ?? "feature",
        filePath: overrides.filePath ?? "/tickets/ticket-1",
        deps: overrides.deps ?? [],
        links: overrides.links ?? [],
        tags: overrides.tags ?? {},
    };
}
function makeAllSpecs() {
    return [
        { name: "detection", sections: 4, ticketCount: 4, status: "covered" },
        { name: "config", sections: 3, ticketCount: 0, status: "uncovered" },
        { name: "adapters", sections: 6, ticketCount: 6, status: "covered" },
        { name: "orchestrator", sections: 8, ticketCount: 5, status: "partial" },
        { name: "tui", sections: 9, ticketCount: 9, status: "covered" },
        { name: "cicd", sections: 2, ticketCount: 2, status: "covered" },
        { name: "context-graph", sections: 7, ticketCount: 7, status: "covered" },
    ];
}
// --- computeProjectSpecs tests ---
(0, vitest_1.describe)("computeProjectSpecs", () => {
    (0, vitest_1.it)("returns specs referenced by project tickets", () => {
        const tickets = [
            makeTicket({ id: "t1", links: ["docs/spec/tui.md#navigation"] }),
            makeTicket({ id: "t2", links: ["docs/spec/tui.md#rendering"] }),
            makeTicket({ id: "t3", links: ["docs/spec/orchestrator.md#plan-stages"] }),
        ];
        const allSpecs = makeAllSpecs();
        const result = (0, health_data_js_1.computeProjectSpecs)(tickets, allSpecs);
        (0, vitest_1.expect)(result).toHaveLength(2);
        const names = result.map((s) => s.name);
        (0, vitest_1.expect)(names).toContain("tui");
        (0, vitest_1.expect)(names).toContain("orchestrator");
    });
    (0, vitest_1.it)("returns empty when no tickets have spec links", () => {
        const tickets = [
            makeTicket({ id: "t1", links: [] }),
            makeTicket({ id: "t2", links: ["some/other/link"] }),
        ];
        const allSpecs = makeAllSpecs();
        const result = (0, health_data_js_1.computeProjectSpecs)(tickets, allSpecs);
        (0, vitest_1.expect)(result).toHaveLength(0);
    });
    (0, vitest_1.it)("returns empty when tickets list is empty", () => {
        const result = (0, health_data_js_1.computeProjectSpecs)([], makeAllSpecs());
        (0, vitest_1.expect)(result).toHaveLength(0);
    });
    (0, vitest_1.it)("returns empty when allSpecs is empty", () => {
        const tickets = [
            makeTicket({ id: "t1", links: ["docs/spec/tui.md#nav"] }),
        ];
        const result = (0, health_data_js_1.computeProjectSpecs)(tickets, []);
        (0, vitest_1.expect)(result).toHaveLength(0);
    });
    (0, vitest_1.it)("counts tickets per spec correctly", () => {
        const tickets = [
            makeTicket({ id: "t1", links: ["docs/spec/tui.md#a"] }),
            makeTicket({ id: "t2", links: ["docs/spec/tui.md#b"] }),
            makeTicket({ id: "t3", links: ["docs/spec/tui.md#c"] }),
            makeTicket({ id: "t4", links: ["docs/spec/orchestrator.md#x"] }),
        ];
        const allSpecs = makeAllSpecs();
        const result = (0, health_data_js_1.computeProjectSpecs)(tickets, allSpecs);
        const tuiSpec = result.find((s) => s.name === "tui");
        const orchSpec = result.find((s) => s.name === "orchestrator");
        (0, vitest_1.expect)(tuiSpec?.ticketCount).toBe(3);
        (0, vitest_1.expect)(orchSpec?.ticketCount).toBe(1);
    });
    (0, vitest_1.it)("sorts by ticket count descending", () => {
        const tickets = [
            makeTicket({ id: "t1", links: ["docs/spec/orchestrator.md#a"] }),
            makeTicket({ id: "t2", links: ["docs/spec/tui.md#a"] }),
            makeTicket({ id: "t3", links: ["docs/spec/tui.md#b"] }),
            makeTicket({ id: "t4", links: ["docs/spec/tui.md#c"] }),
        ];
        const allSpecs = makeAllSpecs();
        const result = (0, health_data_js_1.computeProjectSpecs)(tickets, allSpecs);
        (0, vitest_1.expect)(result[0].name).toBe("tui");
        (0, vitest_1.expect)(result[1].name).toBe("orchestrator");
    });
    (0, vitest_1.it)("marks spec as covered when ticket count >= section count", () => {
        const tickets = [
            makeTicket({ id: "t1", links: ["docs/spec/cicd.md#a"] }),
            makeTicket({ id: "t2", links: ["docs/spec/cicd.md#b"] }),
            makeTicket({ id: "t3", links: ["docs/spec/cicd.md#c"] }),
        ];
        const allSpecs = makeAllSpecs();
        const result = (0, health_data_js_1.computeProjectSpecs)(tickets, allSpecs);
        const cicd = result.find((s) => s.name === "cicd");
        (0, vitest_1.expect)(cicd?.status).toBe("covered");
    });
    (0, vitest_1.it)("marks spec as partial when ticket count < section count", () => {
        const tickets = [
            makeTicket({ id: "t1", links: ["docs/spec/orchestrator.md#one"] }),
        ];
        const allSpecs = makeAllSpecs();
        const result = (0, health_data_js_1.computeProjectSpecs)(tickets, allSpecs);
        const orch = result.find((s) => s.name === "orchestrator");
        (0, vitest_1.expect)(orch?.status).toBe("partial");
    });
    (0, vitest_1.it)("handles ticket linking to multiple specs", () => {
        const tickets = [
            makeTicket({ id: "t1", links: ["docs/spec/tui.md#a", "docs/spec/config.md#b"] }),
        ];
        const allSpecs = makeAllSpecs();
        const result = (0, health_data_js_1.computeProjectSpecs)(tickets, allSpecs);
        (0, vitest_1.expect)(result).toHaveLength(2);
        const names = result.map((s) => s.name);
        (0, vitest_1.expect)(names).toContain("tui");
        (0, vitest_1.expect)(names).toContain("config");
    });
    (0, vitest_1.it)("handles spec/ prefix without docs/ prefix", () => {
        const tickets = [
            makeTicket({ id: "t1", links: ["spec/detection.md#evidence"] }),
        ];
        const allSpecs = makeAllSpecs();
        const result = (0, health_data_js_1.computeProjectSpecs)(tickets, allSpecs);
        (0, vitest_1.expect)(result).toHaveLength(1);
        (0, vitest_1.expect)(result[0].name).toBe("detection");
    });
});
// --- ProjectDetailState specs integration ---
(0, vitest_1.describe)("ProjectDetailState with specs", () => {
    (0, vitest_1.it)("initializes projectSpecs as empty", () => {
        const state = (0, project_detail_js_1.createProjectDetailState)(makeProject());
        (0, vitest_1.expect)(state.projectSpecs).toEqual([]);
    });
    (0, vitest_1.it)("has 8 panel slots in selectedIndex and scrollOffset", () => {
        const state = (0, project_detail_js_1.createProjectDetailState)(makeProject());
        (0, vitest_1.expect)(state.selectedIndex).toHaveLength(8);
        (0, vitest_1.expect)(state.scrollOffset).toHaveLength(8);
    });
});
// --- PANEL_COUNT ---
(0, vitest_1.describe)("PANEL_COUNT", () => {
    (0, vitest_1.it)("is 8 (tickets, agents, specs, stack, cloud, cicd, infra, chat)", () => {
        (0, vitest_1.expect)(project_detail_js_1.PANEL_COUNT).toBe(8);
    });
});
// --- getPanelItemCount for specs ---
(0, vitest_1.describe)("getPanelItemCount for specs panel", () => {
    (0, vitest_1.it)("returns specs count for panel 2", () => {
        const state = (0, project_detail_js_1.createProjectDetailState)(makeProject());
        state.projectSpecs = [
            { name: "tui", sections: 9, ticketCount: 5, status: "covered" },
            { name: "orchestrator", sections: 8, ticketCount: 3, status: "partial" },
        ];
        (0, vitest_1.expect)((0, project_detail_js_1.getPanelItemCount)(state, 2)).toBe(2);
    });
    (0, vitest_1.it)("returns 0 for specs panel when no specs", () => {
        const state = (0, project_detail_js_1.createProjectDetailState)(makeProject());
        (0, vitest_1.expect)((0, project_detail_js_1.getPanelItemCount)(state, 2)).toBe(0);
    });
    (0, vitest_1.it)("returns 0 for stack panel (index 3, not navigable)", () => {
        const state = (0, project_detail_js_1.createProjectDetailState)(makeProject());
        (0, vitest_1.expect)((0, project_detail_js_1.getPanelItemCount)(state, 3)).toBe(0);
    });
    (0, vitest_1.it)("returns cloud services count for panel 4", () => {
        const state = (0, project_detail_js_1.createProjectDetailState)(makeProject());
        state.cloudServices = [
            {
                id: "turso:db",
                projectId: "proj-1",
                provider: "turso",
                kind: "database",
                name: "db",
                status: "healthy",
                detail: { kind: "database", engine: "sqlite" },
                capabilities: [],
                lastCheckedAt: new Date().toISOString(),
            },
        ];
        (0, vitest_1.expect)((0, project_detail_js_1.getPanelItemCount)(state, 4)).toBe(1);
    });
});
// --- clampSelection for specs panel ---
(0, vitest_1.describe)("clampSelection for specs panel", () => {
    (0, vitest_1.it)("clamps specs panel selection to valid range", () => {
        const state = (0, project_detail_js_1.createProjectDetailState)(makeProject());
        state.projectSpecs = [
            { name: "tui", sections: 9, ticketCount: 5, status: "covered" },
        ];
        state.selectedIndex[2] = 5; // Out of range
        (0, project_detail_js_1.clampSelection)(state);
        (0, vitest_1.expect)(state.selectedIndex[2]).toBe(0);
    });
    (0, vitest_1.it)("resets to 0 when no specs", () => {
        const state = (0, project_detail_js_1.createProjectDetailState)(makeProject());
        state.selectedIndex[2] = 2;
        (0, project_detail_js_1.clampSelection)(state);
        (0, vitest_1.expect)(state.selectedIndex[2]).toBe(0);
        (0, vitest_1.expect)(state.scrollOffset[2]).toBe(0);
    });
});
// --- getSpecsList ---
(0, vitest_1.describe)("getSpecsList", () => {
    (0, vitest_1.it)("returns the projectSpecs array", () => {
        const state = (0, project_detail_js_1.createProjectDetailState)(makeProject());
        const specs = [
            { name: "tui", sections: 9, ticketCount: 5, status: "covered" },
            { name: "config", sections: 3, ticketCount: 1, status: "partial" },
        ];
        state.projectSpecs = specs;
        const result = (0, project_detail_js_1.getSpecsList)(state);
        (0, vitest_1.expect)(result).toBe(specs);
        (0, vitest_1.expect)(result).toHaveLength(2);
    });
    (0, vitest_1.it)("returns empty array when no specs set", () => {
        const state = (0, project_detail_js_1.createProjectDetailState)(makeProject());
        (0, vitest_1.expect)((0, project_detail_js_1.getSpecsList)(state)).toEqual([]);
    });
});
// --- Layout includes specs panel ---
(0, vitest_1.describe)("L2 layout includes specs panel", () => {
    (0, vitest_1.it)("includes a specs panel in level 2 layout", () => {
        const layout = (0, layout_js_1.getLayout)(2, 120, 40);
        const specsPanel = layout.panels.find((p) => p.id === "specs");
        (0, vitest_1.expect)(specsPanel).toBeDefined();
    });
    (0, vitest_1.it)("has 8 panels in level 2 layout", () => {
        const layout = (0, layout_js_1.getLayout)(2, 120, 40);
        (0, vitest_1.expect)(layout.panels).toHaveLength(8);
        (0, vitest_1.expect)(layout.panels.map((p) => p.id)).toEqual([
            "tickets", "agents", "specs", "stack", "cloud", "cicd", "infra", "chat",
        ]);
    });
    (0, vitest_1.it)("specs panel is between agents and stack", () => {
        const layout = (0, layout_js_1.getLayout)(2, 120, 40);
        const agents = layout.panels.find((p) => p.id === "agents");
        const specs = layout.panels.find((p) => p.id === "specs");
        const stack = layout.panels.find((p) => p.id === "stack");
        // specs starts where agents ends
        (0, vitest_1.expect)(specs.y).toBe(agents.y + agents.height);
        // stack starts where specs ends
        (0, vitest_1.expect)(stack.y).toBe(specs.y + specs.height);
    });
});
// --- renderProjectDetail with specs ---
(0, vitest_1.describe)("renderProjectDetail with specs", () => {
    (0, vitest_1.it)("renders without crash when specs are empty", () => {
        const buf = new renderer_js_1.ScreenBuffer(120, 40);
        const layout = (0, layout_js_1.getLayout)(2, 120, 40);
        const state = (0, project_detail_js_1.createProjectDetailState)(makeProject());
        (0, project_detail_js_1.renderProjectDetail)(buf, layout.panels, state);
        buf.flush();
        // No crash
    });
    (0, vitest_1.it)("renders without crash when specs are populated", () => {
        const buf = new renderer_js_1.ScreenBuffer(120, 40);
        const layout = (0, layout_js_1.getLayout)(2, 120, 40);
        const state = (0, project_detail_js_1.createProjectDetailState)(makeProject());
        state.projectSpecs = [
            { name: "orchestrator", sections: 8, ticketCount: 8, status: "covered" },
            { name: "tui", sections: 9, ticketCount: 5, status: "partial" },
            { name: "config", sections: 3, ticketCount: 0, status: "uncovered" },
        ];
        (0, project_detail_js_1.renderProjectDetail)(buf, layout.panels, state);
        buf.flush();
        // No crash
    });
    (0, vitest_1.it)("renders with specs panel focused", () => {
        const buf = new renderer_js_1.ScreenBuffer(120, 40);
        const layout = (0, layout_js_1.getLayout)(2, 120, 40);
        const state = (0, project_detail_js_1.createProjectDetailState)(makeProject());
        state.projectSpecs = [
            { name: "tui", sections: 9, ticketCount: 5, status: "covered" },
        ];
        state.focusedPanel = 2; // specs panel
        (0, project_detail_js_1.renderProjectDetail)(buf, layout.panels, state);
        buf.flush();
        // No crash
    });
    (0, vitest_1.it)("renders with selected spec in specs panel", () => {
        const buf = new renderer_js_1.ScreenBuffer(120, 40);
        const layout = (0, layout_js_1.getLayout)(2, 120, 40);
        const state = (0, project_detail_js_1.createProjectDetailState)(makeProject());
        state.projectSpecs = [
            { name: "tui", sections: 9, ticketCount: 5, status: "covered" },
            { name: "orchestrator", sections: 8, ticketCount: 3, status: "partial" },
        ];
        state.focusedPanel = 2;
        state.selectedIndex[2] = 1;
        (0, project_detail_js_1.renderProjectDetail)(buf, layout.panels, state);
        buf.flush();
        // No crash
    });
    (0, vitest_1.it)("handles narrow terminal gracefully", () => {
        const buf = new renderer_js_1.ScreenBuffer(60, 20);
        const layout = (0, layout_js_1.getLayout)(2, 60, 20);
        const state = (0, project_detail_js_1.createProjectDetailState)(makeProject());
        state.projectSpecs = [
            { name: "tui", sections: 9, ticketCount: 5, status: "covered" },
        ];
        (0, project_detail_js_1.renderProjectDetail)(buf, layout.panels, state);
        buf.flush();
        // No crash
    });
});
//# sourceMappingURL=project-specs.test.js.map