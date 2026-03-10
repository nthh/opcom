"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
// Mock child_process to prevent real kubectl calls
const { mockExecFileAsync } = vitest_1.vi.hoisted(() => ({
    mockExecFileAsync: vitest_1.vi.fn(),
}));
vitest_1.vi.mock("node:child_process", () => {
    const mockExecFile = vitest_1.vi.fn();
    mockExecFile[Symbol.for("nodejs.util.promisify.custom")] = mockExecFileAsync;
    return {
        execFile: mockExecFile,
        spawn: vitest_1.vi.fn(() => ({
            stdout: { on: vitest_1.vi.fn() },
            stderr: { on: vitest_1.vi.fn() },
            on: vitest_1.vi.fn(),
            kill: vitest_1.vi.fn(),
        })),
    };
});
// Mock core dependencies for runInfra
vitest_1.vi.mock("@opcom/core", async () => {
    const actual = await vitest_1.vi.importActual("@opcom/core");
    return {
        ...actual,
        loadProject: vitest_1.vi.fn(),
        listProjects: vitest_1.vi.fn().mockResolvedValue([]),
        loadGlobalConfig: vitest_1.vi.fn().mockResolvedValue({ defaultWorkspace: "default" }),
        loadWorkspace: vitest_1.vi.fn().mockResolvedValue({ projectIds: [] }),
    };
});
const infra_js_1 = require("../../packages/cli/src/commands/infra.js");
const core_1 = require("@opcom/core");
(0, vitest_1.beforeEach)(() => {
    mockExecFileAsync.mockReset();
    mockExecFileAsync.mockRejectedValue(new Error("kubectl not available in test"));
});
function makeProject() {
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
(0, vitest_1.describe)("CLI infra logs --container flag", () => {
    (0, vitest_1.it)("passes container option to streamLogs", async () => {
        const project = makeProject();
        const logLines = [
            { timestamp: "2026-03-01T10:00:00Z", container: "sidecar", text: "Starting sidecar" },
        ];
        const mockStreamLogs = vitest_1.vi.fn().mockImplementation(async function* () {
            for (const line of logLines) {
                yield line;
            }
        });
        const mockAdapter = {
            provider: "kubernetes",
            detect: vitest_1.vi.fn().mockResolvedValue(true),
            listResources: vitest_1.vi.fn().mockResolvedValue([]),
            getResource: vitest_1.vi.fn(),
            streamLogs: mockStreamLogs,
            watch: vitest_1.vi.fn().mockReturnValue({ dispose: vitest_1.vi.fn() }),
        };
        // Mock loadProject
        vitest_1.vi.mocked(core_1.loadProject).mockResolvedValue(project);
        // We need to mock detectInfrastructure to return our adapter
        // Since runInfra uses detectInfrastructure internally, we mock it
        const detectMock = vitest_1.vi.fn().mockResolvedValue({
            adapters: [mockAdapter],
            evidence: [{ detectedAs: "infra:kubernetes" }],
        });
        // Override the import
        const coreModule = await import("@opcom/core");
        vitest_1.vi.spyOn(coreModule, "detectInfrastructure").mockImplementation(detectMock);
        // Capture console.log output
        const logs = [];
        const consoleSpy = vitest_1.vi.spyOn(console, "log").mockImplementation((msg) => {
            logs.push(msg);
        });
        await (0, infra_js_1.runInfra)("test-project", "logs", "pod-abc", { container: "sidecar" });
        // Verify streamLogs was called with the container option
        (0, vitest_1.expect)(mockStreamLogs).toHaveBeenCalledWith(project, "test-project/pod-abc", vitest_1.expect.objectContaining({ container: "sidecar" }));
        consoleSpy.mockRestore();
    });
    (0, vitest_1.it)("passes container option in follow mode", async () => {
        const project = makeProject();
        const mockStreamLogs = vitest_1.vi.fn().mockImplementation(async function* () {
            yield { timestamp: "2026-03-01T10:00:00Z", container: "worker", text: "Starting worker" };
        });
        const mockAdapter = {
            provider: "kubernetes",
            detect: vitest_1.vi.fn().mockResolvedValue(true),
            listResources: vitest_1.vi.fn().mockResolvedValue([]),
            getResource: vitest_1.vi.fn(),
            streamLogs: mockStreamLogs,
            watch: vitest_1.vi.fn().mockReturnValue({ dispose: vitest_1.vi.fn() }),
        };
        vitest_1.vi.mocked(core_1.loadProject).mockResolvedValue(project);
        const coreModule = await import("@opcom/core");
        vitest_1.vi.spyOn(coreModule, "detectInfrastructure").mockResolvedValue({
            adapters: [mockAdapter],
            evidence: [{ detectedAs: "infra:kubernetes" }],
        });
        const consoleSpy = vitest_1.vi.spyOn(console, "log").mockImplementation(() => { });
        await (0, infra_js_1.runInfra)("test-project", "logs", "pod-abc", { follow: true, container: "worker" });
        (0, vitest_1.expect)(mockStreamLogs).toHaveBeenCalledWith(project, "test-project/pod-abc", vitest_1.expect.objectContaining({ container: "worker", follow: true }));
        consoleSpy.mockRestore();
    });
    (0, vitest_1.it)("does not pass container when not specified", async () => {
        const project = makeProject();
        const mockStreamLogs = vitest_1.vi.fn().mockImplementation(async function* () {
            yield { timestamp: "2026-03-01T10:00:00Z", text: "Log line" };
        });
        const mockAdapter = {
            provider: "kubernetes",
            detect: vitest_1.vi.fn().mockResolvedValue(true),
            listResources: vitest_1.vi.fn().mockResolvedValue([]),
            getResource: vitest_1.vi.fn(),
            streamLogs: mockStreamLogs,
            watch: vitest_1.vi.fn().mockReturnValue({ dispose: vitest_1.vi.fn() }),
        };
        vitest_1.vi.mocked(core_1.loadProject).mockResolvedValue(project);
        const coreModule = await import("@opcom/core");
        vitest_1.vi.spyOn(coreModule, "detectInfrastructure").mockResolvedValue({
            adapters: [mockAdapter],
            evidence: [{ detectedAs: "infra:kubernetes" }],
        });
        const consoleSpy = vitest_1.vi.spyOn(console, "log").mockImplementation(() => { });
        await (0, infra_js_1.runInfra)("test-project", "logs", "pod-abc", {});
        (0, vitest_1.expect)(mockStreamLogs).toHaveBeenCalledWith(project, "test-project/pod-abc", vitest_1.expect.objectContaining({ container: undefined }));
        consoleSpy.mockRestore();
    });
});
//# sourceMappingURL=cli-container.test.js.map