import { describe, it, expect, vi, beforeEach } from "vitest";
import { CICDPoller } from "@opcom/core";
import type {
  CICDAdapter,
  CICDEvent,
  Pipeline,
  DeploymentStatus,
  ProjectConfig,
  Disposable,
} from "@opcom/types";

// --- Mock helpers ---

function makePipeline(overrides: Partial<Pipeline> = {}): Pipeline {
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

function makeDeployment(overrides: Partial<DeploymentStatus> = {}): DeploymentStatus {
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

function makeProject(id = "proj-1"): ProjectConfig {
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

class MockCICDAdapter implements CICDAdapter {
  provider = "github-actions" as const;

  pipelines: Pipeline[] = [makePipeline()];
  deployments: DeploymentStatus[] = [makeDeployment()];
  watchCallbacks: Array<(event: CICDEvent) => void> = [];
  watchDisposeCalls = 0;

  async detect(): Promise<boolean> {
    return true;
  }

  async listPipelines(): Promise<Pipeline[]> {
    return this.pipelines;
  }

  async getPipeline(_proj: ProjectConfig, id: string): Promise<Pipeline> {
    return this.pipelines.find((p) => p.id === id) ?? makePipeline({ id });
  }

  async listDeployments(): Promise<DeploymentStatus[]> {
    return this.deployments;
  }

  watch(_project: ProjectConfig, callback: (event: CICDEvent) => void): Disposable {
    this.watchCallbacks.push(callback);
    return {
      dispose: () => {
        this.watchDisposeCalls++;
        const idx = this.watchCallbacks.indexOf(callback);
        if (idx >= 0) this.watchCallbacks.splice(idx, 1);
      },
    };
  }

  // Simulate an event from the watcher
  emitEvent(event: CICDEvent): void {
    for (const cb of this.watchCallbacks) cb(event);
  }
}

// --- Tests ---

describe("CICDPoller", () => {
  let adapter: MockCICDAdapter;
  let poller: CICDPoller;

  beforeEach(() => {
    adapter = new MockCICDAdapter();
    poller = new CICDPoller(adapter);
  });

  describe("track", () => {
    it("fetches initial pipelines and deployments", async () => {
      const project = makeProject();
      const state = await poller.track(project);

      expect(state.projectId).toBe("proj-1");
      expect(state.pipelines).toHaveLength(1);
      expect(state.pipelines[0].id).toBe("run-1");
      expect(state.deployments).toHaveLength(1);
      expect(state.deployments[0].environment).toBe("production");
      expect(state.lastFetchedAt).toBeTruthy();
    });

    it("starts a watcher on the adapter", async () => {
      const project = makeProject();
      await poller.track(project);

      expect(adapter.watchCallbacks).toHaveLength(1);
    });

    it("returns cached state if already tracking", async () => {
      const project = makeProject();
      const state1 = await poller.track(project);
      const state2 = await poller.track(project);

      expect(state1).toBe(state2); // same reference
      expect(adapter.watchCallbacks).toHaveLength(1); // only one watcher
    });
  });

  describe("untrack", () => {
    it("disposes the watcher and clears state", async () => {
      const project = makeProject();
      await poller.track(project);

      poller.untrack("proj-1");

      expect(adapter.watchDisposeCalls).toBe(1);
      expect(poller.getState("proj-1")).toBeUndefined();
      expect(poller.trackedProjects()).toEqual([]);
    });

    it("is safe to call for untracked project", () => {
      expect(() => poller.untrack("nonexistent")).not.toThrow();
    });
  });

  describe("getState", () => {
    it("returns undefined for untracked project", () => {
      expect(poller.getState("proj-1")).toBeUndefined();
    });

    it("returns state for tracked project", async () => {
      await poller.track(makeProject());
      const state = poller.getState("proj-1");
      expect(state).toBeDefined();
      expect(state!.projectId).toBe("proj-1");
    });
  });

  describe("trackedProjects", () => {
    it("returns empty list initially", () => {
      expect(poller.trackedProjects()).toEqual([]);
    });

    it("returns tracked project IDs", async () => {
      await poller.track(makeProject("proj-1"));
      await poller.track(makeProject("proj-2"));
      expect(poller.trackedProjects()).toEqual(["proj-1", "proj-2"]);
    });
  });

  describe("refresh", () => {
    it("updates cached state with fresh data", async () => {
      const project = makeProject();
      await poller.track(project);

      // Change what the adapter returns
      adapter.pipelines = [makePipeline({ id: "run-2", status: "failure" })];
      adapter.deployments = [];

      const updated = await poller.refresh(project);
      expect(updated.pipelines).toHaveLength(1);
      expect(updated.pipelines[0].id).toBe("run-2");
      expect(updated.deployments).toHaveLength(0);
    });
  });

  describe("event handling", () => {
    it("updates pipeline state when adapter emits pipeline_updated", async () => {
      const project = makeProject();
      await poller.track(project);

      const updatedPipeline = makePipeline({ id: "run-1", status: "failure" });
      adapter.emitEvent({ type: "pipeline_updated", pipeline: updatedPipeline });

      const state = poller.getState("proj-1");
      expect(state!.pipelines[0].status).toBe("failure");
    });

    it("adds new pipeline if not found in state", async () => {
      const project = makeProject();
      await poller.track(project);

      const newPipeline = makePipeline({ id: "run-2", status: "in_progress" });
      adapter.emitEvent({ type: "pipeline_updated", pipeline: newPipeline });

      const state = poller.getState("proj-1");
      expect(state!.pipelines).toHaveLength(2);
      expect(state!.pipelines[0].id).toBe("run-2"); // prepended
    });

    it("trims pipeline list to 10 entries", async () => {
      adapter.pipelines = Array.from({ length: 10 }, (_, i) =>
        makePipeline({ id: `run-${i}` }),
      );
      const project = makeProject();
      await poller.track(project);

      const newPipeline = makePipeline({ id: "run-new" });
      adapter.emitEvent({ type: "pipeline_updated", pipeline: newPipeline });

      const state = poller.getState("proj-1");
      expect(state!.pipelines).toHaveLength(10);
      expect(state!.pipelines[0].id).toBe("run-new");
    });

    it("updates deployment state when adapter emits deployment_updated", async () => {
      const project = makeProject();
      await poller.track(project);

      const updatedDep = makeDeployment({ id: "dep-1", status: "failed" });
      adapter.emitEvent({ type: "deployment_updated", deployment: updatedDep });

      const state = poller.getState("proj-1");
      expect(state!.deployments[0].status).toBe("failed");
    });

    it("adds new deployment if not found", async () => {
      const project = makeProject();
      await poller.track(project);

      const newDep = makeDeployment({ id: "dep-2", environment: "staging", status: "pending" });
      adapter.emitEvent({ type: "deployment_updated", deployment: newDep });

      const state = poller.getState("proj-1");
      expect(state!.deployments).toHaveLength(2);
    });

    it("notifies listeners of events", async () => {
      const project = makeProject();
      await poller.track(project);

      const events: Array<{ projectId: string; event: CICDEvent }> = [];
      poller.onEvent((projectId, event) => {
        events.push({ projectId, event });
      });

      const pipeline = makePipeline({ id: "run-1", status: "failure" });
      adapter.emitEvent({ type: "pipeline_updated", pipeline });

      expect(events).toHaveLength(1);
      expect(events[0].projectId).toBe("proj-1");
      expect(events[0].event.type).toBe("pipeline_updated");
    });

    it("listener can be disposed", async () => {
      const project = makeProject();
      await poller.track(project);

      const events: CICDEvent[] = [];
      const sub = poller.onEvent((_pid, event) => events.push(event));

      adapter.emitEvent({ type: "pipeline_updated", pipeline: makePipeline({ status: "failure" }) });
      expect(events).toHaveLength(1);

      sub.dispose();
      adapter.emitEvent({ type: "pipeline_updated", pipeline: makePipeline({ status: "success" }) });
      expect(events).toHaveLength(1); // no new event after dispose
    });
  });

  describe("dispose", () => {
    it("stops all watchers and clears state", async () => {
      await poller.track(makeProject("proj-1"));
      await poller.track(makeProject("proj-2"));

      poller.dispose();

      expect(adapter.watchDisposeCalls).toBe(2);
      expect(poller.trackedProjects()).toEqual([]);
      expect(poller.getState("proj-1")).toBeUndefined();
      expect(poller.getState("proj-2")).toBeUndefined();
    });
  });
});
