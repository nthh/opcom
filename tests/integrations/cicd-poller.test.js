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
function makeProject(id = "proj-1") {
    return {
        id,
        name: "test-project",
        path: "/tmp/test-project",
        stack: { languages: [], frameworks: [], packageManagers: [], infrastructure: [], versionManagers: [] },
        git: { remote: "git@github.com:org/repo.git", branch: "main", clean: true },
        workSystem: null,
        docs: {},
        services: [],
        environments: [],
        testing: null,
        linting: [],
        subProjects: [],
        cloudServices: [],
        lastScannedAt: "2026-01-15T10:00:00Z",
    };
}
class MockCICDAdapter {
    provider = "github-actions";
    pipelines = [makePipeline()];
    deployments = [makeDeployment()];
    watchCallbacks = [];
    watchDisposeCalls = 0;
    async detect() {
        return true;
    }
    async listPipelines() {
        return this.pipelines;
    }
    async getPipeline(_proj, id) {
        return this.pipelines.find((p) => p.id === id) ?? makePipeline({ id });
    }
    async listDeployments() {
        return this.deployments;
    }
    watch(_project, callback) {
        this.watchCallbacks.push(callback);
        return {
            dispose: () => {
                this.watchDisposeCalls++;
                const idx = this.watchCallbacks.indexOf(callback);
                if (idx >= 0)
                    this.watchCallbacks.splice(idx, 1);
            },
        };
    }
    // Simulate an event from the watcher
    emitEvent(event) {
        for (const cb of this.watchCallbacks)
            cb(event);
    }
}
// --- Tests ---
(0, vitest_1.describe)("CICDPoller", () => {
    let adapter;
    let poller;
    (0, vitest_1.beforeEach)(() => {
        adapter = new MockCICDAdapter();
        poller = new core_1.CICDPoller(adapter);
    });
    (0, vitest_1.describe)("track", () => {
        (0, vitest_1.it)("fetches initial pipelines and deployments", async () => {
            const project = makeProject();
            const state = await poller.track(project);
            (0, vitest_1.expect)(state.projectId).toBe("proj-1");
            (0, vitest_1.expect)(state.pipelines).toHaveLength(1);
            (0, vitest_1.expect)(state.pipelines[0].id).toBe("run-1");
            (0, vitest_1.expect)(state.deployments).toHaveLength(1);
            (0, vitest_1.expect)(state.deployments[0].environment).toBe("production");
            (0, vitest_1.expect)(state.lastFetchedAt).toBeTruthy();
        });
        (0, vitest_1.it)("starts a watcher on the adapter", async () => {
            const project = makeProject();
            await poller.track(project);
            (0, vitest_1.expect)(adapter.watchCallbacks).toHaveLength(1);
        });
        (0, vitest_1.it)("returns cached state if already tracking", async () => {
            const project = makeProject();
            const state1 = await poller.track(project);
            const state2 = await poller.track(project);
            (0, vitest_1.expect)(state1).toBe(state2); // same reference
            (0, vitest_1.expect)(adapter.watchCallbacks).toHaveLength(1); // only one watcher
        });
    });
    (0, vitest_1.describe)("untrack", () => {
        (0, vitest_1.it)("disposes the watcher and clears state", async () => {
            const project = makeProject();
            await poller.track(project);
            poller.untrack("proj-1");
            (0, vitest_1.expect)(adapter.watchDisposeCalls).toBe(1);
            (0, vitest_1.expect)(poller.getState("proj-1")).toBeUndefined();
            (0, vitest_1.expect)(poller.trackedProjects()).toEqual([]);
        });
        (0, vitest_1.it)("is safe to call for untracked project", () => {
            (0, vitest_1.expect)(() => poller.untrack("nonexistent")).not.toThrow();
        });
    });
    (0, vitest_1.describe)("getState", () => {
        (0, vitest_1.it)("returns undefined for untracked project", () => {
            (0, vitest_1.expect)(poller.getState("proj-1")).toBeUndefined();
        });
        (0, vitest_1.it)("returns state for tracked project", async () => {
            await poller.track(makeProject());
            const state = poller.getState("proj-1");
            (0, vitest_1.expect)(state).toBeDefined();
            (0, vitest_1.expect)(state.projectId).toBe("proj-1");
        });
    });
    (0, vitest_1.describe)("trackedProjects", () => {
        (0, vitest_1.it)("returns empty list initially", () => {
            (0, vitest_1.expect)(poller.trackedProjects()).toEqual([]);
        });
        (0, vitest_1.it)("returns tracked project IDs", async () => {
            await poller.track(makeProject("proj-1"));
            await poller.track(makeProject("proj-2"));
            (0, vitest_1.expect)(poller.trackedProjects()).toEqual(["proj-1", "proj-2"]);
        });
    });
    (0, vitest_1.describe)("refresh", () => {
        (0, vitest_1.it)("updates cached state with fresh data", async () => {
            const project = makeProject();
            await poller.track(project);
            // Change what the adapter returns
            adapter.pipelines = [makePipeline({ id: "run-2", status: "failure" })];
            adapter.deployments = [];
            const updated = await poller.refresh(project);
            (0, vitest_1.expect)(updated.pipelines).toHaveLength(1);
            (0, vitest_1.expect)(updated.pipelines[0].id).toBe("run-2");
            (0, vitest_1.expect)(updated.deployments).toHaveLength(0);
        });
    });
    (0, vitest_1.describe)("event handling", () => {
        (0, vitest_1.it)("updates pipeline state when adapter emits pipeline_updated", async () => {
            const project = makeProject();
            await poller.track(project);
            const updatedPipeline = makePipeline({ id: "run-1", status: "failure" });
            adapter.emitEvent({ type: "pipeline_updated", pipeline: updatedPipeline });
            const state = poller.getState("proj-1");
            (0, vitest_1.expect)(state.pipelines[0].status).toBe("failure");
        });
        (0, vitest_1.it)("adds new pipeline if not found in state", async () => {
            const project = makeProject();
            await poller.track(project);
            const newPipeline = makePipeline({ id: "run-2", status: "in_progress" });
            adapter.emitEvent({ type: "pipeline_updated", pipeline: newPipeline });
            const state = poller.getState("proj-1");
            (0, vitest_1.expect)(state.pipelines).toHaveLength(2);
            (0, vitest_1.expect)(state.pipelines[0].id).toBe("run-2"); // prepended
        });
        (0, vitest_1.it)("trims pipeline list to 10 entries", async () => {
            adapter.pipelines = Array.from({ length: 10 }, (_, i) => makePipeline({ id: `run-${i}` }));
            const project = makeProject();
            await poller.track(project);
            const newPipeline = makePipeline({ id: "run-new" });
            adapter.emitEvent({ type: "pipeline_updated", pipeline: newPipeline });
            const state = poller.getState("proj-1");
            (0, vitest_1.expect)(state.pipelines).toHaveLength(10);
            (0, vitest_1.expect)(state.pipelines[0].id).toBe("run-new");
        });
        (0, vitest_1.it)("updates deployment state when adapter emits deployment_updated", async () => {
            const project = makeProject();
            await poller.track(project);
            const updatedDep = makeDeployment({ id: "dep-1", status: "failed" });
            adapter.emitEvent({ type: "deployment_updated", deployment: updatedDep });
            const state = poller.getState("proj-1");
            (0, vitest_1.expect)(state.deployments[0].status).toBe("failed");
        });
        (0, vitest_1.it)("adds new deployment if not found", async () => {
            const project = makeProject();
            await poller.track(project);
            const newDep = makeDeployment({ id: "dep-2", environment: "staging", status: "pending" });
            adapter.emitEvent({ type: "deployment_updated", deployment: newDep });
            const state = poller.getState("proj-1");
            (0, vitest_1.expect)(state.deployments).toHaveLength(2);
        });
        (0, vitest_1.it)("notifies listeners of events", async () => {
            const project = makeProject();
            await poller.track(project);
            const events = [];
            poller.onEvent((projectId, event) => {
                events.push({ projectId, event });
            });
            const pipeline = makePipeline({ id: "run-1", status: "failure" });
            adapter.emitEvent({ type: "pipeline_updated", pipeline });
            (0, vitest_1.expect)(events).toHaveLength(1);
            (0, vitest_1.expect)(events[0].projectId).toBe("proj-1");
            (0, vitest_1.expect)(events[0].event.type).toBe("pipeline_updated");
        });
        (0, vitest_1.it)("listener can be disposed", async () => {
            const project = makeProject();
            await poller.track(project);
            const events = [];
            const sub = poller.onEvent((_pid, event) => events.push(event));
            adapter.emitEvent({ type: "pipeline_updated", pipeline: makePipeline({ status: "failure" }) });
            (0, vitest_1.expect)(events).toHaveLength(1);
            sub.dispose();
            adapter.emitEvent({ type: "pipeline_updated", pipeline: makePipeline({ status: "success" }) });
            (0, vitest_1.expect)(events).toHaveLength(1); // no new event after dispose
        });
    });
    (0, vitest_1.describe)("dispose", () => {
        (0, vitest_1.it)("stops all watchers and clears state", async () => {
            await poller.track(makeProject("proj-1"));
            await poller.track(makeProject("proj-2"));
            poller.dispose();
            (0, vitest_1.expect)(adapter.watchDisposeCalls).toBe(2);
            (0, vitest_1.expect)(poller.trackedProjects()).toEqual([]);
            (0, vitest_1.expect)(poller.getState("proj-1")).toBeUndefined();
            (0, vitest_1.expect)(poller.getState("proj-2")).toBeUndefined();
        });
    });
});
//# sourceMappingURL=cicd-poller.test.js.map