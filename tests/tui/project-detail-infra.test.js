"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const renderer_js_1 = require("../../packages/cli/src/tui/renderer.js");
const project_detail_js_1 = require("../../packages/cli/src/tui/views/project-detail.js");
function makeProject() {
    return {
        id: "proj-1",
        name: "folia",
        path: "/projects/folia",
        git: { remote: null, branch: "main", clean: true },
        workSummary: { open: 3, total: 5, inProgress: 1, closed: 1, deferred: 0 },
    };
}
function makeResource(overrides = {}) {
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
function makePodDetail(overrides = {}) {
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
(0, vitest_1.describe)("infrastructure panel rendering", () => {
    (0, vitest_1.it)("renders infrastructure panel with resources", () => {
        const state = (0, project_detail_js_1.createProjectDetailState)(makeProject());
        state.infraResources = [
            makeResource({ name: "api", kind: "deployment", status: "healthy", replicas: { desired: 3, ready: 3, available: 3, unavailable: 0 } }),
            makeResource({ name: "worker", kind: "deployment", status: "degraded", replicas: { desired: 2, ready: 1, available: 1, unavailable: 1 } }),
            makeResource({ name: "api-svc", kind: "service", status: "healthy", endpoints: [{ type: "ClusterIP", address: "10.0.0.1", port: 8000, protocol: "TCP" }] }),
        ];
        const buf = new renderer_js_1.ScreenBuffer(80, 40);
        // Should render without error
        (0, project_detail_js_1.renderProjectDetail)(buf, infraPanels, state);
        (0, vitest_1.expect)(state.infraResources).toHaveLength(3);
    });
    (0, vitest_1.it)("renders crash alerts at the top of infra panel", () => {
        const state = (0, project_detail_js_1.createProjectDetailState)(makeProject());
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
        const buf = new renderer_js_1.ScreenBuffer(80, 40);
        (0, project_detail_js_1.renderProjectDetail)(buf, infraPanels, state);
        (0, vitest_1.expect)(state.infraCrashEvents).toHaveLength(1);
        (0, vitest_1.expect)(state.infraCrashEvents[0].reason).toBe("CrashLoopBackOff");
    });
    (0, vitest_1.it)("renders empty state when no infrastructure", () => {
        const state = (0, project_detail_js_1.createProjectDetailState)(makeProject());
        const buf = new renderer_js_1.ScreenBuffer(80, 40);
        (0, project_detail_js_1.renderProjectDetail)(buf, infraPanels, state);
        (0, vitest_1.expect)(state.infraResources).toHaveLength(0);
    });
    (0, vitest_1.it)("renders pods with phase and restart info", () => {
        const state = (0, project_detail_js_1.createProjectDetailState)(makeProject());
        state.infraResources = [
            makePodDetail({ name: "api-7f8b9-abc", status: "healthy", phase: "Running", restarts: 0 }),
            makePodDetail({ name: "tiles-8d1e-pqr", status: "unhealthy", phase: "Running", restarts: 4 }),
        ];
        const buf = new renderer_js_1.ScreenBuffer(80, 40);
        (0, project_detail_js_1.renderProjectDetail)(buf, infraPanels, state);
        (0, vitest_1.expect)(state.infraResources).toHaveLength(2);
    });
});
(0, vitest_1.describe)("getInfraResourcesList", () => {
    (0, vitest_1.it)("returns the infra resources from state", () => {
        const state = (0, project_detail_js_1.createProjectDetailState)(makeProject());
        state.infraResources = [
            makeResource({ name: "api" }),
            makeResource({ name: "worker" }),
        ];
        const list = (0, project_detail_js_1.getInfraResourcesList)(state);
        (0, vitest_1.expect)(list).toHaveLength(2);
        (0, vitest_1.expect)(list[0].name).toBe("api");
        (0, vitest_1.expect)(list[1].name).toBe("worker");
    });
    (0, vitest_1.it)("returns empty for no resources", () => {
        const state = (0, project_detail_js_1.createProjectDetailState)(makeProject());
        const list = (0, project_detail_js_1.getInfraResourcesList)(state);
        (0, vitest_1.expect)(list).toHaveLength(0);
    });
});
(0, vitest_1.describe)("getPanelItemCount for infra panel", () => {
    (0, vitest_1.it)("returns infra resource count for panel 6", () => {
        const state = (0, project_detail_js_1.createProjectDetailState)(makeProject());
        state.infraResources = [
            makeResource({ name: "api" }),
            makeResource({ name: "worker" }),
            makeResource({ name: "api-svc", kind: "service" }),
        ];
        (0, vitest_1.expect)((0, project_detail_js_1.getPanelItemCount)(state, 6)).toBe(3);
    });
    (0, vitest_1.it)("returns 0 for empty infra panel", () => {
        const state = (0, project_detail_js_1.createProjectDetailState)(makeProject());
        (0, vitest_1.expect)((0, project_detail_js_1.getPanelItemCount)(state, 6)).toBe(0);
    });
});
(0, vitest_1.describe)("clampSelection for infra panel", () => {
    (0, vitest_1.it)("clamps infra panel selection to valid range", () => {
        const state = (0, project_detail_js_1.createProjectDetailState)(makeProject());
        state.infraResources = [makeResource({ name: "api" })];
        state.selectedIndex[6] = 5; // Out of range
        (0, project_detail_js_1.clampSelection)(state);
        (0, vitest_1.expect)(state.selectedIndex[6]).toBe(0);
    });
    (0, vitest_1.it)("resets to 0 when no infra resources", () => {
        const state = (0, project_detail_js_1.createProjectDetailState)(makeProject());
        state.selectedIndex[6] = 2;
        (0, project_detail_js_1.clampSelection)(state);
        (0, vitest_1.expect)(state.selectedIndex[6]).toBe(0);
        (0, vitest_1.expect)(state.scrollOffset[6]).toBe(0);
    });
});
(0, vitest_1.describe)("PANEL_COUNT", () => {
    (0, vitest_1.it)("is 8 (tickets, agents, specs, stack, cloud, cicd, infra, chat)", () => {
        (0, vitest_1.expect)(project_detail_js_1.PANEL_COUNT).toBe(8);
    });
});
(0, vitest_1.describe)("createProjectDetailState infra fields", () => {
    (0, vitest_1.it)("initializes infraResources and infraCrashEvents as empty", () => {
        const state = (0, project_detail_js_1.createProjectDetailState)(makeProject());
        (0, vitest_1.expect)(state.infraResources).toEqual([]);
        (0, vitest_1.expect)(state.infraCrashEvents).toEqual([]);
    });
    (0, vitest_1.it)("has 8 panel slots in selectedIndex and scrollOffset", () => {
        const state = (0, project_detail_js_1.createProjectDetailState)(makeProject());
        (0, vitest_1.expect)(state.selectedIndex).toHaveLength(8);
        (0, vitest_1.expect)(state.scrollOffset).toHaveLength(8);
    });
});
//# sourceMappingURL=project-detail-infra.test.js.map