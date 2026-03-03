import { describe, it, expect, afterEach, beforeEach } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { EnvironmentManager, topologicalSort } from "@opcom/core";
import type { ProjectConfig, ServiceDefinition } from "@opcom/types";

function makeProject(overrides?: Partial<ProjectConfig>): ProjectConfig {
  return {
    id: "test-project",
    name: "test-project",
    path: "/tmp",
    stack: {
      languages: [],
      frameworks: [],
      packageManagers: [],
      infrastructure: [],
      versionManagers: [],
    },
    git: null,
    workSystem: null,
    docs: {},
    services: [],
    environments: [],
    testing: null,
    linting: [],
    subProjects: [],
    cloudServices: [],
    lastScannedAt: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

describe("topologicalSort", () => {
  it("returns services in dependency order", () => {
    const services: ServiceDefinition[] = [
      { name: "api", command: "node api.js", port: 8000, dependsOn: ["postgres"] },
      { name: "postgres", command: "pg_start", port: 5432 },
      { name: "worker", command: "node worker.js", dependsOn: ["api"] },
    ];

    const sorted = topologicalSort(services);
    const names = sorted.map((s) => s.name);

    expect(names.indexOf("postgres")).toBeLessThan(names.indexOf("api"));
    expect(names.indexOf("api")).toBeLessThan(names.indexOf("worker"));
  });

  it("handles services with no dependencies", () => {
    const services: ServiceDefinition[] = [
      { name: "web", command: "npm start", port: 3000 },
      { name: "api", command: "npm run api", port: 8000 },
    ];

    const sorted = topologicalSort(services);
    expect(sorted).toHaveLength(2);
  });

  it("throws on circular dependencies", () => {
    const services: ServiceDefinition[] = [
      { name: "a", command: "start-a", dependsOn: ["b"] },
      { name: "b", command: "start-b", dependsOn: ["a"] },
    ];

    expect(() => topologicalSort(services)).toThrow(/[Cc]ircular/);
  });

  it("handles diamond dependencies", () => {
    const services: ServiceDefinition[] = [
      { name: "d", command: "d", dependsOn: ["b", "c"] },
      { name: "b", command: "b", dependsOn: ["a"] },
      { name: "c", command: "c", dependsOn: ["a"] },
      { name: "a", command: "a" },
    ];

    const sorted = topologicalSort(services);
    const names = sorted.map((s) => s.name);
    expect(names.indexOf("a")).toBeLessThan(names.indexOf("b"));
    expect(names.indexOf("a")).toBeLessThan(names.indexOf("c"));
    expect(names.indexOf("b")).toBeLessThan(names.indexOf("d"));
    expect(names.indexOf("c")).toBeLessThan(names.indexOf("d"));
  });
});

describe("EnvironmentManager", () => {
  let em: EnvironmentManager;
  let tempDir: string;
  let origHome: string | undefined;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "opcom-env-"));
    origHome = process.env.HOME;
    process.env.HOME = tempDir;
    em = new EnvironmentManager();
  });

  afterEach(async () => {
    if (em) await em.shutdown();
    process.env.HOME = origHome;
    await rm(tempDir, { recursive: true });
  });

  it("starts a simple service and tracks its instance", async () => {
    const project = makeProject();
    const instance = await em.startService(project, {
      name: "echo-svc",
      command: "echo hello",
    });

    expect(instance.serviceName).toBe("echo-svc");
    expect(instance.projectId).toBe("test-project");
    expect(instance.pid).toBeGreaterThan(0);
    // No port, no health check → immediately "running"
    expect(instance.state).toBe("running");
  });

  it("lists instances by project", async () => {
    const project = makeProject();
    await em.startService(project, { name: "svc-a", command: "sleep 60" });
    await em.startService(project, { name: "svc-b", command: "sleep 60" });

    const instances = em.listInstances("test-project");
    expect(instances).toHaveLength(2);
    expect(em.listInstances("other-project")).toHaveLength(0);
  });

  it("stops a service and updates instance state", async () => {
    const project = makeProject();
    await em.startService(project, { name: "stop-me", command: "sleep 60" });

    await em.stopService("test-project", "stop-me");
    const instance = em.getInstance("test-project", "stop-me");
    expect(instance?.state).toBe("stopped");
  });

  it("computes environment status", async () => {
    const project = makeProject();
    await em.startService(project, { name: "svc-a", command: "sleep 60" });
    await em.startService(project, { name: "svc-b", command: "sleep 60" });

    const status = em.getEnvironmentStatus("test-project");
    expect(status.projectId).toBe("test-project");
    expect(status.services).toHaveLength(2);
    // Both running (no port = immediate running)
    expect(status.state).toBe("all-up");
  });

  it("returns all-down when no services running", () => {
    const status = em.getEnvironmentStatus("nonexistent");
    expect(status.state).toBe("all-down");
    expect(status.services).toHaveLength(0);
  });

  it("allocates ports and persists to registry", async () => {
    const project = makeProject();
    const instance = await em.startService(project, {
      name: "web",
      command: "sleep 60",
      port: 3000,
    });

    expect(instance.port).toBe(3000);

    const registry = await em.getPortRegistry();
    expect(registry.allocations.some((a) => a.port === 3000 && a.serviceName === "web")).toBe(true);
  });

  it("releases ports on service stop", async () => {
    const project = makeProject();
    await em.startService(project, { name: "web", command: "sleep 60", port: 3000 });

    await em.stopService("test-project", "web");
    const registry = await em.getPortRegistry();
    expect(registry.allocations.some((a) => a.serviceName === "web")).toBe(false);
  });

  it("emits events on service state changes", async () => {
    const events: string[] = [];
    em.onEvent((e) => events.push(e.type));

    const project = makeProject();
    await em.startService(project, { name: "evt-svc", command: "echo hi" });

    // Should emit service_status and environment_status
    expect(events).toContain("service_status");
    expect(events).toContain("environment_status");
  });

  it("detects port conflicts and emits event", async () => {
    const events: Array<{ type: string; port?: number }> = [];
    em.onEvent((e) => {
      if (e.type === "port_conflict") events.push(e);
    });

    const projA = makeProject({ id: "proj-a", name: "proj-a" });
    const projB = makeProject({ id: "proj-b", name: "proj-b" });

    await em.startService(projA, { name: "web", command: "sleep 60", port: 3000 });
    await em.startService(projB, { name: "web", command: "sleep 60", port: 3000 });

    expect(events).toHaveLength(1);
    expect(events[0].port).toBe(3000);
  });

  it("auto-offsets conflicting ports", async () => {
    const projA = makeProject({ id: "proj-a", name: "proj-a" });
    const projB = makeProject({ id: "proj-b", name: "proj-b" });

    await em.startService(projA, { name: "web", command: "sleep 60", port: 3000 });
    const instanceB = await em.startService(projB, { name: "web", command: "sleep 60", port: 3000 });

    // Should get an offset port
    expect(instanceB.port).toBe(3100);
  });

  it("stops all services for a project", async () => {
    const project = makeProject();
    await em.startService(project, { name: "svc-a", command: "sleep 60" });
    await em.startService(project, { name: "svc-b", command: "sleep 60" });

    await em.stopAllServices("test-project");

    const instances = em.listInstances("test-project");
    expect(instances.every((i) => i.state === "stopped")).toBe(true);
  });
});
