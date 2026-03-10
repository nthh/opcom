import { describe, it, expect } from "vitest";
import type { ProjectStatusSnapshot, EnvironmentStatus, ServiceInstance } from "@opcom/types";
import { ScreenBuffer, stripAnsi } from "../../packages/cli/src/tui/renderer.js";
import {
  createDashboardState,
  renderDashboard,
  formatProjectLine,
  formatServiceDots,
} from "../../packages/cli/src/tui/views/dashboard.js";

function makeService(name: string, state: ServiceInstance["state"], port?: number): ServiceInstance {
  return {
    serviceName: name,
    projectId: "proj-1",
    pid: 12345,
    port,
    state,
    startedAt: new Date(Date.now() - 120_000).toISOString(), // 2m ago
    restartCount: 0,
  };
}

function makeEnvStatus(services: ServiceInstance[]): EnvironmentStatus {
  const running = services.filter((s) => s.state === "running");
  return {
    projectId: "proj-1",
    state: running.length === services.length ? "all-up"
      : running.length === 0 ? "all-down"
      : "partial",
    services,
    ports: services.filter((s) => s.port).map((s) => s.port!),
    upSince: running[0]?.startedAt,
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

const dashPanels = [
  { id: "projects", x: 0, y: 0, width: 120, height: 20, title: "Projects" },
  { id: "workqueue", x: 0, y: 20, width: 120, height: 20, title: "Work Queue" },
  { id: "agents", x: 120, y: 0, width: 50, height: 20, title: "Agents" },
  { id: "chat", x: 120, y: 20, width: 50, height: 20, title: "Chat" },
];

describe("dashboard service health indicators", () => {
  it("renders service dots when environmentStatus is present", () => {
    const state = createDashboardState();
    state.projects = [
      makeProject({
        environmentStatus: makeEnvStatus([
          makeService("api", "running", 3000),
          makeService("web", "running", 5173),
          makeService("worker", "stopped", 8080),
        ]),
      }),
    ];

    const buf = new ScreenBuffer(170, 40);
    renderDashboard(buf, dashPanels, state);

    expect(state.projects[0].environmentStatus?.services.length).toBe(3);
  });

  it("does not render service dots when no environmentStatus", () => {
    const state = createDashboardState();
    state.projects = [makeProject()];

    const buf = new ScreenBuffer(170, 40);
    renderDashboard(buf, dashPanels, state);

    expect(state.projects[0].environmentStatus).toBeUndefined();
  });

  it("includes service count in project line", () => {
    const env = makeEnvStatus([
      makeService("api", "running", 3000),
      makeService("web", "running", 5173),
      makeService("worker", "stopped"),
    ]);
    const project = makeProject({ environmentStatus: env });

    const line = formatProjectLine(project, null, 120);
    const plain = stripAnsi(line);
    expect(plain).toContain("2/3 svc");
  });
});

describe("formatServiceDots", () => {
  it("returns dots for all service states", () => {
    const env = makeEnvStatus([
      makeService("a", "running"),
      makeService("b", "starting"),
      makeService("c", "unhealthy"),
      makeService("d", "crashed"),
      makeService("e", "stopped"),
    ]);

    const result = formatServiceDots(env);
    expect(result).toBeTruthy();
    // Should contain dot-like characters for each service
    const plain = stripAnsi(result);
    expect(plain.length).toBe(5);
  });

  it("returns all green dots for all-up", () => {
    const env = makeEnvStatus([
      makeService("a", "running"),
      makeService("b", "running"),
    ]);

    const result = formatServiceDots(env);
    const plain = stripAnsi(result);
    expect(plain).toBe("\u25cf\u25cf"); // ●●
  });

  it("returns all empty dots for all-down", () => {
    const env = makeEnvStatus([
      makeService("a", "stopped"),
      makeService("b", "stopped"),
    ]);

    const result = formatServiceDots(env);
    const plain = stripAnsi(result);
    expect(plain).toBe("\u25cb\u25cb"); // ○○
  });
});
