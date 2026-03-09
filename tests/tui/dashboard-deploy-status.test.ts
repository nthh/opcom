import { describe, it, expect } from "vitest";
import { stripAnsi } from "../../packages/cli/src/tui/renderer.js";
import {
  aggregateDeployStatus,
  formatProjectLine,
  formatDeployIndicator,
  createDashboardState,
  type DashboardDeployStatus,
} from "../../packages/cli/src/tui/views/dashboard.js";
import {
  formatDeploymentLine,
} from "../../packages/cli/src/tui/views/cicd-pane.js";
import {
  createDeploymentDetailState,
  rebuildDisplayLines,
  scrollDown,
  scrollUp,
  scrollToTop,
  scrollToBottom,
} from "../../packages/cli/src/tui/views/deployment-detail.js";
import type { DeploymentStatus, ProjectStatusSnapshot } from "@opcom/types";

// --- Factories ---

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

function makeProject(overrides: Partial<ProjectStatusSnapshot> = {}): ProjectStatusSnapshot {
  return {
    id: "proj-1",
    name: "folia",
    path: "/projects/folia",
    git: { branch: "main", clean: true, uncommittedCount: 0 },
    workSummary: { open: 3, total: 10 },
    ...overrides,
  };
}

// --- aggregateDeployStatus tests ---

describe("aggregateDeployStatus", () => {
  it("returns null for empty deployments", () => {
    expect(aggregateDeployStatus([], "proj-1")).toBeNull();
  });

  it("prioritizes failing deployments", () => {
    const deployments = [
      makeDeployment({ id: "d1", environment: "staging", status: "active" }),
      makeDeployment({ id: "d2", environment: "production", status: "failed" }),
    ];
    const result = aggregateDeployStatus(deployments, "proj-1");
    expect(result).not.toBeNull();
    expect(result!.state).toBe("failing");
    expect(result!.environment).toBe("prod");
  });

  it("prioritizes higher environment among failures", () => {
    const deployments = [
      makeDeployment({ id: "d1", environment: "staging", status: "failed" }),
      makeDeployment({ id: "d2", environment: "production", status: "failed" }),
    ];
    const result = aggregateDeployStatus(deployments, "proj-1");
    expect(result!.environment).toBe("prod");
  });

  it("shows deploying when in-progress", () => {
    const deployments = [
      makeDeployment({ id: "d1", environment: "production", status: "active" }),
      makeDeployment({ id: "d2", environment: "staging", status: "in_progress" }),
    ];
    const result = aggregateDeployStatus(deployments, "proj-1");
    expect(result!.state).toBe("deploying");
    expect(result!.environment).toBe("staging");
  });

  it("shows deploying for pending status", () => {
    const deployments = [
      makeDeployment({ id: "d1", environment: "production", status: "pending" }),
    ];
    const result = aggregateDeployStatus(deployments, "proj-1");
    expect(result!.state).toBe("deploying");
  });

  it("failing takes priority over deploying", () => {
    const deployments = [
      makeDeployment({ id: "d1", environment: "staging", status: "in_progress" }),
      makeDeployment({ id: "d2", environment: "production", status: "error" }),
    ];
    const result = aggregateDeployStatus(deployments, "proj-1");
    expect(result!.state).toBe("failing");
  });

  it("shows healthy for active deployment", () => {
    const deployments = [
      makeDeployment({ id: "d1", environment: "production", status: "active" }),
    ];
    const result = aggregateDeployStatus(deployments, "proj-1");
    expect(result!.state).toBe("healthy");
    expect(result!.environment).toBe("prod");
  });

  it("prefers production over staging when both active", () => {
    const deployments = [
      makeDeployment({ id: "d1", environment: "staging", status: "active" }),
      makeDeployment({ id: "d2", environment: "production", status: "active" }),
    ];
    const result = aggregateDeployStatus(deployments, "proj-1");
    expect(result!.environment).toBe("prod");
  });

  it("shows unknown for inactive deployments", () => {
    const deployments = [
      makeDeployment({ id: "d1", environment: "production", status: "inactive" }),
    ];
    const result = aggregateDeployStatus(deployments, "proj-1");
    expect(result!.state).toBe("unknown");
  });

  it("includes relativeTime", () => {
    const deployments = [
      makeDeployment({
        id: "d1",
        environment: "production",
        status: "active",
        updatedAt: new Date(Date.now() - 7_200_000).toISOString(), // 2 hours ago
      }),
    ];
    const result = aggregateDeployStatus(deployments, "proj-1");
    expect(result!.relativeTime).toBe("2h ago");
  });

  it("includes commitSha from ref", () => {
    const deployments = [
      makeDeployment({ id: "d1", ref: "abc123", status: "active" }),
    ];
    const result = aggregateDeployStatus(deployments, "proj-1");
    expect(result!.commitSha).toBe("abc123");
  });

  it("shortens environment names", () => {
    const tests: Array<[string, string]> = [
      ["production", "prod"],
      ["staging", "staging"],
      ["preview", "preview"],
      ["development", "dev"],
      ["custom-env", "custom-env"],
    ];

    for (const [input, expected] of tests) {
      const deployments = [makeDeployment({ environment: input, status: "active" })];
      const result = aggregateDeployStatus(deployments, "proj-1");
      expect(result!.environment).toBe(expected);
    }
  });
});

