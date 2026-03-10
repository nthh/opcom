"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
// Mock child_process to prevent real kubectl calls
const { mockExecFileAsync, mockSpawn } = vitest_1.vi.hoisted(() => ({
    mockExecFileAsync: vitest_1.vi.fn(),
    mockSpawn: vitest_1.vi.fn(),
}));
vitest_1.vi.mock("node:child_process", () => {
    const mockExecFile = vitest_1.vi.fn();
    mockExecFile[Symbol.for("nodejs.util.promisify.custom")] = mockExecFileAsync;
    return {
        execFile: mockExecFile,
        spawn: mockSpawn,
    };
});
const kubernetes_js_1 = require("../../packages/core/src/infra/kubernetes.js");
const mockProject = {
    id: "proj-1",
    name: "test-project",
    path: "/tmp/test-project",
    git: { branch: "main", clean: true, remote: "git@github.com:org/repo.git" },
    stack: {
        languages: [],
        frameworks: [],
        packageManagers: [],
        infra: [{ name: "kubernetes" }],
        versionManagers: [],
    },
    detectedAt: "2026-01-01T00:00:00Z",
};
function makeK8sPodJson(name, phase, ready) {
    return JSON.stringify({
        metadata: {
            name,
            namespace: "test-project",
            creationTimestamp: "2026-03-01T12:00:00Z",
        },
        spec: { nodeName: "node-1" },
        status: {
            phase,
            containerStatuses: [
                {
                    name: "app",
                    image: "app:v1",
                    ready,
                    restartCount: 0,
                    state: ready ? { running: { startedAt: "2026-03-01T12:00:00Z" } } : { waiting: {} },
                },
            ],
        },
    });
}
const emptyList = JSON.stringify({ items: [] });
function makeK8sListJson(pods) {
    return JSON.stringify({
        items: pods.map((name) => ({
            metadata: {
                name,
                namespace: "test-project",
                creationTimestamp: "2026-03-01T12:00:00Z",
            },
            spec: { nodeName: "node-1" },
            status: {
                phase: "Running",
                containerStatuses: [
                    {
                        name: "app",
                        image: "app:v1",
                        ready: true,
                        restartCount: 0,
                        state: { running: { startedAt: "2026-03-01T12:00:00Z" } },
                    },
                ],
            },
        })),
    });
}
function createMockSpawnChild() {
    const listeners = {};
    const stdoutListeners = {};
    return {
        stdout: {
            on: vitest_1.vi.fn((event, cb) => {
                if (!stdoutListeners[event])
                    stdoutListeners[event] = [];
                stdoutListeners[event].push(cb);
            }),
            emit: (event, ...args) => {
                for (const cb of stdoutListeners[event] ?? [])
                    cb(...args);
            },
        },
        stderr: { on: vitest_1.vi.fn() },
        on: vitest_1.vi.fn((event, cb) => {
            if (!listeners[event])
                listeners[event] = [];
            listeners[event].push(cb);
        }),
        emit: (event, ...args) => {
            for (const cb of listeners[event] ?? [])
                cb(...args);
        },
        kill: vitest_1.vi.fn(),
    };
}
function setupListResourcesMock(podNames) {
    mockExecFileAsync.mockImplementation((_cmd, args) => {
        const argsStr = args.join(" ");
        if (argsStr.includes("pods")) {
            return Promise.resolve({ stdout: makeK8sListJson(podNames) });
        }
        return Promise.resolve({ stdout: emptyList });
    });
}
// Helper: wait for seed to complete by flushing microtasks
async function flushSeed() {
    // The seed is a promise chain: listResources().then().catch().finally()
    // Each step is a microtask. We need to flush enough times for all to complete.
    for (let i = 0; i < 20; i++) {
        await Promise.resolve();
    }
}
(0, vitest_1.describe)("KubernetesAdapter.watch() with polling fallback", () => {
    let adapter;
    (0, vitest_1.beforeEach)(() => {
        adapter = new kubernetes_js_1.KubernetesAdapter();
        mockSpawn.mockReset();
        mockExecFileAsync.mockReset();
    });
    (0, vitest_1.it)("seeds initial state and starts watch", async () => {
        const spawnChild = createMockSpawnChild();
        mockSpawn.mockReturnValue(spawnChild);
        setupListResourcesMock(["api-abc"]);
        const events = [];
        const disposable = adapter.watch(mockProject, (event) => events.push(event));
        // Let seed promise chain resolve
        await flushSeed();
        // No events from seeding (first-time load only populates cache)
        (0, vitest_1.expect)(events).toHaveLength(0);
        // spawn called for the watch process
        (0, vitest_1.expect)(mockSpawn).toHaveBeenCalledWith("kubectl", vitest_1.expect.arrayContaining(["get", "pods", "--watch"]));
        disposable.dispose();
    });
    (0, vitest_1.it)("emits resource_updated from kubectl --watch stdout", async () => {
        const spawnChild = createMockSpawnChild();
        mockSpawn.mockReturnValue(spawnChild);
        setupListResourcesMock([]);
        const events = [];
        const disposable = adapter.watch(mockProject, (event) => events.push(event));
        await flushSeed();
        // Simulate kubectl watch output
        spawnChild.stdout.emit("data", Buffer.from(makeK8sPodJson("api-abc", "Running", true) + "\n"));
        (0, vitest_1.expect)(events).toHaveLength(1);
        (0, vitest_1.expect)(events[0].type).toBe("resource_updated");
        disposable.dispose();
    });
    (0, vitest_1.it)("emits pod_crash when CrashLoopBackOff detected via watch", async () => {
        const spawnChild = createMockSpawnChild();
        mockSpawn.mockReturnValue(spawnChild);
        setupListResourcesMock([]);
        const events = [];
        const disposable = adapter.watch(mockProject, (event) => events.push(event));
        await flushSeed();
        const crashPod = JSON.stringify({
            metadata: { name: "api-crash", namespace: "test-project", creationTimestamp: "2026-03-01T12:00:00Z" },
            spec: { nodeName: "node-1" },
            status: {
                phase: "Running",
                containerStatuses: [{
                        name: "app",
                        image: "app:v1",
                        ready: false,
                        restartCount: 5,
                        state: { waiting: { reason: "CrashLoopBackOff" } },
                    }],
            },
        });
        spawnChild.stdout.emit("data", Buffer.from(crashPod + "\n"));
        const crashes = events.filter((e) => e.type === "pod_crash");
        (0, vitest_1.expect)(crashes).toHaveLength(1);
        (0, vitest_1.expect)(crashes[0].type === "pod_crash" && crashes[0].reason).toBe("CrashLoopBackOff");
        disposable.dispose();
    });
    (0, vitest_1.it)("does not emit events after dispose", async () => {
        const spawnChild = createMockSpawnChild();
        mockSpawn.mockReturnValue(spawnChild);
        setupListResourcesMock([]);
        const events = [];
        const disposable = adapter.watch(mockProject, (event) => events.push(event));
        await flushSeed();
        disposable.dispose();
        // Watch data after dispose should be ignored
        spawnChild.stdout.emit("data", Buffer.from(makeK8sPodJson("api-new", "Running", true) + "\n"));
        (0, vitest_1.expect)(events).toHaveLength(0);
    });
    (0, vitest_1.it)("dispose kills watch child process", async () => {
        const spawnChild = createMockSpawnChild();
        mockSpawn.mockReturnValue(spawnChild);
        setupListResourcesMock([]);
        const disposable = adapter.watch(mockProject, () => { });
        await flushSeed();
        disposable.dispose();
        (0, vitest_1.expect)(spawnChild.kill).toHaveBeenCalled();
    });
    (0, vitest_1.it)("watch handles multi-line buffer correctly", async () => {
        const spawnChild = createMockSpawnChild();
        mockSpawn.mockReturnValue(spawnChild);
        setupListResourcesMock([]);
        const events = [];
        const disposable = adapter.watch(mockProject, (event) => events.push(event));
        await flushSeed();
        // Send two pods in one chunk
        const data = makeK8sPodJson("pod-a", "Running", true) + "\n" + makeK8sPodJson("pod-b", "Running", true) + "\n";
        spawnChild.stdout.emit("data", Buffer.from(data));
        const updated = events.filter((e) => e.type === "resource_updated");
        (0, vitest_1.expect)(updated).toHaveLength(2);
        disposable.dispose();
    });
    (0, vitest_1.it)("watch recovers from JSON parse errors", async () => {
        const spawnChild = createMockSpawnChild();
        mockSpawn.mockReturnValue(spawnChild);
        setupListResourcesMock([]);
        const events = [];
        const disposable = adapter.watch(mockProject, (event) => events.push(event));
        await flushSeed();
        // Send invalid JSON followed by valid JSON
        spawnChild.stdout.emit("data", Buffer.from("not valid json\n"));
        spawnChild.stdout.emit("data", Buffer.from(makeK8sPodJson("pod-ok", "Running", true) + "\n"));
        // Should only have the valid pod event
        const updated = events.filter((e) => e.type === "resource_updated");
        (0, vitest_1.expect)(updated).toHaveLength(1);
        disposable.dispose();
    });
});
(0, vitest_1.describe)("Polling fallback integration", () => {
    (0, vitest_1.it)("schedules polling after seed completes", async () => {
        const spawnChild = createMockSpawnChild();
        mockSpawn.mockReturnValue(spawnChild);
        setupListResourcesMock(["api-abc"]);
        vitest_1.vi.useFakeTimers();
        const disposable = new kubernetes_js_1.KubernetesAdapter().watch(mockProject, () => { });
        // Let seed complete
        await vitest_1.vi.advanceTimersByTimeAsync(1);
        // A 30s timer should be pending
        const timerCount = vitest_1.vi.getTimerCount();
        (0, vitest_1.expect)(timerCount).toBeGreaterThanOrEqual(1);
        disposable.dispose();
        vitest_1.vi.useRealTimers();
    });
    (0, vitest_1.it)("polling detects new resources after seed", async () => {
        const spawnChild = createMockSpawnChild();
        mockSpawn.mockReturnValue(spawnChild);
        // Seed returns one pod
        let currentPods = ["api-abc"];
        mockExecFileAsync.mockImplementation((_cmd, args) => {
            const argsStr = args.join(" ");
            if (argsStr.includes("pods")) {
                return Promise.resolve({ stdout: makeK8sListJson(currentPods) });
            }
            return Promise.resolve({ stdout: emptyList });
        });
        vitest_1.vi.useFakeTimers();
        const events = [];
        const disposable = new kubernetes_js_1.KubernetesAdapter().watch(mockProject, (event) => events.push(event));
        // Let seed complete
        await vitest_1.vi.advanceTimersByTimeAsync(1);
        events.length = 0;
        // Change what listResources returns
        currentPods = ["api-abc", "api-def"];
        // Advance to trigger the poll
        await vitest_1.vi.advanceTimersByTimeAsync(30_000);
        const updated = events.filter((e) => e.type === "resource_updated");
        (0, vitest_1.expect)(updated.length).toBeGreaterThan(0);
        disposable.dispose();
        vitest_1.vi.useRealTimers();
    });
    (0, vitest_1.it)("polling detects resource deletions", async () => {
        const spawnChild = createMockSpawnChild();
        mockSpawn.mockReturnValue(spawnChild);
        let currentPods = ["api-abc", "api-def"];
        mockExecFileAsync.mockImplementation((_cmd, args) => {
            const argsStr = args.join(" ");
            if (argsStr.includes("pods")) {
                return Promise.resolve({ stdout: makeK8sListJson(currentPods) });
            }
            return Promise.resolve({ stdout: emptyList });
        });
        vitest_1.vi.useFakeTimers();
        const events = [];
        const disposable = new kubernetes_js_1.KubernetesAdapter().watch(mockProject, (event) => events.push(event));
        await vitest_1.vi.advanceTimersByTimeAsync(1);
        events.length = 0;
        // Remove one pod
        currentPods = ["api-abc"];
        await vitest_1.vi.advanceTimersByTimeAsync(30_000);
        const deletions = events.filter((e) => e.type === "resource_deleted");
        (0, vitest_1.expect)(deletions.length).toBeGreaterThan(0);
        disposable.dispose();
        vitest_1.vi.useRealTimers();
    });
});
//# sourceMappingURL=watch-polling.test.js.map