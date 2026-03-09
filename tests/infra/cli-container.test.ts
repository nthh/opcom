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

// Mock core dependencies for runInfra
vi.mock("@opcom/core", async () => {
  const actual = await vi.importActual<typeof import("@opcom/core")>("@opcom/core");
  return {
    ...actual,
    loadProject: vi.fn(),
    listProjects: vi.fn().mockResolvedValue([]),
    loadGlobalConfig: vi.fn().mockResolvedValue({ defaultWorkspace: "default" }),
    loadWorkspace: vi.fn().mockResolvedValue({ projectIds: [] }),
  };
});

import { runInfra } from "../../packages/cli/src/commands/infra.js";
import { loadProject, detectInfrastructure } from "@opcom/core";
import type { ProjectConfig, InfraAdapter, InfraLogLine } from "@opcom/types";

beforeEach(() => {
  mockExecFileAsync.mockReset();
  mockExecFileAsync.mockRejectedValue(new Error("kubectl not available in test"));
});

function makeProject(): ProjectConfig {
  return {
    id: "test-project",
    name: "test-project",
    path: "/tmp/test-project",
    stack: {
      languages: [],
      frameworks: [],
      packageManagers: [],
      infrastructure: [{ name: "kubernetes", sourceFile: "k8s/deployment.yaml" }],
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
    lastScannedAt: new Date().toISOString(),
  };
}

describe("CLI infra logs --container flag", () => {
  it("passes container option to streamLogs", async () => {
    const project = makeProject();
    const logLines: InfraLogLine[] = [
      { timestamp: "2026-03-01T10:00:00Z", container: "sidecar", text: "Starting sidecar" },
    ];

    const mockStreamLogs = vi.fn().mockImplementation(async function* () {
      for (const line of logLines) {
        yield line;
      }
    });

    const mockAdapter: InfraAdapter = {
      provider: "kubernetes",
      detect: vi.fn().mockResolvedValue(true),
      listResources: vi.fn().mockResolvedValue([]),
      getResource: vi.fn(),
      streamLogs: mockStreamLogs,
      watch: vi.fn().mockReturnValue({ dispose: vi.fn() }),
    };

    // Mock loadProject
    vi.mocked(loadProject).mockResolvedValue(project);

    // We need to mock detectInfrastructure to return our adapter
    // Since runInfra uses detectInfrastructure internally, we mock it
    const detectMock = vi.fn().mockResolvedValue({
      adapters: [mockAdapter],
      evidence: [{ detectedAs: "infra:kubernetes" }],
    });

    // Override the import
    const coreModule = await import("@opcom/core");
    vi.spyOn(coreModule, "detectInfrastructure").mockImplementation(detectMock);

    // Capture console.log output
    const logs: string[] = [];
    const consoleSpy = vi.spyOn(console, "log").mockImplementation((msg: string) => {
      logs.push(msg);
    });

    await runInfra("test-project", "logs", "pod-abc", { container: "sidecar" });

    // Verify streamLogs was called with the container option
    expect(mockStreamLogs).toHaveBeenCalledWith(
      project,
      "test-project/pod-abc",
      expect.objectContaining({ container: "sidecar" }),
    );

    consoleSpy.mockRestore();
  });

  it("passes container option in follow mode", async () => {
    const project = makeProject();

    const mockStreamLogs = vi.fn().mockImplementation(async function* () {
      yield { timestamp: "2026-03-01T10:00:00Z", container: "worker", text: "Starting worker" };
    });

    const mockAdapter: InfraAdapter = {
      provider: "kubernetes",
      detect: vi.fn().mockResolvedValue(true),
      listResources: vi.fn().mockResolvedValue([]),
      getResource: vi.fn(),
      streamLogs: mockStreamLogs,
      watch: vi.fn().mockReturnValue({ dispose: vi.fn() }),
    };

    vi.mocked(loadProject).mockResolvedValue(project);

    const coreModule = await import("@opcom/core");
    vi.spyOn(coreModule, "detectInfrastructure").mockResolvedValue({
      adapters: [mockAdapter],
      evidence: [{ detectedAs: "infra:kubernetes" }],
    });

    const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    await runInfra("test-project", "logs", "pod-abc", { follow: true, container: "worker" });

    expect(mockStreamLogs).toHaveBeenCalledWith(
      project,
      "test-project/pod-abc",
      expect.objectContaining({ container: "worker", follow: true }),
    );

    consoleSpy.mockRestore();
  });

  it("does not pass container when not specified", async () => {
    const project = makeProject();

    const mockStreamLogs = vi.fn().mockImplementation(async function* () {
      yield { timestamp: "2026-03-01T10:00:00Z", text: "Log line" };
    });

    const mockAdapter: InfraAdapter = {
      provider: "kubernetes",
      detect: vi.fn().mockResolvedValue(true),
      listResources: vi.fn().mockResolvedValue([]),
      getResource: vi.fn(),
      streamLogs: mockStreamLogs,
      watch: vi.fn().mockReturnValue({ dispose: vi.fn() }),
    };

    vi.mocked(loadProject).mockResolvedValue(project);

    const coreModule = await import("@opcom/core");
    vi.spyOn(coreModule, "detectInfrastructure").mockResolvedValue({
      adapters: [mockAdapter],
      evidence: [{ detectedAs: "infra:kubernetes" }],
    });

    const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    await runInfra("test-project", "logs", "pod-abc", {});

    expect(mockStreamLogs).toHaveBeenCalledWith(
      project,
      "test-project/pod-abc",
      expect.objectContaining({ container: undefined }),
    );

    consoleSpy.mockRestore();
  });
});
