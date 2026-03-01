import { describe, it, expect, afterEach } from "vitest";
import { ProcessManager } from "@opcom/core";
import type { ProjectConfig } from "@opcom/types";

function makeProject(): ProjectConfig {
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
    lastScannedAt: "2026-02-27T00:00:00Z",
  };
}

describe("ProcessManager", () => {
  let pm: ProcessManager;

  afterEach(async () => {
    if (pm) await pm.shutdown();
  });

  it("lists no processes initially", () => {
    pm = new ProcessManager();
    expect(pm.listProcesses()).toHaveLength(0);
  });

  it("starts a service that exits quickly", async () => {
    pm = new ProcessManager();
    const project = makeProject();
    const managed = await pm.startService(project, {
      name: "echo-test",
      command: "echo hello",
    });

    expect(managed.name).toBe("echo-test");
    expect(managed.projectId).toBe("test-project");
    expect(managed.pid).toBeGreaterThan(0);
    // State is "running" initially (no port to check)
    expect(managed.state).toBe("running");
  });

  it("stops a service", async () => {
    pm = new ProcessManager();
    const project = makeProject();
    await pm.startService(project, { name: "sleepy", command: "sleep 60" });

    expect(pm.listProcesses()).toHaveLength(1);

    await pm.stopService("test-project", "sleepy");
    expect(pm.getProcess("test-project", "sleepy")).toBeUndefined();
  });

  it("lists processes filtered by project", async () => {
    pm = new ProcessManager();
    const project = makeProject();
    await pm.startService(project, { name: "svc-a", command: "sleep 60" });

    const filtered = pm.listProcesses("test-project");
    expect(filtered.length).toBe(1);

    const other = pm.listProcesses("nonexistent");
    expect(other).toHaveLength(0);
  });

  it("captures stdout output", async () => {
    pm = new ProcessManager();
    const project = makeProject();
    const managed = await pm.startService(project, {
      name: "output-test",
      command: "echo captured-output",
    });

    // Wait for output to be captured
    await new Promise((r) => setTimeout(r, 200));

    expect(managed.stdout.join("")).toContain("captured-output");
  });
});
