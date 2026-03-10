"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
// Test the CI/CD event handling logic extracted from client.ts
// We can't easily instantiate TuiClient (it requires daemon/ws), so we test
// the event processing logic directly.
function makePipeline(overrides = {}) {
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
function makeDeployment(overrides = {}) {
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
function handlePipelineUpdated(cache, projectId, pipeline) {
    const pipelines = cache.get(projectId) ?? [];
    const pIdx = pipelines.findIndex((p) => p.id === pipeline.id);
    if (pIdx >= 0) {
        pipelines[pIdx] = pipeline;
    }
    else {
        pipelines.unshift(pipeline);
        if (pipelines.length > 20)
            pipelines.pop();
    }
    cache.set(projectId, pipelines);
}
// Simulate the deployment_updated handler from client.ts
function handleDeploymentUpdated(cache, projectId, deployment) {
    const deployments = cache.get(projectId) ?? [];
    const dIdx = deployments.findIndex((d) => d.id === deployment.id);
    if (dIdx >= 0) {
        deployments[dIdx] = deployment;
    }
    else {
        deployments.unshift(deployment);
    }
    cache.set(projectId, deployments);
}
(0, vitest_1.describe)("pipeline_updated event handling", () => {
    (0, vitest_1.it)("adds new pipeline to empty cache", () => {
        const cache = new Map();
        const pipeline = makePipeline({ id: "run-1" });
        handlePipelineUpdated(cache, "proj-1", pipeline);
        const cached = cache.get("proj-1");
        (0, vitest_1.expect)(cached).toHaveLength(1);
        (0, vitest_1.expect)(cached[0].id).toBe("run-1");
    });
    (0, vitest_1.it)("prepends new pipelines (most recent first)", () => {
        const cache = new Map();
        handlePipelineUpdated(cache, "proj-1", makePipeline({ id: "run-1" }));
        handlePipelineUpdated(cache, "proj-1", makePipeline({ id: "run-2" }));
        const cached = cache.get("proj-1");
        (0, vitest_1.expect)(cached).toHaveLength(2);
        (0, vitest_1.expect)(cached[0].id).toBe("run-2"); // most recent first
        (0, vitest_1.expect)(cached[1].id).toBe("run-1");
    });
    (0, vitest_1.it)("updates existing pipeline in place", () => {
        const cache = new Map();
        handlePipelineUpdated(cache, "proj-1", makePipeline({ id: "run-1", status: "in_progress" }));
        handlePipelineUpdated(cache, "proj-1", makePipeline({ id: "run-1", status: "success" }));
        const cached = cache.get("proj-1");
        (0, vitest_1.expect)(cached).toHaveLength(1);
        (0, vitest_1.expect)(cached[0].status).toBe("success");
    });
    (0, vitest_1.it)("caps cache at 20 pipelines", () => {
        const cache = new Map();
        for (let i = 0; i < 25; i++) {
            handlePipelineUpdated(cache, "proj-1", makePipeline({ id: `run-${i}` }));
        }
        const cached = cache.get("proj-1");
        (0, vitest_1.expect)(cached).toHaveLength(20);
        // Most recent (run-24) should be first
        (0, vitest_1.expect)(cached[0].id).toBe("run-24");
    });
    (0, vitest_1.it)("maintains separate caches per project", () => {
        const cache = new Map();
        handlePipelineUpdated(cache, "proj-1", makePipeline({ id: "r1" }));
        handlePipelineUpdated(cache, "proj-2", makePipeline({ id: "r2", projectId: "proj-2" }));
        (0, vitest_1.expect)(cache.get("proj-1")).toHaveLength(1);
        (0, vitest_1.expect)(cache.get("proj-2")).toHaveLength(1);
        (0, vitest_1.expect)(cache.get("proj-1")[0].id).toBe("r1");
        (0, vitest_1.expect)(cache.get("proj-2")[0].id).toBe("r2");
    });
});
(0, vitest_1.describe)("deployment_updated event handling", () => {
    (0, vitest_1.it)("adds new deployment to empty cache", () => {
        const cache = new Map();
        const deployment = makeDeployment({ id: "d1" });
        handleDeploymentUpdated(cache, "proj-1", deployment);
        const cached = cache.get("proj-1");
        (0, vitest_1.expect)(cached).toHaveLength(1);
        (0, vitest_1.expect)(cached[0].id).toBe("d1");
    });
    (0, vitest_1.it)("prepends new deployments", () => {
        const cache = new Map();
        handleDeploymentUpdated(cache, "proj-1", makeDeployment({ id: "d1" }));
        handleDeploymentUpdated(cache, "proj-1", makeDeployment({ id: "d2" }));
        const cached = cache.get("proj-1");
        (0, vitest_1.expect)(cached).toHaveLength(2);
        (0, vitest_1.expect)(cached[0].id).toBe("d2");
    });
    (0, vitest_1.it)("updates existing deployment in place", () => {
        const cache = new Map();
        handleDeploymentUpdated(cache, "proj-1", makeDeployment({ id: "d1", status: "pending" }));
        handleDeploymentUpdated(cache, "proj-1", makeDeployment({ id: "d1", status: "active" }));
        const cached = cache.get("proj-1");
        (0, vitest_1.expect)(cached).toHaveLength(1);
        (0, vitest_1.expect)(cached[0].status).toBe("active");
    });
    (0, vitest_1.it)("handles multiple environments", () => {
        const cache = new Map();
        handleDeploymentUpdated(cache, "proj-1", makeDeployment({ id: "d1", environment: "production" }));
        handleDeploymentUpdated(cache, "proj-1", makeDeployment({ id: "d2", environment: "staging" }));
        const cached = cache.get("proj-1");
        (0, vitest_1.expect)(cached).toHaveLength(2);
    });
});
// --- Layout integration test ---
(0, vitest_1.describe)("layout includes CI/CD panel", () => {
    (0, vitest_1.it)("L2 layout has cicd panel", async () => {
        const { getLayout } = await import("../../packages/cli/src/tui/layout.js");
        const layout = getLayout(2, 120, 40);
        const cicdPanel = layout.panels.find((p) => p.id === "cicd");
        (0, vitest_1.expect)(cicdPanel).toBeDefined();
        (0, vitest_1.expect)(cicdPanel.width).toBeGreaterThan(0);
        (0, vitest_1.expect)(cicdPanel.height).toBeGreaterThan(0);
    });
    (0, vitest_1.it)("L2 layout cicd panel is at bottom of right column", async () => {
        const { getLayout } = await import("../../packages/cli/src/tui/layout.js");
        const layout = getLayout(2, 120, 40);
        const panels = layout.panels;
        const cicdPanel = panels.find((p) => p.id === "cicd");
        const cloudPanel = panels.find((p) => p.id === "cloud");
        // CI/CD should be below cloud panel
        (0, vitest_1.expect)(cicdPanel.y).toBeGreaterThanOrEqual(cloudPanel.y + cloudPanel.height);
    });
    (0, vitest_1.it)("L1 and L3 layouts do not have cicd panel", async () => {
        const { getLayout } = await import("../../packages/cli/src/tui/layout.js");
        const l1 = getLayout(1, 120, 40);
        (0, vitest_1.expect)(l1.panels.find((p) => p.id === "cicd")).toBeUndefined();
        const l3 = getLayout(3, 120, 40);
        (0, vitest_1.expect)(l3.panels.find((p) => p.id === "cicd")).toBeUndefined();
    });
});
//# sourceMappingURL=client-cicd.test.js.map