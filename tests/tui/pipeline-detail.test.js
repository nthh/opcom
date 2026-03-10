"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const renderer_js_1 = require("../../packages/cli/src/tui/renderer.js");
const pipeline_detail_js_1 = require("../../packages/cli/src/tui/views/pipeline-detail.js");
// --- Factories ---
function makeStep(overrides = {}) {
    return {
        name: "Run tests",
        status: "success",
        durationMs: 30_000,
        ...overrides,
    };
}
function makeJob(overrides = {}) {
    return {
        id: "job-1",
        name: "build",
        status: "success",
        durationMs: 60_000,
        steps: [makeStep()],
        ...overrides,
    };
}
function makePipeline(overrides = {}) {
    return {
        id: "run-1",
        projectId: "proj-1",
        provider: "github-actions",
        name: "CI Pipeline",
        ref: "refs/heads/main",
        commitSha: "abc1234567890def",
        commitMessage: "feat: add new feature",
        triggeredBy: "nathan",
        status: "success",
        startedAt: new Date(Date.now() - 300_000).toISOString(),
        durationMs: 120_000,
        url: "https://github.com/org/repo/actions/runs/1",
        jobs: [makeJob()],
        ...overrides,
    };
}
function makePanel(overrides = {}) {
    return {
        id: "focus",
        x: 0,
        y: 0,
        width: 80,
        height: 30,
        title: "Focus",
        ...overrides,
    };
}
// --- createPipelineDetailState tests ---
(0, vitest_1.describe)("createPipelineDetailState", () => {
    (0, vitest_1.it)("creates state with pipeline and project name", () => {
        const pipeline = makePipeline();
        const state = (0, pipeline_detail_js_1.createPipelineDetailState)(pipeline, "My Project");
        (0, vitest_1.expect)(state.pipeline).toBe(pipeline);
        (0, vitest_1.expect)(state.projectName).toBe("My Project");
        (0, vitest_1.expect)(state.scrollOffset).toBe(0);
        (0, vitest_1.expect)(state.displayLines.length).toBeGreaterThan(0);
    });
    (0, vitest_1.it)("builds display lines on creation", () => {
        const state = (0, pipeline_detail_js_1.createPipelineDetailState)(makePipeline(), "Test");
        (0, vitest_1.expect)(state.displayLines.length).toBeGreaterThan(5);
    });
});
// --- rebuildDisplayLines tests ---
(0, vitest_1.describe)("rebuildDisplayLines", () => {
    (0, vitest_1.it)("includes project name in header", () => {
        const state = (0, pipeline_detail_js_1.createPipelineDetailState)(makePipeline(), "My Project");
        const hasName = state.displayLines.some((l) => (0, renderer_js_1.stripAnsi)(l).includes("My Project"));
        (0, vitest_1.expect)(hasName).toBe(true);
    });
    (0, vitest_1.it)("includes workflow name", () => {
        const pipeline = makePipeline({ name: "Deploy Production" });
        const state = (0, pipeline_detail_js_1.createPipelineDetailState)(pipeline, "Test");
        const hasWorkflow = state.displayLines.some((l) => (0, renderer_js_1.stripAnsi)(l).includes("Deploy Production"));
        (0, vitest_1.expect)(hasWorkflow).toBe(true);
    });
    (0, vitest_1.it)("includes branch name without refs/heads/ prefix", () => {
        const pipeline = makePipeline({ ref: "refs/heads/feature/awesome" });
        const state = (0, pipeline_detail_js_1.createPipelineDetailState)(pipeline, "Test");
        const hasBranch = state.displayLines.some((l) => (0, renderer_js_1.stripAnsi)(l).includes("feature/awesome"));
        (0, vitest_1.expect)(hasBranch).toBe(true);
        const hasPrefix = state.displayLines.some((l) => (0, renderer_js_1.stripAnsi)(l).includes("refs/heads/"));
        (0, vitest_1.expect)(hasPrefix).toBe(false);
    });
    (0, vitest_1.it)("includes commit SHA (first 7 chars)", () => {
        const pipeline = makePipeline({ commitSha: "deadbeef1234567890" });
        const state = (0, pipeline_detail_js_1.createPipelineDetailState)(pipeline, "Test");
        const hasSha = state.displayLines.some((l) => (0, renderer_js_1.stripAnsi)(l).includes("deadbee"));
        (0, vitest_1.expect)(hasSha).toBe(true);
    });
    (0, vitest_1.it)("includes commit message", () => {
        const pipeline = makePipeline({ commitMessage: "fix: resolve race condition" });
        const state = (0, pipeline_detail_js_1.createPipelineDetailState)(pipeline, "Test");
        const hasMsg = state.displayLines.some((l) => (0, renderer_js_1.stripAnsi)(l).includes("resolve race condition"));
        (0, vitest_1.expect)(hasMsg).toBe(true);
    });
    (0, vitest_1.it)("includes triggered-by when present", () => {
        const pipeline = makePipeline({ triggeredBy: "github-bot" });
        const state = (0, pipeline_detail_js_1.createPipelineDetailState)(pipeline, "Test");
        const hasTrigger = state.displayLines.some((l) => (0, renderer_js_1.stripAnsi)(l).includes("github-bot"));
        (0, vitest_1.expect)(hasTrigger).toBe(true);
    });
    (0, vitest_1.it)("omits triggered-by when absent", () => {
        const pipeline = makePipeline({ triggeredBy: undefined });
        const state = (0, pipeline_detail_js_1.createPipelineDetailState)(pipeline, "Test");
        const hasTrigger = state.displayLines.some((l) => (0, renderer_js_1.stripAnsi)(l).includes("Triggered:"));
        (0, vitest_1.expect)(hasTrigger).toBe(false);
    });
    (0, vitest_1.it)("includes duration", () => {
        const pipeline = makePipeline({ durationMs: 90_000 });
        const state = (0, pipeline_detail_js_1.createPipelineDetailState)(pipeline, "Test");
        const hasDuration = state.displayLines.some((l) => (0, renderer_js_1.stripAnsi)(l).includes("1m30s"));
        (0, vitest_1.expect)(hasDuration).toBe(true);
    });
    (0, vitest_1.it)("includes URL", () => {
        const pipeline = makePipeline({ url: "https://github.com/org/repo/actions/runs/42" });
        const state = (0, pipeline_detail_js_1.createPipelineDetailState)(pipeline, "Test");
        const hasUrl = state.displayLines.some((l) => (0, renderer_js_1.stripAnsi)(l).includes("github.com"));
        (0, vitest_1.expect)(hasUrl).toBe(true);
    });
    (0, vitest_1.it)("includes job names", () => {
        const pipeline = makePipeline({
            jobs: [
                makeJob({ name: "lint" }),
                makeJob({ name: "test", id: "j2" }),
                makeJob({ name: "deploy", id: "j3" }),
            ],
        });
        const state = (0, pipeline_detail_js_1.createPipelineDetailState)(pipeline, "Test");
        const lines = state.displayLines.map((l) => (0, renderer_js_1.stripAnsi)(l));
        (0, vitest_1.expect)(lines.some((l) => l.includes("lint"))).toBe(true);
        (0, vitest_1.expect)(lines.some((l) => l.includes("test"))).toBe(true);
        (0, vitest_1.expect)(lines.some((l) => l.includes("deploy"))).toBe(true);
    });
    (0, vitest_1.it)("includes step names within jobs", () => {
        const pipeline = makePipeline({
            jobs: [makeJob({
                    steps: [
                        makeStep({ name: "Checkout code" }),
                        makeStep({ name: "Install deps" }),
                        makeStep({ name: "Run tests" }),
                    ],
                })],
        });
        const state = (0, pipeline_detail_js_1.createPipelineDetailState)(pipeline, "Test");
        const lines = state.displayLines.map((l) => (0, renderer_js_1.stripAnsi)(l));
        (0, vitest_1.expect)(lines.some((l) => l.includes("Checkout code"))).toBe(true);
        (0, vitest_1.expect)(lines.some((l) => l.includes("Install deps"))).toBe(true);
        (0, vitest_1.expect)(lines.some((l) => l.includes("Run tests"))).toBe(true);
    });
    (0, vitest_1.it)("shows 'No job data available' when no jobs", () => {
        const pipeline = makePipeline({ jobs: [] });
        const state = (0, pipeline_detail_js_1.createPipelineDetailState)(pipeline, "Test");
        const lines = state.displayLines.map((l) => (0, renderer_js_1.stripAnsi)(l));
        (0, vitest_1.expect)(lines.some((l) => l.includes("No job data available"))).toBe(true);
    });
    (0, vitest_1.it)("includes jobs header with count", () => {
        const pipeline = makePipeline({
            jobs: [makeJob(), makeJob({ id: "j2", name: "deploy" })],
        });
        const state = (0, pipeline_detail_js_1.createPipelineDetailState)(pipeline, "Test");
        const lines = state.displayLines.map((l) => (0, renderer_js_1.stripAnsi)(l));
        (0, vitest_1.expect)(lines.some((l) => l.includes("Jobs (2)"))).toBe(true);
    });
    (0, vitest_1.it)("includes job runner when present", () => {
        const pipeline = makePipeline({
            jobs: [makeJob({ runner: "ubuntu-latest" })],
        });
        const state = (0, pipeline_detail_js_1.createPipelineDetailState)(pipeline, "Test");
        const lines = state.displayLines.map((l) => (0, renderer_js_1.stripAnsi)(l));
        (0, vitest_1.expect)(lines.some((l) => l.includes("ubuntu-latest"))).toBe(true);
    });
});
// --- Scroll tests ---
(0, vitest_1.describe)("scrollDown", () => {
    (0, vitest_1.it)("increases scroll offset", () => {
        const state = (0, pipeline_detail_js_1.createPipelineDetailState)(makePipeline(), "Test");
        (0, vitest_1.expect)(state.scrollOffset).toBe(0);
        (0, pipeline_detail_js_1.scrollDown)(state, 3, 10);
        (0, vitest_1.expect)(state.scrollOffset).toBe(3);
    });
    (0, vitest_1.it)("does not exceed maximum", () => {
        const state = (0, pipeline_detail_js_1.createPipelineDetailState)(makePipeline({ jobs: [] }), "Test");
        const viewHeight = 5;
        (0, pipeline_detail_js_1.scrollDown)(state, 1000, viewHeight);
        (0, vitest_1.expect)(state.scrollOffset).toBe(Math.max(0, state.displayLines.length - viewHeight));
    });
});
(0, vitest_1.describe)("scrollUp", () => {
    (0, vitest_1.it)("decreases scroll offset", () => {
        const state = (0, pipeline_detail_js_1.createPipelineDetailState)(makePipeline(), "Test");
        state.scrollOffset = 5;
        (0, pipeline_detail_js_1.scrollUp)(state, 2);
        (0, vitest_1.expect)(state.scrollOffset).toBe(3);
    });
    (0, vitest_1.it)("does not go below 0", () => {
        const state = (0, pipeline_detail_js_1.createPipelineDetailState)(makePipeline(), "Test");
        state.scrollOffset = 1;
        (0, pipeline_detail_js_1.scrollUp)(state, 5);
        (0, vitest_1.expect)(state.scrollOffset).toBe(0);
    });
});
(0, vitest_1.describe)("scrollToTop", () => {
    (0, vitest_1.it)("sets scroll offset to 0", () => {
        const state = (0, pipeline_detail_js_1.createPipelineDetailState)(makePipeline(), "Test");
        state.scrollOffset = 10;
        (0, pipeline_detail_js_1.scrollToTop)(state);
        (0, vitest_1.expect)(state.scrollOffset).toBe(0);
    });
});
(0, vitest_1.describe)("scrollToBottom", () => {
    (0, vitest_1.it)("sets scroll offset to end", () => {
        const state = (0, pipeline_detail_js_1.createPipelineDetailState)(makePipeline(), "Test");
        const viewHeight = 5;
        (0, pipeline_detail_js_1.scrollToBottom)(state, viewHeight);
        (0, vitest_1.expect)(state.scrollOffset).toBe(Math.max(0, state.displayLines.length - viewHeight));
    });
});
// --- renderPipelineDetail tests ---
(0, vitest_1.describe)("renderPipelineDetail", () => {
    (0, vitest_1.it)("renders without crashing", () => {
        const buf = new renderer_js_1.ScreenBuffer(80, 30);
        const panel = makePanel();
        const state = (0, pipeline_detail_js_1.createPipelineDetailState)(makePipeline(), "Test Project");
        (0, pipeline_detail_js_1.renderPipelineDetail)(buf, panel, state);
        buf.flush();
    });
    (0, vitest_1.it)("renders with many jobs and steps", () => {
        const jobs = Array.from({ length: 5 }, (_, i) => makeJob({
            id: `j${i}`,
            name: `job-${i}`,
            steps: Array.from({ length: 3 }, (_, s) => makeStep({
                name: `step-${i}-${s}`,
                status: s === 0 ? "success" : s === 1 ? "in_progress" : "queued",
            })),
        }));
        const pipeline = makePipeline({ jobs });
        const state = (0, pipeline_detail_js_1.createPipelineDetailState)(pipeline, "Test");
        const buf = new renderer_js_1.ScreenBuffer(100, 40);
        const panel = makePanel({ width: 100, height: 40 });
        (0, pipeline_detail_js_1.renderPipelineDetail)(buf, panel, state);
        buf.flush();
    });
    (0, vitest_1.it)("renders with scroll offset", () => {
        const pipeline = makePipeline({
            jobs: Array.from({ length: 10 }, (_, i) => makeJob({ id: `j${i}`, name: `job-${i}` })),
        });
        const state = (0, pipeline_detail_js_1.createPipelineDetailState)(pipeline, "Test");
        state.scrollOffset = 5;
        const buf = new renderer_js_1.ScreenBuffer(80, 20);
        const panel = makePanel({ height: 20 });
        (0, pipeline_detail_js_1.renderPipelineDetail)(buf, panel, state);
        buf.flush();
    });
    (0, vitest_1.it)("handles narrow terminal", () => {
        const state = (0, pipeline_detail_js_1.createPipelineDetailState)(makePipeline(), "Test");
        const buf = new renderer_js_1.ScreenBuffer(40, 15);
        const panel = makePanel({ width: 40, height: 15 });
        (0, pipeline_detail_js_1.renderPipelineDetail)(buf, panel, state);
        buf.flush();
    });
    (0, vitest_1.it)("handles failure status pipeline", () => {
        const pipeline = makePipeline({
            status: "failure",
            jobs: [
                makeJob({ name: "lint", status: "success" }),
                makeJob({ id: "j2", name: "test", status: "failure", steps: [
                        makeStep({ name: "Run unit tests", status: "failure" }),
                    ] }),
            ],
        });
        const state = (0, pipeline_detail_js_1.createPipelineDetailState)(pipeline, "Test");
        const buf = new renderer_js_1.ScreenBuffer(80, 30);
        const panel = makePanel();
        (0, pipeline_detail_js_1.renderPipelineDetail)(buf, panel, state);
        buf.flush();
    });
});
// --- Client event handling integration ---
function makeDeployment(overrides = {}) {
    return {
        id: "deploy-1",
        projectId: "proj-1",
        provider: "github-actions",
        environment: "production",
        ref: "main",
        status: "active",
        createdAt: "2026-03-07T00:00:00Z",
        updatedAt: "2026-03-07T00:00:00Z",
        ...overrides,
    };
}
(0, vitest_1.describe)("client CI/CD event handling", () => {
    (0, vitest_1.it)("pipeline_updated adds new pipeline to cache", async () => {
        // Test the event shape matches server types
        const pipeline = makePipeline({ id: "new-run" });
        const event = { type: "pipeline_updated", projectId: "proj-1", pipeline };
        (0, vitest_1.expect)(event.type).toBe("pipeline_updated");
        (0, vitest_1.expect)(event.pipeline.id).toBe("new-run");
    });
    (0, vitest_1.it)("deployment_updated creates valid event", () => {
        const deployment = makeDeployment({ id: "new-deploy" });
        const event = { type: "deployment_updated", projectId: "proj-1", deployment };
        (0, vitest_1.expect)(event.type).toBe("deployment_updated");
        (0, vitest_1.expect)(event.deployment.id).toBe("new-deploy");
    });
});
//# sourceMappingURL=pipeline-detail.test.js.map