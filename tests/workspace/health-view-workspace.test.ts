/**
 * Tests for TUI health view rendering with workspace health data.
 */
import { describe, it, expect } from "vitest";
import { ScreenBuffer } from "../../packages/cli/src/tui/renderer.js";
import {
  renderHealthView,
  createHealthViewState,
} from "../../packages/cli/src/tui/views/health-view.js";
import type { HealthData } from "../../packages/cli/src/tui/health-data.js";
import type { WorkspaceHealthSummary } from "../../packages/cli/src/tui/health-data.js";

function makePanel(width = 80, height = 40) {
  return { id: "health", x: 0, y: 0, width, height, title: "Health" };
}

function makeHealthData(): HealthData {
  return {
    specCount: 5,
    specsCovered: 3,
    specsPartial: 1,
    specsUncovered: 1,
    specs: [
      { name: "detection", sections: 4, ticketCount: 4, status: "covered" as const },
      { name: "config", sections: 2, ticketCount: 2, status: "covered" as const },
      { name: "adapters", sections: 8, ticketCount: 5, status: "partial" as const },
      { name: "cicd", sections: 5, ticketCount: 0, status: "uncovered" as const },
      { name: "tui", sections: 6, ticketCount: 6, status: "covered" as const },
    ],
    ticketCount: 20,
    ticketsWithSpec: 16,
    ticketsWithoutSpec: 4,
    brokenLinks: [],
    useCases: [],
  };
}

function makeWorkspaceHealth(): WorkspaceHealthSummary {
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

describe("Health view with workspace health", () => {
  it("renders without workspace health (backward compatible)", () => {
    const buf = new ScreenBuffer(80, 40);
    const panel = makePanel();
    const state = createHealthViewState();
    state.data = makeHealthData();

    // Should not throw
    renderHealthView(buf, panel, state);
  });

  it("renders with workspace health data without throwing", () => {
    const buf = new ScreenBuffer(100, 50);
    const panel = makePanel(100, 50);
    const state = createHealthViewState();
    state.data = makeHealthData();
    state.workspaceHealth = makeWorkspaceHealth();

    // Should not throw
    renderHealthView(buf, panel, state);
  });

  it("renders with shared patterns without throwing", () => {
    const buf = new ScreenBuffer(120, 60);
    const panel = makePanel(120, 60);
    const state = createHealthViewState();
    state.data = makeHealthData();
    state.workspaceHealth = makeWorkspaceHealth();

    // Should not throw
    renderHealthView(buf, panel, state);
  });

  it("does not throw when workspace has no projects", () => {
    const buf = new ScreenBuffer(80, 40);
    const panel = makePanel();
    const state = createHealthViewState();
    state.data = makeHealthData();
    state.workspaceHealth = { projects: [], totalSignals: 0, sharedPatterns: [] };

    // Should not throw
    renderHealthView(buf, panel, state);
  });

  it("createHealthViewState initializes workspaceHealth to null", () => {
    const state = createHealthViewState();
    expect(state.workspaceHealth).toBeNull();
  });

  it("state accepts workspace health with multiple projects", () => {
    const state = createHealthViewState();
    state.data = makeHealthData();
    state.workspaceHealth = makeWorkspaceHealth();

    expect(state.workspaceHealth.projects).toHaveLength(2);
    expect(state.workspaceHealth.projects[0].projectName).toBe("folia");
    expect(state.workspaceHealth.projects[1].projectName).toBe("mtnmap");
    expect(state.workspaceHealth.totalSignals).toBe(12);
  });

  it("state accepts workspace health with shared patterns", () => {
    const state = createHealthViewState();
    state.workspaceHealth = makeWorkspaceHealth();

    expect(state.workspaceHealth.sharedPatterns).toHaveLength(1);
    expect(state.workspaceHealth.sharedPatterns[0].patternId).toBe("file_no_tests:connector");
    expect(state.workspaceHealth.sharedPatterns[0].projects).toContain("folia");
    expect(state.workspaceHealth.sharedPatterns[0].projects).toContain("mtnmap");
  });

  it("renders with only workspace health (no spec data)", () => {
    const buf = new ScreenBuffer(80, 40);
    const panel = makePanel();
    const state = createHealthViewState();
    // No state.data — should show loading message
    state.workspaceHealth = makeWorkspaceHealth();

    // Should not throw (shows loading when data is null)
    renderHealthView(buf, panel, state);
  });
});
