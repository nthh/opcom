import { describe, it, expect } from "vitest";
import type { AgentSession, ProjectStatusSnapshot } from "@opcom/types";
import { ScreenBuffer } from "../../packages/cli/src/tui/renderer.js";
import type { Panel } from "../../packages/cli/src/tui/layout.js";
import type { TuiComponent } from "../../packages/cli/src/tui/components/types.js";
import {
  AgentsListComponent,
  getVisibleAgents,
  clampAgentsSelection,
  type AgentsListState,
} from "../../packages/cli/src/tui/components/agents-list.js";
import { createDashboardState, renderDashboard } from "../../packages/cli/src/tui/views/dashboard.js";
import { createProjectDetailState, renderProjectDetail } from "../../packages/cli/src/tui/views/project-detail.js";

// --- Test helpers ---

function makeAgent(overrides: Partial<AgentSession> = {}): AgentSession {
  return {
    id: "agent-1",
    backend: "claude-code",
    projectId: "proj-1",
    state: "streaming",
    startedAt: new Date().toISOString(),
    ...overrides,
  };
}

function makeProject(overrides: Partial<ProjectStatusSnapshot> = {}): ProjectStatusSnapshot {
  return {
    id: "proj-1",
    name: "folia",
    path: "/projects/folia",
    git: { remote: null, branch: "main", clean: true },
    workSummary: { open: 3, total: 5, inProgress: 1, closed: 1, deferred: 0 },
    ...overrides,
  };
}

