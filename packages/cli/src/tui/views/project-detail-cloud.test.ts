import { describe, it, expect } from "vitest";
import type { CloudService, ProjectStatusSnapshot } from "@opcom/types";
import {
  createProjectDetailState,
  buildCloudSections,
  getCloudServicesList,
  getPanelItemCount,
  clampSelection,
  PANEL_COUNT,
} from "./project-detail.js";

function makeProject(): ProjectStatusSnapshot {
  return {
    id: "proj-1",
    name: "folia",
    path: "/projects/folia",
    git: { remote: null, branch: "main", clean: true },
    workSummary: { open: 3, total: 5, inProgress: 1, closed: 1, deferred: 0 },
  };
}

function makeCloudService(overrides: Partial<CloudService>): CloudService {
  return {
    id: `${overrides.provider ?? "turso"}:${overrides.name ?? "test"}`,
    projectId: "proj-1",
    provider: "turso",
    kind: "database",
    name: "test",
    status: "healthy",
    detail: { kind: "database", engine: "sqlite" },
    capabilities: [],
    lastCheckedAt: new Date().toISOString(),
    ...overrides,
  };
}

describe("buildCloudSections", () => {
  it("returns empty for no services", () => {
    const sections = buildCloudSections([]);
    expect(sections).toHaveLength(0);
  });

  it("groups services by kind", () => {
    const services: CloudService[] = [
      makeCloudService({ provider: "turso", kind: "database", name: "db1" }),
      makeCloudService({ provider: "neon", kind: "database", name: "db2" }),
      makeCloudService({ provider: "cloudflare-r2", kind: "storage", name: "assets" }),
      makeCloudService({ provider: "cloudflare-workers", kind: "serverless", name: "api" }),
    ];

    const sections = buildCloudSections(services);
    expect(sections).toHaveLength(3);
    expect(sections[0].title).toBe("DATABASES");
    expect(sections[0].services).toHaveLength(2);
    expect(sections[1].title).toBe("STORAGE");
    expect(sections[1].services).toHaveLength(1);
    expect(sections[2].title).toBe("SERVERLESS");
    expect(sections[2].services).toHaveLength(1);
  });

  it("only includes sections with data", () => {
    const services: CloudService[] = [
      makeCloudService({ provider: "firebase-hosting", kind: "hosting", name: "web" }),
    ];

    const sections = buildCloudSections(services);
    expect(sections).toHaveLength(1);
    expect(sections[0].title).toBe("HOSTING");
  });

  it("orders sections by kind priority", () => {
    const services: CloudService[] = [
      makeCloudService({ provider: "expo-eas", kind: "mobile", name: "ios" }),
      makeCloudService({ provider: "turso", kind: "database", name: "db" }),
      makeCloudService({ provider: "firebase-hosting", kind: "hosting", name: "web" }),
    ];

    const sections = buildCloudSections(services);
    expect(sections.map((s) => s.title)).toEqual(["DATABASES", "HOSTING", "MOBILE"]);
  });
});

describe("getCloudServicesList", () => {
  it("returns flat list of services in section order", () => {
    const state = createProjectDetailState(makeProject());
    state.cloudServices = [
      makeCloudService({ provider: "cloudflare-r2", kind: "storage", name: "assets" }),
      makeCloudService({ provider: "turso", kind: "database", name: "db1" }),
    ];

    const list = getCloudServicesList(state);
    expect(list).toHaveLength(2);
    // Databases come before storage in section order
    expect(list[0].name).toBe("db1");
    expect(list[1].name).toBe("assets");
  });
});

describe("PANEL_COUNT", () => {
  it("is 8 (tickets, agents, specs, stack, cloud, cicd, infra, chat)", () => {
    expect(PANEL_COUNT).toBe(8);
  });
});

describe("getPanelItemCount", () => {
  it("returns cloud services count for panel 4", () => {
    const state = createProjectDetailState(makeProject());
    state.cloudServices = [
      makeCloudService({ provider: "turso", kind: "database", name: "db1" }),
      makeCloudService({ provider: "neon", kind: "database", name: "db2" }),
      makeCloudService({ provider: "cloudflare-r2", kind: "storage", name: "assets" }),
    ];

    expect(getPanelItemCount(state, 4)).toBe(3);
  });

  it("returns 0 for cloud panel when no services", () => {
    const state = createProjectDetailState(makeProject());
    expect(getPanelItemCount(state, 4)).toBe(0);
  });
});

describe("clampSelection for cloud panel", () => {
  it("clamps cloud panel selection to valid range", () => {
    const state = createProjectDetailState(makeProject());
    state.cloudServices = [
      makeCloudService({ provider: "turso", kind: "database", name: "db" }),
    ];
    state.selectedIndex[4] = 5; // Out of range

    clampSelection(state);
    expect(state.selectedIndex[4]).toBe(0);
  });

  it("resets to 0 when no cloud services", () => {
    const state = createProjectDetailState(makeProject());
    state.selectedIndex[4] = 2;

    clampSelection(state);
    expect(state.selectedIndex[4]).toBe(0);
    expect(state.scrollOffset[4]).toBe(0);
  });
});

describe("createProjectDetailState", () => {
  it("initializes cloudServices as empty", () => {
    const state = createProjectDetailState(makeProject());
    expect(state.cloudServices).toEqual([]);
  });

  it("has 8 panel slots in selectedIndex", () => {
    const state = createProjectDetailState(makeProject());
    expect(state.selectedIndex).toHaveLength(8);
    expect(state.scrollOffset).toHaveLength(8);
  });
});
