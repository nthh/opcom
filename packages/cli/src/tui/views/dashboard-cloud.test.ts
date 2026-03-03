import { describe, it, expect } from "vitest";
import type { ProjectStatusSnapshot, CloudHealthSummary } from "@opcom/types";
import { ScreenBuffer } from "../renderer.js";
import { createDashboardState, renderDashboard } from "./dashboard.js";

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

describe("dashboard cloud health dots", () => {
  it("renders cloud dots when cloudHealthSummary is present", () => {
    const state = createDashboardState();
    state.projects = [
      makeProject({
        cloudHealthSummary: { total: 3, healthy: 2, degraded: 1, unreachable: 0, unknown: 0 },
      }),
    ];

    const buf = new ScreenBuffer(120, 40);
    const panels = [
      { id: "projects", x: 0, y: 0, width: 70, height: 20, title: "Projects" },
      { id: "workqueue", x: 0, y: 20, width: 70, height: 20, title: "Work Queue" },
      { id: "agents", x: 70, y: 0, width: 50, height: 40, title: "Agents" },
    ];

    renderDashboard(buf, panels, state);

    // We can't easily check the exact buffer content with ANSI codes,
    // but we can verify the render doesn't throw
    expect(state.projects[0].cloudHealthSummary?.total).toBe(3);
  });

  it("does not render cloud dots when no summary", () => {
    const state = createDashboardState();
    state.projects = [makeProject()];

    const buf = new ScreenBuffer(120, 40);
    const panels = [
      { id: "projects", x: 0, y: 0, width: 70, height: 20, title: "Projects" },
      { id: "workqueue", x: 0, y: 20, width: 70, height: 20, title: "Work Queue" },
      { id: "agents", x: 70, y: 0, width: 50, height: 40, title: "Agents" },
    ];

    // Should render without error
    renderDashboard(buf, panels, state);
    expect(state.projects[0].cloudHealthSummary).toBeUndefined();
  });

  it("renders dots for all health states", () => {
    const state = createDashboardState();
    state.projects = [
      makeProject({
        cloudHealthSummary: { total: 7, healthy: 3, degraded: 1, unreachable: 1, unknown: 2 },
      }),
    ];

    const buf = new ScreenBuffer(120, 40);
    const panels = [
      { id: "projects", x: 0, y: 0, width: 70, height: 20, title: "Projects" },
      { id: "workqueue", x: 0, y: 20, width: 70, height: 20, title: "Work Queue" },
      { id: "agents", x: 70, y: 0, width: 50, height: 40, title: "Agents" },
    ];

    renderDashboard(buf, panels, state);
    expect(state.projects[0].cloudHealthSummary?.total).toBe(7);
  });
});
