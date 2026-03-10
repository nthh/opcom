"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const pod_detail_js_1 = require("../../packages/cli/src/tui/views/pod-detail.js");
const renderer_js_1 = require("../../packages/cli/src/tui/renderer.js");
function makePod(overrides = {}) {
    return {
        id: "default/api-7f8b9-abc",
        projectId: "proj-1",
        provider: "kubernetes",
        kind: "pod",
        name: "api-7f8b9-abc",
        namespace: "folia-prod",
        status: "healthy",
        age: "2026-03-01T12:00:00Z",
        containers: [
            {
                name: "api",
                image: "ghcr.io/folia/api:v2.4.2",
                ready: true,
                state: "running",
                restarts: 0,
            },
        ],
        node: "gke-pool-1-abc",
        restarts: 0,
        phase: "Running",
        ...overrides,
    };
}
(0, vitest_1.describe)("createPodDetailState", () => {
    (0, vitest_1.it)("creates initial state with display lines", () => {
        const pod = makePod();
        const state = (0, pod_detail_js_1.createPodDetailState)(pod, "folia");
        (0, vitest_1.expect)(state.pod).toBe(pod);
        (0, vitest_1.expect)(state.projectName).toBe("folia");
        (0, vitest_1.expect)(state.scrollOffset).toBe(0);
        (0, vitest_1.expect)(state.displayLines.length).toBeGreaterThan(0);
    });
    (0, vitest_1.it)("includes pod info in display lines", () => {
        const pod = makePod();
        const state = (0, pod_detail_js_1.createPodDetailState)(pod, "folia");
        const text = state.displayLines.join("\n");
        (0, vitest_1.expect)(text).toContain("api-7f8b9-abc");
        (0, vitest_1.expect)(text).toContain("Running");
        (0, vitest_1.expect)(text).toContain("folia-prod");
        (0, vitest_1.expect)(text).toContain("gke-pool-1-abc");
    });
    (0, vitest_1.it)("includes container info in display lines", () => {
        const pod = makePod();
        const state = (0, pod_detail_js_1.createPodDetailState)(pod, "folia");
        const text = state.displayLines.join("\n");
        (0, vitest_1.expect)(text).toContain("api");
        (0, vitest_1.expect)(text).toContain("ghcr.io/folia/api:v2.4.2");
    });
    (0, vitest_1.it)("shows crash reason for crashing containers", () => {
        const pod = makePod({
            status: "unhealthy",
            containers: [
                {
                    name: "tiles",
                    image: "ghcr.io/folia/tiles:v2.4.2",
                    ready: false,
                    state: "waiting",
                    restarts: 4,
                    reason: "CrashLoopBackOff",
                },
            ],
        });
        const state = (0, pod_detail_js_1.createPodDetailState)(pod, "folia");
        const text = state.displayLines.join("\n");
        (0, vitest_1.expect)(text).toContain("CrashLoopBackOff");
        (0, vitest_1.expect)(text).toContain("4 restarts");
    });
    (0, vitest_1.it)("shows multiple containers", () => {
        const pod = makePod({
            containers: [
                {
                    name: "api",
                    image: "api:v1",
                    ready: true,
                    state: "running",
                    restarts: 0,
                },
                {
                    name: "sidecar",
                    image: "istio/proxyv2:1.20",
                    ready: true,
                    state: "running",
                    restarts: 0,
                },
            ],
        });
        const state = (0, pod_detail_js_1.createPodDetailState)(pod, "folia");
        const text = state.displayLines.join("\n");
        (0, vitest_1.expect)(text).toContain("CONTAINERS (2)");
        (0, vitest_1.expect)(text).toContain("api");
        (0, vitest_1.expect)(text).toContain("sidecar");
    });
    (0, vitest_1.it)("shows conditions when present", () => {
        const pod = makePod({
            conditions: [
                { type: "Ready", status: true, lastTransition: "2026-03-01T12:00:00Z" },
                { type: "ContainersReady", status: true, lastTransition: "2026-03-01T12:00:00Z" },
            ],
        });
        const state = (0, pod_detail_js_1.createPodDetailState)(pod, "folia");
        const text = state.displayLines.join("\n");
        (0, vitest_1.expect)(text).toContain("CONDITIONS");
        (0, vitest_1.expect)(text).toContain("Ready");
        (0, vitest_1.expect)(text).toContain("ContainersReady");
    });
    (0, vitest_1.it)("shows labels when present", () => {
        const pod = makePod({
            labels: { "app": "folia", "version": "v2" },
        });
        const state = (0, pod_detail_js_1.createPodDetailState)(pod, "folia");
        const text = state.displayLines.join("\n");
        (0, vitest_1.expect)(text).toContain("LABELS");
        (0, vitest_1.expect)(text).toContain("app");
        (0, vitest_1.expect)(text).toContain("folia");
    });
});
(0, vitest_1.describe)("rebuildDisplayLines", () => {
    (0, vitest_1.it)("rebuilds lines with new width", () => {
        const pod = makePod();
        const state = (0, pod_detail_js_1.createPodDetailState)(pod, "folia");
        const originalLength = state.displayLines.length;
        (0, pod_detail_js_1.rebuildDisplayLines)(state, 120);
        (0, vitest_1.expect)(state.displayLines.length).toBe(originalLength);
    });
});
(0, vitest_1.describe)("scroll helpers", () => {
    (0, vitest_1.it)("scrollDown increases offset", () => {
        const state = (0, pod_detail_js_1.createPodDetailState)(makePod(), "folia");
        (0, pod_detail_js_1.scrollDown)(state, 3, 10);
        (0, vitest_1.expect)(state.scrollOffset).toBe(3);
    });
    (0, vitest_1.it)("scrollUp decreases offset", () => {
        const state = (0, pod_detail_js_1.createPodDetailState)(makePod(), "folia");
        state.scrollOffset = 5;
        (0, pod_detail_js_1.scrollUp)(state, 2);
        (0, vitest_1.expect)(state.scrollOffset).toBe(3);
    });
    (0, vitest_1.it)("scrollUp does not go below 0", () => {
        const state = (0, pod_detail_js_1.createPodDetailState)(makePod(), "folia");
        (0, pod_detail_js_1.scrollUp)(state, 5);
        (0, vitest_1.expect)(state.scrollOffset).toBe(0);
    });
    (0, vitest_1.it)("scrollToTop resets to 0", () => {
        const state = (0, pod_detail_js_1.createPodDetailState)(makePod(), "folia");
        state.scrollOffset = 10;
        (0, pod_detail_js_1.scrollToTop)(state);
        (0, vitest_1.expect)(state.scrollOffset).toBe(0);
    });
    (0, vitest_1.it)("scrollToBottom goes to max offset", () => {
        const state = (0, pod_detail_js_1.createPodDetailState)(makePod(), "folia");
        (0, pod_detail_js_1.scrollToBottom)(state, 5);
        (0, vitest_1.expect)(state.scrollOffset).toBe(Math.max(0, state.displayLines.length - 5));
    });
    (0, vitest_1.it)("scrollDown clamps to max offset", () => {
        const state = (0, pod_detail_js_1.createPodDetailState)(makePod(), "folia");
        (0, pod_detail_js_1.scrollDown)(state, 1000, 5);
        (0, vitest_1.expect)(state.scrollOffset).toBe(Math.max(0, state.displayLines.length - 5));
    });
});
(0, vitest_1.describe)("renderPodDetail", () => {
    (0, vitest_1.it)("renders without error", () => {
        const pod = makePod();
        const state = (0, pod_detail_js_1.createPodDetailState)(pod, "folia");
        const buf = new renderer_js_1.ScreenBuffer();
        const panel = { x: 0, y: 0, width: 80, height: 24 };
        (0, vitest_1.expect)(() => (0, pod_detail_js_1.renderPodDetail)(buf, panel, state)).not.toThrow();
    });
    (0, vitest_1.it)("renders with scroll offset", () => {
        const pod = makePod();
        const state = (0, pod_detail_js_1.createPodDetailState)(pod, "folia");
        state.scrollOffset = 2;
        const buf = new renderer_js_1.ScreenBuffer();
        const panel = { x: 0, y: 0, width: 80, height: 24 };
        (0, vitest_1.expect)(() => (0, pod_detail_js_1.renderPodDetail)(buf, panel, state)).not.toThrow();
    });
});
(0, vitest_1.describe)("logs section", () => {
    (0, vitest_1.it)("shows LOGS section with selected container name", () => {
        const pod = makePod();
        const state = (0, pod_detail_js_1.createPodDetailState)(pod, "folia");
        const text = state.displayLines.join("\n");
        (0, vitest_1.expect)(text).toContain("LOGS (api)");
    });
    (0, vitest_1.it)("shows 'No logs available' when no logs", () => {
        const pod = makePod();
        const state = (0, pod_detail_js_1.createPodDetailState)(pod, "folia");
        const text = state.displayLines.join("\n");
        (0, vitest_1.expect)(text).toContain("No logs available");
    });
    (0, vitest_1.it)("renders log lines with timestamps", () => {
        const pod = makePod();
        const state = (0, pod_detail_js_1.createPodDetailState)(pod, "folia");
        const logs = [
            { timestamp: "2026-03-01T12:00:00Z", text: "Starting server" },
            { timestamp: "2026-03-01T12:00:01Z", text: "Listening on :8080" },
        ];
        (0, pod_detail_js_1.addLogLines)(state, logs);
        const text = state.displayLines.join("\n");
        (0, vitest_1.expect)(text).toContain("Starting server");
        (0, vitest_1.expect)(text).toContain("Listening on :8080");
        (0, vitest_1.expect)(text).toContain("2026-03-01T12:00:00Z");
    });
    (0, vitest_1.it)("selects first container by default", () => {
        const pod = makePod({
            containers: [
                { name: "web", image: "web:v1", ready: true, state: "running", restarts: 0 },
                { name: "sidecar", image: "sidecar:v1", ready: true, state: "running", restarts: 0 },
            ],
        });
        const state = (0, pod_detail_js_1.createPodDetailState)(pod, "folia");
        (0, vitest_1.expect)(state.selectedContainer).toBe("web");
        const text = state.displayLines.join("\n");
        (0, vitest_1.expect)(text).toContain("LOGS (web)");
    });
    (0, vitest_1.it)("shows updated footer with f and c keybindings", () => {
        const pod = makePod();
        const state = (0, pod_detail_js_1.createPodDetailState)(pod, "folia");
        const text = state.displayLines.join("\n");
        (0, vitest_1.expect)(text).toContain("f:follow logs");
        (0, vitest_1.expect)(text).toContain("c:switch container");
    });
});
(0, vitest_1.describe)("toggleFollow", () => {
    (0, vitest_1.it)("toggles follow mode on", () => {
        const state = (0, pod_detail_js_1.createPodDetailState)(makePod(), "folia");
        (0, vitest_1.expect)(state.followMode).toBe(false);
        (0, pod_detail_js_1.toggleFollow)(state);
        (0, vitest_1.expect)(state.followMode).toBe(true);
        const text = state.displayLines.join("\n");
        (0, vitest_1.expect)(text).toContain("(following)");
    });
    (0, vitest_1.it)("toggles follow mode off", () => {
        const state = (0, pod_detail_js_1.createPodDetailState)(makePod(), "folia");
        (0, pod_detail_js_1.toggleFollow)(state);
        (0, pod_detail_js_1.toggleFollow)(state);
        (0, vitest_1.expect)(state.followMode).toBe(false);
        const text = state.displayLines.join("\n");
        (0, vitest_1.expect)(text).not.toContain("(following)");
    });
});
(0, vitest_1.describe)("switchContainer", () => {
    (0, vitest_1.it)("cycles to next container", () => {
        const pod = makePod({
            containers: [
                { name: "api", image: "api:v1", ready: true, state: "running", restarts: 0 },
                { name: "sidecar", image: "istio:1.20", ready: true, state: "running", restarts: 0 },
            ],
        });
        const state = (0, pod_detail_js_1.createPodDetailState)(pod, "folia");
        (0, vitest_1.expect)(state.selectedContainer).toBe("api");
        (0, pod_detail_js_1.switchContainer)(state);
        (0, vitest_1.expect)(state.selectedContainer).toBe("sidecar");
        const text = state.displayLines.join("\n");
        (0, vitest_1.expect)(text).toContain("LOGS (sidecar)");
    });
    (0, vitest_1.it)("wraps around to first container", () => {
        const pod = makePod({
            containers: [
                { name: "api", image: "api:v1", ready: true, state: "running", restarts: 0 },
                { name: "sidecar", image: "istio:1.20", ready: true, state: "running", restarts: 0 },
            ],
        });
        const state = (0, pod_detail_js_1.createPodDetailState)(pod, "folia");
        (0, pod_detail_js_1.switchContainer)(state); // api -> sidecar
        (0, pod_detail_js_1.switchContainer)(state); // sidecar -> api
        (0, vitest_1.expect)(state.selectedContainer).toBe("api");
    });
    (0, vitest_1.it)("does nothing with single container", () => {
        const state = (0, pod_detail_js_1.createPodDetailState)(makePod(), "folia");
        const before = state.selectedContainer;
        (0, pod_detail_js_1.switchContainer)(state);
        (0, vitest_1.expect)(state.selectedContainer).toBe(before);
    });
    (0, vitest_1.it)("clears logs and follow mode on switch", () => {
        const pod = makePod({
            containers: [
                { name: "api", image: "api:v1", ready: true, state: "running", restarts: 0 },
                { name: "sidecar", image: "istio:1.20", ready: true, state: "running", restarts: 0 },
            ],
        });
        const state = (0, pod_detail_js_1.createPodDetailState)(pod, "folia");
        (0, pod_detail_js_1.addLogLines)(state, [{ timestamp: "t1", text: "line1" }]);
        (0, pod_detail_js_1.toggleFollow)(state);
        (0, vitest_1.expect)(state.logLines.length).toBe(1);
        (0, vitest_1.expect)(state.followMode).toBe(true);
        (0, pod_detail_js_1.switchContainer)(state);
        (0, vitest_1.expect)(state.logLines.length).toBe(0);
        (0, vitest_1.expect)(state.followMode).toBe(false);
    });
});
(0, vitest_1.describe)("addLogLines", () => {
    (0, vitest_1.it)("appends log lines to state", () => {
        const state = (0, pod_detail_js_1.createPodDetailState)(makePod(), "folia");
        (0, pod_detail_js_1.addLogLines)(state, [{ timestamp: "t1", text: "first" }]);
        (0, pod_detail_js_1.addLogLines)(state, [{ timestamp: "t2", text: "second" }]);
        (0, vitest_1.expect)(state.logLines.length).toBe(2);
        const text = state.displayLines.join("\n");
        (0, vitest_1.expect)(text).toContain("first");
        (0, vitest_1.expect)(text).toContain("second");
    });
    (0, vitest_1.it)("auto-scrolls to bottom in follow mode", () => {
        const state = (0, pod_detail_js_1.createPodDetailState)(makePod(), "folia");
        (0, pod_detail_js_1.toggleFollow)(state);
        (0, pod_detail_js_1.addLogLines)(state, [
            { timestamp: "t1", text: "line1" },
            { timestamp: "t2", text: "line2" },
            { timestamp: "t3", text: "line3" },
        ], 5);
        const maxOffset = Math.max(0, state.displayLines.length - 5);
        (0, vitest_1.expect)(state.scrollOffset).toBe(maxOffset);
    });
    (0, vitest_1.it)("does not auto-scroll when not in follow mode", () => {
        const state = (0, pod_detail_js_1.createPodDetailState)(makePod(), "folia");
        (0, pod_detail_js_1.addLogLines)(state, [
            { timestamp: "t1", text: "line1" },
            { timestamp: "t2", text: "line2" },
        ], 5);
        (0, vitest_1.expect)(state.scrollOffset).toBe(0);
    });
});
//# sourceMappingURL=pod-detail.test.js.map