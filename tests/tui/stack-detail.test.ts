import { describe, it, expect } from "vitest";
import type { ProjectConfig, InfraResource } from "@opcom/types";
import {
  buildStackItemList,
  buildDetailLines,
  createStackDetailState,
  renderStackDetail,
  scrollUp,
  scrollDown,
  scrollToTop,
  scrollToBottom,
  type StackItem,
} from "../../packages/cli/src/tui/views/stack-detail.js";
import {
  getStackList,
  getPanelItemCount,
  createProjectDetailState,
} from "../../packages/cli/src/tui/views/project-detail.js";
import { ScreenBuffer } from "../../packages/cli/src/tui/renderer.js";

function makeConfig(overrides: Partial<ProjectConfig> = {}): ProjectConfig {
  return {
    id: "proj-1",
    name: "testproject",
    path: "/tmp/testproject",
    stack: {
      languages: [
        { name: "TypeScript", version: "5.3.3", sourceFile: "package.json" },
      ],
      frameworks: [
        { name: "React", version: "18.2.0", sourceFile: "package.json" },
        { name: "Vite", version: "5.0.0", sourceFile: "vite.config.ts" },
      ],
      infrastructure: [
        { name: "Docker", sourceFile: "Dockerfile" },
      ],
      packageManagers: [
        { name: "npm", sourceFile: "package-lock.json" },
      ],
      versionManagers: [
        { name: "mise", sourceFile: ".mise.toml" },
      ],
    },
    git: null,
    workSystem: null,
    docs: {},
    services: [
      { name: "api", port: 3000 },
      { name: "worker" },
    ],
    environments: [],
    testing: [{ name: "vitest", framework: "vitest", command: "npx vitest run", testDir: "tests/" }],
    linting: [
      { name: "eslint", sourceFile: ".eslintrc.json" },
    ],
    subProjects: [],
    cloudServices: [],
    lastScannedAt: "2026-03-01T00:00:00Z",
    ...overrides,
  };
}

function makeInfraResources(): InfraResource[] {
  return [
    {
      id: "default/api-pod-1",
      projectId: "proj-1",
      provider: "kubernetes",
      kind: "pod",
      name: "api-pod-1",
      namespace: "default",
      status: "healthy",
      age: "2026-03-01T00:00:00Z",
    },
    {
      id: "default/api-svc",
      projectId: "proj-1",
      provider: "kubernetes",
      kind: "service",
      name: "api-svc",
      namespace: "default",
      status: "healthy",
      age: "2026-03-01T00:00:00Z",
    },
  ];
}

describe("buildStackItemList", () => {
  it("builds flat list from config", () => {
    const config = makeConfig();
    const items = buildStackItemList(config);

    expect(items.length).toBe(9); // 1 lang + 2 fw + 1 infra + 1 pm + 1 vm + 1 testing + 2 services
  });

  it("includes languages with category", () => {
    const config = makeConfig();
    const items = buildStackItemList(config);
    const ts = items.find((i) => i.name === "TypeScript");
    expect(ts).toBeDefined();
    expect(ts!.category).toBe("language");
    expect(ts!.version).toBe("5.3.3");
    expect(ts!.sourceFile).toBe("package.json");
  });

  it("includes frameworks", () => {
    const config = makeConfig();
    const items = buildStackItemList(config);
    const react = items.find((i) => i.name === "React");
    expect(react).toBeDefined();
    expect(react!.category).toBe("framework");
    expect(react!.version).toBe("18.2.0");
  });

  it("includes infrastructure", () => {
    const config = makeConfig();
    const items = buildStackItemList(config);
    const docker = items.find((i) => i.name === "Docker");
    expect(docker).toBeDefined();
    expect(docker!.category).toBe("infrastructure");
  });

  it("includes package managers", () => {
    const config = makeConfig();
    const items = buildStackItemList(config);
    const npm = items.find((i) => i.name === "npm");
    expect(npm).toBeDefined();
    expect(npm!.category).toBe("package-manager");
  });

  it("includes version managers", () => {
    const config = makeConfig();
    const items = buildStackItemList(config);
    const mise = items.find((i) => i.name === "mise");
    expect(mise).toBeDefined();
    expect(mise!.category).toBe("version-manager");
  });

  it("includes testing framework", () => {
    const config = makeConfig();
    const items = buildStackItemList(config);
    const vitest = items.find((i) => i.name === "vitest (vitest)");
    expect(vitest).toBeDefined();
    expect(vitest!.category).toBe("testing");
  });

  it("includes services with ports", () => {
    const config = makeConfig();
    const items = buildStackItemList(config);
    const api = items.find((i) => i.name === "api");
    expect(api).toBeDefined();
    expect(api!.category).toBe("service");
    expect(api!.port).toBe(3000);
  });

  it("returns empty list when stack is empty", () => {
    const config = makeConfig({
      stack: {
        languages: [],
        frameworks: [],
        infrastructure: [],
        packageManagers: [],
        versionManagers: [],
      },
      testing: [],
      services: [],
    });
    const items = buildStackItemList(config);
    expect(items.length).toBe(0);
  });
});

