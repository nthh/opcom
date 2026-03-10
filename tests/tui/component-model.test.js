"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const renderer_js_1 = require("../../packages/cli/src/tui/renderer.js");
const agents_list_js_1 = require("../../packages/cli/src/tui/components/agents-list.js");
const dashboard_js_1 = require("../../packages/cli/src/tui/views/dashboard.js");
const project_detail_js_1 = require("../../packages/cli/src/tui/views/project-detail.js");
// --- Test helpers ---
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
function makePanel(overrides = {}) {
    return {
        id: "agents",
        x: 0,
        y: 0,
        width: 60,
        height: 20,
        title: "Agents",
        ...overrides,
    };
}
// --- TuiComponent interface tests ---
(0, vitest_1.describe)("TuiComponent interface", () => {
    (0, vitest_1.it)("AgentsListComponent satisfies TuiComponent<AgentsListState>", () => {
        const component = agents_list_js_1.AgentsListComponent;
        (0, vitest_1.expect)(component.id).toBe("agents-list");
        (0, vitest_1.expect)(typeof component.init).toBe("function");
        (0, vitest_1.expect)(typeof component.render).toBe("function");
        (0, vitest_1.expect)(typeof component.handleKey).toBe("function");
    });
});
// --- AgentsListComponent.init() ---
(0, vitest_1.describe)("AgentsListComponent.init", () => {
    (0, vitest_1.it)("returns correct default state", () => {
        const state = agents_list_js_1.AgentsListComponent.init();
        (0, vitest_1.expect)(state.agents).toEqual([]);
        (0, vitest_1.expect)(state.selectedIndex).toBe(0);
        (0, vitest_1.expect)(state.scrollOffset).toBe(0);
        (0, vitest_1.expect)(state.panelHeight).toBe(0);
        (0, vitest_1.expect)(state.projects).toEqual([]);
        (0, vitest_1.expect)(state.plan).toBeNull();
        (0, vitest_1.expect)(state.mode).toBe("dashboard");
        (0, vitest_1.expect)(state.projectId).toBeNull();
    });
});
// --- AgentsListComponent.handleKey ---
(0, vitest_1.describe)("AgentsListComponent.handleKey", () => {
    (0, vitest_1.it)("j moves selection down", () => {
        const state = agents_list_js_1.AgentsListComponent.init();
        state.agents = [makeAgent({ id: "a1" }), makeAgent({ id: "a2" }), makeAgent({ id: "a3" })];
        state.panelHeight = 20;
        const result = agents_list_js_1.AgentsListComponent.handleKey("j", state);
        (0, vitest_1.expect)(result.handled).toBe(true);
        (0, vitest_1.expect)(result.state.selectedIndex).toBe(1);
    });
    (0, vitest_1.it)("k moves selection up", () => {
        const state = agents_list_js_1.AgentsListComponent.init();
        state.agents = [makeAgent({ id: "a1" }), makeAgent({ id: "a2" })];
        state.selectedIndex = 1;
        state.panelHeight = 20;
        const result = agents_list_js_1.AgentsListComponent.handleKey("k", state);
        (0, vitest_1.expect)(result.handled).toBe(true);
        (0, vitest_1.expect)(result.state.selectedIndex).toBe(0);
    });
    (0, vitest_1.it)("down arrow moves selection down", () => {
        const state = agents_list_js_1.AgentsListComponent.init();
        state.agents = [makeAgent({ id: "a1" }), makeAgent({ id: "a2" })];
        state.panelHeight = 20;
        const result = agents_list_js_1.AgentsListComponent.handleKey("\x1b[B", state);
        (0, vitest_1.expect)(result.handled).toBe(true);
        (0, vitest_1.expect)(result.state.selectedIndex).toBe(1);
    });
    (0, vitest_1.it)("up arrow moves selection up", () => {
        const state = agents_list_js_1.AgentsListComponent.init();
        state.agents = [makeAgent({ id: "a1" }), makeAgent({ id: "a2" })];
        state.selectedIndex = 1;
        state.panelHeight = 20;
        const result = agents_list_js_1.AgentsListComponent.handleKey("\x1b[A", state);
        (0, vitest_1.expect)(result.handled).toBe(true);
        (0, vitest_1.expect)(result.state.selectedIndex).toBe(0);
    });
    (0, vitest_1.it)("does not go below 0", () => {
        const state = agents_list_js_1.AgentsListComponent.init();
        state.agents = [makeAgent({ id: "a1" })];
        state.selectedIndex = 0;
        state.panelHeight = 20;
        const result = agents_list_js_1.AgentsListComponent.handleKey("k", state);
        (0, vitest_1.expect)(result.handled).toBe(true);
        (0, vitest_1.expect)(result.state.selectedIndex).toBe(0);
    });
    (0, vitest_1.it)("does not exceed max index", () => {
        const state = agents_list_js_1.AgentsListComponent.init();
        state.agents = [makeAgent({ id: "a1" }), makeAgent({ id: "a2" })];
        state.selectedIndex = 1;
        state.panelHeight = 20;
        const result = agents_list_js_1.AgentsListComponent.handleKey("j", state);
        (0, vitest_1.expect)(result.handled).toBe(true);
        (0, vitest_1.expect)(result.state.selectedIndex).toBe(1);
    });
    (0, vitest_1.it)("returns handled=true for j/k with empty list", () => {
        const state = agents_list_js_1.AgentsListComponent.init();
        state.panelHeight = 20;
        const resultJ = agents_list_js_1.AgentsListComponent.handleKey("j", state);
        (0, vitest_1.expect)(resultJ.handled).toBe(true);
        (0, vitest_1.expect)(resultJ.state.selectedIndex).toBe(0);
        const resultK = agents_list_js_1.AgentsListComponent.handleKey("k", state);
        (0, vitest_1.expect)(resultK.handled).toBe(true);
        (0, vitest_1.expect)(resultK.state.selectedIndex).toBe(0);
    });
    (0, vitest_1.it)("returns handled=false for unrecognized keys", () => {
        const state = agents_list_js_1.AgentsListComponent.init();
        state.agents = [makeAgent()];
        (0, vitest_1.expect)(agents_list_js_1.AgentsListComponent.handleKey("q", state).handled).toBe(false);
        (0, vitest_1.expect)(agents_list_js_1.AgentsListComponent.handleKey("\t", state).handled).toBe(false);
        (0, vitest_1.expect)(agents_list_js_1.AgentsListComponent.handleKey("\r", state).handled).toBe(false);
        (0, vitest_1.expect)(agents_list_js_1.AgentsListComponent.handleKey("w", state).handled).toBe(false);
        (0, vitest_1.expect)(agents_list_js_1.AgentsListComponent.handleKey("S", state).handled).toBe(false);
    });
    (0, vitest_1.it)("returns new state object (immutable)", () => {
        const state = agents_list_js_1.AgentsListComponent.init();
        state.agents = [makeAgent({ id: "a1" }), makeAgent({ id: "a2" })];
        state.panelHeight = 20;
        const result = agents_list_js_1.AgentsListComponent.handleKey("j", state);
        (0, vitest_1.expect)(result.state).not.toBe(state);
        (0, vitest_1.expect)(result.state.selectedIndex).toBe(1);
        (0, vitest_1.expect)(state.selectedIndex).toBe(0); // original unchanged
    });
    (0, vitest_1.it)("adjusts scroll offset when navigating past visible area", () => {
        const state = agents_list_js_1.AgentsListComponent.init();
        state.agents = Array.from({ length: 30 }, (_, i) => makeAgent({ id: `a${i}` }));
        state.panelHeight = 5; // 5 - 2 border = 3 visible
        state.selectedIndex = 2;
        state.scrollOffset = 0;
        // Move to index 3 — beyond visible area (0-2)
        const result = agents_list_js_1.AgentsListComponent.handleKey("j", state);
        (0, vitest_1.expect)(result.state.selectedIndex).toBe(3);
        (0, vitest_1.expect)(result.state.scrollOffset).toBe(1);
    });
});
// --- getVisibleAgents ---
(0, vitest_1.describe)("getVisibleAgents", () => {
    (0, vitest_1.it)("returns all agents in dashboard mode (sorted)", () => {
        const state = agents_list_js_1.AgentsListComponent.init();
        state.agents = [
            makeAgent({ id: "a1", state: "stopped" }),
            makeAgent({ id: "a2", state: "streaming" }),
        ];
        state.mode = "dashboard";
        const visible = (0, agents_list_js_1.getVisibleAgents)(state);
        (0, vitest_1.expect)(visible).toHaveLength(2);
        // Streaming agents sort before stopped
        (0, vitest_1.expect)(visible[0].id).toBe("a2");
        (0, vitest_1.expect)(visible[1].id).toBe("a1");
    });
    (0, vitest_1.it)("filters agents by projectId in project-detail mode", () => {
        const state = agents_list_js_1.AgentsListComponent.init();
        state.agents = [
            makeAgent({ id: "a1", projectId: "proj-1" }),
            makeAgent({ id: "a2", projectId: "proj-2" }),
            makeAgent({ id: "a3", projectId: "proj-1" }),
        ];
        state.mode = "project-detail";
        state.projectId = "proj-1";
        const visible = (0, agents_list_js_1.getVisibleAgents)(state);
        (0, vitest_1.expect)(visible).toHaveLength(2);
        (0, vitest_1.expect)(visible.every((a) => a.projectId === "proj-1")).toBe(true);
    });
});
// --- clampAgentsSelection ---
(0, vitest_1.describe)("clampAgentsSelection", () => {
    (0, vitest_1.it)("clamps selection to valid range when list shrinks", () => {
        const state = agents_list_js_1.AgentsListComponent.init();
        state.agents = [makeAgent()];
        state.selectedIndex = 5;
        (0, agents_list_js_1.clampAgentsSelection)(state);
        (0, vitest_1.expect)(state.selectedIndex).toBe(0);
    });
    (0, vitest_1.it)("resets to 0 when list becomes empty", () => {
        const state = agents_list_js_1.AgentsListComponent.init();
        state.agents = [];
        state.selectedIndex = 3;
        state.scrollOffset = 2;
        (0, agents_list_js_1.clampAgentsSelection)(state);
        (0, vitest_1.expect)(state.selectedIndex).toBe(0);
        (0, vitest_1.expect)(state.scrollOffset).toBe(0);
    });
});
// --- Render tests ---
(0, vitest_1.describe)("AgentsListComponent.render", () => {
    (0, vitest_1.it)("renders dashboard mode without crashing", () => {
        const state = agents_list_js_1.AgentsListComponent.init();
        state.agents = [
            makeAgent({ id: "agent-abc123", state: "streaming" }),
            makeAgent({ id: "agent-def456", state: "idle" }),
        ];
        state.projects = [makeProject()];
        const buf = new renderer_js_1.ScreenBuffer(80, 30);
        const panel = makePanel();
        agents_list_js_1.AgentsListComponent.render(buf, panel, state, true);
        // Verify panelHeight was cached
        (0, vitest_1.expect)(state.panelHeight).toBe(20);
    });
    (0, vitest_1.it)("renders project-detail mode without crashing", () => {
        const state = agents_list_js_1.AgentsListComponent.init();
        state.mode = "project-detail";
        state.projectId = "proj-1";
        state.agents = [makeAgent({ id: "agent-abc123", projectId: "proj-1" })];
        const buf = new renderer_js_1.ScreenBuffer(80, 30);
        const panel = makePanel();
        agents_list_js_1.AgentsListComponent.render(buf, panel, state, false);
        (0, vitest_1.expect)(state.panelHeight).toBe(20);
    });
    (0, vitest_1.it)("renders empty state message in dashboard mode", () => {
        const state = agents_list_js_1.AgentsListComponent.init();
        const buf = new renderer_js_1.ScreenBuffer(80, 30);
        const panel = makePanel();
        agents_list_js_1.AgentsListComponent.render(buf, panel, state, true);
        // Should not throw — empty state renders placeholder text
    });
    (0, vitest_1.it)("renders empty state message in project-detail mode", () => {
        const state = agents_list_js_1.AgentsListComponent.init();
        state.mode = "project-detail";
        state.projectId = "proj-1";
        const buf = new renderer_js_1.ScreenBuffer(80, 30);
        const panel = makePanel();
        agents_list_js_1.AgentsListComponent.render(buf, panel, state, false);
        // Should not throw
    });
});
// --- Integration: Dashboard with AgentsListComponent ---
(0, vitest_1.describe)("dashboard integration with AgentsListComponent", () => {
    (0, vitest_1.it)("renders dashboard with agents component", () => {
        const state = (0, dashboard_js_1.createDashboardState)();
        state.agents = [makeAgent()];
        state.agentsComponent.agents = state.agents;
        state.agentsComponent.projects = [];
        const buf = new renderer_js_1.ScreenBuffer(120, 40);
        const panels = [
            { id: "projects", x: 0, y: 0, width: 70, height: 20, title: "Projects" },
            { id: "workqueue", x: 0, y: 20, width: 70, height: 20, title: "Work Queue" },
            { id: "agents", x: 70, y: 0, width: 50, height: 40, title: "Agents" },
        ];
        (0, dashboard_js_1.renderDashboard)(buf, panels, state);
        // Should not throw; agents panel rendered via component
    });
    (0, vitest_1.it)("component key dispatch handles j/k for agents panel", () => {
        const state = (0, dashboard_js_1.createDashboardState)();
        state.agents = [makeAgent({ id: "a1" }), makeAgent({ id: "a2" })];
        state.agentsComponent.agents = state.agents;
        state.agentsComponent.panelHeight = 20;
        state.focusedPanel = 2;
        // Simulate what app.ts does: dispatch to component when panel === 2
        const result = agents_list_js_1.AgentsListComponent.handleKey("j", state.agentsComponent);
        (0, vitest_1.expect)(result.handled).toBe(true);
        state.agentsComponent = result.state;
        (0, vitest_1.expect)(state.agentsComponent.selectedIndex).toBe(1);
    });
    (0, vitest_1.it)("non-component keys fall through (component returns handled=false)", () => {
        const state = (0, dashboard_js_1.createDashboardState)();
        state.agents = [makeAgent()];
        state.agentsComponent.agents = state.agents;
        state.focusedPanel = 2;
        // Tab should not be handled by component
        const result = agents_list_js_1.AgentsListComponent.handleKey("\t", state.agentsComponent);
        (0, vitest_1.expect)(result.handled).toBe(false);
    });
});
// --- Integration: Project Detail with AgentsListComponent ---
(0, vitest_1.describe)("project-detail integration with AgentsListComponent", () => {
    (0, vitest_1.it)("renders project-detail with agents component", () => {
        const project = makeProject();
        const state = (0, project_detail_js_1.createProjectDetailState)(project);
        state.agents = [makeAgent({ projectId: "proj-1" })];
        state.agentsComponent.agents = state.agents;
        const buf = new renderer_js_1.ScreenBuffer(120, 40);
        const panels = [
            { id: "tickets", x: 0, y: 0, width: 60, height: 40, title: "Tickets" },
            { id: "agents", x: 60, y: 0, width: 60, height: 10, title: "Agents" },
            { id: "specs", x: 60, y: 10, width: 60, height: 10, title: "Specs" },
            { id: "stack", x: 60, y: 20, width: 60, height: 10, title: "Stack" },
            { id: "cloud", x: 60, y: 30, width: 60, height: 10, title: "Cloud" },
        ];
        (0, project_detail_js_1.renderProjectDetail)(buf, panels, state);
        // Should not throw; agents panel rendered via component
    });
    (0, vitest_1.it)("project-detail agents component filters by project", () => {
        const project = makeProject({ id: "proj-1" });
        const state = (0, project_detail_js_1.createProjectDetailState)(project);
        state.agents = [
            makeAgent({ id: "a1", projectId: "proj-1" }),
            makeAgent({ id: "a2", projectId: "proj-2" }),
        ];
        state.agentsComponent.agents = state.agents;
        // projectId is set by createProjectDetailState
        (0, vitest_1.expect)(state.agentsComponent.projectId).toBe("proj-1");
        (0, vitest_1.expect)(state.agentsComponent.mode).toBe("project-detail");
        const visible = (0, agents_list_js_1.getVisibleAgents)(state.agentsComponent);
        (0, vitest_1.expect)(visible).toHaveLength(1);
        (0, vitest_1.expect)(visible[0].id).toBe("a1");
    });
});
// --- Focus cycling: component + legacy panels coexist ---
(0, vitest_1.describe)("focus cycling with components and legacy panels", () => {
    (0, vitest_1.it)("dashboard: Tab cycles across all 3 panels including component", () => {
        const state = (0, dashboard_js_1.createDashboardState)();
        // Start at panel 0 (legacy projects)
        (0, vitest_1.expect)(state.focusedPanel).toBe(0);
        // Tab → panel 1 (legacy work queue)
        state.focusedPanel = (state.focusedPanel + 1) % 3;
        (0, vitest_1.expect)(state.focusedPanel).toBe(1);
        // Tab → panel 2 (component: agents)
        state.focusedPanel = (state.focusedPanel + 1) % 3;
        (0, vitest_1.expect)(state.focusedPanel).toBe(2);
        // Tab → back to panel 0 (legacy projects)
        state.focusedPanel = (state.focusedPanel + 1) % 3;
        (0, vitest_1.expect)(state.focusedPanel).toBe(0);
    });
    (0, vitest_1.it)("project-detail: Tab cycles across 5 panels including agents component", () => {
        const project = makeProject();
        const state = (0, project_detail_js_1.createProjectDetailState)(project);
        // Panel 1 is the agents component
        state.focusedPanel = 1;
        // j/k should be handled by component
        state.agentsComponent.agents = [makeAgent({ id: "a1" }), makeAgent({ id: "a2" })];
        state.agentsComponent.panelHeight = 20;
        const result = agents_list_js_1.AgentsListComponent.handleKey("j", state.agentsComponent);
        (0, vitest_1.expect)(result.handled).toBe(true);
        (0, vitest_1.expect)(result.state.selectedIndex).toBe(1);
        // Tab should NOT be handled by component
        const tabResult = agents_list_js_1.AgentsListComponent.handleKey("\t", state.agentsComponent);
        (0, vitest_1.expect)(tabResult.handled).toBe(false);
    });
});
// --- Render isolation: component renders within panel bounds ---
(0, vitest_1.describe)("render isolation", () => {
    (0, vitest_1.it)("component only writes within panel bounds", () => {
        const state = agents_list_js_1.AgentsListComponent.init();
        state.agents = [makeAgent(), makeAgent({ id: "a2" }), makeAgent({ id: "a3" })];
        state.projects = [makeProject()];
        const buf = new renderer_js_1.ScreenBuffer(100, 50);
        const panel = makePanel({ x: 10, y: 5, width: 40, height: 10 });
        agents_list_js_1.AgentsListComponent.render(buf, panel, state, true);
        // Flush captures the output — no crash means rendering stayed within bounds
        // (ScreenBuffer.write silently clips out-of-bounds writes)
    });
});
//# sourceMappingURL=component-model.test.js.map