// --- formatDeployIndicator tests ---

describe("formatDeployIndicator", () => {
  it("shows green check for healthy", () => {
    const status: DashboardDeployStatus = {
      projectId: "proj-1",
      environment: "prod",
      state: "healthy",
      relativeTime: "2m ago",
    };
    const text = stripAnsi(formatDeployIndicator(status));
    expect(text).toContain("prod");
    expect(text).toContain("2m ago");
  });

  it("shows red X for failing", () => {
    const status: DashboardDeployStatus = {
      projectId: "proj-1",
      environment: "prod",
      state: "failing",
      relativeTime: "5m ago",
    };
    const text = stripAnsi(formatDeployIndicator(status));
    expect(text).toContain("prod");
    expect(text).toContain("5m ago");
  });

  it("shows deploying indicator", () => {
    const status: DashboardDeployStatus = {
      projectId: "proj-1",
      environment: "staging",
      state: "deploying",
      relativeTime: "just now",
    };
    const text = stripAnsi(formatDeployIndicator(status));
    expect(text).toContain("staging");
    expect(text).toContain("deploying...");
  });

  it("shows dimmed indicator for unknown", () => {
    const status: DashboardDeployStatus = {
      projectId: "proj-1",
      environment: "prod",
      state: "unknown",
      relativeTime: "1d ago",
    };
    const text = stripAnsi(formatDeployIndicator(status));
    expect(text).toContain("prod");
    expect(text).toContain("1d ago");
  });
});

// --- formatProjectLine with deploy status ---

describe("formatProjectLine with deploy status", () => {
  it("renders project without deploy status", () => {
    const project = makeProject();
    const line = stripAnsi(formatProjectLine(project, null, 120));
    expect(line).toContain("folia");
    expect(line).toContain("main");
    expect(line).toContain("clean");
    expect(line).not.toContain("prod");
  });

  it("renders project with healthy deploy status", () => {
    const project = makeProject();
    const status: DashboardDeployStatus = {
      projectId: "proj-1",
      environment: "prod",
      state: "healthy",
      relativeTime: "2m ago",
    };
    const line = stripAnsi(formatProjectLine(project, status, 120));
    expect(line).toContain("folia");
    expect(line).toContain("prod");
    expect(line).toContain("2m ago");
  });

  it("renders project with failing deploy status", () => {
    const project = makeProject();
    const status: DashboardDeployStatus = {
      projectId: "proj-1",
      environment: "prod",
      state: "failing",
      relativeTime: "5m ago",
    };
    const line = stripAnsi(formatProjectLine(project, status, 120));
    expect(line).toContain("prod");
  });

  it("renders project with deploying status", () => {
    const project = makeProject();
    const status: DashboardDeployStatus = {
      projectId: "proj-1",
      environment: "staging",
      state: "deploying",
      relativeTime: "just now",
    };
    const line = stripAnsi(formatProjectLine(project, status, 120));
    expect(line).toContain("staging");
    expect(line).toContain("deploying...");
  });

  it("truncates long lines", () => {
    const project = makeProject({ name: "very-long-project-name" });
    const status: DashboardDeployStatus = {
      projectId: "proj-1",
      environment: "prod",
      state: "healthy",
      relativeTime: "2m ago",
    };
    const line = stripAnsi(formatProjectLine(project, status, 40));
    expect(line.length).toBeLessThanOrEqual(40);
  });
});

