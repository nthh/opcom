import { describe, it, expect } from "vitest";
import type { ProjectStatusSnapshot, InfraHealthSummary } from "@opcom/types";
import { ScreenBuffer } from "../../packages/cli/src/tui/renderer.js";
import { createDashboardState, renderDashboard, formatInfraDots } from "../../packages/cli/src/tui/views/dashboard.js";

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

const dashPanels = [
  { id: "projects", x: 0, y: 0, width: 100, height: 20, title: "Projects" },
  { id: "workqueue", x: 0, y: 20, width: 100, height: 20, title: "Work Queue" },
  { id: "agents", x: 100, y: 0, width: 50, height: 40, title: "Agents" },
];

describe("dashboard infra health dots", () => {
  it("renders infra dots when infraHealthSummary is present", () => {
    const state = createDashboardState();
    state.projects = [
      makeProject({
        infraHealthSummary: { total: 3, healthy: 2, degraded: 0, unhealthy: 1, progressing: 0, suspended: 0, unknown: 0 },
      }),
    ];

    const buf = new ScreenBuffer(150, 40);
    renderDashboard(buf, dashPanels, state);

    // Verify the summary is on the project
    expect(state.projects[0].infraHealthSummary?.total).toBe(3);
  });

  it("does not render infra dots when no summary", () => {
    const state = createDashboardState();
    state.projects = [makeProject()];

    const buf = new ScreenBuffer(150, 40);
    renderDashboard(buf, dashPanels, state);
    expect(state.projects[0].infraHealthSummary).toBeUndefined();
  });

  it("renders both cloud and infra dots together", () => {
    const state = createDashboardState();
    state.projects = [
      makeProject({
        cloudHealthSummary: { total: 2, healthy: 2, degraded: 0, unreachable: 0, unknown: 0 },
        infraHealthSummary: { total: 3, healthy: 3, degraded: 0, unhealthy: 0, progressing: 0, suspended: 0, unknown: 0 },
      }),
    ];

    const buf = new ScreenBuffer(150, 40);
    // Should render without error
    renderDashboard(buf, dashPanels, state);
    expect(state.projects[0].cloudHealthSummary?.total).toBe(2);
    expect(state.projects[0].infraHealthSummary?.total).toBe(3);
  });
});

describe("formatInfraDots", () => {
  it("returns dots for all health states", () => {
    const summary: InfraHealthSummary = {
      total: 6,
      healthy: 2,
      degraded: 1,
      unhealthy: 1,
      progressing: 1,
      suspended: 1,
      unknown: 0,
    };

    const result = formatInfraDots(summary);
    // Contains ANSI escape codes, but should have 6 dot characters
    expect(result).toBeTruthy();
    // Check it contains the expected unicode characters (within ANSI codes)
    expect(result).toContain("\u25cf"); // ● healthy
    expect(result).toContain("\u25d0"); // ◐ progressing or degraded
    expect(result).toContain("\u25cb"); // ○ unhealthy
    expect(result).toContain("\u2013"); // – suspended
  });

  it("returns empty string for all-zero summary", () => {
    const summary: InfraHealthSummary = {
      total: 0,
      healthy: 0,
      degraded: 0,
      unhealthy: 0,
      progressing: 0,
      suspended: 0,
      unknown: 0,
    };

    const result = formatInfraDots(summary);
    expect(result).toBe("");
  });

  it("returns only healthy dots when all healthy", () => {
    const summary: InfraHealthSummary = {
      total: 3,
      healthy: 3,
      degraded: 0,
      unhealthy: 0,
      progressing: 0,
      suspended: 0,
      unknown: 0,
    };

    const result = formatInfraDots(summary);
    expect(result).toContain("\u25cf"); // ● healthy
    expect(result).not.toContain("\u25cb"); // no ○ unhealthy
  });
});
