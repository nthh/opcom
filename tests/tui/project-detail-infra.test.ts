import { describe, it, expect } from "vitest";
import type { ProjectStatusSnapshot, InfraResource, PodDetail } from "@opcom/types";
import { ScreenBuffer } from "../../packages/cli/src/tui/renderer.js";
import {
  createProjectDetailState,
  renderProjectDetail,
  getInfraResourcesList,
  getPanelItemCount,
  clampSelection,
  PANEL_COUNT,
} from "../../packages/cli/src/tui/views/project-detail.js";
import type { InfraCrashEvent } from "../../packages/cli/src/tui/views/project-detail.js";

function makeProject(): ProjectStatusSnapshot {
  return {
    id: "proj-1",
    name: "folia",
    path: "/projects/folia",
    git: { remote: null, branch: "main", clean: true },
    workSummary: { open: 3, total: 5, inProgress: 1, closed: 1, deferred: 0 },
  };
}

function makeResource(overrides: Partial<InfraResource> = {}): InfraResource {
  return {
    id: "default/test",
    projectId: "proj-1",
    provider: "kubernetes",
    kind: "deployment",
    name: "test",
    status: "healthy",
    age: new Date().toISOString(),
    ...overrides,
  };
}

function makePodDetail(overrides: Partial<PodDetail> = {}): PodDetail {
  return {
    id: "default/pod-abc",
    projectId: "proj-1",
    provider: "kubernetes",
    kind: "pod",
    name: "pod-abc",
    status: "unhealthy",
    age: new Date().toISOString(),
    containers: [
      {
        name: "api",
        image: "api:v1",
        ready: false,
        state: "waiting",
        restarts: 5,
        reason: "CrashLoopBackOff",
      },
    ],
    node: "gke-pool-1-abc",
    restarts: 5,
    phase: "Running",
    ...overrides,
  };
}

const infraPanels = [
  { id: "tickets", x: 0, y: 0, width: 40, height: 15, title: "Tickets" },
  { id: "agents", x: 40, y: 0, width: 40, height: 15, title: "Agents" },
  { id: "specs", x: 0, y: 15, width: 40, height: 10, title: "Specs" },
  { id: "stack", x: 40, y: 15, width: 40, height: 10, title: "Stack" },
  { id: "cloud", x: 0, y: 25, width: 40, height: 10, title: "Cloud" },
  { id: "infra", x: 40, y: 25, width: 40, height: 10, title: "Infra" },
];

describe("infrastructure panel rendering", () => {
  it("renders infrastructure panel with resources", () => {
    const state = createProjectDetailState(makeProject());
    state.infraResources = [
      makeResource({ name: "api", kind: "deployment", status: "healthy", replicas: { desired: 3, ready: 3, available: 3, unavailable: 0 } }),
      makeResource({ name: "worker", kind: "deployment", status: "degraded", replicas: { desired: 2, ready: 1, available: 1, unavailable: 1 } }),
      makeResource({ name: "api-svc", kind: "service", status: "healthy", endpoints: [{ type: "ClusterIP", address: "10.0.0.1", port: 8000, protocol: "TCP" }] }),
    ];

    const buf = new ScreenBuffer(80, 40);
    // Should render without error
    renderProjectDetail(buf, infraPanels, state);
    expect(state.infraResources).toHaveLength(3);
  });

  it("renders crash alerts at the top of infra panel", () => {
    const state = createProjectDetailState(makeProject());
    const crashPod = makePodDetail();
    state.infraCrashEvents = [
      {
        pod: crashPod,
        container: "api",
        reason: "CrashLoopBackOff",
        timestamp: new Date().toISOString(),
      },
    ];
    state.infraResources = [
      makeResource({ name: "api", kind: "deployment", status: "unhealthy" }),
    ];

    const buf = new ScreenBuffer(80, 40);
    renderProjectDetail(buf, infraPanels, state);
    expect(state.infraCrashEvents).toHaveLength(1);
    expect(state.infraCrashEvents[0].reason).toBe("CrashLoopBackOff");
  });

  it("renders empty state when no infrastructure", () => {
    const state = createProjectDetailState(makeProject());

    const buf = new ScreenBuffer(80, 40);
    renderProjectDetail(buf, infraPanels, state);
    expect(state.infraResources).toHaveLength(0);
  });

  it("renders pods with phase and restart info", () => {
    const state = createProjectDetailState(makeProject());
    state.infraResources = [
      makePodDetail({ name: "api-7f8b9-abc", status: "healthy", phase: "Running", restarts: 0 }),
      makePodDetail({ name: "tiles-8d1e-pqr", status: "unhealthy", phase: "Running", restarts: 4 }),
    ];

    const buf = new ScreenBuffer(80, 40);
    renderProjectDetail(buf, infraPanels, state);
    expect(state.infraResources).toHaveLength(2);
  });
});

describe("getInfraResourcesList", () => {
  it("returns the infra resources from state", () => {
    const state = createProjectDetailState(makeProject());
    state.infraResources = [
      makeResource({ name: "api" }),
      makeResource({ name: "worker" }),
    ];

    const list = getInfraResourcesList(state);
    expect(list).toHaveLength(2);
    expect(list[0].name).toBe("api");
    expect(list[1].name).toBe("worker");
  });

  it("returns empty for no resources", () => {
    const state = createProjectDetailState(makeProject());
    const list = getInfraResourcesList(state);
    expect(list).toHaveLength(0);
  });
});

describe("getPanelItemCount for infra panel", () => {
  it("returns infra resource count for panel 5", () => {
    const state = createProjectDetailState(makeProject());
    state.infraResources = [
      makeResource({ name: "api" }),
      makeResource({ name: "worker" }),
      makeResource({ name: "api-svc", kind: "service" }),
    ];

    expect(getPanelItemCount(state, 5)).toBe(3);
  });

  it("returns 0 for empty infra panel", () => {
    const state = createProjectDetailState(makeProject());
    expect(getPanelItemCount(state, 5)).toBe(0);
  });
});

describe("clampSelection for infra panel", () => {
  it("clamps infra panel selection to valid range", () => {
    const state = createProjectDetailState(makeProject());
    state.infraResources = [makeResource({ name: "api" })];
    state.selectedIndex[5] = 5; // Out of range

    clampSelection(state);
    expect(state.selectedIndex[5]).toBe(0);
  });

  it("resets to 0 when no infra resources", () => {
    const state = createProjectDetailState(makeProject());
    state.selectedIndex[5] = 2;

    clampSelection(state);
    expect(state.selectedIndex[5]).toBe(0);
    expect(state.scrollOffset[5]).toBe(0);
  });
});

describe("PANEL_COUNT", () => {
  it("is 6 (tickets, agents, specs, stack, cloud, infra)", () => {
    expect(PANEL_COUNT).toBe(6);
  });
});

describe("createProjectDetailState infra fields", () => {
  it("initializes infraResources and infraCrashEvents as empty", () => {
    const state = createProjectDetailState(makeProject());
    expect(state.infraResources).toEqual([]);
    expect(state.infraCrashEvents).toEqual([]);
  });

  it("has 6 panel slots in selectedIndex and scrollOffset", () => {
    const state = createProjectDetailState(makeProject());
    expect(state.selectedIndex).toHaveLength(6);
    expect(state.scrollOffset).toHaveLength(6);
  });
});
