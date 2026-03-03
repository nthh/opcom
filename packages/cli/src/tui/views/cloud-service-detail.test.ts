import { describe, it, expect } from "vitest";
import type { CloudService, CloudServiceHealth } from "@opcom/types";
import {
  createCloudServiceDetailState,
  healthDot,
  healthIndicator,
  scrollUp,
  scrollDown,
  scrollToTop,
  scrollToBottom,
} from "./cloud-service-detail.js";

function makeService(overrides: Partial<CloudService> = {}): CloudService {
  return {
    id: "turso:test-db",
    projectId: "proj-1",
    provider: "turso",
    kind: "database",
    name: "test-db",
    status: "healthy",
    detail: {
      kind: "database",
      engine: "sqlite",
      sizeBytes: 1_200_000_000,
      tableCount: 245,
      region: "us-east-1",
      replicas: 3,
      migration: {
        tool: "prisma",
        applied: 47,
        pending: 0,
        lastMigrationName: "add_user_prefs",
        lastAppliedAt: "2026-02-27T14:00:00Z",
      },
    },
    capabilities: ["logs", "metrics", "migrate"],
    lastCheckedAt: new Date().toISOString(),
    url: "https://turso.tech/dashboard/test-db",
    ...overrides,
  };
}

describe("createCloudServiceDetailState", () => {
  it("creates state with correct initial values", () => {
    const service = makeService();
    const state = createCloudServiceDetailState(service, "folia");

    expect(state.service).toBe(service);
    expect(state.projectName).toBe("folia");
    expect(state.scrollOffset).toBe(0);
    expect(state.totalLines).toBe(0);
  });
});

describe("healthDot", () => {
  it("returns green dot for healthy", () => {
    const dot = healthDot("healthy");
    expect(dot).toContain("\u25cf");
  });

  it("returns yellow dot for degraded", () => {
    const dot = healthDot("degraded");
    expect(dot).toContain("\u25d0");
  });

  it("returns red dot for unreachable", () => {
    const dot = healthDot("unreachable");
    expect(dot).toContain("\u25cb");
  });

  it("returns dim dot for unknown", () => {
    const dot = healthDot("unknown");
    expect(dot).toContain("\u25cc");
  });
});

describe("healthIndicator", () => {
  it("includes status text", () => {
    expect(healthIndicator("healthy")).toContain("healthy");
    expect(healthIndicator("degraded")).toContain("degraded");
    expect(healthIndicator("unreachable")).toContain("unreachable");
    expect(healthIndicator("unknown")).toContain("unknown");
  });
});

describe("scroll helpers", () => {
  it("scrollDown increases offset", () => {
    const state = createCloudServiceDetailState(makeService(), "test");
    state.totalLines = 50;
    scrollDown(state, 5, 20);
    expect(state.scrollOffset).toBe(5);
  });

  it("scrollDown caps at max scroll", () => {
    const state = createCloudServiceDetailState(makeService(), "test");
    state.totalLines = 30;
    scrollDown(state, 100, 20);
    expect(state.scrollOffset).toBe(10); // 30 - 20
  });

  it("scrollUp decreases offset", () => {
    const state = createCloudServiceDetailState(makeService(), "test");
    state.scrollOffset = 10;
    scrollUp(state, 3);
    expect(state.scrollOffset).toBe(7);
  });

  it("scrollUp does not go below 0", () => {
    const state = createCloudServiceDetailState(makeService(), "test");
    state.scrollOffset = 2;
    scrollUp(state, 5);
    expect(state.scrollOffset).toBe(0);
  });

  it("scrollToTop resets to 0", () => {
    const state = createCloudServiceDetailState(makeService(), "test");
    state.scrollOffset = 15;
    scrollToTop(state);
    expect(state.scrollOffset).toBe(0);
  });

  it("scrollToBottom jumps to end", () => {
    const state = createCloudServiceDetailState(makeService(), "test");
    state.totalLines = 40;
    scrollToBottom(state, 20);
    expect(state.scrollOffset).toBe(20); // 40 - 20
  });
});
