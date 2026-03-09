import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock child_process to prevent real kubectl calls
const { mockExecFileAsync } = vi.hoisted(() => ({
  mockExecFileAsync: vi.fn(),
}));

vi.mock("node:child_process", () => {
  const mockExecFile: any = vi.fn();
  mockExecFile[Symbol.for("nodejs.util.promisify.custom")] = mockExecFileAsync;
  return {
    execFile: mockExecFile,
    spawn: vi.fn(() => ({
      stdout: { on: vi.fn() },
      stderr: { on: vi.fn() },
      on: vi.fn(),
      kill: vi.fn(),
    })),
  };
});

import { Station } from "../../packages/core/src/server/station.js";
import type { ServerEvent, InfraResource, PodDetail } from "@opcom/types";

beforeEach(() => {
  mockExecFileAsync.mockReset();
  mockExecFileAsync.mockRejectedValue(new Error("kubectl not available in test"));
});

describe("Station infrastructure event types", () => {
  it("ServerEvent includes infra_resource_updated type", () => {
    const event: ServerEvent = {
      type: "infra_resource_updated",
      projectId: "proj-1",
      resource: {
        id: "default/api",
        projectId: "proj-1",
        provider: "kubernetes",
        kind: "deployment",
        name: "api",
        status: "healthy",
        age: new Date().toISOString(),
      },
    };
    expect(event.type).toBe("infra_resource_updated");
    expect(event.projectId).toBe("proj-1");
  });

  it("ServerEvent includes infra_resource_deleted type", () => {
    const event: ServerEvent = {
      type: "infra_resource_deleted",
      projectId: "proj-1",
      resourceId: "default/api",
    };
    expect(event.type).toBe("infra_resource_deleted");
    expect(event.resourceId).toBe("default/api");
  });

  it("ServerEvent includes pod_crash type", () => {
    const pod: PodDetail = {
      id: "default/api-abc",
      projectId: "proj-1",
      provider: "kubernetes",
      kind: "pod",
      name: "api-abc",
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
      node: "node-1",
      restarts: 5,
      phase: "Running",
    };

    const event: ServerEvent = {
      type: "pod_crash",
      projectId: "proj-1",
      pod,
      container: "api",
      reason: "CrashLoopBackOff",
    };

    expect(event.type).toBe("pod_crash");
    expect(event.pod.name).toBe("api-abc");
    expect(event.container).toBe("api");
    expect(event.reason).toBe("CrashLoopBackOff");
  });
});

describe("Station constructor accepts skipInfra option", () => {
  it("creates station with skipInfra option", () => {
    const station = new Station(0, { skipCICD: true, skipReconcile: true, skipInfra: true });
    expect(station).toBeDefined();
  });
});

describe("Station start/stop with infra watchers disabled", () => {
  it("starts and stops cleanly with all watchers skipped", async () => {
    const station = new Station(0, { skipCICD: true, skipReconcile: true, skipInfra: true });
    await station.start();
    const port = station.getPort();
    expect(port).toBeDefined();
    await station.stop();
  });
});