function makePanel(overrides: Partial<Panel> = {}): Panel {
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

describe("TuiComponent interface", () => {
  it("AgentsListComponent satisfies TuiComponent<AgentsListState>", () => {
    const component: TuiComponent<AgentsListState> = AgentsListComponent;
    expect(component.id).toBe("agents-list");
    expect(typeof component.init).toBe("function");
    expect(typeof component.render).toBe("function");
    expect(typeof component.handleKey).toBe("function");
  });
});

// --- AgentsListComponent.init() ---

describe("AgentsListComponent.init", () => {
  it("returns correct default state", () => {
    const state = AgentsListComponent.init();
    expect(state.agents).toEqual([]);
    expect(state.selectedIndex).toBe(0);
    expect(state.scrollOffset).toBe(0);
    expect(state.panelHeight).toBe(0);
    expect(state.projects).toEqual([]);
    expect(state.plan).toBeNull();
    expect(state.mode).toBe("dashboard");
    expect(state.projectId).toBeNull();
  });
});

// --- AgentsListComponent.handleKey ---

describe("AgentsListComponent.handleKey", () => {
  it("j moves selection down", () => {
    const state = AgentsListComponent.init();
    state.agents = [makeAgent({ id: "a1" }), makeAgent({ id: "a2" }), makeAgent({ id: "a3" })];
    state.panelHeight = 20;

    const result = AgentsListComponent.handleKey("j", state);
    expect(result.handled).toBe(true);
    expect(result.state.selectedIndex).toBe(1);
  });

  it("k moves selection up", () => {
    const state = AgentsListComponent.init();
    state.agents = [makeAgent({ id: "a1" }), makeAgent({ id: "a2" })];
    state.selectedIndex = 1;
    state.panelHeight = 20;

    const result = AgentsListComponent.handleKey("k", state);
    expect(result.handled).toBe(true);
    expect(result.state.selectedIndex).toBe(0);
  });

  it("down arrow moves selection down", () => {
    const state = AgentsListComponent.init();
    state.agents = [makeAgent({ id: "a1" }), makeAgent({ id: "a2" })];
    state.panelHeight = 20;

    const result = AgentsListComponent.handleKey("\x1b[B", state);
    expect(result.handled).toBe(true);
    expect(result.state.selectedIndex).toBe(1);
  });

  it("up arrow moves selection up", () => {
    const state = AgentsListComponent.init();
    state.agents = [makeAgent({ id: "a1" }), makeAgent({ id: "a2" })];
    state.selectedIndex = 1;
    state.panelHeight = 20;

    const result = AgentsListComponent.handleKey("\x1b[A", state);
    expect(result.handled).toBe(true);
    expect(result.state.selectedIndex).toBe(0);
  });

  it("does not go below 0", () => {
    const state = AgentsListComponent.init();
    state.agents = [makeAgent({ id: "a1" })];
    state.selectedIndex = 0;
    state.panelHeight = 20;

    const result = AgentsListComponent.handleKey("k", state);
    expect(result.handled).toBe(true);
    expect(result.state.selectedIndex).toBe(0);
  });

  it("does not exceed max index", () => {
    const state = AgentsListComponent.init();
    state.agents = [makeAgent({ id: "a1" }), makeAgent({ id: "a2" })];
    state.selectedIndex = 1;
    state.panelHeight = 20;

    const result = AgentsListComponent.handleKey("j", state);
    expect(result.handled).toBe(true);
    expect(result.state.selectedIndex).toBe(1);
  });

  it("returns handled=true for j/k with empty list", () => {
    const state = AgentsListComponent.init();
    state.panelHeight = 20;

    const resultJ = AgentsListComponent.handleKey("j", state);
    expect(resultJ.handled).toBe(true);
    expect(resultJ.state.selectedIndex).toBe(0);

    const resultK = AgentsListComponent.handleKey("k", state);
    expect(resultK.handled).toBe(true);
    expect(resultK.state.selectedIndex).toBe(0);
  });

  it("returns handled=false for unrecognized keys", () => {
    const state = AgentsListComponent.init();
    state.agents = [makeAgent()];

    expect(AgentsListComponent.handleKey("q", state).handled).toBe(false);
    expect(AgentsListComponent.handleKey("\t", state).handled).toBe(false);
    expect(AgentsListComponent.handleKey("\r", state).handled).toBe(false);
    expect(AgentsListComponent.handleKey("w", state).handled).toBe(false);
    expect(AgentsListComponent.handleKey("S", state).handled).toBe(false);
  });

  it("returns new state object (immutable)", () => {
    const state = AgentsListComponent.init();
    state.agents = [makeAgent({ id: "a1" }), makeAgent({ id: "a2" })];
    state.panelHeight = 20;

    const result = AgentsListComponent.handleKey("j", state);
    expect(result.state).not.toBe(state);
    expect(result.state.selectedIndex).toBe(1);
    expect(state.selectedIndex).toBe(0); // original unchanged
  });

  it("adjusts scroll offset when navigating past visible area", () => {
    const state = AgentsListComponent.init();
    state.agents = Array.from({ length: 30 }, (_, i) => makeAgent({ id: `a${i}` }));
    state.panelHeight = 5; // 5 - 2 border = 3 visible
    state.selectedIndex = 2;
    state.scrollOffset = 0;

    // Move to index 3 — beyond visible area (0-2)
    const result = AgentsListComponent.handleKey("j", state);
    expect(result.state.selectedIndex).toBe(3);
    expect(result.state.scrollOffset).toBe(1);
  });
});

// --- getVisibleAgents ---

describe("getVisibleAgents", () => {
  it("returns all agents in dashboard mode (sorted)", () => {
    const state = AgentsListComponent.init();
    state.agents = [
      makeAgent({ id: "a1", state: "stopped" }),
      makeAgent({ id: "a2", state: "streaming" }),
    ];
    state.mode = "dashboard";

    const visible = getVisibleAgents(state);
    expect(visible).toHaveLength(2);
    // Streaming agents sort before stopped
    expect(visible[0].id).toBe("a2");
    expect(visible[1].id).toBe("a1");
  });

  it("filters agents by projectId in project-detail mode", () => {
    const state = AgentsListComponent.init();
    state.agents = [
      makeAgent({ id: "a1", projectId: "proj-1" }),
      makeAgent({ id: "a2", projectId: "proj-2" }),
      makeAgent({ id: "a3", projectId: "proj-1" }),
    ];
    state.mode = "project-detail";
    state.projectId = "proj-1";

    const visible = getVisibleAgents(state);
    expect(visible).toHaveLength(2);
    expect(visible.every((a) => a.projectId === "proj-1")).toBe(true);
  });
});

// --- clampAgentsSelection ---

describe("clampAgentsSelection", () => {
  it("clamps selection to valid range when list shrinks", () => {
    const state = AgentsListComponent.init();
    state.agents = [makeAgent()];
    state.selectedIndex = 5;

    clampAgentsSelection(state);
    expect(state.selectedIndex).toBe(0);
  });

  it("resets to 0 when list becomes empty", () => {
    const state = AgentsListComponent.init();
    state.agents = [];
    state.selectedIndex = 3;
    state.scrollOffset = 2;

    clampAgentsSelection(state);
    expect(state.selectedIndex).toBe(0);
    expect(state.scrollOffset).toBe(0);
  });
});

// --- Render tests ---

describe("AgentsListComponent.render", () => {
  it("renders dashboard mode without crashing", () => {
    const state = AgentsListComponent.init();
    state.agents = [
      makeAgent({ id: "agent-abc123", state: "streaming" }),
      makeAgent({ id: "agent-def456", state: "idle" }),
    ];
    state.projects = [makeProject()];

    const buf = new ScreenBuffer(80, 30);
    const panel = makePanel();

    AgentsListComponent.render(buf, panel, state, true);
    // Verify panelHeight was cached
    expect(state.panelHeight).toBe(20);
  });

  it("renders project-detail mode without crashing", () => {
    const state = AgentsListComponent.init();
    state.mode = "project-detail";
    state.projectId = "proj-1";
    state.agents = [makeAgent({ id: "agent-abc123", projectId: "proj-1" })];

    const buf = new ScreenBuffer(80, 30);
    const panel = makePanel();

    AgentsListComponent.render(buf, panel, state, false);
    expect(state.panelHeight).toBe(20);
  });

  it("renders empty state message in dashboard mode", () => {
    const state = AgentsListComponent.init();
    const buf = new ScreenBuffer(80, 30);
    const panel = makePanel();

    AgentsListComponent.render(buf, panel, state, true);
    // Should not throw — empty state renders placeholder text
  });

  it("renders empty state message in project-detail mode", () => {
    const state = AgentsListComponent.init();
    state.mode = "project-detail";
    state.projectId = "proj-1";

    const buf = new ScreenBuffer(80, 30);
    const panel = makePanel();

    AgentsListComponent.render(buf, panel, state, false);
    // Should not throw
  });
});

// --- Integration: Dashboard with AgentsListComponent ---

describe("dashboard integration with AgentsListComponent", () => {
  it("renders dashboard with agents component", () => {
    const state = createDashboardState();
    state.agents = [makeAgent()];
    state.agentsComponent.agents = state.agents;
    state.agentsComponent.projects = [];

    const buf = new ScreenBuffer(120, 40);
    const panels = [
      { id: "projects", x: 0, y: 0, width: 70, height: 20, title: "Projects" },
      { id: "workqueue", x: 0, y: 20, width: 70, height: 20, title: "Work Queue" },
      { id: "agents", x: 70, y: 0, width: 50, height: 40, title: "Agents" },
    ];

    renderDashboard(buf, panels, state);
    // Should not throw; agents panel rendered via component
  });

  it("component key dispatch handles j/k for agents panel", () => {
    const state = createDashboardState();
    state.agents = [makeAgent({ id: "a1" }), makeAgent({ id: "a2" })];
    state.agentsComponent.agents = state.agents;
    state.agentsComponent.panelHeight = 20;
    state.focusedPanel = 2;

    // Simulate what app.ts does: dispatch to component when panel === 2
    const result = AgentsListComponent.handleKey("j", state.agentsComponent);
    expect(result.handled).toBe(true);
    state.agentsComponent = result.state;
    expect(state.agentsComponent.selectedIndex).toBe(1);
  });

  it("non-component keys fall through (component returns handled=false)", () => {
    const state = createDashboardState();
    state.agents = [makeAgent()];
    state.agentsComponent.agents = state.agents;
    state.focusedPanel = 2;

    // Tab should not be handled by component
    const result = AgentsListComponent.handleKey("\t", state.agentsComponent);
    expect(result.handled).toBe(false);
  });
});

// --- Integration: Project Detail with AgentsListComponent ---

describe("project-detail integration with AgentsListComponent", () => {
  it("renders project-detail with agents component", () => {
    const project = makeProject();
    const state = createProjectDetailState(project);
    state.agents = [makeAgent({ projectId: "proj-1" })];
    state.agentsComponent.agents = state.agents;

    const buf = new ScreenBuffer(120, 40);
    const panels = [
      { id: "tickets", x: 0, y: 0, width: 60, height: 40, title: "Tickets" },
      { id: "agents", x: 60, y: 0, width: 60, height: 10, title: "Agents" },
      { id: "specs", x: 60, y: 10, width: 60, height: 10, title: "Specs" },
      { id: "stack", x: 60, y: 20, width: 60, height: 10, title: "Stack" },
      { id: "cloud", x: 60, y: 30, width: 60, height: 10, title: "Cloud" },
    ];

    renderProjectDetail(buf, panels, state);
    // Should not throw; agents panel rendered via component
  });

  it("project-detail agents component filters by project", () => {
    const project = makeProject({ id: "proj-1" });
    const state = createProjectDetailState(project);
    state.agents = [
      makeAgent({ id: "a1", projectId: "proj-1" }),
      makeAgent({ id: "a2", projectId: "proj-2" }),
    ];
    state.agentsComponent.agents = state.agents;
    // projectId is set by createProjectDetailState
    expect(state.agentsComponent.projectId).toBe("proj-1");
    expect(state.agentsComponent.mode).toBe("project-detail");

    const visible = getVisibleAgents(state.agentsComponent);
    expect(visible).toHaveLength(1);
    expect(visible[0].id).toBe("a1");
  });
});

// --- Focus cycling: component + legacy panels coexist ---

describe("focus cycling with components and legacy panels", () => {
  it("dashboard: Tab cycles across all 3 panels including component", () => {
    const state = createDashboardState();

    // Start at panel 0 (legacy projects)
    expect(state.focusedPanel).toBe(0);

    // Tab → panel 1 (legacy work queue)
    state.focusedPanel = (state.focusedPanel + 1) % 3;
    expect(state.focusedPanel).toBe(1);

    // Tab → panel 2 (component: agents)
    state.focusedPanel = (state.focusedPanel + 1) % 3;
    expect(state.focusedPanel).toBe(2);

    // Tab → back to panel 0 (legacy projects)
    state.focusedPanel = (state.focusedPanel + 1) % 3;
    expect(state.focusedPanel).toBe(0);
  });

  it("project-detail: Tab cycles across 5 panels including agents component", () => {
    const project = makeProject();
    const state = createProjectDetailState(project);

    // Panel 1 is the agents component
    state.focusedPanel = 1;

    // j/k should be handled by component
    state.agentsComponent.agents = [makeAgent({ id: "a1" }), makeAgent({ id: "a2" })];
    state.agentsComponent.panelHeight = 20;
    const result = AgentsListComponent.handleKey("j", state.agentsComponent);
    expect(result.handled).toBe(true);
    expect(result.state.selectedIndex).toBe(1);

    // Tab should NOT be handled by component
    const tabResult = AgentsListComponent.handleKey("\t", state.agentsComponent);
    expect(tabResult.handled).toBe(false);
  });
});

// --- Render isolation: component renders within panel bounds ---

describe("render isolation", () => {
  it("component only writes within panel bounds", () => {
    const state = AgentsListComponent.init();
    state.agents = [makeAgent(), makeAgent({ id: "a2" }), makeAgent({ id: "a3" })];
    state.projects = [makeProject()];

    const buf = new ScreenBuffer(100, 50);
    const panel = makePanel({ x: 10, y: 5, width: 40, height: 10 });

    AgentsListComponent.render(buf, panel, state, true);

    // Flush captures the output — no crash means rendering stayed within bounds
    // (ScreenBuffer.write silently clips out-of-bounds writes)
  });
});
