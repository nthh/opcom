import { describe, it, expect } from "vitest";
import type { ServiceInstance, HealthCheckResult } from "@opcom/types";
import { ScreenBuffer, stripAnsi } from "../../packages/cli/src/tui/renderer.js";
import {
  createServiceDetailState,
  renderServiceDetail,
  rebuildDisplayLines,
  scrollUp,
  scrollDown,
  scrollToTop,
  scrollToBottom,
  type ServiceDetailState,
} from "../../packages/cli/src/tui/views/service-detail.js";
import type { Panel } from "../../packages/cli/src/tui/layout.js";

function makePanel(): Panel {
  return { id: "focus", x: 0, y: 0, width: 80, height: 30, title: "Focus" };
}

function makeInstance(overrides: Partial<ServiceInstance> = {}): ServiceInstance {
  return {
    serviceName: "api",
    projectId: "folia",
    pid: 12345,
    port: 3000,
    state: "running",
    startedAt: new Date(Date.now() - 120_000).toISOString(),
    restartCount: 0,
    ...overrides,
  };
}

describe("service detail view", () => {
  it("creates state for a running service", () => {
    const instance = makeInstance();
    const state = createServiceDetailState("folia", "api", instance);

    expect(state.projectId).toBe("folia");
    expect(state.serviceName).toBe("api");
    expect(state.instance).toBe(instance);
    expect(state.displayLines.length).toBeGreaterThan(0);
    expect(state.scrollOffset).toBe(0);
  });

  it("creates state for a service not running", () => {
    const state = createServiceDetailState("folia", "api");

    expect(state.instance).toBeNull();
    expect(state.displayLines.length).toBeGreaterThan(0);
    const content = state.displayLines.map(stripAnsi).join("\n");
    expect(content).toContain("stopped");
  });

  it("shows PID and port for running service", () => {
    const instance = makeInstance({ pid: 9999, port: 8080 });
    const state = createServiceDetailState("folia", "api", instance);

    const content = state.displayLines.map(stripAnsi).join("\n");
    expect(content).toContain("9999");
    expect(content).toContain(":8080");
  });

  it("shows health check results", () => {
    const hc: HealthCheckResult = {
      healthy: true,
      checkedAt: new Date().toISOString(),
      latencyMs: 12,
    };
    const instance = makeInstance({ lastHealthCheck: hc });
    const state = createServiceDetailState("folia", "api", instance);

    const content = state.displayLines.map(stripAnsi).join("\n");
    expect(content).toContain("healthy");
    expect(content).toContain("12ms");
  });

  it("shows unhealthy health check with error", () => {
    const hc: HealthCheckResult = {
      healthy: false,
      checkedAt: new Date().toISOString(),
      latencyMs: 3000,
      error: "Connection refused",
    };
    const instance = makeInstance({ lastHealthCheck: hc, state: "unhealthy" });
    const state = createServiceDetailState("folia", "api", instance);

    const content = state.displayLines.map(stripAnsi).join("\n");
    expect(content).toContain("unhealthy");
    expect(content).toContain("Connection refused");
  });

  it("renders without error", () => {
    const instance = makeInstance();
    const state = createServiceDetailState("folia", "api", instance);
    const buf = new ScreenBuffer(80, 30);
    const panel = makePanel();

    renderServiceDetail(buf, panel, state);
    // No error thrown = success
  });

  it("shows restart count", () => {
    const instance = makeInstance({ restartCount: 3 });
    const state = createServiceDetailState("folia", "api", instance);

    const content = state.displayLines.map(stripAnsi).join("\n");
    expect(content).toContain("3");
  });
});

describe("service detail scrolling", () => {
  it("scrolls down", () => {
    const state = createServiceDetailState("folia", "api", makeInstance());
    expect(state.scrollOffset).toBe(0);

    scrollDown(state, 3, 10);
    expect(state.scrollOffset).toBe(3);
  });

  it("scrolls up", () => {
    const state = createServiceDetailState("folia", "api", makeInstance());
    state.scrollOffset = 5;

    scrollUp(state, 2);
    expect(state.scrollOffset).toBe(3);
  });

  it("does not scroll below 0", () => {
    const state = createServiceDetailState("folia", "api", makeInstance());
    scrollUp(state, 10);
    expect(state.scrollOffset).toBe(0);
  });

  it("scrollToTop resets offset", () => {
    const state = createServiceDetailState("folia", "api", makeInstance());
    state.scrollOffset = 10;
    scrollToTop(state);
    expect(state.scrollOffset).toBe(0);
  });

  it("scrollToBottom moves to end", () => {
    const state = createServiceDetailState("folia", "api", makeInstance());
    scrollToBottom(state);
    expect(state.scrollOffset).toBeGreaterThan(0);
  });
});

describe("rebuildDisplayLines", () => {
  it("rebuilds lines after instance update", () => {
    const state = createServiceDetailState("folia", "api", makeInstance({ state: "starting" }));
    const initialContent = state.displayLines.map(stripAnsi).join("\n");
    expect(initialContent).toContain("starting");

    // Simulate instance updating to running
    state.instance = makeInstance({ state: "running" });
    rebuildDisplayLines(state, 80);

    const updatedContent = state.displayLines.map(stripAnsi).join("\n");
    expect(updatedContent).toContain("running");
    expect(updatedContent).not.toContain("starting");
  });
});

describe("service detail logs", () => {
  it("shows log lines when present", () => {
    const instance = makeInstance({
      logs: [
        "Starting server on port 3000...",
        "Connected to database",
        "Ready to accept connections",
      ],
    });
    const state = createServiceDetailState("folia", "api", instance);

    const content = state.displayLines.map(stripAnsi).join("\n");
    expect(content).toContain("LOGS");
    expect(content).toContain("Starting server on port 3000...");
    expect(content).toContain("Connected to database");
    expect(content).toContain("Ready to accept connections");
  });

  it("does not show LOGS section when logs are empty", () => {
    const instance = makeInstance({ logs: [] });
    const state = createServiceDetailState("folia", "api", instance);

    const content = state.displayLines.map(stripAnsi).join("\n");
    expect(content).not.toContain("LOGS");
  });

  it("does not show LOGS section when logs are undefined", () => {
    const instance = makeInstance();
    const state = createServiceDetailState("folia", "api", instance);

    const content = state.displayLines.map(stripAnsi).join("\n");
    expect(content).not.toContain("LOGS");
  });

  it("renders log lines after health check section", () => {
    const hc: HealthCheckResult = {
      healthy: true,
      checkedAt: new Date().toISOString(),
      latencyMs: 5,
    };
    const instance = makeInstance({
      lastHealthCheck: hc,
      logs: ["Server started"],
    });
    const state = createServiceDetailState("folia", "api", instance);

    const content = state.displayLines.map(stripAnsi).join("\n");
    const healthIdx = content.indexOf("HEALTH CHECK");
    const logsIdx = content.indexOf("LOGS");
    expect(healthIdx).toBeGreaterThan(-1);
    expect(logsIdx).toBeGreaterThan(healthIdx);
  });
});
