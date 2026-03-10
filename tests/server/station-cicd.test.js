"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const core_1 = require("@opcom/core");
// --- Mock helpers ---
function makePipeline(overrides = {}) {
    return {
        id: "run-1",
        projectId: "proj-1",
        provider: "github-actions",
        name: "CI",
        ref: "main",
        commitSha: "abc123",
        status: "success",
        url: "https://github.com/org/repo/actions/runs/1",
        jobs: [],
        ...overrides,
    };
}
function makeDeployment(overrides = {}) {
    return {
        id: "dep-1",
        projectId: "proj-1",
        provider: "github-actions",
        environment: "production",
        ref: "main",
        status: "active",
        createdAt: "2026-01-15T10:00:00Z",
        updatedAt: "2026-01-15T10:01:00Z",
        ...overrides,
    };
}
const mockProject = {
    id: "proj-1",
    name: "test-project",
    path: "/tmp/test-project",
    git: { branch: "main", clean: true, remote: "git@github.com:org/repo.git" },
    stack: {
        languages: [],
        frameworks: [],
        packageManagers: [],
        infra: [],
        versionManagers: [],
    },
    detectedAt: "2026-01-01T00:00:00Z",
};
function createMockAdapter(pipelines, deployments) {
    let watchCallback = null;
    return {
        provider: "github-actions",
        detect: vitest_1.vi.fn().mockResolvedValue(true),
        listPipelines: vitest_1.vi.fn().mockResolvedValue(pipelines),
        getPipeline: vitest_1.vi.fn().mockImplementation(async (_proj, id) => {
            const found = pipelines.find((p) => p.id === id);
            if (!found)
                throw new Error("Pipeline not found");
            return { ...found, jobs: [{ id: "j1", name: "build", status: "success", steps: [] }] };
        }),
        listDeployments: vitest_1.vi.fn().mockResolvedValue(deployments),
        watch: vitest_1.vi.fn().mockImplementation((_project, cb) => {
            watchCallback = cb;
            return { dispose: () => { watchCallback = null; } };
        }),
        _emitEvent(event) {
            if (watchCallback)
                watchCallback(event);
        },
    };
}
(0, vitest_1.describe)("CICDPoller integration with Station patterns", () => {
    const pipelines = [
        makePipeline({ id: "run-1", status: "success" }),
        makePipeline({ id: "run-2", status: "in_progress", name: "Deploy" }),
    ];
    const deployments = [makeDeployment()];
    let adapter;
    let poller;
    (0, vitest_1.beforeEach)(() => {
        adapter = createMockAdapter(pipelines, deployments);
        poller = new core_1.CICDPoller(adapter);
    });
    (0, vitest_1.it)("tracks a project and caches pipelines + deployments", async () => {
        const state = await poller.track(mockProject);
        (0, vitest_1.expect)(state.projectId).toBe("proj-1");
        (0, vitest_1.expect)(state.pipelines).toHaveLength(2);
        (0, vitest_1.expect)(state.deployments).toHaveLength(1);
        (0, vitest_1.expect)(state.pipelines[0].status).toBe("success");
        (0, vitest_1.expect)(state.deployments[0].environment).toBe("production");
    });
    (0, vitest_1.it)("getState returns cached state after tracking", async () => {
        await poller.track(mockProject);
        const state = poller.getState("proj-1");
        (0, vitest_1.expect)(state).toBeDefined();
        (0, vitest_1.expect)(state.pipelines).toHaveLength(2);
    });
    (0, vitest_1.it)("getState returns undefined for untracked project", () => {
        (0, vitest_1.expect)(poller.getState("nonexistent")).toBeUndefined();
    });
    (0, vitest_1.it)("emits pipeline_updated events to listeners", async () => {
        const events = [];
        poller.onEvent((projectId, event) => events.push({ projectId, event }));
        await poller.track(mockProject);
        const updatedPipeline = makePipeline({ id: "run-2", status: "success", name: "Deploy" });
        adapter._emitEvent({ type: "pipeline_updated", pipeline: updatedPipeline });
        (0, vitest_1.expect)(events).toHaveLength(1);
        (0, vitest_1.expect)(events[0].projectId).toBe("proj-1");
        (0, vitest_1.expect)(events[0].event.type).toBe("pipeline_updated");
    });
    (0, vitest_1.it)("emits deployment_updated events to listeners", async () => {
        const events = [];
        poller.onEvent((projectId, event) => events.push({ projectId, event }));
        await poller.track(mockProject);
        const updatedDeploy = makeDeployment({ id: "dep-2", environment: "staging", status: "in_progress" });
        adapter._emitEvent({ type: "deployment_updated", deployment: updatedDeploy });
        (0, vitest_1.expect)(events).toHaveLength(1);
        (0, vitest_1.expect)(events[0].event.type).toBe("deployment_updated");
    });
    (0, vitest_1.it)("updates cached state when pipeline events arrive", async () => {
        await poller.track(mockProject);
        const updatedPipeline = makePipeline({ id: "run-2", status: "failure", name: "Deploy" });
        adapter._emitEvent({ type: "pipeline_updated", pipeline: updatedPipeline });
        const state = poller.getState("proj-1");
        const run2 = state.pipelines.find((p) => p.id === "run-2");
        (0, vitest_1.expect)(run2?.status).toBe("failure");
    });
    (0, vitest_1.it)("updates cached state when deployment events arrive", async () => {
        await poller.track(mockProject);
        const updatedDeploy = makeDeployment({ id: "dep-1", status: "inactive" });
        adapter._emitEvent({ type: "deployment_updated", deployment: updatedDeploy });
        const state = poller.getState("proj-1");
        const dep = state.deployments.find((d) => d.id === "dep-1");
        (0, vitest_1.expect)(dep?.status).toBe("inactive");
    });
    (0, vitest_1.it)("adds new pipelines to cached state", async () => {
        await poller.track(mockProject);
        const newPipeline = makePipeline({ id: "run-3", status: "queued", name: "New Run" });
        adapter._emitEvent({ type: "pipeline_updated", pipeline: newPipeline });
        const state = poller.getState("proj-1");
        (0, vitest_1.expect)(state.pipelines).toHaveLength(3);
        (0, vitest_1.expect)(state.pipelines[0].id).toBe("run-3"); // prepended
    });
    (0, vitest_1.it)("disposes all watchers and clears state", async () => {
        await poller.track(mockProject);
        (0, vitest_1.expect)(poller.getState("proj-1")).toBeDefined();
        poller.dispose();
        (0, vitest_1.expect)(poller.getState("proj-1")).toBeUndefined();
        (0, vitest_1.expect)(poller.trackedProjects()).toHaveLength(0);
    });
    (0, vitest_1.it)("untrack removes watcher and state for a project", async () => {
        await poller.track(mockProject);
        (0, vitest_1.expect)(poller.trackedProjects()).toContain("proj-1");
        poller.untrack("proj-1");
        (0, vitest_1.expect)(poller.getState("proj-1")).toBeUndefined();
        (0, vitest_1.expect)(poller.trackedProjects()).not.toContain("proj-1");
    });
    (0, vitest_1.it)("event listener disposal prevents further callbacks", async () => {
        const events = [];
        const sub = poller.onEvent((_pid, event) => events.push(event));
        await poller.track(mockProject);
        // Emit before dispose
        adapter._emitEvent({ type: "pipeline_updated", pipeline: makePipeline({ id: "run-2", status: "success" }) });
        (0, vitest_1.expect)(events).toHaveLength(1);
        // Dispose and emit again
        sub.dispose();
        adapter._emitEvent({ type: "pipeline_updated", pipeline: makePipeline({ id: "run-2", status: "failure" }) });
        (0, vitest_1.expect)(events).toHaveLength(1); // no new events
    });
    (0, vitest_1.it)("returns existing state on duplicate track", async () => {
        const state1 = await poller.track(mockProject);
        const state2 = await poller.track(mockProject);
        (0, vitest_1.expect)(state1).toBe(state2);
        (0, vitest_1.expect)(adapter.listPipelines).toHaveBeenCalledTimes(1); // only fetched once
    });
    (0, vitest_1.it)("refresh updates cached state", async () => {
        await poller.track(mockProject);
        const newPipelines = [makePipeline({ id: "run-99", status: "success", name: "Fresh" })];
        adapter.listPipelines.mockResolvedValueOnce(newPipelines);
        const refreshed = await poller.refresh(mockProject);
        (0, vitest_1.expect)(refreshed.pipelines).toHaveLength(1);
        (0, vitest_1.expect)(refreshed.pipelines[0].id).toBe("run-99");
    });
});
(0, vitest_1.describe)("ServerEvent shapes for CI/CD", () => {
    (0, vitest_1.it)("pipeline_updated event has correct shape", () => {
        const event = {
            type: "pipeline_updated",
            projectId: "proj-1",
            pipeline: makePipeline(),
        };
        (0, vitest_1.expect)(event.type).toBe("pipeline_updated");
        (0, vitest_1.expect)(event.projectId).toBe("proj-1");
        (0, vitest_1.expect)(event.pipeline.id).toBe("run-1");
        (0, vitest_1.expect)(event.pipeline.provider).toBe("github-actions");
    });
    (0, vitest_1.it)("deployment_updated event has correct shape", () => {
        const event = {
            type: "deployment_updated",
            projectId: "proj-1",
            deployment: makeDeployment(),
        };
        (0, vitest_1.expect)(event.type).toBe("deployment_updated");
        (0, vitest_1.expect)(event.deployment.environment).toBe("production");
        (0, vitest_1.expect)(event.deployment.status).toBe("active");
    });
});
//# sourceMappingURL=station-cicd.test.js.map