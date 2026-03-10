"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const renderer_js_1 = require("../../packages/cli/src/tui/renderer.js");
const dashboard_js_1 = require("../../packages/cli/src/tui/views/dashboard.js");
const cicd_pane_js_1 = require("../../packages/cli/src/tui/views/cicd-pane.js");
const deployment_detail_js_1 = require("../../packages/cli/src/tui/views/deployment-detail.js");
// --- Factories ---
function makeDeployment(overrides = {}) {
    return {
        id: "deploy-1",
        projectId: "proj-1",
        provider: "github-actions",
        environment: "production",
        ref: "main",
        status: "active",
        createdAt: new Date(Date.now() - 600_000).toISOString(),
        updatedAt: new Date(Date.now() - 300_000).toISOString(),
        ...overrides,
    };
}
function makeProject(overrides = {}) {
    return {
        id: "proj-1",
        name: "folia",
        path: "/projects/folia",
        git: { branch: "main", clean: true, uncommittedCount: 0 },
        workSummary: { open: 3, total: 10 },
        ...overrides,
    };
}
// --- aggregateDeployStatus tests ---
(0, vitest_1.describe)("aggregateDeployStatus", () => {
    (0, vitest_1.it)("returns null for empty deployments", () => {
        (0, vitest_1.expect)((0, dashboard_js_1.aggregateDeployStatus)([], "proj-1")).toBeNull();
    });
    (0, vitest_1.it)("prioritizes failing deployments", () => {
        const deployments = [
            makeDeployment({ id: "d1", environment: "staging", status: "active" }),
            makeDeployment({ id: "d2", environment: "production", status: "failed" }),
        ];
        const result = (0, dashboard_js_1.aggregateDeployStatus)(deployments, "proj-1");
        (0, vitest_1.expect)(result).not.toBeNull();
        (0, vitest_1.expect)(result.state).toBe("failing");
        (0, vitest_1.expect)(result.environment).toBe("prod");
    });
    (0, vitest_1.it)("prioritizes higher environment among failures", () => {
        const deployments = [
            makeDeployment({ id: "d1", environment: "staging", status: "failed" }),
            makeDeployment({ id: "d2", environment: "production", status: "failed" }),
        ];
        const result = (0, dashboard_js_1.aggregateDeployStatus)(deployments, "proj-1");
        (0, vitest_1.expect)(result.environment).toBe("prod");
    });
    (0, vitest_1.it)("shows deploying when in-progress", () => {
        const deployments = [
            makeDeployment({ id: "d1", environment: "production", status: "active" }),
            makeDeployment({ id: "d2", environment: "staging", status: "in_progress" }),
        ];
        const result = (0, dashboard_js_1.aggregateDeployStatus)(deployments, "proj-1");
        (0, vitest_1.expect)(result.state).toBe("deploying");
        (0, vitest_1.expect)(result.environment).toBe("staging");
    });
    (0, vitest_1.it)("shows deploying for pending status", () => {
        const deployments = [
            makeDeployment({ id: "d1", environment: "production", status: "pending" }),
        ];
        const result = (0, dashboard_js_1.aggregateDeployStatus)(deployments, "proj-1");
        (0, vitest_1.expect)(result.state).toBe("deploying");
    });
    (0, vitest_1.it)("failing takes priority over deploying", () => {
        const deployments = [
            makeDeployment({ id: "d1", environment: "staging", status: "in_progress" }),
            makeDeployment({ id: "d2", environment: "production", status: "error" }),
        ];
        const result = (0, dashboard_js_1.aggregateDeployStatus)(deployments, "proj-1");
        (0, vitest_1.expect)(result.state).toBe("failing");
    });
    (0, vitest_1.it)("shows healthy for active deployment", () => {
        const deployments = [
            makeDeployment({ id: "d1", environment: "production", status: "active" }),
        ];
        const result = (0, dashboard_js_1.aggregateDeployStatus)(deployments, "proj-1");
        (0, vitest_1.expect)(result.state).toBe("healthy");
        (0, vitest_1.expect)(result.environment).toBe("prod");
    });
    (0, vitest_1.it)("prefers production over staging when both active", () => {
        const deployments = [
            makeDeployment({ id: "d1", environment: "staging", status: "active" }),
            makeDeployment({ id: "d2", environment: "production", status: "active" }),
        ];
        const result = (0, dashboard_js_1.aggregateDeployStatus)(deployments, "proj-1");
        (0, vitest_1.expect)(result.environment).toBe("prod");
    });
    (0, vitest_1.it)("shows unknown for inactive deployments", () => {
        const deployments = [
            makeDeployment({ id: "d1", environment: "production", status: "inactive" }),
        ];
        const result = (0, dashboard_js_1.aggregateDeployStatus)(deployments, "proj-1");
        (0, vitest_1.expect)(result.state).toBe("unknown");
    });
    (0, vitest_1.it)("includes relativeTime", () => {
        const deployments = [
            makeDeployment({
                id: "d1",
                environment: "production",
                status: "active",
                updatedAt: new Date(Date.now() - 7_200_000).toISOString(), // 2 hours ago
            }),
        ];
        const result = (0, dashboard_js_1.aggregateDeployStatus)(deployments, "proj-1");
        (0, vitest_1.expect)(result.relativeTime).toBe("2h ago");
    });
    (0, vitest_1.it)("includes commitSha from ref", () => {
        const deployments = [
            makeDeployment({ id: "d1", ref: "abc123", status: "active" }),
        ];
        const result = (0, dashboard_js_1.aggregateDeployStatus)(deployments, "proj-1");
        (0, vitest_1.expect)(result.commitSha).toBe("abc123");
    });
    (0, vitest_1.it)("shortens environment names", () => {
        const tests = [
            ["production", "prod"],
            ["staging", "staging"],
            ["preview", "preview"],
            ["development", "dev"],
            ["custom-env", "custom-env"],
        ];
        for (const [input, expected] of tests) {
            const deployments = [makeDeployment({ environment: input, status: "active" })];
            const result = (0, dashboard_js_1.aggregateDeployStatus)(deployments, "proj-1");
            (0, vitest_1.expect)(result.environment).toBe(expected);
        }
    });
});
// --- formatDeployIndicator tests ---
(0, vitest_1.describe)("formatDeployIndicator", () => {
    (0, vitest_1.it)("shows green check for healthy", () => {
        const status = {
            projectId: "proj-1",
            environment: "prod",
            state: "healthy",
            relativeTime: "2m ago",
        };
        const text = (0, renderer_js_1.stripAnsi)((0, dashboard_js_1.formatDeployIndicator)(status));
        (0, vitest_1.expect)(text).toContain("prod");
        (0, vitest_1.expect)(text).toContain("2m ago");
    });
    (0, vitest_1.it)("shows red X for failing", () => {
        const status = {
            projectId: "proj-1",
            environment: "prod",
            state: "failing",
            relativeTime: "5m ago",
        };
        const text = (0, renderer_js_1.stripAnsi)((0, dashboard_js_1.formatDeployIndicator)(status));
        (0, vitest_1.expect)(text).toContain("prod");
        (0, vitest_1.expect)(text).toContain("5m ago");
    });
    (0, vitest_1.it)("shows deploying indicator", () => {
        const status = {
            projectId: "proj-1",
            environment: "staging",
            state: "deploying",
            relativeTime: "just now",
        };
        const text = (0, renderer_js_1.stripAnsi)((0, dashboard_js_1.formatDeployIndicator)(status));
        (0, vitest_1.expect)(text).toContain("staging");
        (0, vitest_1.expect)(text).toContain("deploying...");
    });
    (0, vitest_1.it)("shows dimmed indicator for unknown", () => {
        const status = {
            projectId: "proj-1",
            environment: "prod",
            state: "unknown",
            relativeTime: "1d ago",
        };
        const text = (0, renderer_js_1.stripAnsi)((0, dashboard_js_1.formatDeployIndicator)(status));
        (0, vitest_1.expect)(text).toContain("prod");
        (0, vitest_1.expect)(text).toContain("1d ago");
    });
});
// --- formatProjectLine with deploy status ---
(0, vitest_1.describe)("formatProjectLine with deploy status", () => {
    (0, vitest_1.it)("renders project without deploy status", () => {
        const project = makeProject();
        const line = (0, renderer_js_1.stripAnsi)((0, dashboard_js_1.formatProjectLine)(project, null, 120));
        (0, vitest_1.expect)(line).toContain("folia");
        (0, vitest_1.expect)(line).toContain("main");
        (0, vitest_1.expect)(line).toContain("clean");
        (0, vitest_1.expect)(line).not.toContain("prod");
    });
    (0, vitest_1.it)("renders project with healthy deploy status", () => {
        const project = makeProject();
        const status = {
            projectId: "proj-1",
            environment: "prod",
            state: "healthy",
            relativeTime: "2m ago",
        };
        const line = (0, renderer_js_1.stripAnsi)((0, dashboard_js_1.formatProjectLine)(project, status, 120));
        (0, vitest_1.expect)(line).toContain("folia");
        (0, vitest_1.expect)(line).toContain("prod");
        (0, vitest_1.expect)(line).toContain("2m ago");
    });
    (0, vitest_1.it)("renders project with failing deploy status", () => {
        const project = makeProject();
        const status = {
            projectId: "proj-1",
            environment: "prod",
            state: "failing",
            relativeTime: "5m ago",
        };
        const line = (0, renderer_js_1.stripAnsi)((0, dashboard_js_1.formatProjectLine)(project, status, 120));
        (0, vitest_1.expect)(line).toContain("prod");
    });
    (0, vitest_1.it)("renders project with deploying status", () => {
        const project = makeProject();
        const status = {
            projectId: "proj-1",
            environment: "staging",
            state: "deploying",
            relativeTime: "just now",
        };
        const line = (0, renderer_js_1.stripAnsi)((0, dashboard_js_1.formatProjectLine)(project, status, 120));
        (0, vitest_1.expect)(line).toContain("staging");
        (0, vitest_1.expect)(line).toContain("deploying...");
    });
    (0, vitest_1.it)("truncates long lines", () => {
        const project = makeProject({ name: "very-long-project-name" });
        const status = {
            projectId: "proj-1",
            environment: "prod",
            state: "healthy",
            relativeTime: "2m ago",
        };
        const line = (0, renderer_js_1.stripAnsi)((0, dashboard_js_1.formatProjectLine)(project, status, 40));
        (0, vitest_1.expect)(line.length).toBeLessThanOrEqual(40);
    });
});
// --- DashboardState deploy status ---
(0, vitest_1.describe)("DashboardState deployStatuses", () => {
    (0, vitest_1.it)("initializes with empty deploy statuses map", () => {
        const state = (0, dashboard_js_1.createDashboardState)();
        (0, vitest_1.expect)(state.deployStatuses).toBeInstanceOf(Map);
        (0, vitest_1.expect)(state.deployStatuses.size).toBe(0);
    });
});
// --- formatDeploymentLine (L2 CI/CD pane) ---
(0, vitest_1.describe)("formatDeploymentLine", () => {
    (0, vitest_1.it)("shows commit ref for deployment", () => {
        const deployment = makeDeployment({ ref: "abc1234567890" });
        const text = (0, renderer_js_1.stripAnsi)((0, cicd_pane_js_1.formatDeploymentLine)(deployment, 120));
        (0, vitest_1.expect)(text).toContain("abc1234");
        (0, vitest_1.expect)(text).toContain("production");
    });
    (0, vitest_1.it)("shows LIVE label for active deployment", () => {
        const deployment = makeDeployment({ status: "active", ref: "abc1234" });
        const text = (0, renderer_js_1.stripAnsi)((0, cicd_pane_js_1.formatDeploymentLine)(deployment, 120));
        (0, vitest_1.expect)(text).toContain("LIVE");
        (0, vitest_1.expect)(text).toContain("active");
    });
    (0, vitest_1.it)("does not show LIVE for non-active deployment", () => {
        const deployment = makeDeployment({ status: "failed", ref: "abc1234" });
        const text = (0, renderer_js_1.stripAnsi)((0, cicd_pane_js_1.formatDeploymentLine)(deployment, 120));
        (0, vitest_1.expect)(text).not.toContain("LIVE");
        (0, vitest_1.expect)(text).toContain("failed");
    });
    (0, vitest_1.it)("shows short ref (first 7 chars)", () => {
        const deployment = makeDeployment({ ref: "abcdef1234567890" });
        const text = (0, renderer_js_1.stripAnsi)((0, cicd_pane_js_1.formatDeploymentLine)(deployment, 120));
        (0, vitest_1.expect)(text).toContain("abcdef1");
        (0, vitest_1.expect)(text).not.toContain("abcdef1234567890");
    });
});
// --- Deployment Detail View (L3) ---
(0, vitest_1.describe)("createDeploymentDetailState", () => {
    (0, vitest_1.it)("creates state with display lines for deployments", () => {
        const deployments = [
            makeDeployment({ id: "d1", environment: "production", status: "active", ref: "abc123" }),
            makeDeployment({ id: "d2", environment: "staging", status: "in_progress", ref: "def456" }),
        ];
        const state = (0, deployment_detail_js_1.createDeploymentDetailState)(deployments, "folia");
        (0, vitest_1.expect)(state.projectName).toBe("folia");
        (0, vitest_1.expect)(state.deployments).toHaveLength(2);
        (0, vitest_1.expect)(state.displayLines.length).toBeGreaterThan(0);
        (0, vitest_1.expect)(state.scrollOffset).toBe(0);
    });
    (0, vitest_1.it)("shows empty state for no deployments", () => {
        const state = (0, deployment_detail_js_1.createDeploymentDetailState)([], "folia");
        const text = state.displayLines.map(renderer_js_1.stripAnsi).join("\n");
        (0, vitest_1.expect)(text).toContain("No deployments found");
    });
});
(0, vitest_1.describe)("deployment detail display content", () => {
    (0, vitest_1.it)("groups deployments by environment", () => {
        const deployments = [
            makeDeployment({ id: "d1", environment: "production", status: "active", ref: "abc123" }),
            makeDeployment({ id: "d2", environment: "staging", status: "active", ref: "def456" }),
        ];
        const state = (0, deployment_detail_js_1.createDeploymentDetailState)(deployments, "folia");
        const text = state.displayLines.map(renderer_js_1.stripAnsi).join("\n");
        (0, vitest_1.expect)(text).toContain("PRODUCTION");
        (0, vitest_1.expect)(text).toContain("STAGING");
    });
    (0, vitest_1.it)("shows LIVE label for active environment", () => {
        const deployments = [
            makeDeployment({ id: "d1", environment: "production", status: "active", ref: "abc123" }),
        ];
        const state = (0, deployment_detail_js_1.createDeploymentDetailState)(deployments, "folia");
        const text = state.displayLines.map(renderer_js_1.stripAnsi).join("\n");
        (0, vitest_1.expect)(text).toContain("LIVE");
        (0, vitest_1.expect)(text).toContain("Live commit:");
        (0, vitest_1.expect)(text).toContain("abc123");
    });
    (0, vitest_1.it)("shows deploy history per environment", () => {
        const deployments = [
            makeDeployment({ id: "d1", environment: "production", status: "active", ref: "abc123",
                updatedAt: new Date(Date.now() - 60_000).toISOString() }),
            makeDeployment({ id: "d2", environment: "production", status: "inactive", ref: "old456",
                updatedAt: new Date(Date.now() - 3600_000).toISOString() }),
        ];
        const state = (0, deployment_detail_js_1.createDeploymentDetailState)(deployments, "folia");
        const text = state.displayLines.map(renderer_js_1.stripAnsi).join("\n");
        (0, vitest_1.expect)(text).toContain("History (2)");
        (0, vitest_1.expect)(text).toContain("abc123");
        (0, vitest_1.expect)(text).toContain("old456");
    });
    (0, vitest_1.it)("orders environments by priority (production first)", () => {
        const deployments = [
            makeDeployment({ id: "d1", environment: "staging", status: "active" }),
            makeDeployment({ id: "d2", environment: "production", status: "active" }),
            makeDeployment({ id: "d3", environment: "preview", status: "active" }),
        ];
        const state = (0, deployment_detail_js_1.createDeploymentDetailState)(deployments, "folia");
        const text = state.displayLines.map(renderer_js_1.stripAnsi).join("\n");
        const prodIdx = text.indexOf("PRODUCTION");
        const stagingIdx = text.indexOf("STAGING");
        const previewIdx = text.indexOf("PREVIEW");
        (0, vitest_1.expect)(prodIdx).toBeLessThan(stagingIdx);
        (0, vitest_1.expect)(stagingIdx).toBeLessThan(previewIdx);
    });
    (0, vitest_1.it)("shows commit sha for each deployment in history", () => {
        const deployments = [
            makeDeployment({ id: "d1", environment: "production", status: "active", ref: "commit1abc" }),
            makeDeployment({ id: "d2", environment: "production", status: "inactive", ref: "commit2def" }),
        ];
        const state = (0, deployment_detail_js_1.createDeploymentDetailState)(deployments, "folia");
        const text = state.displayLines.map(renderer_js_1.stripAnsi).join("\n");
        (0, vitest_1.expect)(text).toContain("commit1");
        (0, vitest_1.expect)(text).toContain("commit2");
    });
});
(0, vitest_1.describe)("deployment detail scrolling", () => {
    (0, vitest_1.it)("scrolls down", () => {
        const deployments = Array.from({ length: 20 }, (_, i) => makeDeployment({ id: `d${i}`, environment: "production", status: "active", ref: `ref${i}` }));
        const state = (0, deployment_detail_js_1.createDeploymentDetailState)(deployments, "folia");
        (0, vitest_1.expect)(state.scrollOffset).toBe(0);
        (0, deployment_detail_js_1.scrollDown)(state, 5, 10);
        (0, vitest_1.expect)(state.scrollOffset).toBe(5);
    });
    (0, vitest_1.it)("scrolls up", () => {
        const deployments = Array.from({ length: 20 }, (_, i) => makeDeployment({ id: `d${i}`, environment: "production", status: "active", ref: `ref${i}` }));
        const state = (0, deployment_detail_js_1.createDeploymentDetailState)(deployments, "folia");
        (0, deployment_detail_js_1.scrollDown)(state, 10, 10);
        (0, deployment_detail_js_1.scrollUp)(state, 3);
        (0, vitest_1.expect)(state.scrollOffset).toBe(7);
    });
    (0, vitest_1.it)("scrollToTop resets offset", () => {
        const deployments = Array.from({ length: 20 }, (_, i) => makeDeployment({ id: `d${i}`, environment: "production", status: "active", ref: `ref${i}` }));
        const state = (0, deployment_detail_js_1.createDeploymentDetailState)(deployments, "folia");
        (0, deployment_detail_js_1.scrollDown)(state, 10, 10);
        (0, deployment_detail_js_1.scrollToTop)(state);
        (0, vitest_1.expect)(state.scrollOffset).toBe(0);
    });
    (0, vitest_1.it)("scrollToBottom goes to max offset", () => {
        const deployments = Array.from({ length: 20 }, (_, i) => makeDeployment({ id: `d${i}`, environment: "production", status: "active", ref: `ref${i}` }));
        const state = (0, deployment_detail_js_1.createDeploymentDetailState)(deployments, "folia");
        (0, deployment_detail_js_1.scrollToBottom)(state, 5);
        (0, vitest_1.expect)(state.scrollOffset).toBe(state.displayLines.length - 5);
    });
});
// --- Real-time deploy status updates ---
/**
 * Simulate the deployment_updated event handler from client.ts.
 * This mirrors TuiClient.handleServerEvent for deployment_updated events.
 * In production, the CICDPoller polls GitHub Actions for deployment changes and
 * emits deployment_updated events, which are forwarded through handleServerEvent.
 */
