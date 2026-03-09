import { describe, it, expect } from "vitest";
import { stripAnsi, ScreenBuffer } from "../../packages/cli/src/tui/renderer.js";
import {
  renderCICDPanel,
  buildCICDRows,
  getCICDItemCount,
  getPipelineAtIndex,
  getDeploymentAtIndex,
  formatPipelineLine,
  formatDeploymentLine,
  pipelineStatusIcon,
  deploymentStateIcon,
  formatDuration,
  formatTimeAgo,
} from "../../packages/cli/src/tui/views/cicd-pane.js";
import type { Pipeline, DeploymentStatus, PipelineStatus, DeploymentState } from "@opcom/types";
import type { Panel } from "../../packages/cli/src/tui/layout.js";

// --- Factories ---

function makePipeline(overrides: Partial<Pipeline> = {}): Pipeline {
  return {
    id: "run-1",
    projectId: "proj-1",
    provider: "github-actions",
    name: "CI",
    ref: "refs/heads/main",
    commitSha: "abc1234567890",
    status: "success",
    startedAt: new Date(Date.now() - 300_000).toISOString(), // 5 min ago
    durationMs: 120_000,
    url: "https://github.com/org/repo/actions/runs/1",
    jobs: [],
    ...overrides,
  };
}

function makeDeployment(overrides: Partial<DeploymentStatus> = {}): DeploymentStatus {
  return {
    id: "deploy-1",
    projectId: "proj-1",
    provider: "github-actions",
    environment: "production",
    ref: "main",
    status: "active",
    createdAt: new Date(Date.now() - 600_000).toISOString(),
    updatedAt: new Date(Date.now() - 300_000).toISOString(),
    ...overrides,
  };
}

function makePanel(overrides: Partial<Panel> = {}): Panel {
  return {
    id: "cicd",
    x: 0,
    y: 0,
    width: 80,
    height: 20,
    title: "CI/CD",
    ...overrides,
  };
}

// --- formatDuration tests ---

describe("formatDuration", () => {
  it("formats milliseconds", () => {
    expect(formatDuration(500)).toBe("500ms");
  });

  it("formats seconds", () => {
    expect(formatDuration(45_000)).toBe("45s");
  });

  it("formats minutes and seconds", () => {
    expect(formatDuration(125_000)).toBe("2m5s");
  });

  it("formats exact minutes", () => {
    expect(formatDuration(120_000)).toBe("2m");
  });

  it("formats hours and minutes", () => {
    expect(formatDuration(3_900_000)).toBe("1h5m");
  });

  it("formats exact hours", () => {
    expect(formatDuration(3_600_000)).toBe("1h");
  });
});

// --- formatTimeAgo tests ---

describe("formatTimeAgo", () => {
  it("returns 'just now' for recent timestamps", () => {
    const recent = new Date(Date.now() - 10_000).toISOString();
    expect(formatTimeAgo(recent)).toBe("just now");
  });

  it("returns minutes ago", () => {
    const fiveMin = new Date(Date.now() - 300_000).toISOString();
    expect(formatTimeAgo(fiveMin)).toBe("5m ago");
  });

  it("returns hours ago", () => {
    const twoHours = new Date(Date.now() - 7_200_000).toISOString();
    expect(formatTimeAgo(twoHours)).toBe("2h ago");
  });

  it("returns days ago", () => {
    const threeDays = new Date(Date.now() - 259_200_000).toISOString();
    expect(formatTimeAgo(threeDays)).toBe("3d ago");
  });

  it("returns raw string for invalid ISO", () => {
    expect(formatTimeAgo("not-a-date")).toBe("not-a-date");
  });
});

// --- pipelineStatusIcon tests ---

describe("pipelineStatusIcon", () => {
  const statuses: PipelineStatus[] = [
    "success", "failure", "in_progress", "queued",
    "cancelled", "timed_out", "skipped",
  ];

  for (const status of statuses) {
    it(`returns an icon for ${status}`, () => {
      const icon = pipelineStatusIcon(status);
      expect(stripAnsi(icon).length).toBeGreaterThan(0);
    });
  }
});

// --- deploymentStateIcon tests ---

describe("deploymentStateIcon", () => {
  const states: DeploymentState[] = [
    "active", "in_progress", "pending", "inactive", "failed", "error",
  ];

  for (const state of states) {
    it(`returns an icon for ${state}`, () => {
      const icon = deploymentStateIcon(state);
      expect(stripAnsi(icon).length).toBeGreaterThan(0);
    });
  }
});

// --- buildCICDRows tests ---

