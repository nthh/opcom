import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, readFile, readdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { writeFile, mkdir } from "node:fs/promises";

describe("opcom init <folder>", () => {
  let tempDir: string;
  let originalHome: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "opcom-init-folder-"));
    originalHome = process.env.HOME!;
    process.env.HOME = tempDir;
  });

  afterEach(async () => {
    process.env.HOME = originalHome;
    await rm(tempDir, { recursive: true, force: true });
  });

  it("creates a new empty project folder with scaffolding", async () => {
    const { ensureOpcomDirs } = await import("@opcom/core");
    const { runInitFolder } = await import("../../packages/cli/src/commands/init.js");

    await ensureOpcomDirs();

    const projectDir = join(tempDir, "japan-trip");

    await runInitFolder({
      folder: projectDir,
      promptFn: async (q: string) => {
        if (q.includes("Project name")) return "";
        if (q.includes("What is this project about")) return "Plan a two-week trip to Japan";
        return "";
      },
    });

    // Folder was created
    expect(existsSync(projectDir)).toBe(true);

    // .tickets/impl/ was created
    expect(existsSync(join(projectDir, ".tickets/impl"))).toBe(true);

    // AGENTS.md was created with project name and description
    const agentsMd = await readFile(join(projectDir, "AGENTS.md"), "utf-8");
    expect(agentsMd).toContain("japan-trip");
    expect(agentsMd).toContain("Plan a two-week trip to Japan");

    // Project config was saved
    const { loadProject } = await import("@opcom/core");
    const config = await loadProject("japan-trip");
    expect(config).not.toBeNull();
    expect(config!.id).toBe("japan-trip");
    expect(config!.name).toBe("japan-trip");
    expect(config!.path).toBe(projectDir);
    expect(config!.description).toBe("Plan a two-week trip to Japan");
    expect(config!.stack.languages).toHaveLength(0);
    expect(config!.lastScannedAt).toBeTruthy();
  });

  it("initializes an existing folder with code detection", async () => {
    const { ensureOpcomDirs } = await import("@opcom/core");
    const { runInitFolder } = await import("../../packages/cli/src/commands/init.js");

    await ensureOpcomDirs();

    // Create an existing project with a package.json
    const projectDir = join(tempDir, "my-app");
    await mkdir(projectDir, { recursive: true });
    await writeFile(
      join(projectDir, "package.json"),
      JSON.stringify({
        name: "my-app",
        dependencies: { react: "^18.0.0" },
        devDependencies: { typescript: "^5.0.0" },
      }),
      "utf-8",
    );

    await runInitFolder({
      folder: projectDir,
      promptFn: async (q: string) => {
        if (q.includes("Project name")) return "My App";
        if (q.includes("What is this project about")) return "A React SPA for task management";
        return "";
      },
    });

    // Folder already existed — should still work
    expect(existsSync(projectDir)).toBe(true);

    // .tickets/impl/ was created
    expect(existsSync(join(projectDir, ".tickets/impl"))).toBe(true);

    // AGENTS.md was created
    expect(existsSync(join(projectDir, "AGENTS.md"))).toBe(true);

    // Project config has detection results + description
    const { loadProject } = await import("@opcom/core");
    const config = await loadProject("my-app");
    expect(config).not.toBeNull();
    expect(config!.id).toBe("my-app");
    expect(config!.name).toBe("My App");
    expect(config!.description).toBe("A React SPA for task management");
    expect(config!.stack.languages.map((l) => l.name)).toContain("typescript");
    expect(config!.stack.frameworks.map((f) => f.name)).toContain("React");
  });

  it("adds project to default workspace", async () => {
    const { ensureOpcomDirs, saveGlobalConfig, saveWorkspace, loadWorkspace, defaultSettings } =
      await import("@opcom/core");
    const { runInitFolder } = await import("../../packages/cli/src/commands/init.js");

    await ensureOpcomDirs();
    await saveGlobalConfig({ defaultWorkspace: "personal", settings: defaultSettings() });
    await saveWorkspace({
      id: "personal",
      name: "personal",
      projectIds: [],
      createdAt: new Date().toISOString(),
    });

    const projectDir = join(tempDir, "new-proj");

    await runInitFolder({
      folder: projectDir,
      promptFn: async (q: string) => {
        if (q.includes("Project name")) return "";
        if (q.includes("What is this project about")) return "test project";
        return "";
      },
    });

    const ws = await loadWorkspace("personal");
    expect(ws).not.toBeNull();
    expect(ws!.projectIds).toContain("new-proj");
  });

  it("uses custom project name for id", async () => {
    const { ensureOpcomDirs } = await import("@opcom/core");
    const { runInitFolder } = await import("../../packages/cli/src/commands/init.js");

    await ensureOpcomDirs();

    const projectDir = join(tempDir, "some-folder");

    await runInitFolder({
      folder: projectDir,
      promptFn: async (q: string) => {
        if (q.includes("Project name")) return "Custom Name";
        if (q.includes("What is this project about")) return "";
        return "";
      },
    });

    const { loadProject } = await import("@opcom/core");
    const config = await loadProject("custom-name");
    expect(config).not.toBeNull();
    expect(config!.name).toBe("Custom Name");
    expect(config!.id).toBe("custom-name");
    expect(config!.description).toBeUndefined();
  });

  it("does not overwrite existing AGENTS.md", async () => {
    const { ensureOpcomDirs } = await import("@opcom/core");
    const { runInitFolder } = await import("../../packages/cli/src/commands/init.js");

    await ensureOpcomDirs();

    const projectDir = join(tempDir, "has-agents");
    await mkdir(projectDir, { recursive: true });
    await writeFile(join(projectDir, "AGENTS.md"), "# Existing content\n", "utf-8");

    await runInitFolder({
      folder: projectDir,
      promptFn: async (q: string) => {
        if (q.includes("Project name")) return "";
        if (q.includes("What is this project about")) return "something";
        return "";
      },
    });

    const content = await readFile(join(projectDir, "AGENTS.md"), "utf-8");
    expect(content).toBe("# Existing content\n");
  });

  it("does not overwrite existing .tickets directory", async () => {
    const { ensureOpcomDirs } = await import("@opcom/core");
    const { runInitFolder } = await import("../../packages/cli/src/commands/init.js");

    await ensureOpcomDirs();

    const projectDir = join(tempDir, "has-tickets");
    await mkdir(join(projectDir, ".tickets/impl/my-task"), { recursive: true });
    await writeFile(join(projectDir, ".tickets/impl/my-task/README.md"), "# task\n", "utf-8");

    await runInitFolder({
      folder: projectDir,
      promptFn: async (q: string) => {
        if (q.includes("Project name")) return "";
        if (q.includes("What is this project about")) return "something";
        return "";
      },
    });

    // Existing ticket still there
    const taskFile = await readFile(join(projectDir, ".tickets/impl/my-task/README.md"), "utf-8");
    expect(taskFile).toBe("# task\n");
  });

  it("handles ~ in folder path", async () => {
    const { ensureOpcomDirs } = await import("@opcom/core");
    const { runInitFolder } = await import("../../packages/cli/src/commands/init.js");

    await ensureOpcomDirs();

    await runInitFolder({
      folder: "~/tilde-project",
      promptFn: async (q: string) => {
        if (q.includes("Project name")) return "";
        if (q.includes("What is this project about")) return "";
        return "";
      },
    });

    const expectedPath = join(tempDir, "tilde-project");
    expect(existsSync(expectedPath)).toBe(true);

    const { loadProject } = await import("@opcom/core");
    const config = await loadProject("tilde-project");
    expect(config).not.toBeNull();
    expect(config!.path).toBe(expectedPath);
  });
});

