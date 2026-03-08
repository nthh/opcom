import { describe, it, expect } from "vitest";
import type { Pipeline, DeploymentStatus, ServerEvent } from "@opcom/types";

// Test the CI/CD event handling logic extracted from client.ts
// We can't easily instantiate TuiClient (it requires daemon/ws), so we test
// the event processing logic directly.

function makePipeline(overrides: Partial<Pipeline> = {}): Pipeline {
  return {
    id: "run-1",
    projectId: "proj-1",
    provider: "github-actions",
    name: "CI",
    ref: "refs/heads/main",
    commitSha: "abc1234",
    status: "success",
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
    createdAt: "2026-03-07T00:00:00Z",
    updatedAt: "2026-03-07T00:00:00Z",
    ...overrides,
  };
}

// Simulate the pipeline_updated handler from client.ts
function handlePipelineUpdated(
  cache: Map<string, Pipeline[]>,
  projectId: string,
  pipeline: Pipeline,
): void {
  const pipelines = cache.get(projectId) ?? [];
  const pIdx = pipelines.findIndex((p) => p.id === pipeline.id);
  if (pIdx >= 0) {
    pipelines[pIdx] = pipeline;
  } else {
    pipelines.unshift(pipeline);
    if (pipelines.length > 20) pipelines.pop();
  }
  cache.set(projectId, pipelines);
}

// Simulate the deployment_updated handler from client.ts
function handleDeploymentUpdated(
  cache: Map<string, DeploymentStatus[]>,
  projectId: string,
  deployment: DeploymentStatus,
): void {
  const deployments = cache.get(projectId) ?? [];
  const dIdx = deployments.findIndex((d) => d.id === deployment.id);
  if (dIdx >= 0) {
    deployments[dIdx] = deployment;
  } else {
    deployments.unshift(deployment);
  }
  cache.set(projectId, deployments);
}

describe("pipeline_updated event handling", () => {
  it("adds new pipeline to empty cache", () => {
    const cache = new Map<string, Pipeline[]>();
    const pipeline = makePipeline({ id: "run-1" });
    handlePipelineUpdated(cache, "proj-1", pipeline);

    const cached = cache.get("proj-1")!;
    expect(cached).toHaveLength(1);
    expect(cached[0].id).toBe("run-1");
  });

  it("prepends new pipelines (most recent first)", () => {
    const cache = new Map<string, Pipeline[]>();
    handlePipelineUpdated(cache, "proj-1", makePipeline({ id: "run-1" }));
    handlePipelineUpdated(cache, "proj-1", makePipeline({ id: "run-2" }));

    const cached = cache.get("proj-1")!;
    expect(cached).toHaveLength(2);
    expect(cached[0].id).toBe("run-2"); // most recent first
    expect(cached[1].id).toBe("run-1");
  });

  it("updates existing pipeline in place", () => {
    const cache = new Map<string, Pipeline[]>();
    handlePipelineUpdated(cache, "proj-1", makePipeline({ id: "run-1", status: "in_progress" }));
    handlePipelineUpdated(cache, "proj-1", makePipeline({ id: "run-1", status: "success" }));

    const cached = cache.get("proj-1")!;
    expect(cached).toHaveLength(1);
    expect(cached[0].status).toBe("success");
  });

  it("caps cache at 20 pipelines", () => {
    const cache = new Map<string, Pipeline[]>();
    for (let i = 0; i < 25; i++) {
      handlePipelineUpdated(cache, "proj-1", makePipeline({ id: `run-${i}` }));
    }

    const cached = cache.get("proj-1")!;
    expect(cached).toHaveLength(20);
    // Most recent (run-24) should be first
    expect(cached[0].id).toBe("run-24");
  });

  it("maintains separate caches per project", () => {
    const cache = new Map<string, Pipeline[]>();
    handlePipelineUpdated(cache, "proj-1", makePipeline({ id: "r1" }));
    handlePipelineUpdated(cache, "proj-2", makePipeline({ id: "r2", projectId: "proj-2" }));

    expect(cache.get("proj-1")!).toHaveLength(1);
    expect(cache.get("proj-2")!).toHaveLength(1);
    expect(cache.get("proj-1")![0].id).toBe("r1");
    expect(cache.get("proj-2")![0].id).toBe("r2");
  });
});

describe("deployment_updated event handling", () => {
  it("adds new deployment to empty cache", () => {
    const cache = new Map<string, DeploymentStatus[]>();
    const deployment = makeDeployment({ id: "d1" });
    handleDeploymentUpdated(cache, "proj-1", deployment);

    const cached = cache.get("proj-1")!;
    expect(cached).toHaveLength(1);
    expect(cached[0].id).toBe("d1");
  });

  it("prepends new deployments", () => {
    const cache = new Map<string, DeploymentStatus[]>();
    handleDeploymentUpdated(cache, "proj-1", makeDeployment({ id: "d1" }));
    handleDeploymentUpdated(cache, "proj-1", makeDeployment({ id: "d2" }));

    const cached = cache.get("proj-1")!;
    expect(cached).toHaveLength(2);
    expect(cached[0].id).toBe("d2");
  });

  it("updates existing deployment in place", () => {
    const cache = new Map<string, DeploymentStatus[]>();
    handleDeploymentUpdated(cache, "proj-1", makeDeployment({ id: "d1", status: "pending" }));
    handleDeploymentUpdated(cache, "proj-1", makeDeployment({ id: "d1", status: "active" }));

    const cached = cache.get("proj-1")!;
    expect(cached).toHaveLength(1);
    expect(cached[0].status).toBe("active");
  });

  it("handles multiple environments", () => {
    const cache = new Map<string, DeploymentStatus[]>();
    handleDeploymentUpdated(cache, "proj-1", makeDeployment({ id: "d1", environment: "production" }));
    handleDeploymentUpdated(cache, "proj-1", makeDeployment({ id: "d2", environment: "staging" }));

    const cached = cache.get("proj-1")!;
    expect(cached).toHaveLength(2);
  });
});

// --- Layout integration test ---

describe("layout includes CI/CD panel", () => {
  it("L2 layout has cicd panel", async () => {
    const { getLayout } = await import("../../packages/cli/src/tui/layout.js");
    const layout = getLayout(2, 120, 40);
    const cicdPanel = layout.panels.find((p) => p.id === "cicd");
    expect(cicdPanel).toBeDefined();
    expect(cicdPanel!.width).toBeGreaterThan(0);
    expect(cicdPanel!.height).toBeGreaterThan(0);
  });

  it("L2 layout cicd panel is at bottom of right column", async () => {
    const { getLayout } = await import("../../packages/cli/src/tui/layout.js");
    const layout = getLayout(2, 120, 40);
    const panels = layout.panels;
    const cicdPanel = panels.find((p) => p.id === "cicd")!;
    const cloudPanel = panels.find((p) => p.id === "cloud")!;

    // CI/CD should be below cloud panel
    expect(cicdPanel.y).toBeGreaterThanOrEqual(cloudPanel.y + cloudPanel.height);
  });

  it("L1 and L3 layouts do not have cicd panel", async () => {
    const { getLayout } = await import("../../packages/cli/src/tui/layout.js");

    const l1 = getLayout(1, 120, 40);
    expect(l1.panels.find((p) => p.id === "cicd")).toBeUndefined();

    const l3 = getLayout(3, 120, 40);
    expect(l3.panels.find((p) => p.id === "cicd")).toBeUndefined();
  });
});
