import { describe, it, expect } from "vitest";
import { ScreenBuffer } from "../../packages/cli/src/tui/renderer.js";
import {
  createProjectDetailState,
  renderProjectDetail,
  getSpecsList,
  getPanelItemCount,
  clampSelection,
  PANEL_COUNT,
} from "../../packages/cli/src/tui/views/project-detail.js";
import {
  computeProjectSpecs,
  type SpecCoverageItem,
} from "../../packages/cli/src/tui/health-data.js";
import { getLayout } from "../../packages/cli/src/tui/layout.js";
import type { ProjectStatusSnapshot, WorkItem } from "@opcom/types";

function makeProject(): ProjectStatusSnapshot {
  return {
    id: "proj-1",
    name: "opcom",
    path: "/projects/opcom",
    git: { remote: null, branch: "main", clean: true },
    workSummary: { open: 10, total: 15, inProgress: 2, closed: 3, deferred: 0 },
  };
}

function makeTicket(overrides: Partial<WorkItem>): WorkItem {
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

function makeAllSpecs(): SpecCoverageItem[] {
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

describe("computeProjectSpecs", () => {
  it("returns specs referenced by project tickets", () => {
    const tickets = [
      makeTicket({ id: "t1", links: ["docs/spec/tui.md#navigation"] }),
      makeTicket({ id: "t2", links: ["docs/spec/tui.md#rendering"] }),
      makeTicket({ id: "t3", links: ["docs/spec/orchestrator.md#plan-stages"] }),
    ];
    const allSpecs = makeAllSpecs();

    const result = computeProjectSpecs(tickets, allSpecs);

    expect(result).toHaveLength(2);
    const names = result.map((s) => s.name);
    expect(names).toContain("tui");
    expect(names).toContain("orchestrator");
  });

  it("returns empty when no tickets have spec links", () => {
    const tickets = [
      makeTicket({ id: "t1", links: [] }),
      makeTicket({ id: "t2", links: ["some/other/link"] }),
    ];
    const allSpecs = makeAllSpecs();

    const result = computeProjectSpecs(tickets, allSpecs);
    expect(result).toHaveLength(0);
  });

  it("returns empty when tickets list is empty", () => {
    const result = computeProjectSpecs([], makeAllSpecs());
    expect(result).toHaveLength(0);
  });

  it("returns empty when allSpecs is empty", () => {
    const tickets = [
      makeTicket({ id: "t1", links: ["docs/spec/tui.md#nav"] }),
    ];
    const result = computeProjectSpecs(tickets, []);
    expect(result).toHaveLength(0);
  });

  it("counts tickets per spec correctly", () => {
    const tickets = [
      makeTicket({ id: "t1", links: ["docs/spec/tui.md#a"] }),
      makeTicket({ id: "t2", links: ["docs/spec/tui.md#b"] }),
      makeTicket({ id: "t3", links: ["docs/spec/tui.md#c"] }),
      makeTicket({ id: "t4", links: ["docs/spec/orchestrator.md#x"] }),
    ];
    const allSpecs = makeAllSpecs();

    const result = computeProjectSpecs(tickets, allSpecs);
    const tuiSpec = result.find((s) => s.name === "tui");
    const orchSpec = result.find((s) => s.name === "orchestrator");

    expect(tuiSpec?.ticketCount).toBe(3);
    expect(orchSpec?.ticketCount).toBe(1);
  });

  it("sorts by ticket count descending", () => {
    const tickets = [
      makeTicket({ id: "t1", links: ["docs/spec/orchestrator.md#a"] }),
      makeTicket({ id: "t2", links: ["docs/spec/tui.md#a"] }),
      makeTicket({ id: "t3", links: ["docs/spec/tui.md#b"] }),
      makeTicket({ id: "t4", links: ["docs/spec/tui.md#c"] }),
    ];
    const allSpecs = makeAllSpecs();

    const result = computeProjectSpecs(tickets, allSpecs);
    expect(result[0].name).toBe("tui");
    expect(result[1].name).toBe("orchestrator");
  });

  it("marks spec as covered when ticket count >= section count", () => {
    const tickets = [
      makeTicket({ id: "t1", links: ["docs/spec/cicd.md#a"] }),
      makeTicket({ id: "t2", links: ["docs/spec/cicd.md#b"] }),
      makeTicket({ id: "t3", links: ["docs/spec/cicd.md#c"] }),
    ];
    const allSpecs = makeAllSpecs();

    const result = computeProjectSpecs(tickets, allSpecs);
    const cicd = result.find((s) => s.name === "cicd");
    expect(cicd?.status).toBe("covered");
  });

  it("marks spec as partial when ticket count < section count", () => {
    const tickets = [
      makeTicket({ id: "t1", links: ["docs/spec/orchestrator.md#one"] }),
    ];
    const allSpecs = makeAllSpecs();

    const result = computeProjectSpecs(tickets, allSpecs);
    const orch = result.find((s) => s.name === "orchestrator");
    expect(orch?.status).toBe("partial");
  });

  it("handles ticket linking to multiple specs", () => {
    const tickets = [
      makeTicket({ id: "t1", links: ["docs/spec/tui.md#a", "docs/spec/config.md#b"] }),
    ];
    const allSpecs = makeAllSpecs();

    const result = computeProjectSpecs(tickets, allSpecs);
    expect(result).toHaveLength(2);
    const names = result.map((s) => s.name);
    expect(names).toContain("tui");
    expect(names).toContain("config");
  });

  it("handles spec/ prefix without docs/ prefix", () => {
    const tickets = [
      makeTicket({ id: "t1", links: ["spec/detection.md#evidence"] }),
    ];
    const allSpecs = makeAllSpecs();

    const result = computeProjectSpecs(tickets, allSpecs);
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe("detection");
  });
});

// --- ProjectDetailState specs integration ---

describe("ProjectDetailState with specs", () => {
  it("initializes projectSpecs as empty", () => {
    const state = createProjectDetailState(makeProject());
    expect(state.projectSpecs).toEqual([]);
  });

  it("has 8 panel slots in selectedIndex and scrollOffset", () => {
    const state = createProjectDetailState(makeProject());
    expect(state.selectedIndex).toHaveLength(8);
    expect(state.scrollOffset).toHaveLength(8);
  });
});

// --- PANEL_COUNT ---

describe("PANEL_COUNT", () => {
  it("is 8 (tickets, agents, specs, stack, cloud, cicd, infra, chat)", () => {
    expect(PANEL_COUNT).toBe(8);
  });
});

// --- getPanelItemCount for specs ---

describe("getPanelItemCount for specs panel", () => {
  it("returns specs count for panel 2", () => {
    const state = createProjectDetailState(makeProject());
    state.projectSpecs = [
      { name: "tui", sections: 9, ticketCount: 5, status: "covered" },
      { name: "orchestrator", sections: 8, ticketCount: 3, status: "partial" },
    ];

    expect(getPanelItemCount(state, 2)).toBe(2);
  });

  it("returns 0 for specs panel when no specs", () => {
    const state = createProjectDetailState(makeProject());
    expect(getPanelItemCount(state, 2)).toBe(0);
  });

  it("returns 0 for stack panel (index 3, not navigable)", () => {
    const state = createProjectDetailState(makeProject());
    expect(getPanelItemCount(state, 3)).toBe(0);
  });

  it("returns cloud services count for panel 4", () => {
    const state = createProjectDetailState(makeProject());
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
    expect(getPanelItemCount(state, 4)).toBe(1);
  });
});

// --- clampSelection for specs panel ---

describe("clampSelection for specs panel", () => {
  it("clamps specs panel selection to valid range", () => {
    const state = createProjectDetailState(makeProject());
    state.projectSpecs = [
      { name: "tui", sections: 9, ticketCount: 5, status: "covered" },
    ];
    state.selectedIndex[2] = 5; // Out of range

    clampSelection(state);
    expect(state.selectedIndex[2]).toBe(0);
  });

  it("resets to 0 when no specs", () => {
    const state = createProjectDetailState(makeProject());
    state.selectedIndex[2] = 2;

    clampSelection(state);
    expect(state.selectedIndex[2]).toBe(0);
    expect(state.scrollOffset[2]).toBe(0);
  });
});

// --- getSpecsList ---

describe("getSpecsList", () => {
  it("returns the projectSpecs array", () => {
    const state = createProjectDetailState(makeProject());
    const specs: SpecCoverageItem[] = [
      { name: "tui", sections: 9, ticketCount: 5, status: "covered" },
      { name: "config", sections: 3, ticketCount: 1, status: "partial" },
    ];
    state.projectSpecs = specs;

    const result = getSpecsList(state);
    expect(result).toBe(specs);
    expect(result).toHaveLength(2);
  });

  it("returns empty array when no specs set", () => {
    const state = createProjectDetailState(makeProject());
    expect(getSpecsList(state)).toEqual([]);
  });
});

// --- Layout includes specs panel ---

describe("L2 layout includes specs panel", () => {
  it("includes a specs panel in level 2 layout", () => {
    const layout = getLayout(2, 120, 40);
    const specsPanel = layout.panels.find((p) => p.id === "specs");
    expect(specsPanel).toBeDefined();
  });

  it("has 8 panels in level 2 layout", () => {
    const layout = getLayout(2, 120, 40);
    expect(layout.panels).toHaveLength(8);
    expect(layout.panels.map((p) => p.id)).toEqual([
      "tickets", "agents", "specs", "stack", "cloud", "cicd", "infra", "chat",
    ]);
  });

  it("specs panel is between agents and stack", () => {
    const layout = getLayout(2, 120, 40);
    const agents = layout.panels.find((p) => p.id === "agents")!;
    const specs = layout.panels.find((p) => p.id === "specs")!;
    const stack = layout.panels.find((p) => p.id === "stack")!;

    // specs starts where agents ends
    expect(specs.y).toBe(agents.y + agents.height);
    // stack starts where specs ends
    expect(stack.y).toBe(specs.y + specs.height);
  });
});

// --- renderProjectDetail with specs ---

describe("renderProjectDetail with specs", () => {
  it("renders without crash when specs are empty", () => {
    const buf = new ScreenBuffer(120, 40);
    const layout = getLayout(2, 120, 40);
    const state = createProjectDetailState(makeProject());

    renderProjectDetail(buf, layout.panels, state);
    buf.flush();
    // No crash
  });

  it("renders without crash when specs are populated", () => {
    const buf = new ScreenBuffer(120, 40);
    const layout = getLayout(2, 120, 40);
    const state = createProjectDetailState(makeProject());
    state.projectSpecs = [
      { name: "orchestrator", sections: 8, ticketCount: 8, status: "covered" },
      { name: "tui", sections: 9, ticketCount: 5, status: "partial" },
      { name: "config", sections: 3, ticketCount: 0, status: "uncovered" },
    ];

    renderProjectDetail(buf, layout.panels, state);
    buf.flush();
    // No crash
  });

  it("renders with specs panel focused", () => {
    const buf = new ScreenBuffer(120, 40);
    const layout = getLayout(2, 120, 40);
    const state = createProjectDetailState(makeProject());
    state.projectSpecs = [
      { name: "tui", sections: 9, ticketCount: 5, status: "covered" },
    ];
    state.focusedPanel = 2; // specs panel

    renderProjectDetail(buf, layout.panels, state);
    buf.flush();
    // No crash
  });

  it("renders with selected spec in specs panel", () => {
    const buf = new ScreenBuffer(120, 40);
    const layout = getLayout(2, 120, 40);
    const state = createProjectDetailState(makeProject());
    state.projectSpecs = [
      { name: "tui", sections: 9, ticketCount: 5, status: "covered" },
      { name: "orchestrator", sections: 8, ticketCount: 3, status: "partial" },
    ];
    state.focusedPanel = 2;
    state.selectedIndex[2] = 1;

    renderProjectDetail(buf, layout.panels, state);
    buf.flush();
    // No crash
  });

  it("handles narrow terminal gracefully", () => {
    const buf = new ScreenBuffer(60, 20);
    const layout = getLayout(2, 60, 20);
    const state = createProjectDetailState(makeProject());
    state.projectSpecs = [
      { name: "tui", sections: 9, ticketCount: 5, status: "covered" },
    ];

    renderProjectDetail(buf, layout.panels, state);
    buf.flush();
    // No crash
  });
});
