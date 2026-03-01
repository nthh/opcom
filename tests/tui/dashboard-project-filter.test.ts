import { describe, it, expect } from "vitest";
import {
  createDashboardState,
  getFilteredWorkItems,
  clampSelection,
  type DashboardState,
  type DashboardWorkItem,
} from "../../packages/cli/src/tui/views/dashboard.js";
import type { WorkItem, ProjectStatusSnapshot } from "@opcom/types";

function makeWorkItem(overrides: Partial<WorkItem> = {}): WorkItem {
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

function makeDashboardWorkItem(
  projectId: string,
  projectName: string,
  overrides: Partial<WorkItem> = {},
): DashboardWorkItem {
  return {
    item: makeWorkItem(overrides),
    projectId,
    projectName,
  };
}

function makeProject(id: string, name: string): ProjectStatusSnapshot {
  return {
    id,
    name,
    path: `/tmp/${id}`,
    stack: null as any,
    git: null,
    workSummary: null,
  };
}

function stateWithItems(): DashboardState {
  const state = createDashboardState();
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

describe("DashboardWorkItem", () => {
  it("createDashboardState initializes projectFilter to null", () => {
    const state = createDashboardState();
    expect(state.projectFilter).toBeNull();
  });

  it("wraps WorkItem with project association", () => {
    const dw = makeDashboardWorkItem("proj1", "My Project", { id: "t1", title: "test" });
    expect(dw.item.id).toBe("t1");
    expect(dw.projectId).toBe("proj1");
    expect(dw.projectName).toBe("My Project");
  });
});

describe("getFilteredWorkItems", () => {
  it("returns all items sorted by priority when no filters", () => {
    const state = stateWithItems();
    const result = getFilteredWorkItems(state);
    expect(result).toHaveLength(7);
    // P0 first
    expect(result[0].item.id).toBe("auth-mig");
    // P3 last
    expect(result[result.length - 1].item.id).toBe("groceries");
  });

  it("filters by project", () => {
    const state = stateWithItems();
    state.projectFilter = "life";
    const result = getFilteredWorkItems(state);
    expect(result).toHaveLength(3);
    expect(result.every((w) => w.projectId === "life")).toBe(true);
  });

  it("filters by priority", () => {
    const state = stateWithItems();
    state.priorityFilter = 1;
    const result = getFilteredWorkItems(state);
    expect(result).toHaveLength(4);
    expect(result.every((w) => w.item.priority === 1)).toBe(true);
  });

  it("combines project and priority filters", () => {
    const state = stateWithItems();
    state.projectFilter = "folia";
    state.priorityFilter = 1;
    const result = getFilteredWorkItems(state);
    expect(result).toHaveLength(2);
    expect(result.every((w) => w.projectId === "folia" && w.item.priority === 1)).toBe(true);
  });

  it("filters by search query matching title", () => {
    const state = stateWithItems();
    state.searchQuery = "camping";
    const result = getFilteredWorkItems(state);
    expect(result).toHaveLength(1);
    expect(result[0].item.id).toBe("camping");
  });

  it("filters by search query matching item id", () => {
    const state = stateWithItems();
    state.searchQuery = "auth-mig";
    const result = getFilteredWorkItems(state);
    expect(result).toHaveLength(1);
    expect(result[0].item.id).toBe("auth-mig");
  });

  it("search matches project name", () => {
    const state = stateWithItems();
    state.searchQuery = "mtnmap";
    const result = getFilteredWorkItems(state);
    expect(result).toHaveLength(2);
    expect(result.every((w) => w.projectName === "mtnmap")).toBe(true);
  });

  it("combines all three filters", () => {
    const state = stateWithItems();
    state.projectFilter = "life";
    state.priorityFilter = 2;
    state.searchQuery = "camping";
    const result = getFilteredWorkItems(state);
    expect(result).toHaveLength(1);
    expect(result[0].item.id).toBe("camping");
  });

  it("returns empty when project filter matches nothing", () => {
    const state = stateWithItems();
    state.projectFilter = "nonexistent";
    const result = getFilteredWorkItems(state);
    expect(result).toHaveLength(0);
  });
});

describe("project filter cycling", () => {
  // Simulate the f/F keybinding logic from app.ts

  function cycleForward(state: DashboardState): void {
    const projectIds = state.projects.map((p) => p.id);
    if (projectIds.length === 0) return;
    if (state.projectFilter === null) {
      state.projectFilter = projectIds[0];
    } else {
      const idx = projectIds.indexOf(state.projectFilter);
      if (idx === -1 || idx === projectIds.length - 1) {
        state.projectFilter = null;
      } else {
        state.projectFilter = projectIds[idx + 1];
      }
    }
    state.selectedIndex[1] = 0;
    state.scrollOffset[1] = 0;
    clampSelection(state);
  }

  function clearFilter(state: DashboardState): void {
    state.projectFilter = null;
    state.selectedIndex[1] = 0;
    state.scrollOffset[1] = 0;
    clampSelection(state);
  }

  it("cycles through projects: null → folia → mtnmap → life → null", () => {
    const state = stateWithItems();

    expect(state.projectFilter).toBeNull();

    cycleForward(state);
    expect(state.projectFilter).toBe("folia");

    cycleForward(state);
    expect(state.projectFilter).toBe("mtnmap");

    cycleForward(state);
    expect(state.projectFilter).toBe("life");

    cycleForward(state);
    expect(state.projectFilter).toBeNull();
  });

  it("F clears project filter", () => {
    const state = stateWithItems();
    state.projectFilter = "mtnmap";

    clearFilter(state);
    expect(state.projectFilter).toBeNull();
  });

  it("resets selection when filter changes", () => {
    const state = stateWithItems();
    state.selectedIndex[1] = 3;
    state.scrollOffset[1] = 2;

    cycleForward(state);
    expect(state.selectedIndex[1]).toBe(0);
    expect(state.scrollOffset[1]).toBe(0);
  });

  it("handles cycling with no projects", () => {
    const state = createDashboardState();
    // No projects
    cycleForward(state);
    expect(state.projectFilter).toBeNull();
  });

  it("handles cycling when current filter project no longer exists", () => {
    const state = stateWithItems();
    state.projectFilter = "deleted-project";

    cycleForward(state);
    // idx === -1, so wraps to null
    expect(state.projectFilter).toBeNull();
  });
});
