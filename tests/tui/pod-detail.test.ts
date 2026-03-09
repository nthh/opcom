import { describe, it, expect } from "vitest";
import type { PodDetail } from "@opcom/types";
import {
  createPodDetailState,
  rebuildDisplayLines,
  renderPodDetail,
  scrollUp,
  scrollDown,
  scrollToTop,
  scrollToBottom,
} from "../../packages/cli/src/tui/views/pod-detail.js";
import { ScreenBuffer } from "../../packages/cli/src/tui/renderer.js";

function makePod(overrides: Partial<PodDetail> = {}): PodDetail {
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

describe("createPodDetailState", () => {
  it("creates initial state with display lines", () => {
    const pod = makePod();
    const state = createPodDetailState(pod, "folia");
    expect(state.pod).toBe(pod);
    expect(state.projectName).toBe("folia");
    expect(state.scrollOffset).toBe(0);
    expect(state.displayLines.length).toBeGreaterThan(0);
  });

  it("includes pod info in display lines", () => {
    const pod = makePod();
    const state = createPodDetailState(pod, "folia");
    const text = state.displayLines.join("\n");
    expect(text).toContain("api-7f8b9-abc");
    expect(text).toContain("Running");
    expect(text).toContain("folia-prod");
    expect(text).toContain("gke-pool-1-abc");
  });

  it("includes container info in display lines", () => {
    const pod = makePod();
    const state = createPodDetailState(pod, "folia");
    const text = state.displayLines.join("\n");
    expect(text).toContain("api");
    expect(text).toContain("ghcr.io/folia/api:v2.4.2");
  });

  it("shows crash reason for crashing containers", () => {
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
    const state = createPodDetailState(pod, "folia");
    const text = state.displayLines.join("\n");
    expect(text).toContain("CrashLoopBackOff");
    expect(text).toContain("4 restarts");
  });

  it("shows multiple containers", () => {
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
    const state = createPodDetailState(pod, "folia");
    const text = state.displayLines.join("\n");
    expect(text).toContain("CONTAINERS (2)");
    expect(text).toContain("api");
    expect(text).toContain("sidecar");
  });

  it("shows conditions when present", () => {
    const pod = makePod({
      conditions: [
        { type: "Ready", status: true, lastTransition: "2026-03-01T12:00:00Z" },
        { type: "ContainersReady", status: true, lastTransition: "2026-03-01T12:00:00Z" },
      ],
    });
    const state = createPodDetailState(pod, "folia");
    const text = state.displayLines.join("\n");
    expect(text).toContain("CONDITIONS");
    expect(text).toContain("Ready");
    expect(text).toContain("ContainersReady");
  });

  it("shows labels when present", () => {
    const pod = makePod({
      labels: { "app": "folia", "version": "v2" },
    });
    const state = createPodDetailState(pod, "folia");
    const text = state.displayLines.join("\n");
    expect(text).toContain("LABELS");
    expect(text).toContain("app");
    expect(text).toContain("folia");
  });
});

describe("rebuildDisplayLines", () => {
  it("rebuilds lines with new width", () => {
    const pod = makePod();
    const state = createPodDetailState(pod, "folia");
    const originalLength = state.displayLines.length;
    rebuildDisplayLines(state, 120);
    expect(state.displayLines.length).toBe(originalLength);
  });
});

describe("scroll helpers", () => {
  it("scrollDown increases offset", () => {
    const state = createPodDetailState(makePod(), "folia");
    scrollDown(state, 3, 10);
    expect(state.scrollOffset).toBe(3);
  });

  it("scrollUp decreases offset", () => {
    const state = createPodDetailState(makePod(), "folia");
    state.scrollOffset = 5;
    scrollUp(state, 2);
    expect(state.scrollOffset).toBe(3);
  });

  it("scrollUp does not go below 0", () => {
    const state = createPodDetailState(makePod(), "folia");
    scrollUp(state, 5);
    expect(state.scrollOffset).toBe(0);
  });

  it("scrollToTop resets to 0", () => {
    const state = createPodDetailState(makePod(), "folia");
    state.scrollOffset = 10;
    scrollToTop(state);
    expect(state.scrollOffset).toBe(0);
  });

  it("scrollToBottom goes to max offset", () => {
    const state = createPodDetailState(makePod(), "folia");
    scrollToBottom(state, 5);
    expect(state.scrollOffset).toBe(Math.max(0, state.displayLines.length - 5));
  });

  it("scrollDown clamps to max offset", () => {
    const state = createPodDetailState(makePod(), "folia");
    scrollDown(state, 1000, 5);
    expect(state.scrollOffset).toBe(Math.max(0, state.displayLines.length - 5));
  });
});

describe("renderPodDetail", () => {
  it("renders without error", () => {
    const pod = makePod();
    const state = createPodDetailState(pod, "folia");
    const buf = new ScreenBuffer();
    const panel = { x: 0, y: 0, width: 80, height: 24 };
    expect(() => renderPodDetail(buf, panel, state)).not.toThrow();
  });

  it("renders with scroll offset", () => {
    const pod = makePod();
    const state = createPodDetailState(pod, "folia");
    state.scrollOffset = 2;
    const buf = new ScreenBuffer();
    const panel = { x: 0, y: 0, width: 80, height: 24 };
    expect(() => renderPodDetail(buf, panel, state)).not.toThrow();
  });
});