describe("getStackList / getPanelItemCount integration", () => {
  it("returns stack items for panel 3", () => {
    const project = {
      id: "proj-1",
      name: "testproject",
      path: "/tmp/testproject",
      status: "scanned" as const,
      lastScannedAt: "2026-03-01T00:00:00Z",
    };
    const state = createProjectDetailState(project);
    state.projectConfig = makeConfig();

    const items = getStackList(state);
    expect(items.length).toBe(9);
    expect(getPanelItemCount(state, 3)).toBe(9);
  });

  it("returns 0 when no config loaded", () => {
    const project = {
      id: "proj-1",
      name: "testproject",
      path: "/tmp/testproject",
      status: "scanned" as const,
      lastScannedAt: "2026-03-01T00:00:00Z",
    };
    const state = createProjectDetailState(project);
    // projectConfig is null by default
    expect(getStackList(state).length).toBe(0);
    expect(getPanelItemCount(state, 3)).toBe(0);
  });
});

describe("createStackDetailState", () => {
  it("creates initial state", () => {
    const item: StackItem = {
      name: "TypeScript",
      category: "language",
      version: "5.3.3",
      sourceFile: "package.json",
    };
    const config = makeConfig();
    const state = createStackDetailState(item, "testproject", config, []);

    expect(state.item).toBe(item);
    expect(state.projectName).toBe("testproject");
    expect(state.projectConfig).toBe(config);
    expect(state.scrollOffset).toBe(0);
    expect(state.totalLines).toBe(0);
  });
});