// --- DashboardState deploy status ---

describe("DashboardState deployStatuses", () => {
  it("initializes with empty deploy statuses map", () => {
    const state = createDashboardState();
    expect(state.deployStatuses).toBeInstanceOf(Map);
    expect(state.deployStatuses.size).toBe(0);
  });
});

// --- formatDeploymentLine (L2 CI/CD pane) ---

describe("formatDeploymentLine", () => {
  it("shows commit ref for deployment", () => {
    const deployment = makeDeployment({ ref: "abc1234567890" });
    const text = stripAnsi(formatDeploymentLine(deployment, 120));
    expect(text).toContain("abc1234");
    expect(text).toContain("production");
  });

  it("shows LIVE label for active deployment", () => {
    const deployment = makeDeployment({ status: "active", ref: "abc1234" });
    const text = stripAnsi(formatDeploymentLine(deployment, 120));
    expect(text).toContain("LIVE");
    expect(text).toContain("active");
  });

  it("does not show LIVE for non-active deployment", () => {
    const deployment = makeDeployment({ status: "failed", ref: "abc1234" });
    const text = stripAnsi(formatDeploymentLine(deployment, 120));
    expect(text).not.toContain("LIVE");
    expect(text).toContain("failed");
  });

  it("shows short ref (first 7 chars)", () => {
    const deployment = makeDeployment({ ref: "abcdef1234567890" });
    const text = stripAnsi(formatDeploymentLine(deployment, 120));
    expect(text).toContain("abcdef1");
    expect(text).not.toContain("abcdef1234567890");
  });
});

// --- Deployment Detail View (L3) ---

describe("createDeploymentDetailState", () => {
  it("creates state with display lines for deployments", () => {
    const deployments = [
      makeDeployment({ id: "d1", environment: "production", status: "active", ref: "abc123" }),
      makeDeployment({ id: "d2", environment: "staging", status: "in_progress", ref: "def456" }),
    ];
    const state = createDeploymentDetailState(deployments, "folia");
    expect(state.projectName).toBe("folia");
    expect(state.deployments).toHaveLength(2);
    expect(state.displayLines.length).toBeGreaterThan(0);
    expect(state.scrollOffset).toBe(0);
  });

  it("shows empty state for no deployments", () => {
    const state = createDeploymentDetailState([], "folia");
    const text = state.displayLines.map(stripAnsi).join("\n");
    expect(text).toContain("No deployments found");
  });
});

