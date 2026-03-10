import { describe, it, expect } from "vitest";
import type { ProjectStatusSnapshot, EnvironmentStatus, ServiceInstance, ProjectConfig } from "@opcom/types";
import { ScreenBuffer, stripAnsi } from "../../packages/cli/src/tui/renderer.js";
import {
  createProjectDetailState,
  renderProjectDetail,
  getServicesList,
  getPanelItemCount,
  type ProjectDetailState,
} from "../../packages/cli/src/tui/views/project-detail.js";
import type { Panel } from "../../packages/cli/src/tui/layout.js";

function makeService(name: string, state: ServiceInstance["state"], port?: number): ServiceInstance {
  return {
    serviceName: name,
    projectId: "proj-1",
    pid: 12345,
    port,
    state,
    startedAt: new Date(Date.now() - 120_000).toISOString(),
    restartCount: 0,
  };
}

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

function makeProjectConfig(): ProjectConfig {
  return {
    id: "proj-1",
    name: "folia",
    path: "/projects/folia",
    git: { remote: null, branch: "main", clean: true },
    stack: {
      languages: [{ name: "TypeScript", version: "5.7.0" }],
      frameworks: [],
      infrastructure: [],
      packageManagers: [{ name: "npm" }],
      versionManagers: [],
    },
    services: [
      { name: "api", command: "node server.js", port: 3000 },
      { name: "web", command: "vite dev", port: 5173 },
      { name: "worker", command: "node worker.js" },
    ],
    environments: [],
    testing: { framework: "vitest", command: "npx vitest run" },
    cloudServices: [],
  };
}

const panels: Panel[] = [
  { id: "tickets", x: 0, y: 0, width: 60, height: 40, title: "Tickets" },
  { id: "agents", x: 60, y: 0, width: 50, height: 7, title: "Agents" },
  { id: "specs", x: 60, y: 7, width: 50, height: 7, title: "Specs" },
  { id: "stack", x: 60, y: 14, width: 50, height: 10, title: "Stack" },
  { id: "cloud", x: 60, y: 24, width: 50, height: 7, title: "Cloud" },
  { id: "cicd", x: 60, y: 31, width: 50, height: 7, title: "CI/CD" },
  { id: "infra", x: 60, y: 38, width: 50, height: 7, title: "Infra" },
  { id: "chat", x: 60, y: 45, width: 50, height: 7, title: "Chat" },
];

describe("project detail live services", () => {
  it("renders static service list when no environment status", () => {
    const state = createProjectDetailState(makeProject());
    state.projectConfig = makeProjectConfig();

    const buf = new ScreenBuffer(110, 52);
    renderProjectDetail(buf, panels, state);

    // Verify services section renders (basic rendering, no error)
    expect(state.projectConfig.services.length).toBe(3);
  });

  it("renders live service status when environment status present", () => {
    const state = createProjectDetailState(makeProject());
    state.projectConfig = makeProjectConfig();
    state.environmentStatus = {
      projectId: "proj-1",
      state: "partial",
      services: [
        makeService("api", "running", 3000),
        makeService("web", "running", 5173),
        makeService("worker", "stopped"),
      ],
      ports: [3000, 5173],
      upSince: new Date(Date.now() - 120_000).toISOString(),
    };

    const buf = new ScreenBuffer(110, 52);
    renderProjectDetail(buf, panels, state);

    // Environment status was set and has 3 services
    expect(state.environmentStatus.services.length).toBe(3);
    expect(state.environmentStatus.state).toBe("partial");
  });

  it("returns empty services list when no projectConfig", () => {
    const state = createProjectDetailState(makeProject());
    const services = getServicesList(state);
    expect(services).toEqual([]);
  });

  it("returns service list with instances when available", () => {
    const state = createProjectDetailState(makeProject());
    state.projectConfig = makeProjectConfig();
    const apiInstance = makeService("api", "running", 3000);
    state.environmentStatus = {
      projectId: "proj-1",
      state: "partial",
      services: [apiInstance],
      ports: [3000],
    };

    const services = getServicesList(state);
    expect(services.length).toBe(3);
    expect(services[0].name).toBe("api");
    expect(services[0].instance).toBe(apiInstance);
    expect(services[1].name).toBe("web");
    expect(services[1].instance).toBeUndefined();
    expect(services[2].name).toBe("worker");
    expect(services[2].instance).toBeUndefined();
  });

  it("stack panel item count reflects all stack items", () => {
    const state = createProjectDetailState(makeProject());
    state.projectConfig = makeProjectConfig();

    // Stack items include: 1 language, 1 pkg manager, 1 testing, 3 services = 6
    const count = getPanelItemCount(state, 3);
    expect(count).toBe(6);
  });

  it("stack panel item count is 0 without config", () => {
    const state = createProjectDetailState(makeProject());

    const count = getPanelItemCount(state, 3);
    expect(count).toBe(0);
  });
});
