"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const renderer_js_1 = require("../../packages/cli/src/tui/renderer.js");
const cicd_pane_js_1 = require("../../packages/cli/src/tui/views/cicd-pane.js");
// --- Factories ---
function makePipeline(overrides = {}) {
    return {
        id: "run-1",
        projectId: "proj-1",
        provider: "github-actions",
        name: "CI",
        ref: "refs/heads/main",
        commitSha: "abc1234567890",
        status: "success",
        startedAt: new Date(Date.now() - 300_000).toISOString(), // 5 min ago
        durationMs: 120_000,
        url: "https://github.com/org/repo/actions/runs/1",
        jobs: [],
        ...overrides,
    };
}
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
function makePanel(overrides = {}) {
    return {
        id: "cicd",
        x: 0,
        y: 0,
        width: 80,
        height: 20,
        title: "CI/CD",
        ...overrides,
    };
}
// --- formatDuration tests ---
(0, vitest_1.describe)("formatDuration", () => {
    (0, vitest_1.it)("formats milliseconds", () => {
        (0, vitest_1.expect)((0, cicd_pane_js_1.formatDuration)(500)).toBe("500ms");
    });
    (0, vitest_1.it)("formats seconds", () => {
        (0, vitest_1.expect)((0, cicd_pane_js_1.formatDuration)(45_000)).toBe("45s");
    });
    (0, vitest_1.it)("formats minutes and seconds", () => {
        (0, vitest_1.expect)((0, cicd_pane_js_1.formatDuration)(125_000)).toBe("2m5s");
    });
    (0, vitest_1.it)("formats exact minutes", () => {
        (0, vitest_1.expect)((0, cicd_pane_js_1.formatDuration)(120_000)).toBe("2m");
    });
    (0, vitest_1.it)("formats hours and minutes", () => {
        (0, vitest_1.expect)((0, cicd_pane_js_1.formatDuration)(3_900_000)).toBe("1h5m");
    });
    (0, vitest_1.it)("formats exact hours", () => {
        (0, vitest_1.expect)((0, cicd_pane_js_1.formatDuration)(3_600_000)).toBe("1h");
    });
});
// --- formatTimeAgo tests ---
(0, vitest_1.describe)("formatTimeAgo", () => {
    (0, vitest_1.it)("returns 'just now' for recent timestamps", () => {
        const recent = new Date(Date.now() - 10_000).toISOString();
        (0, vitest_1.expect)((0, cicd_pane_js_1.formatTimeAgo)(recent)).toBe("just now");
    });
    (0, vitest_1.it)("returns minutes ago", () => {
        const fiveMin = new Date(Date.now() - 300_000).toISOString();
        (0, vitest_1.expect)((0, cicd_pane_js_1.formatTimeAgo)(fiveMin)).toBe("5m ago");
    });
    (0, vitest_1.it)("returns hours ago", () => {
        const twoHours = new Date(Date.now() - 7_200_000).toISOString();
        (0, vitest_1.expect)((0, cicd_pane_js_1.formatTimeAgo)(twoHours)).toBe("2h ago");
    });
    (0, vitest_1.it)("returns days ago", () => {
        const threeDays = new Date(Date.now() - 259_200_000).toISOString();
        (0, vitest_1.expect)((0, cicd_pane_js_1.formatTimeAgo)(threeDays)).toBe("3d ago");
    });
    (0, vitest_1.it)("returns raw string for invalid ISO", () => {
        (0, vitest_1.expect)((0, cicd_pane_js_1.formatTimeAgo)("not-a-date")).toBe("not-a-date");
    });
});
// --- pipelineStatusIcon tests ---
(0, vitest_1.describe)("pipelineStatusIcon", () => {
    const statuses = [
        "success", "failure", "in_progress", "queued",
        "cancelled", "timed_out", "skipped",
    ];
    for (const status of statuses) {
        (0, vitest_1.it)(`returns an icon for ${status}`, () => {
            const icon = (0, cicd_pane_js_1.pipelineStatusIcon)(status);
            (0, vitest_1.expect)((0, renderer_js_1.stripAnsi)(icon).length).toBeGreaterThan(0);
        });
    }
});
// --- deploymentStateIcon tests ---
(0, vitest_1.describe)("deploymentStateIcon", () => {
    const states = [
        "active", "in_progress", "pending", "inactive", "failed", "error",
    ];
    for (const state of states) {
        (0, vitest_1.it)(`returns an icon for ${state}`, () => {
            const icon = (0, cicd_pane_js_1.deploymentStateIcon)(state);
            (0, vitest_1.expect)((0, renderer_js_1.stripAnsi)(icon).length).toBeGreaterThan(0);
        });
    }
});
// --- buildCICDRows tests ---
(0, vitest_1.describe)("buildCICDRows", () => {
    (0, vitest_1.it)("returns empty array when no data", () => {
        const rows = (0, cicd_pane_js_1.buildCICDRows)([], []);
        (0, vitest_1.expect)(rows).toHaveLength(0);
    });
    (0, vitest_1.it)("builds rows with pipeline header and items", () => {
        const pipelines = [makePipeline({ id: "r1" }), makePipeline({ id: "r2" })];
        const rows = (0, cicd_pane_js_1.buildCICDRows)(pipelines, []);
        (0, vitest_1.expect)(rows).toHaveLength(3); // 1 header + 2 pipelines
        (0, vitest_1.expect)(rows[0].type).toBe("header");
        (0, vitest_1.expect)(rows[0].text).toContain("WORKFLOWS");
        (0, vitest_1.expect)(rows[1].type).toBe("pipeline");
        (0, vitest_1.expect)(rows[1].itemIndex).toBe(0);
        (0, vitest_1.expect)(rows[2].type).toBe("pipeline");
        (0, vitest_1.expect)(rows[2].itemIndex).toBe(1);
    });
    (0, vitest_1.it)("builds rows with deployment header and items", () => {
        const deployments = [makeDeployment({ id: "d1" })];
        const rows = (0, cicd_pane_js_1.buildCICDRows)([], deployments);
        (0, vitest_1.expect)(rows).toHaveLength(2); // 1 header + 1 deployment
        (0, vitest_1.expect)(rows[0].type).toBe("header");
        (0, vitest_1.expect)(rows[0].text).toContain("DEPLOYMENTS");
        (0, vitest_1.expect)(rows[1].type).toBe("deployment");
        (0, vitest_1.expect)(rows[1].itemIndex).toBe(0);
    });
    (0, vitest_1.it)("builds mixed rows with correct indices", () => {
        const pipelines = [makePipeline({ id: "r1" })];
        const deployments = [makeDeployment({ id: "d1" }), makeDeployment({ id: "d2" })];
        const rows = (0, cicd_pane_js_1.buildCICDRows)(pipelines, deployments);
        // 1 pipeline header + 1 pipeline + 1 deployment header + 2 deployments = 5
        (0, vitest_1.expect)(rows).toHaveLength(5);
        (0, vitest_1.expect)(rows[1].itemIndex).toBe(0); // pipeline
        (0, vitest_1.expect)(rows[3].itemIndex).toBe(1); // first deployment
        (0, vitest_1.expect)(rows[4].itemIndex).toBe(2); // second deployment
    });
});
// --- getCICDItemCount tests ---
(0, vitest_1.describe)("getCICDItemCount", () => {
    (0, vitest_1.it)("returns 0 for empty lists", () => {
        (0, vitest_1.expect)((0, cicd_pane_js_1.getCICDItemCount)([], [])).toBe(0);
    });
    (0, vitest_1.it)("returns sum of pipelines and deployments", () => {
        const pipelines = [makePipeline(), makePipeline({ id: "r2" })];
        const deployments = [makeDeployment()];
        (0, vitest_1.expect)((0, cicd_pane_js_1.getCICDItemCount)(pipelines, deployments)).toBe(3);
    });
});
// --- getPipelineAtIndex / getDeploymentAtIndex tests ---
(0, vitest_1.describe)("getPipelineAtIndex", () => {
    (0, vitest_1.it)("returns pipeline for index within pipeline range", () => {
        const pipelines = [makePipeline({ id: "r1" }), makePipeline({ id: "r2" })];
        const deployments = [makeDeployment()];
        (0, vitest_1.expect)((0, cicd_pane_js_1.getPipelineAtIndex)(pipelines, deployments, 0)?.id).toBe("r1");
        (0, vitest_1.expect)((0, cicd_pane_js_1.getPipelineAtIndex)(pipelines, deployments, 1)?.id).toBe("r2");
    });
    (0, vitest_1.it)("returns null for deployment index", () => {
        const pipelines = [makePipeline()];
        const deployments = [makeDeployment()];
        (0, vitest_1.expect)((0, cicd_pane_js_1.getPipelineAtIndex)(pipelines, deployments, 1)).toBeNull();
    });
});
(0, vitest_1.describe)("getDeploymentAtIndex", () => {
    (0, vitest_1.it)("returns deployment for index past pipelines", () => {
        const pipelines = [makePipeline()];
        const deployments = [makeDeployment({ id: "d1" }), makeDeployment({ id: "d2" })];
        (0, vitest_1.expect)((0, cicd_pane_js_1.getDeploymentAtIndex)(pipelines, deployments, 1)?.id).toBe("d1");
        (0, vitest_1.expect)((0, cicd_pane_js_1.getDeploymentAtIndex)(pipelines, deployments, 2)?.id).toBe("d2");
    });
    (0, vitest_1.it)("returns null for pipeline index", () => {
        const pipelines = [makePipeline()];
        const deployments = [makeDeployment()];
        (0, vitest_1.expect)((0, cicd_pane_js_1.getDeploymentAtIndex)(pipelines, deployments, 0)).toBeNull();
    });
    (0, vitest_1.it)("returns null for out-of-range index", () => {
        const pipelines = [makePipeline()];
        const deployments = [makeDeployment()];
        (0, vitest_1.expect)((0, cicd_pane_js_1.getDeploymentAtIndex)(pipelines, deployments, 5)).toBeNull();
    });
});
// --- formatPipelineLine tests ---
(0, vitest_1.describe)("formatPipelineLine", () => {
    (0, vitest_1.it)("includes branch name without refs/heads/ prefix", () => {
        const pipeline = makePipeline({ ref: "refs/heads/feature-branch" });
        const line = (0, renderer_js_1.stripAnsi)((0, cicd_pane_js_1.formatPipelineLine)(pipeline, 100));
        (0, vitest_1.expect)(line).toContain("feature-branch");
        (0, vitest_1.expect)(line).not.toContain("refs/heads/");
    });
    (0, vitest_1.it)("includes workflow name", () => {
        const pipeline = makePipeline({ name: "Build & Deploy" });
        const line = (0, renderer_js_1.stripAnsi)((0, cicd_pane_js_1.formatPipelineLine)(pipeline, 100));
        (0, vitest_1.expect)(line).toContain("Build & Deploy");
    });
    (0, vitest_1.it)("includes duration when present", () => {
        const pipeline = makePipeline({ durationMs: 90_000 });
        const line = (0, renderer_js_1.stripAnsi)((0, cicd_pane_js_1.formatPipelineLine)(pipeline, 100));
        (0, vitest_1.expect)(line).toContain("1m30s");
    });
    (0, vitest_1.it)("omits duration when not present", () => {
        const pipeline = makePipeline({ durationMs: undefined });
        const line = (0, renderer_js_1.stripAnsi)((0, cicd_pane_js_1.formatPipelineLine)(pipeline, 100));
        (0, vitest_1.expect)(line).not.toContain("ms");
    });
    (0, vitest_1.it)("truncates to maxWidth", () => {
        const pipeline = makePipeline({ name: "A very long workflow name that should be truncated" });
        const line = (0, renderer_js_1.stripAnsi)((0, cicd_pane_js_1.formatPipelineLine)(pipeline, 30));
        (0, vitest_1.expect)(line.length).toBeLessThanOrEqual(30);
    });
});
// --- formatDeploymentLine tests ---
(0, vitest_1.describe)("formatDeploymentLine", () => {
    (0, vitest_1.it)("includes environment name", () => {
        const deployment = makeDeployment({ environment: "staging" });
        const line = (0, renderer_js_1.stripAnsi)((0, cicd_pane_js_1.formatDeploymentLine)(deployment, 100));
        (0, vitest_1.expect)(line).toContain("staging");
    });
    (0, vitest_1.it)("includes status", () => {
        const deployment = makeDeployment({ status: "active" });
        const line = (0, renderer_js_1.stripAnsi)((0, cicd_pane_js_1.formatDeploymentLine)(deployment, 100));
        (0, vitest_1.expect)(line).toContain("active");
    });
    (0, vitest_1.it)("includes time ago", () => {
        const deployment = makeDeployment({
            updatedAt: new Date(Date.now() - 7_200_000).toISOString(),
        });
        const line = (0, renderer_js_1.stripAnsi)((0, cicd_pane_js_1.formatDeploymentLine)(deployment, 100));
        (0, vitest_1.expect)(line).toContain("2h ago");
    });
});
// --- renderCICDPanel tests ---
(0, vitest_1.describe)("renderCICDPanel", () => {
    (0, vitest_1.it)("renders empty state message", () => {
        const buf = new renderer_js_1.ScreenBuffer(80, 20);
        const panel = makePanel();
        (0, cicd_pane_js_1.renderCICDPanel)(buf, panel, [], [], 0, 0, false);
        buf.flush();
        // No crash for empty state
    });
    (0, vitest_1.it)("renders pipelines", () => {
        const buf = new renderer_js_1.ScreenBuffer(80, 20);
        const panel = makePanel();
        const pipelines = [
            makePipeline({ name: "CI", status: "success" }),
            makePipeline({ id: "r2", name: "Deploy", status: "failure" }),
        ];
        (0, cicd_pane_js_1.renderCICDPanel)(buf, panel, pipelines, [], 0, 0, true);
        buf.flush();
        // No crash with pipeline data
    });
    (0, vitest_1.it)("renders deployments", () => {
        const buf = new renderer_js_1.ScreenBuffer(80, 20);
        const panel = makePanel();
        const deployments = [
            makeDeployment({ environment: "production", status: "active" }),
            makeDeployment({ id: "d2", environment: "staging", status: "pending" }),
        ];
        (0, cicd_pane_js_1.renderCICDPanel)(buf, panel, [], deployments, 0, 0, true);
        buf.flush();
        // No crash with deployment data
    });
    (0, vitest_1.it)("renders mixed pipelines and deployments", () => {
        const buf = new renderer_js_1.ScreenBuffer(100, 25);
        const panel = makePanel({ width: 100, height: 25 });
        const pipelines = [makePipeline()];
        const deployments = [makeDeployment()];
        (0, cicd_pane_js_1.renderCICDPanel)(buf, panel, pipelines, deployments, 0, 0, true);
        buf.flush();
        // No crash with mixed data
    });
    (0, vitest_1.it)("handles narrow terminal", () => {
        const buf = new renderer_js_1.ScreenBuffer(40, 10);
        const panel = makePanel({ width: 40, height: 10 });
        const pipelines = [makePipeline()];
        (0, cicd_pane_js_1.renderCICDPanel)(buf, panel, pipelines, [], 0, 0, false);
        buf.flush();
        // No crash in narrow terminal
    });
    (0, vitest_1.it)("handles scrolling with offset", () => {
        const buf = new renderer_js_1.ScreenBuffer(80, 10);
        const panel = makePanel({ height: 10 });
        const pipelines = Array.from({ length: 20 }, (_, i) => makePipeline({ id: `r${i}`, name: `Workflow ${i}` }));
        (0, cicd_pane_js_1.renderCICDPanel)(buf, panel, pipelines, [], 5, 10, false);
        buf.flush();
        // No crash with scroll offset
    });
});
// --- Project detail CI/CD panel integration ---
(0, vitest_1.describe)("project detail CI/CD integration", () => {
    (0, vitest_1.it)("includes CI/CD panel count of 8", async () => {
        const { PANEL_COUNT } = await import("../../packages/cli/src/tui/views/project-detail.js");
        (0, vitest_1.expect)(PANEL_COUNT).toBe(8);
    });
    (0, vitest_1.it)("creates state with empty CI/CD data", async () => {
        const { createProjectDetailState } = await import("../../packages/cli/src/tui/views/project-detail.js");
        const state = createProjectDetailState({
            id: "proj-1",
            name: "Test Project",
            path: "/test",
            git: null,
            workSummary: null,
        });
        (0, vitest_1.expect)(state.pipelines).toEqual([]);
        (0, vitest_1.expect)(state.deployments).toEqual([]);
        (0, vitest_1.expect)(state.selectedIndex).toHaveLength(8);
        (0, vitest_1.expect)(state.scrollOffset).toHaveLength(8);
    });
    (0, vitest_1.it)("getPanelItemCount returns CI/CD item count for panel 5", async () => {
        const { createProjectDetailState, getPanelItemCount } = await import("../../packages/cli/src/tui/views/project-detail.js");
        const state = createProjectDetailState({
            id: "proj-1",
            name: "Test",
            path: "/test",
            git: null,
            workSummary: null,
        });
        state.pipelines = [makePipeline()];
        state.deployments = [makeDeployment(), makeDeployment({ id: "d2" })];
        (0, vitest_1.expect)(getPanelItemCount(state, 5)).toBe(3);
    });
    (0, vitest_1.it)("clampSelection handles CI/CD panel", async () => {
        const { createProjectDetailState, clampSelection } = await import("../../packages/cli/src/tui/views/project-detail.js");
        const state = createProjectDetailState({
            id: "proj-1",
            name: "Test",
            path: "/test",
            git: null,
            workSummary: null,
        });
        state.pipelines = [makePipeline()];
        state.selectedIndex[5] = 10; // out of range
        clampSelection(state);
        (0, vitest_1.expect)(state.selectedIndex[5]).toBe(0); // clamped to max (1 item, so index 0)
    });
});
//# sourceMappingURL=cicd-pane.test.js.map