describe("renderStackDetail", () => {
  it("renders without error", () => {
    const item: StackItem = {
      name: "TypeScript",
      category: "language",
      version: "5.3.3",
      sourceFile: "package.json",
    };
    const config = makeConfig();
    const state = createStackDetailState(item, "testproject", config, []);
    const buf = new ScreenBuffer(80, 24);
    const panel = { x: 0, y: 0, width: 80, height: 24 };

    expect(() => renderStackDetail(buf, panel, state)).not.toThrow();
  });

  it("populates totalLines after render", () => {
    const item: StackItem = {
      name: "TypeScript",
      category: "language",
      version: "5.3.3",
      sourceFile: "package.json",
    };
    const config = makeConfig();
    const state = createStackDetailState(item, "testproject", config, []);
    const buf = new ScreenBuffer(80, 24);
    const panel = { x: 0, y: 0, width: 80, height: 24 };

    renderStackDetail(buf, panel, state);
    expect(state.totalLines).toBeGreaterThan(0);
  });

  it("renders language detail with frameworks section", () => {
    const item: StackItem = {
      name: "TypeScript",
      category: "language",
      version: "5.3.3",
      sourceFile: "package.json",
    };
    const config = makeConfig();
    const state = createStackDetailState(item, "testproject", config, []);
    const lines = buildDetailLines(state, 80);
    const output = lines.join("\n");
    expect(output).toContain("TypeScript");
    expect(output).toContain("Language");
    expect(output).toContain("5.3.3");
    expect(output).toContain("package.json");
    expect(output).toContain("FRAMEWORKS");
    expect(output).toContain("React");
  });

  it("renders framework detail with languages section", () => {
    const item: StackItem = {
      name: "React",
      category: "framework",
      version: "18.2.0",
      sourceFile: "package.json",
    };
    const config = makeConfig();
    const state = createStackDetailState(item, "testproject", config, []);
    const lines = buildDetailLines(state, 80);
    const output = lines.join("\n");
    expect(output).toContain("React");
    expect(output).toContain("Framework");
    expect(output).toContain("18.2.0");
    expect(output).toContain("LANGUAGES");
    expect(output).toContain("TypeScript");
  });

  it("renders infrastructure detail with live resources", () => {
    const item: StackItem = {
      name: "Docker",
      category: "infrastructure",
      sourceFile: "Dockerfile",
    };
    const config = makeConfig();
    const infra = makeInfraResources();
    const state = createStackDetailState(item, "testproject", config, infra);
    const lines = buildDetailLines(state, 80);
    const output = lines.join("\n");
    expect(output).toContain("Docker");
    expect(output).toContain("Infrastructure");
    expect(output).toContain("LIVE RESOURCES");
    expect(output).toContain("api-pod-1");
  });

  it("renders service detail with port", () => {
    const item: StackItem = {
      name: "api",
      category: "service",
      port: 3000,
    };
    const config = makeConfig({
      services: [
        { name: "api", port: 3000, command: "node server.js", dependsOn: ["db"] },
      ],
    });
    const state = createStackDetailState(item, "testproject", config, []);
    const lines = buildDetailLines(state, 80);
    const output = lines.join("\n");
    expect(output).toContain("api");
    expect(output).toContain("Service");
    expect(output).toContain("3000");
    expect(output).toContain("node server.js");
    expect(output).toContain("db");
  });

  it("renders testing detail", () => {
    const item: StackItem = {
      name: "vitest (vitest)",
      category: "testing",
    };
    const config = makeConfig();
    const state = createStackDetailState(item, "testproject", config, []);
    const lines = buildDetailLines(state, 80);
    const output = lines.join("\n");
    expect(output).toContain("vitest");
    expect(output).toContain("Testing");
    expect(output).toContain("npx vitest run");
    expect(output).toContain("LINTING");
    expect(output).toContain("eslint");
  });

  it("renders with scroll offset", () => {
    const item: StackItem = {
      name: "TypeScript",
      category: "language",
      version: "5.3.3",
      sourceFile: "package.json",
    };
    const config = makeConfig();
    const state = createStackDetailState(item, "testproject", config, []);
    state.scrollOffset = 2;
    const buf = new ScreenBuffer(80, 24);
    const panel = { x: 0, y: 0, width: 80, height: 24 };

    expect(() => renderStackDetail(buf, panel, state)).not.toThrow();
  });
});

describe("scroll helpers", () => {
  it("scrollDown increases offset", () => {
    const item: StackItem = { name: "TypeScript", category: "language" };
    const state = createStackDetailState(item, "test", makeConfig(), []);
    state.totalLines = 30;
    scrollDown(state, 3, 10);
    expect(state.scrollOffset).toBe(3);
  });

  it("scrollUp decreases offset", () => {
    const item: StackItem = { name: "TypeScript", category: "language" };
    const state = createStackDetailState(item, "test", makeConfig(), []);
    state.scrollOffset = 5;
    scrollUp(state, 2);
    expect(state.scrollOffset).toBe(3);
  });

  it("scrollUp does not go below 0", () => {
    const item: StackItem = { name: "TypeScript", category: "language" };
    const state = createStackDetailState(item, "test", makeConfig(), []);
    scrollUp(state, 5);
    expect(state.scrollOffset).toBe(0);
  });

  it("scrollToTop resets to 0", () => {
    const item: StackItem = { name: "TypeScript", category: "language" };
    const state = createStackDetailState(item, "test", makeConfig(), []);
    state.scrollOffset = 10;
    scrollToTop(state);
    expect(state.scrollOffset).toBe(0);
  });

  it("scrollToBottom goes to max offset", () => {
    const item: StackItem = { name: "TypeScript", category: "language" };
    const state = createStackDetailState(item, "test", makeConfig(), []);
    state.totalLines = 30;
    scrollToBottom(state, 10);
    expect(state.scrollOffset).toBe(20);
  });

  it("scrollDown clamps to max offset", () => {
    const item: StackItem = { name: "TypeScript", category: "language" };
    const state = createStackDetailState(item, "test", makeConfig(), []);
    state.totalLines = 15;
    scrollDown(state, 1000, 10);
    expect(state.scrollOffset).toBe(5);
  });
});