describe("buildCICDRows", () => {
  it("returns empty array when no data", () => {
    const rows = buildCICDRows([], []);
    expect(rows).toHaveLength(0);
  });

  it("builds rows with pipeline header and items", () => {
    const pipelines = [makePipeline({ id: "r1" }), makePipeline({ id: "r2" })];
    const rows = buildCICDRows(pipelines, []);
    expect(rows).toHaveLength(3); // 1 header + 2 pipelines
    expect(rows[0].type).toBe("header");
    expect(rows[0].text).toContain("WORKFLOWS");
    expect(rows[1].type).toBe("pipeline");
    expect(rows[1].itemIndex).toBe(0);
    expect(rows[2].type).toBe("pipeline");
    expect(rows[2].itemIndex).toBe(1);
  });

  it("builds rows with deployment header and items", () => {
    const deployments = [makeDeployment({ id: "d1" })];
    const rows = buildCICDRows([], deployments);
    expect(rows).toHaveLength(2); // 1 header + 1 deployment
    expect(rows[0].type).toBe("header");
    expect(rows[0].text).toContain("DEPLOYMENTS");
    expect(rows[1].type).toBe("deployment");
    expect(rows[1].itemIndex).toBe(0);
  });

  it("builds mixed rows with correct indices", () => {
    const pipelines = [makePipeline({ id: "r1" })];
    const deployments = [makeDeployment({ id: "d1" }), makeDeployment({ id: "d2" })];
    const rows = buildCICDRows(pipelines, deployments);
    // 1 pipeline header + 1 pipeline + 1 deployment header + 2 deployments = 5
    expect(rows).toHaveLength(5);
    expect(rows[1].itemIndex).toBe(0); // pipeline
    expect(rows[3].itemIndex).toBe(1); // first deployment
    expect(rows[4].itemIndex).toBe(2); // second deployment
  });
});

// --- getCICDItemCount tests ---

describe("getCICDItemCount", () => {
  it("returns 0 for empty lists", () => {
    expect(getCICDItemCount([], [])).toBe(0);
  });

  it("returns sum of pipelines and deployments", () => {
    const pipelines = [makePipeline(), makePipeline({ id: "r2" })];
    const deployments = [makeDeployment()];
    expect(getCICDItemCount(pipelines, deployments)).toBe(3);
  });
});

// --- getPipelineAtIndex / getDeploymentAtIndex tests ---

describe("getPipelineAtIndex", () => {
  it("returns pipeline for index within pipeline range", () => {
    const pipelines = [makePipeline({ id: "r1" }), makePipeline({ id: "r2" })];
    const deployments = [makeDeployment()];
    expect(getPipelineAtIndex(pipelines, deployments, 0)?.id).toBe("r1");
    expect(getPipelineAtIndex(pipelines, deployments, 1)?.id).toBe("r2");
  });

  it("returns null for deployment index", () => {
    const pipelines = [makePipeline()];
    const deployments = [makeDeployment()];
    expect(getPipelineAtIndex(pipelines, deployments, 1)).toBeNull();
  });
});

describe("getDeploymentAtIndex", () => {
  it("returns deployment for index past pipelines", () => {
    const pipelines = [makePipeline()];
    const deployments = [makeDeployment({ id: "d1" }), makeDeployment({ id: "d2" })];
    expect(getDeploymentAtIndex(pipelines, deployments, 1)?.id).toBe("d1");
    expect(getDeploymentAtIndex(pipelines, deployments, 2)?.id).toBe("d2");
  });

  it("returns null for pipeline index", () => {
    const pipelines = [makePipeline()];
    const deployments = [makeDeployment()];
    expect(getDeploymentAtIndex(pipelines, deployments, 0)).toBeNull();
  });

  it("returns null for out-of-range index", () => {
    const pipelines = [makePipeline()];
    const deployments = [makeDeployment()];
    expect(getDeploymentAtIndex(pipelines, deployments, 5)).toBeNull();
  });
});

// --- formatPipelineLine tests ---

describe("formatPipelineLine", () => {
  it("includes branch name without refs/heads/ prefix", () => {
    const pipeline = makePipeline({ ref: "refs/heads/feature-branch" });
    const line = stripAnsi(formatPipelineLine(pipeline, 100));
    expect(line).toContain("feature-branch");
    expect(line).not.toContain("refs/heads/");
  });

  it("includes workflow name", () => {
    const pipeline = makePipeline({ name: "Build & Deploy" });
    const line = stripAnsi(formatPipelineLine(pipeline, 100));
    expect(line).toContain("Build & Deploy");
  });

  it("includes duration when present", () => {
    const pipeline = makePipeline({ durationMs: 90_000 });
    const line = stripAnsi(formatPipelineLine(pipeline, 100));
    expect(line).toContain("1m30s");
  });

  it("omits duration when not present", () => {
    const pipeline = makePipeline({ durationMs: undefined });
    const line = stripAnsi(formatPipelineLine(pipeline, 100));
    expect(line).not.toContain("ms");
  });

  it("truncates to maxWidth", () => {
    const pipeline = makePipeline({ name: "A very long workflow name that should be truncated" });
    const line = stripAnsi(formatPipelineLine(pipeline, 30));
    expect(line.length).toBeLessThanOrEqual(30);
  });
});

// --- formatDeploymentLine tests ---

