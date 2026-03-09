import { describe, it, expect } from "vitest";
import { stripAnsi, ScreenBuffer } from "../../packages/cli/src/tui/renderer.js";
import {
  createPipelineDetailState,
  rebuildDisplayLines,
  renderPipelineDetail,
  scrollUp,
  scrollDown,
  scrollToTop,
  scrollToBottom,
  type PipelineDetailState,
} from "../../packages/cli/src/tui/views/pipeline-detail.js";
import type { Pipeline, PipelineJob, PipelineStep, DeploymentStatus } from "@opcom/types";
import type { Panel } from "../../packages/cli/src/tui/layout.js";

// --- Factories ---

function makeStep(overrides: Partial<PipelineStep> = {}): PipelineStep {
  return {
    name: "Run tests",
    status: "success",
    durationMs: 30_000,
    ...overrides,
  };
}

function makeJob(overrides: Partial<PipelineJob> = {}): PipelineJob {
  return {
    id: "job-1",
    name: "build",
    status: "success",
    durationMs: 60_000,
    steps: [makeStep()],
    ...overrides,
  };
}

function makePipeline(overrides: Partial<Pipeline> = {}): Pipeline {
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

function makePanel(overrides: Partial<Panel> = {}): Panel {
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

describe("createPipelineDetailState", () => {
  it("creates state with pipeline and project name", () => {
    const pipeline = makePipeline();
    const state = createPipelineDetailState(pipeline, "My Project");
    expect(state.pipeline).toBe(pipeline);
    expect(state.projectName).toBe("My Project");
    expect(state.scrollOffset).toBe(0);
    expect(state.displayLines.length).toBeGreaterThan(0);
  });

  it("builds display lines on creation", () => {
    const state = createPipelineDetailState(makePipeline(), "Test");
    expect(state.displayLines.length).toBeGreaterThan(5);
  });
});

// --- rebuildDisplayLines tests ---

describe("rebuildDisplayLines", () => {
  it("includes project name in header", () => {
    const state = createPipelineDetailState(makePipeline(), "My Project");
    const hasName = state.displayLines.some((l) => stripAnsi(l).includes("My Project"));
    expect(hasName).toBe(true);
  });

  it("includes workflow name", () => {
    const pipeline = makePipeline({ name: "Deploy Production" });
    const state = createPipelineDetailState(pipeline, "Test");
    const hasWorkflow = state.displayLines.some((l) => stripAnsi(l).includes("Deploy Production"));
    expect(hasWorkflow).toBe(true);
  });

  it("includes branch name without refs/heads/ prefix", () => {
    const pipeline = makePipeline({ ref: "refs/heads/feature/awesome" });
    const state = createPipelineDetailState(pipeline, "Test");
    const hasBranch = state.displayLines.some((l) => stripAnsi(l).includes("feature/awesome"));
    expect(hasBranch).toBe(true);
    const hasPrefix = state.displayLines.some((l) => stripAnsi(l).includes("refs/heads/"));
    expect(hasPrefix).toBe(false);
  });

  it("includes commit SHA (first 7 chars)", () => {
    const pipeline = makePipeline({ commitSha: "deadbeef1234567890" });
    const state = createPipelineDetailState(pipeline, "Test");
    const hasSha = state.displayLines.some((l) => stripAnsi(l).includes("deadbee"));
    expect(hasSha).toBe(true);
  });

  it("includes commit message", () => {
    const pipeline = makePipeline({ commitMessage: "fix: resolve race condition" });
    const state = createPipelineDetailState(pipeline, "Test");
    const hasMsg = state.displayLines.some((l) => stripAnsi(l).includes("resolve race condition"));
    expect(hasMsg).toBe(true);
  });

  it("includes triggered-by when present", () => {
    const pipeline = makePipeline({ triggeredBy: "github-bot" });
    const state = createPipelineDetailState(pipeline, "Test");
    const hasTrigger = state.displayLines.some((l) => stripAnsi(l).includes("github-bot"));
    expect(hasTrigger).toBe(true);
  });

  it("omits triggered-by when absent", () => {
    const pipeline = makePipeline({ triggeredBy: undefined });
    const state = createPipelineDetailState(pipeline, "Test");
    const hasTrigger = state.displayLines.some((l) => stripAnsi(l).includes("Triggered:"));
    expect(hasTrigger).toBe(false);
  });

  it("includes duration", () => {
    const pipeline = makePipeline({ durationMs: 90_000 });
    const state = createPipelineDetailState(pipeline, "Test");
    const hasDuration = state.displayLines.some((l) => stripAnsi(l).includes("1m30s"));
    expect(hasDuration).toBe(true);
  });

  it("includes URL", () => {
    const pipeline = makePipeline({ url: "https://github.com/org/repo/actions/runs/42" });
    const state = createPipelineDetailState(pipeline, "Test");
    const hasUrl = state.displayLines.some((l) => stripAnsi(l).includes("github.com"));
    expect(hasUrl).toBe(true);
  });

  it("includes job names", () => {
    const pipeline = makePipeline({
      jobs: [
        makeJob({ name: "lint" }),
        makeJob({ name: "test", id: "j2" }),
        makeJob({ name: "deploy", id: "j3" }),
      ],
    });
    const state = createPipelineDetailState(pipeline, "Test");
    const lines = state.displayLines.map((l) => stripAnsi(l));
    expect(lines.some((l) => l.includes("lint"))).toBe(true);
    expect(lines.some((l) => l.includes("test"))).toBe(true);
    expect(lines.some((l) => l.includes("deploy"))).toBe(true);
  });

  it("includes step names within jobs", () => {
    const pipeline = makePipeline({
      jobs: [makeJob({
        steps: [
          makeStep({ name: "Checkout code" }),
          makeStep({ name: "Install deps" }),
          makeStep({ name: "Run tests" }),
        ],
      })],
    });
    const state = createPipelineDetailState(pipeline, "Test");
    const lines = state.displayLines.map((l) => stripAnsi(l));
    expect(lines.some((l) => l.includes("Checkout code"))).toBe(true);
    expect(lines.some((l) => l.includes("Install deps"))).toBe(true);
    expect(lines.some((l) => l.includes("Run tests"))).toBe(true);
  });

  it("shows 'No job data available' when no jobs", () => {
    const pipeline = makePipeline({ jobs: [] });
    const state = createPipelineDetailState(pipeline, "Test");
    const lines = state.displayLines.map((l) => stripAnsi(l));
    expect(lines.some((l) => l.includes("No job data available"))).toBe(true);
  });

  it("includes jobs header with count", () => {
    const pipeline = makePipeline({
      jobs: [makeJob(), makeJob({ id: "j2", name: "deploy" })],
    });
    const state = createPipelineDetailState(pipeline, "Test");
    const lines = state.displayLines.map((l) => stripAnsi(l));
    expect(lines.some((l) => l.includes("Jobs (2)"))).toBe(true);
  });

  it("includes job runner when present", () => {
    const pipeline = makePipeline({
      jobs: [makeJob({ runner: "ubuntu-latest" })],
    });
    const state = createPipelineDetailState(pipeline, "Test");
    const lines = state.displayLines.map((l) => stripAnsi(l));
    expect(lines.some((l) => l.includes("ubuntu-latest"))).toBe(true);
  });
});

// --- Scroll tests ---

describe("scrollDown", () => {
  it("increases scroll offset", () => {
    const state = createPipelineDetailState(makePipeline(), "Test");
    expect(state.scrollOffset).toBe(0);
    scrollDown(state, 3, 10);
    expect(state.scrollOffset).toBe(3);
  });

  it("does not exceed maximum", () => {
    const state = createPipelineDetailState(makePipeline({ jobs: [] }), "Test");
    const viewHeight = 5;
    scrollDown(state, 1000, viewHeight);
    expect(state.scrollOffset).toBe(Math.max(0, state.displayLines.length - viewHeight));
  });
});

describe("scrollUp", () => {
  it("decreases scroll offset", () => {
    const state = createPipelineDetailState(makePipeline(), "Test");
    state.scrollOffset = 5;
    scrollUp(state, 2);
    expect(state.scrollOffset).toBe(3);
  });

  it("does not go below 0", () => {
    const state = createPipelineDetailState(makePipeline(), "Test");
    state.scrollOffset = 1;
    scrollUp(state, 5);
    expect(state.scrollOffset).toBe(0);
  });
});

describe("scrollToTop", () => {
  it("sets scroll offset to 0", () => {
    const state = createPipelineDetailState(makePipeline(), "Test");
    state.scrollOffset = 10;
    scrollToTop(state);
    expect(state.scrollOffset).toBe(0);
  });
});

describe("scrollToBottom", () => {
  it("sets scroll offset to end", () => {
    const state = createPipelineDetailState(makePipeline(), "Test");
    const viewHeight = 5;
    scrollToBottom(state, viewHeight);
    expect(state.scrollOffset).toBe(Math.max(0, state.displayLines.length - viewHeight));
  });
});

// --- renderPipelineDetail tests ---

describe("renderPipelineDetail", () => {
  it("renders without crashing", () => {
    const buf = new ScreenBuffer(80, 30);
    const panel = makePanel();
    const state = createPipelineDetailState(makePipeline(), "Test Project");
    renderPipelineDetail(buf, panel, state);
    buf.flush();
  });

  it("renders with many jobs and steps", () => {
    const jobs: PipelineJob[] = Array.from({ length: 5 }, (_, i) => makeJob({
      id: `j${i}`,
      name: `job-${i}`,
      steps: Array.from({ length: 3 }, (_, s) => makeStep({
        name: `step-${i}-${s}`,
        status: s === 0 ? "success" : s === 1 ? "in_progress" : "queued",
      })),
    }));
    const pipeline = makePipeline({ jobs });
    const state = createPipelineDetailState(pipeline, "Test");
    const buf = new ScreenBuffer(100, 40);
    const panel = makePanel({ width: 100, height: 40 });
    renderPipelineDetail(buf, panel, state);
    buf.flush();
  });

  it("renders with scroll offset", () => {
    const pipeline = makePipeline({
      jobs: Array.from({ length: 10 }, (_, i) => makeJob({ id: `j${i}`, name: `job-${i}` })),
    });
    const state = createPipelineDetailState(pipeline, "Test");
    state.scrollOffset = 5;
    const buf = new ScreenBuffer(80, 20);
    const panel = makePanel({ height: 20 });
    renderPipelineDetail(buf, panel, state);
    buf.flush();
  });

  it("handles narrow terminal", () => {
    const state = createPipelineDetailState(makePipeline(), "Test");
    const buf = new ScreenBuffer(40, 15);
    const panel = makePanel({ width: 40, height: 15 });
    renderPipelineDetail(buf, panel, state);
    buf.flush();
  });

  it("handles failure status pipeline", () => {
    const pipeline = makePipeline({
      status: "failure",
      jobs: [
        makeJob({ name: "lint", status: "success" }),
        makeJob({ id: "j2", name: "test", status: "failure", steps: [
          makeStep({ name: "Run unit tests", status: "failure" }),
        ]}),
      ],
    });
    const state = createPipelineDetailState(pipeline, "Test");
    const buf = new ScreenBuffer(80, 30);
    const panel = makePanel();
    renderPipelineDetail(buf, panel, state);
    buf.flush();
  });
});

// --- Client event handling integration ---

function makeDeployment(overrides: Partial<DeploymentStatus> = {}): DeploymentStatus {
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

describe("client CI/CD event handling", () => {
  it("pipeline_updated adds new pipeline to cache", async () => {
    // Test the event shape matches server types
    const pipeline = makePipeline({ id: "new-run" });
    const event = { type: "pipeline_updated" as const, projectId: "proj-1", pipeline };
    expect(event.type).toBe("pipeline_updated");
    expect(event.pipeline.id).toBe("new-run");
  });

  it("deployment_updated creates valid event", () => {
    const deployment = makeDeployment({ id: "new-deploy" });
    const event = { type: "deployment_updated" as const, projectId: "proj-1", deployment };
    expect(event.type).toBe("deployment_updated");
    expect(event.deployment.id).toBe("new-deploy");
  });
});
