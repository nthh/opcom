import { describe, it, expect, vi, beforeEach } from "vitest";
import type {
  CICDAdapter,
  CICDEvent,
  Pipeline,
  DeploymentStatus,
  ProjectConfig,
  Disposable,
} from "@opcom/types";
import { CICDPoller } from "@opcom/core";
import type { ProjectCICDState } from "@opcom/core";

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

const mockProject: ProjectConfig = {
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

function createMockAdapter(pipelines: Pipeline[], deployments: DeploymentStatus[]): CICDAdapter {
  let watchCallback: ((event: CICDEvent) => void) | null = null;

  return {
    provider: "github-actions",
    detect: vi.fn().mockResolvedValue(true),
    listPipelines: vi.fn().mockResolvedValue(pipelines),
    getPipeline: vi.fn().mockImplementation(async (_proj, id) => {
      const found = pipelines.find((p) => p.id === id);
      if (!found) throw new Error("Pipeline not found");
      return { ...found, jobs: [{ id: "j1", name: "build", status: "success", steps: [] }] };
    }),
    listDeployments: vi.fn().mockResolvedValue(deployments),
    watch: vi.fn().mockImplementation((_project, cb) => {
      watchCallback = cb;
      return { dispose: () => { watchCallback = null; } };
    }),
    _emitEvent(event: CICDEvent) {
      if (watchCallback) watchCallback(event);
    },
  } as CICDAdapter & { _emitEvent: (event: CICDEvent) => void };
}

describe("CICDPoller integration with Station patterns", () => {
  const pipelines = [
    makePipeline({ id: "run-1", status: "success" }),
    makePipeline({ id: "run-2", status: "in_progress", name: "Deploy" }),
  ];
  const deployments = [makeDeployment()];

  let adapter: ReturnType<typeof createMockAdapter>;
  let poller: CICDPoller;

  beforeEach(() => {
    adapter = createMockAdapter(pipelines, deployments);
    poller = new CICDPoller(adapter);
  });

  it("tracks a project and caches pipelines + deployments", async () => {
    const state = await poller.track(mockProject);
    expect(state.projectId).toBe("proj-1");
    expect(state.pipelines).toHaveLength(2);
    expect(state.deployments).toHaveLength(1);
    expect(state.pipelines[0].status).toBe("success");
    expect(state.deployments[0].environment).toBe("production");
  });

  it("getState returns cached state after tracking", async () => {
    await poller.track(mockProject);
    const state = poller.getState("proj-1");
    expect(state).toBeDefined();
    expect(state!.pipelines).toHaveLength(2);
  });

  it("getState returns undefined for untracked project", () => {
    expect(poller.getState("nonexistent")).toBeUndefined();
  });

  it("emits pipeline_updated events to listeners", async () => {
    const events: Array<{ projectId: string; event: CICDEvent }> = [];
    poller.onEvent((projectId, event) => events.push({ projectId, event }));

    await poller.track(mockProject);

    const updatedPipeline = makePipeline({ id: "run-2", status: "success", name: "Deploy" });
    adapter._emitEvent({ type: "pipeline_updated", pipeline: updatedPipeline });

    expect(events).toHaveLength(1);
    expect(events[0].projectId).toBe("proj-1");
    expect(events[0].event.type).toBe("pipeline_updated");
  });

  it("emits deployment_updated events to listeners", async () => {
    const events: Array<{ projectId: string; event: CICDEvent }> = [];
    poller.onEvent((projectId, event) => events.push({ projectId, event }));

    await poller.track(mockProject);

    const updatedDeploy = makeDeployment({ id: "dep-2", environment: "staging", status: "in_progress" });
    adapter._emitEvent({ type: "deployment_updated", deployment: updatedDeploy });

    expect(events).toHaveLength(1);
    expect(events[0].event.type).toBe("deployment_updated");
  });

  it("updates cached state when pipeline events arrive", async () => {
    await poller.track(mockProject);

    const updatedPipeline = makePipeline({ id: "run-2", status: "failure", name: "Deploy" });
    adapter._emitEvent({ type: "pipeline_updated", pipeline: updatedPipeline });

    const state = poller.getState("proj-1")!;
    const run2 = state.pipelines.find((p) => p.id === "run-2");
    expect(run2?.status).toBe("failure");
  });

  it("updates cached state when deployment events arrive", async () => {
    await poller.track(mockProject);

    const updatedDeploy = makeDeployment({ id: "dep-1", status: "inactive" });
    adapter._emitEvent({ type: "deployment_updated", deployment: updatedDeploy });

    const state = poller.getState("proj-1")!;
    const dep = state.deployments.find((d) => d.id === "dep-1");
    expect(dep?.status).toBe("inactive");
  });

  it("adds new pipelines to cached state", async () => {
    await poller.track(mockProject);

    const newPipeline = makePipeline({ id: "run-3", status: "queued", name: "New Run" });
    adapter._emitEvent({ type: "pipeline_updated", pipeline: newPipeline });

    const state = poller.getState("proj-1")!;
    expect(state.pipelines).toHaveLength(3);
    expect(state.pipelines[0].id).toBe("run-3"); // prepended
  });

  it("disposes all watchers and clears state", async () => {
    await poller.track(mockProject);
    expect(poller.getState("proj-1")).toBeDefined();

    poller.dispose();
    expect(poller.getState("proj-1")).toBeUndefined();
    expect(poller.trackedProjects()).toHaveLength(0);
  });

  it("untrack removes watcher and state for a project", async () => {
    await poller.track(mockProject);
    expect(poller.trackedProjects()).toContain("proj-1");

    poller.untrack("proj-1");
    expect(poller.getState("proj-1")).toBeUndefined();
    expect(poller.trackedProjects()).not.toContain("proj-1");
  });

  it("event listener disposal prevents further callbacks", async () => {
    const events: CICDEvent[] = [];
    const sub = poller.onEvent((_pid, event) => events.push(event));

    await poller.track(mockProject);

    // Emit before dispose
    adapter._emitEvent({ type: "pipeline_updated", pipeline: makePipeline({ id: "run-2", status: "success" }) });
    expect(events).toHaveLength(1);

    // Dispose and emit again
    sub.dispose();
    adapter._emitEvent({ type: "pipeline_updated", pipeline: makePipeline({ id: "run-2", status: "failure" }) });
    expect(events).toHaveLength(1); // no new events
  });

  it("returns existing state on duplicate track", async () => {
    const state1 = await poller.track(mockProject);
    const state2 = await poller.track(mockProject);
    expect(state1).toBe(state2);
    expect(adapter.listPipelines).toHaveBeenCalledTimes(1); // only fetched once
  });

  it("refresh updates cached state", async () => {
    await poller.track(mockProject);

    const newPipelines = [makePipeline({ id: "run-99", status: "success", name: "Fresh" })];
    (adapter.listPipelines as ReturnType<typeof vi.fn>).mockResolvedValueOnce(newPipelines);

    const refreshed = await poller.refresh(mockProject);
    expect(refreshed.pipelines).toHaveLength(1);
    expect(refreshed.pipelines[0].id).toBe("run-99");
  });
});

describe("ServerEvent shapes for CI/CD", () => {
  it("pipeline_updated event has correct shape", () => {
    const event = {
      type: "pipeline_updated" as const,
      projectId: "proj-1",
      pipeline: makePipeline(),
    };
    expect(event.type).toBe("pipeline_updated");
    expect(event.projectId).toBe("proj-1");
    expect(event.pipeline.id).toBe("run-1");
    expect(event.pipeline.provider).toBe("github-actions");
  });

  it("deployment_updated event has correct shape", () => {
    const event = {
      type: "deployment_updated" as const,
      projectId: "proj-1",
      deployment: makeDeployment(),
    };
    expect(event.type).toBe("deployment_updated");
    expect(event.deployment.environment).toBe("production");
    expect(event.deployment.status).toBe("active");
  });
});