describe("formatDeploymentLine", () => {
  it("includes environment name", () => {
    const deployment = makeDeployment({ environment: "staging" });
    const line = stripAnsi(formatDeploymentLine(deployment, 100));
    expect(line).toContain("staging");
  });

  it("includes status", () => {
    const deployment = makeDeployment({ status: "active" });
    const line = stripAnsi(formatDeploymentLine(deployment, 100));
    expect(line).toContain("active");
  });

  it("includes time ago", () => {
    const deployment = makeDeployment({
      updatedAt: new Date(Date.now() - 7_200_000).toISOString(),
    });
    const line = stripAnsi(formatDeploymentLine(deployment, 100));
    expect(line).toContain("2h ago");
  });
});

// --- renderCICDPanel tests ---

describe("renderCICDPanel", () => {
  it("renders empty state message", () => {
    const buf = new ScreenBuffer(80, 20);
    const panel = makePanel();
    renderCICDPanel(buf, panel, [], [], 0, 0, false);
    buf.flush();
    // No crash for empty state
  });

  it("renders pipelines", () => {
    const buf = new ScreenBuffer(80, 20);
    const panel = makePanel();
    const pipelines = [
      makePipeline({ name: "CI", status: "success" }),
      makePipeline({ id: "r2", name: "Deploy", status: "failure" }),
    ];
    renderCICDPanel(buf, panel, pipelines, [], 0, 0, true);
    buf.flush();
    // No crash with pipeline data
  });

  it("renders deployments", () => {
    const buf = new ScreenBuffer(80, 20);
    const panel = makePanel();
    const deployments = [
      makeDeployment({ environment: "production", status: "active" }),
      makeDeployment({ id: "d2", environment: "staging", status: "pending" }),
    ];
    renderCICDPanel(buf, panel, [], deployments, 0, 0, true);
    buf.flush();
    // No crash with deployment data
  });

  it("renders mixed pipelines and deployments", () => {
    const buf = new ScreenBuffer(100, 25);
    const panel = makePanel({ width: 100, height: 25 });
    const pipelines = [makePipeline()];
    const deployments = [makeDeployment()];
    renderCICDPanel(buf, panel, pipelines, deployments, 0, 0, true);
    buf.flush();
    // No crash with mixed data
  });

  it("handles narrow terminal", () => {
    const buf = new ScreenBuffer(40, 10);
    const panel = makePanel({ width: 40, height: 10 });
    const pipelines = [makePipeline()];
    renderCICDPanel(buf, panel, pipelines, [], 0, 0, false);
    buf.flush();
    // No crash in narrow terminal
  });

  it("handles scrolling with offset", () => {
    const buf = new ScreenBuffer(80, 10);
    const panel = makePanel({ height: 10 });
    const pipelines = Array.from({ length: 20 }, (_, i) =>
      makePipeline({ id: `r${i}`, name: `Workflow ${i}` }),
    );
    renderCICDPanel(buf, panel, pipelines, [], 5, 10, false);
    buf.flush();
    // No crash with scroll offset
  });
});

// --- Project detail CI/CD panel integration ---

describe("project detail CI/CD integration", () => {
  it("includes CI/CD panel count of 8", async () => {
    const { PANEL_COUNT } = await import("../../packages/cli/src/tui/views/project-detail.js");
    expect(PANEL_COUNT).toBe(8);
  });

  it("creates state with empty CI/CD data", async () => {
    const { createProjectDetailState } = await import("../../packages/cli/src/tui/views/project-detail.js");
    const state = createProjectDetailState({
      id: "proj-1",
      name: "Test Project",
      path: "/test",
      git: null,
      workSummary: null,
    });
    expect(state.pipelines).toEqual([]);
    expect(state.deployments).toEqual([]);
    expect(state.selectedIndex).toHaveLength(8);
    expect(state.scrollOffset).toHaveLength(8);
  });

  it("getPanelItemCount returns CI/CD item count for panel 5", async () => {
    const { createProjectDetailState, getPanelItemCount } = await import("../../packages/cli/src/tui/views/project-detail.js");
    const state = createProjectDetailState({
      id: "proj-1",
      name: "Test",
      path: "/test",
      git: null,
      workSummary: null,
    });
    state.pipelines = [makePipeline()];
    state.deployments = [makeDeployment(), makeDeployment({ id: "d2" })];
    expect(getPanelItemCount(state, 5)).toBe(3);
  });

  it("clampSelection handles CI/CD panel", async () => {
    const { createProjectDetailState, clampSelection } = await import("../../packages/cli/src/tui/views/project-detail.js");
    const state = createProjectDetailState({
      id: "proj-1",
      name: "Test",
      path: "/test",
      git: null,
      workSummary: null,
    });
    state.pipelines = [makePipeline()];
    state.selectedIndex[5] = 10; // out of range
    clampSelection(state);
    expect(state.selectedIndex[5]).toBe(0); // clamped to max (1 item, so index 0)
  });
});