describe("deployment detail display content", () => {
  it("groups deployments by environment", () => {
    const deployments = [
      makeDeployment({ id: "d1", environment: "production", status: "active", ref: "abc123" }),
      makeDeployment({ id: "d2", environment: "staging", status: "active", ref: "def456" }),
    ];
    const state = createDeploymentDetailState(deployments, "folia");
    const text = state.displayLines.map(stripAnsi).join("\n");
    expect(text).toContain("PRODUCTION");
    expect(text).toContain("STAGING");
  });

  it("shows LIVE label for active environment", () => {
    const deployments = [
      makeDeployment({ id: "d1", environment: "production", status: "active", ref: "abc123" }),
    ];
    const state = createDeploymentDetailState(deployments, "folia");
    const text = state.displayLines.map(stripAnsi).join("\n");
    expect(text).toContain("LIVE");
    expect(text).toContain("Live commit:");
    expect(text).toContain("abc123");
  });

  it("shows deploy history per environment", () => {
    const deployments = [
      makeDeployment({ id: "d1", environment: "production", status: "active", ref: "abc123",
        updatedAt: new Date(Date.now() - 60_000).toISOString() }),
      makeDeployment({ id: "d2", environment: "production", status: "inactive", ref: "old456",
        updatedAt: new Date(Date.now() - 3600_000).toISOString() }),
    ];
    const state = createDeploymentDetailState(deployments, "folia");
    const text = state.displayLines.map(stripAnsi).join("\n");
    expect(text).toContain("History (2)");
    expect(text).toContain("abc123");
    expect(text).toContain("old456");
  });

  it("orders environments by priority (production first)", () => {
    const deployments = [
      makeDeployment({ id: "d1", environment: "staging", status: "active" }),
      makeDeployment({ id: "d2", environment: "production", status: "active" }),
      makeDeployment({ id: "d3", environment: "preview", status: "active" }),
    ];
    const state = createDeploymentDetailState(deployments, "folia");
    const text = state.displayLines.map(stripAnsi).join("\n");
    const prodIdx = text.indexOf("PRODUCTION");
    const stagingIdx = text.indexOf("STAGING");
    const previewIdx = text.indexOf("PREVIEW");
    expect(prodIdx).toBeLessThan(stagingIdx);
    expect(stagingIdx).toBeLessThan(previewIdx);
  });

  it("shows commit sha for each deployment in history", () => {
    const deployments = [
      makeDeployment({ id: "d1", environment: "production", status: "active", ref: "commit1abc" }),
      makeDeployment({ id: "d2", environment: "production", status: "inactive", ref: "commit2def" }),
    ];
    const state = createDeploymentDetailState(deployments, "folia");
    const text = state.displayLines.map(stripAnsi).join("\n");
    expect(text).toContain("commit1");
    expect(text).toContain("commit2");
  });
});

describe("deployment detail scrolling", () => {
  it("scrolls down", () => {
    const deployments = Array.from({ length: 20 }, (_, i) =>
      makeDeployment({ id: `d${i}`, environment: "production", status: "active", ref: `ref${i}` }),
    );
    const state = createDeploymentDetailState(deployments, "folia");
    expect(state.scrollOffset).toBe(0);
    scrollDown(state, 5, 10);
    expect(state.scrollOffset).toBe(5);
  });

  it("scrolls up", () => {
    const deployments = Array.from({ length: 20 }, (_, i) =>
      makeDeployment({ id: `d${i}`, environment: "production", status: "active", ref: `ref${i}` }),
    );
    const state = createDeploymentDetailState(deployments, "folia");
    scrollDown(state, 10, 10);
    scrollUp(state, 3);
    expect(state.scrollOffset).toBe(7);
  });

  it("scrollToTop resets offset", () => {
    const deployments = Array.from({ length: 20 }, (_, i) =>
      makeDeployment({ id: `d${i}`, environment: "production", status: "active", ref: `ref${i}` }),
    );
    const state = createDeploymentDetailState(deployments, "folia");
    scrollDown(state, 10, 10);
    scrollToTop(state);
    expect(state.scrollOffset).toBe(0);
  });

  it("scrollToBottom goes to max offset", () => {
    const deployments = Array.from({ length: 20 }, (_, i) =>
      makeDeployment({ id: `d${i}`, environment: "production", status: "active", ref: `ref${i}` }),
    );
    const state = createDeploymentDetailState(deployments, "folia");
    scrollToBottom(state, 5);
    expect(state.scrollOffset).toBe(state.displayLines.length - 5);
  });
});