function handleDeploymentUpdatedEvent(cache, projectId, deployment) {
    const deployments = cache.get(projectId) ?? [];
    const dIdx = deployments.findIndex((d) => d.id === deployment.id);
    if (dIdx >= 0) {
        deployments[dIdx] = deployment;
    }
    else {
        deployments.unshift(deployment);
    }
    cache.set(projectId, deployments);
}
/**
 * Simulate the syncData deploy aggregation from app.ts.
 * In production, this runs on every ServerEvent (including deployment_updated)
 * via client.onEvent(() => { syncData(); scheduleRender(); }).
 */
function syncDeployStatuses(state, projectDeployments) {
    const deployStatuses = new Map();
    for (const project of state.projects) {
        const deployments = projectDeployments.get(project.id) ?? [];
        const status = (0, dashboard_js_1.aggregateDeployStatus)(deployments, project.id);
        if (status) {
            deployStatuses.set(project.id, status);
        }
    }
    state.deployStatuses = deployStatuses;
}
(0, vitest_1.describe)("real-time deploy status updates", () => {
    (0, vitest_1.it)("re-aggregates deploy status when deployments change", () => {
        // Simulate: deployment starts as in_progress, then transitions to active
        const initialDeployments = [
            makeDeployment({ id: "d1", environment: "production", status: "in_progress", ref: "abc123" }),
        ];
        const status1 = (0, dashboard_js_1.aggregateDeployStatus)(initialDeployments, "proj-1");
        (0, vitest_1.expect)(status1.state).toBe("deploying");
        // Deployment progresses to active
        const updatedDeployments = [
            makeDeployment({ id: "d1", environment: "production", status: "active", ref: "abc123" }),
        ];
        const status2 = (0, dashboard_js_1.aggregateDeployStatus)(updatedDeployments, "proj-1");
        (0, vitest_1.expect)(status2.state).toBe("healthy");
        (0, vitest_1.expect)(status2.commitSha).toBe("abc123");
    });
    (0, vitest_1.it)("updates dashboard deployStatuses map from project deployments", () => {
        const state = (0, dashboard_js_1.createDashboardState)();
        state.projects = [
            makeProject({ id: "proj-1", name: "folia" }),
            makeProject({ id: "proj-2", name: "mtnmap" }),
        ];
        // Simulate client.projectDeployments being populated by deployment_updated events
        const projectDeployments = new Map();
        projectDeployments.set("proj-1", [
            makeDeployment({ id: "d1", projectId: "proj-1", environment: "production", status: "active", ref: "abc123" }),
        ]);
        projectDeployments.set("proj-2", [
            makeDeployment({ id: "d2", projectId: "proj-2", environment: "staging", status: "in_progress", ref: "def456" }),
        ]);
        // Re-aggregate (mirrors what syncData does on every event)
        syncDeployStatuses(state, projectDeployments);
        (0, vitest_1.expect)(state.deployStatuses.size).toBe(2);
        (0, vitest_1.expect)(state.deployStatuses.get("proj-1").state).toBe("healthy");
        (0, vitest_1.expect)(state.deployStatuses.get("proj-1").commitSha).toBe("abc123");
        (0, vitest_1.expect)(state.deployStatuses.get("proj-2").state).toBe("deploying");
    });
    (0, vitest_1.it)("deploy status transitions from deploying to healthy on event", () => {
        // Simulate event-driven update: pending → in_progress → active
        const stages = [
            { status: "pending", expectedState: "deploying" },
            { status: "in_progress", expectedState: "deploying" },
            { status: "active", expectedState: "healthy" },
        ];
        for (const { status, expectedState } of stages) {
            const deployments = [makeDeployment({ status, ref: "commit-abc" })];
            const result = (0, dashboard_js_1.aggregateDeployStatus)(deployments, "proj-1");
            (0, vitest_1.expect)(result.state).toBe(expectedState);
        }
    });
    (0, vitest_1.it)("deploy status transitions to failing on error event", () => {
        // Start healthy, then error event arrives
        const healthy = [makeDeployment({ status: "active", ref: "commit1" })];
        (0, vitest_1.expect)((0, dashboard_js_1.aggregateDeployStatus)(healthy, "proj-1").state).toBe("healthy");
        // Error deployment arrives (e.g., new deploy failed)
        const withError = [
            makeDeployment({ id: "d1", status: "active", ref: "commit1" }),
            makeDeployment({ id: "d2", status: "error", ref: "commit2" }),
        ];
        (0, vitest_1.expect)((0, dashboard_js_1.aggregateDeployStatus)(withError, "proj-1").state).toBe("failing");
    });
    (0, vitest_1.it)("deployment_updated event updates cache and dashboard state in real time", () => {
        // Full event-driven flow: event arrives → cache updates → syncData → dashboard updates
        const projectDeployments = new Map();
        const state = (0, dashboard_js_1.createDashboardState)();
        state.projects = [makeProject({ id: "proj-1", name: "folia" })];
        // Step 1: Initial deployment event arrives (pending)
        handleDeploymentUpdatedEvent(projectDeployments, "proj-1", makeDeployment({ id: "d1", projectId: "proj-1", status: "pending", ref: "abc123" }));
        syncDeployStatuses(state, projectDeployments);
        (0, vitest_1.expect)(state.deployStatuses.get("proj-1").state).toBe("deploying");
        // Step 2: Deployment progresses (in_progress event)
        handleDeploymentUpdatedEvent(projectDeployments, "proj-1", makeDeployment({ id: "d1", projectId: "proj-1", status: "in_progress", ref: "abc123" }));
        syncDeployStatuses(state, projectDeployments);
        (0, vitest_1.expect)(state.deployStatuses.get("proj-1").state).toBe("deploying");
        // Step 3: Deployment succeeds (active event)
        handleDeploymentUpdatedEvent(projectDeployments, "proj-1", makeDeployment({ id: "d1", projectId: "proj-1", status: "active", ref: "abc123" }));
        syncDeployStatuses(state, projectDeployments);
        (0, vitest_1.expect)(state.deployStatuses.get("proj-1").state).toBe("healthy");
        (0, vitest_1.expect)(state.deployStatuses.get("proj-1").commitSha).toBe("abc123");
    });
    (0, vitest_1.it)("multiple deployment events update dashboard state correctly", () => {
        // Simulate multiple projects receiving deployment events concurrently
        const projectDeployments = new Map();
        const state = (0, dashboard_js_1.createDashboardState)();
        state.projects = [
            makeProject({ id: "proj-1", name: "folia" }),
            makeProject({ id: "proj-2", name: "mtnmap" }),
        ];
        // proj-1: deploy starts
        handleDeploymentUpdatedEvent(projectDeployments, "proj-1", makeDeployment({ id: "d1", projectId: "proj-1", status: "in_progress", ref: "abc123" }));
        syncDeployStatuses(state, projectDeployments);
        (0, vitest_1.expect)(state.deployStatuses.get("proj-1").state).toBe("deploying");
        (0, vitest_1.expect)(state.deployStatuses.has("proj-2")).toBe(false);
        // proj-2: deploy fails
        handleDeploymentUpdatedEvent(projectDeployments, "proj-2", makeDeployment({ id: "d2", projectId: "proj-2", status: "failed", ref: "def456" }));
        syncDeployStatuses(state, projectDeployments);
        (0, vitest_1.expect)(state.deployStatuses.get("proj-1").state).toBe("deploying");
        (0, vitest_1.expect)(state.deployStatuses.get("proj-2").state).toBe("failing");
        // proj-1: deploy succeeds
        handleDeploymentUpdatedEvent(projectDeployments, "proj-1", makeDeployment({ id: "d1", projectId: "proj-1", status: "active", ref: "abc123" }));
        syncDeployStatuses(state, projectDeployments);
        (0, vitest_1.expect)(state.deployStatuses.get("proj-1").state).toBe("healthy");
        (0, vitest_1.expect)(state.deployStatuses.get("proj-2").state).toBe("failing");
    });
    (0, vitest_1.it)("deployment detail view updates in real time when deployments change", () => {
        // Simulates syncData updating the deployment detail view on deployment_updated events.
        // In app.ts, syncData checks if deploymentDetailState is active and rebuilds display lines
        // when deployment status changes.
        // Create initial detail state with in_progress deployment
        const initialDeployments = [
            makeDeployment({ id: "d1", environment: "production", status: "in_progress", ref: "abc123" }),
        ];
        const detailState = (0, deployment_detail_js_1.createDeploymentDetailState)(initialDeployments, "folia");
        const text1 = detailState.displayLines.map(renderer_js_1.stripAnsi).join("\n");
        (0, vitest_1.expect)(text1).not.toContain("LIVE");
        (0, vitest_1.expect)(text1).not.toContain("Live commit:");
        // deployment_updated event arrives: status changes to active.
        // In production, CICDPoller emits this event, handleServerEvent updates the cache,
        // and syncData detects the change and rebuilds display lines.
        const updatedDeployments = [
            makeDeployment({ id: "d1", environment: "production", status: "active", ref: "abc123" }),
        ];
        // Simulate syncData's real-time update path:
        // it detects status differs and rebuilds the display lines
        const statusChanged = updatedDeployments.length !== detailState.deployments.length ||
            updatedDeployments.some((d, i) => d.status !== detailState.deployments[i]?.status);
        (0, vitest_1.expect)(statusChanged).toBe(true);
        detailState.deployments = updatedDeployments;
        (0, deployment_detail_js_1.rebuildDisplayLines)(detailState, 80);
        const text2 = detailState.displayLines.map(renderer_js_1.stripAnsi).join("\n");
        (0, vitest_1.expect)(text2).toContain("LIVE");
        (0, vitest_1.expect)(text2).toContain("Live commit:");
        (0, vitest_1.expect)(text2).toContain("abc123");
    });
});
// --- Deployment detail view: live commit rendering ---
(0, vitest_1.describe)("deployment detail live commit display", () => {
    (0, vitest_1.it)("shows live commit SHA prominently", () => {
        const deployments = [
            makeDeployment({ environment: "production", status: "active", ref: "abc123def456" }),
        ];
        const state = (0, deployment_detail_js_1.createDeploymentDetailState)(deployments, "folia");
        const text = state.displayLines.map(renderer_js_1.stripAnsi).join("\n");
        (0, vitest_1.expect)(text).toContain("Live commit:");
        (0, vitest_1.expect)(text).toContain("abc123d"); // First 7 chars of commit SHA
    });
    (0, vitest_1.it)("does not show live commit when no active deployment", () => {
        const deployments = [
            makeDeployment({ environment: "production", status: "failed", ref: "abc123def456" }),
        ];
        const state = (0, deployment_detail_js_1.createDeploymentDetailState)(deployments, "folia");
        const text = state.displayLines.map(renderer_js_1.stripAnsi).join("\n");
        (0, vitest_1.expect)(text).not.toContain("Live commit:");
    });
    (0, vitest_1.it)("shows live commit per environment", () => {
        const deployments = [
            makeDeployment({ id: "d1", environment: "production", status: "active", ref: "prod-commit" }),
            makeDeployment({ id: "d2", environment: "staging", status: "active", ref: "staging-commit" }),
        ];
        const state = (0, deployment_detail_js_1.createDeploymentDetailState)(deployments, "folia");
        const text = state.displayLines.map(renderer_js_1.stripAnsi).join("\n");
        (0, vitest_1.expect)(text).toContain("prod-co"); // 7 char truncation
        (0, vitest_1.expect)(text).toContain("staging"); // 7 chars
    });
    (0, vitest_1.it)("rebuilds display lines on deployment change (real-time update)", () => {
        // Start with in_progress deployment
        const deployments = [
            makeDeployment({ environment: "production", status: "in_progress", ref: "abc123" }),
        ];
        const state = (0, deployment_detail_js_1.createDeploymentDetailState)(deployments, "folia");
        const text1 = state.displayLines.map(renderer_js_1.stripAnsi).join("\n");
        (0, vitest_1.expect)(text1).not.toContain("LIVE");
        (0, vitest_1.expect)(text1).not.toContain("Live commit:");
        // Simulate deployment_updated event: status changes to active
        state.deployments = [
            makeDeployment({ environment: "production", status: "active", ref: "abc123" }),
        ];
        (0, deployment_detail_js_1.rebuildDisplayLines)(state, 80);
        const text2 = state.displayLines.map(renderer_js_1.stripAnsi).join("\n");
        (0, vitest_1.expect)(text2).toContain("LIVE");
        (0, vitest_1.expect)(text2).toContain("Live commit:");
        (0, vitest_1.expect)(text2).toContain("abc123");
    });
});
// --- Dashboard drill-down to deployment detail ---
(0, vitest_1.describe)("dashboard drill-down to deployment detail", () => {
    (0, vitest_1.it)("deployment detail state is creatable from project deployments", () => {
        // Simulates what drillDownToDeployments does: takes project deployments and creates detail state
        const projectDeployments = [
            makeDeployment({ id: "d1", environment: "production", status: "active", ref: "abc123",
                updatedAt: new Date(Date.now() - 60_000).toISOString() }),
            makeDeployment({ id: "d2", environment: "production", status: "inactive", ref: "old456",
                updatedAt: new Date(Date.now() - 3600_000).toISOString() }),
            makeDeployment({ id: "d3", environment: "staging", status: "active", ref: "stg789",
                updatedAt: new Date(Date.now() - 120_000).toISOString() }),
        ];
        const state = (0, deployment_detail_js_1.createDeploymentDetailState)(projectDeployments, "folia");
        const text = state.displayLines.map(renderer_js_1.stripAnsi).join("\n");
        // Shows both environments
        (0, vitest_1.expect)(text).toContain("PRODUCTION");
        (0, vitest_1.expect)(text).toContain("STAGING");
        // Shows deploy history
        (0, vitest_1.expect)(text).toContain("History (2)"); // 2 production deploys
        (0, vitest_1.expect)(text).toContain("History (1)"); // 1 staging deploy
        // Shows which commit is live
        (0, vitest_1.expect)(text).toContain("Live commit:");
        (0, vitest_1.expect)(text).toContain("abc123");
        (0, vitest_1.expect)(text).toContain("stg789");
        // Shows old deployment in history
        (0, vitest_1.expect)(text).toContain("old456");
    });
    (0, vitest_1.it)("deployment detail shows all deploys across environments from a single project", () => {
        const deployments = [
            makeDeployment({ id: "d1", environment: "production", status: "active", ref: "prod1" }),
            makeDeployment({ id: "d2", environment: "staging", status: "active", ref: "stg1" }),
            makeDeployment({ id: "d3", environment: "preview", status: "active", ref: "prev1" }),
        ];
        const state = (0, deployment_detail_js_1.createDeploymentDetailState)(deployments, "testproj");
        const text = state.displayLines.map(renderer_js_1.stripAnsi).join("\n");
        // All environments visible
        (0, vitest_1.expect)(text).toContain("PRODUCTION");
        (0, vitest_1.expect)(text).toContain("STAGING");
        (0, vitest_1.expect)(text).toContain("PREVIEW");
        // All commit SHAs visible
        (0, vitest_1.expect)(text).toContain("prod1");
        (0, vitest_1.expect)(text).toContain("stg1");
        (0, vitest_1.expect)(text).toContain("prev1");
    });
});
//# sourceMappingURL=dashboard-deploy-status.test.js.map