describe("description field roundtrip", () => {
  let tempDir: string;
  let originalHome: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "opcom-desc-"));
    originalHome = process.env.HOME!;
    process.env.HOME = tempDir;
  });

  afterEach(async () => {
    process.env.HOME = originalHome;
    await rm(tempDir, { recursive: true, force: true });
  });

  it("persists and loads description in project config", async () => {
    const { ensureOpcomDirs, saveProject, loadProject, emptyStack } = await import("@opcom/core");

    await ensureOpcomDirs();

    await saveProject({
      id: "with-desc",
      name: "With Desc",
      path: "/tmp/wd",
      description: "A project with a description",
      stack: emptyStack(),
      git: null,
      workSystem: null,
      docs: {},
      services: [],
      environments: [],
      testing: null,
      linting: [],
      subProjects: [],
      cloudServices: [],
      lastScannedAt: "2026-01-01T00:00:00Z",
    });

    const loaded = await loadProject("with-desc");
    expect(loaded).not.toBeNull();
    expect(loaded!.description).toBe("A project with a description");
  });

  it("omits description when not provided", async () => {
    const { ensureOpcomDirs, saveProject, loadProject, emptyStack } = await import("@opcom/core");

    await ensureOpcomDirs();

    await saveProject({
      id: "no-desc",
      name: "No Desc",
      path: "/tmp/nd",
      stack: emptyStack(),
      git: null,
      workSystem: null,
      docs: {},
      services: [],
      environments: [],
      testing: null,
      linting: [],
      subProjects: [],
      cloudServices: [],
      lastScannedAt: "2026-01-01T00:00:00Z",
    });

    const loaded = await loadProject("no-desc");
    expect(loaded).not.toBeNull();
    expect(loaded!.description).toBeUndefined();
  });
});
