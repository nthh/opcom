import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

describe("init-pipeline shared helpers", () => {
  let tempDir: string;
  let originalHome: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "opcom-pipeline-"));
    originalHome = process.env.HOME!;
    process.env.HOME = tempDir;
  });

  afterEach(async () => {
    process.env.HOME = originalHome;
    await rm(tempDir, { recursive: true, force: true });
  });

  describe("resolvePath", () => {
    it("expands ~ to HOME directory", async () => {
      const { resolvePath } = await import("../../packages/cli/src/commands/init-pipeline.js");
      const result = resolvePath("~/projects/myapp");
      expect(result).toBe(join(tempDir, "projects/myapp"));
    });

    it("resolves relative paths to absolute", async () => {
      const { resolvePath } = await import("../../packages/cli/src/commands/init-pipeline.js");
      const result = resolvePath("relative/path");
      expect(result).toMatch(/^\/.*relative\/path$/);
    });

    it("returns absolute paths unchanged", async () => {
      const { resolvePath } = await import("../../packages/cli/src/commands/init-pipeline.js");
      const result = resolvePath("/absolute/path");
      expect(result).toBe("/absolute/path");
    });
  });

  describe("addToWorkspace", () => {
    it("adds project to existing workspace", async () => {
      const { ensureOpcomDirs, saveGlobalConfig, saveWorkspace, loadWorkspace, defaultSettings } =
        await import("@opcom/core");
      const { addToWorkspace } = await import("../../packages/cli/src/commands/init-pipeline.js");

      await ensureOpcomDirs();
      await saveGlobalConfig({ defaultWorkspace: "personal", settings: defaultSettings() });
      await saveWorkspace({
        id: "personal",
        name: "personal",
        projectIds: ["existing-project"],
        createdAt: new Date().toISOString(),
      });

      await addToWorkspace("new-project");

      const ws = await loadWorkspace("personal");
      expect(ws!.projectIds).toContain("existing-project");
      expect(ws!.projectIds).toContain("new-project");
    });

    it("is idempotent — does not duplicate project IDs", async () => {
      const { ensureOpcomDirs, saveGlobalConfig, saveWorkspace, loadWorkspace, defaultSettings } =
        await import("@opcom/core");
      const { addToWorkspace } = await import("../../packages/cli/src/commands/init-pipeline.js");

      await ensureOpcomDirs();
      await saveGlobalConfig({ defaultWorkspace: "personal", settings: defaultSettings() });
      await saveWorkspace({
        id: "personal",
        name: "personal",
        projectIds: ["my-project"],
        createdAt: new Date().toISOString(),
      });

      await addToWorkspace("my-project");
      await addToWorkspace("my-project");

      const ws = await loadWorkspace("personal");
      expect(ws!.projectIds.filter((id) => id === "my-project")).toHaveLength(1);
    });

    it("is a no-op when no global config exists", async () => {
      const { addToWorkspace } = await import("../../packages/cli/src/commands/init-pipeline.js");

      // Should not throw
      await addToWorkspace("orphan-project");
    });
  });

  describe("configureProject", () => {
    it("returns config directly in agent mode", async () => {
      const { detectProject } = await import("@opcom/core");
      const { configureProject } = await import("../../packages/cli/src/commands/init-pipeline.js");

      const projectDir = join(tempDir, "agent-project");
      await mkdir(projectDir, { recursive: true });
      await writeFile(
        join(projectDir, "package.json"),
        JSON.stringify({ name: "agent-project", dependencies: { react: "^18" } }),
        "utf-8",
      );

      const detection = await detectProject(projectDir);
      const config = await configureProject(detection, "agent");

      expect(config.id).toBe("agent-project");
      expect(config.name).toBe("agent-project");
      expect(config.path).toBe(projectDir);
      expect(config.stack.frameworks.map((f) => f.name)).toContain("React");
    });

    it("applies overrides to id and name", async () => {
      const { detectProject } = await import("@opcom/core");
      const { configureProject } = await import("../../packages/cli/src/commands/init-pipeline.js");

      const projectDir = join(tempDir, "override-test");
      await mkdir(projectDir, { recursive: true });

      const detection = await detectProject(projectDir);
      const config = await configureProject(detection, "agent", {
        overrides: { id: "custom-id", name: "Custom Name" },
        description: "A custom project",
      });

      expect(config.id).toBe("custom-id");
      expect(config.name).toBe("Custom Name");
      expect(config.description).toBe("A custom project");
    });

    it("runs profile confirmation in interactive mode", async () => {
      const { detectProject } = await import("@opcom/core");
      const { configureProject } = await import("../../packages/cli/src/commands/init-pipeline.js");

      const projectDir = join(tempDir, "interactive-project");
      await mkdir(projectDir, { recursive: true });

      const detection = await detectProject(projectDir);
      // No profile to confirm → should complete without issue
      const config = await configureProject(detection, "interactive", {
        ask: async () => "",
      });

      expect(config.id).toBe("interactive-project");
    });
  });

  describe("persistProject", () => {
    it("saves project config and writes summary", async () => {
      const { ensureOpcomDirs, loadProject, emptyStack } = await import("@opcom/core");
      const { persistProject } = await import("../../packages/cli/src/commands/init-pipeline.js");

      await ensureOpcomDirs();

      await persistProject({
        id: "persist-test",
        name: "Persist Test",
        path: "/tmp/persist-test",
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
        lastScannedAt: new Date().toISOString(),
      });

      const loaded = await loadProject("persist-test");
      expect(loaded).not.toBeNull();
      expect(loaded!.id).toBe("persist-test");
      expect(loaded!.name).toBe("Persist Test");

      // Summary file should exist
      const summaryPath = join(tempDir, ".opcom/summaries/persist-test.md");
      expect(existsSync(summaryPath)).toBe(true);
    });
  });

  describe("devStartup", () => {
    it("is callable and does not throw", async () => {
      const { emptyStack } = await import("@opcom/core");
      const { devStartup } = await import("../../packages/cli/src/commands/init-pipeline.js");

      // devStartup is a stub — should be a no-op for both modes
      await devStartup(
        {
          id: "test",
          name: "test",
          path: "/tmp/test",
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
          lastScannedAt: new Date().toISOString(),
        },
        "interactive",
      );

      await devStartup(
        {
          id: "test",
          name: "test",
          path: "/tmp/test",
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
          lastScannedAt: new Date().toISOString(),
        },
        "agent",
      );
    });
  });

  describe("ensureWorkspace", () => {
    it("creates personal workspace on first run", async () => {
      const { loadGlobalConfig, loadWorkspace } = await import("@opcom/core");
      const { ensureWorkspace } = await import("../../packages/cli/src/commands/init-pipeline.js");

      const isFirst = await ensureWorkspace();

      expect(isFirst).toBe(true);
      const global = await loadGlobalConfig();
      expect(global.defaultWorkspace).toBe("personal");
      const ws = await loadWorkspace("personal");
      expect(ws).not.toBeNull();
      expect(ws!.projectIds).toHaveLength(0);
    });

    it("returns false on subsequent runs", async () => {
      const { ensureOpcomDirs, saveGlobalConfig, saveWorkspace, defaultSettings } =
        await import("@opcom/core");
      const { ensureWorkspace } = await import("../../packages/cli/src/commands/init-pipeline.js");

      await ensureOpcomDirs();
      await saveGlobalConfig({ defaultWorkspace: "personal", settings: defaultSettings() });
      await saveWorkspace({
        id: "personal",
        name: "personal",
        projectIds: ["existing"],
        createdAt: new Date().toISOString(),
      });

      const isFirst = await ensureWorkspace();
      expect(isFirst).toBe(false);
    });
  });
});

describe("initPipeline", () => {
  let tempDir: string;
  let originalHome: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "opcom-pipeline-"));
    originalHome = process.env.HOME!;
    process.env.HOME = tempDir;
  });

  afterEach(async () => {
    process.env.HOME = originalHome;
    await rm(tempDir, { recursive: true, force: true });
  });

  it("agent mode: detects, configures, persists, and adds to workspace", async () => {
    const { ensureOpcomDirs, saveGlobalConfig, saveWorkspace, loadProject, loadWorkspace, defaultSettings } =
      await import("@opcom/core");
    const { initPipeline } = await import("../../packages/cli/src/commands/init-pipeline.js");

    // Set up workspace first
    await ensureOpcomDirs();
    await saveGlobalConfig({ defaultWorkspace: "personal", settings: defaultSettings() });
    await saveWorkspace({
      id: "personal",
      name: "personal",
      projectIds: [],
      createdAt: new Date().toISOString(),
    });

    // Create a project directory
    const projectDir = join(tempDir, "my-agent-app");
    await mkdir(projectDir, { recursive: true });
    await writeFile(
      join(projectDir, "package.json"),
      JSON.stringify({ name: "my-agent-app", devDependencies: { typescript: "^5.0" } }),
      "utf-8",
    );

    const result = await initPipeline({ mode: "agent", path: projectDir });

    // Config returned
    expect(result.config.id).toBe("my-agent-app");
    expect(result.config.path).toBe(projectDir);
    expect(result.detection.path).toBe(projectDir);

    // Project persisted
    const loaded = await loadProject("my-agent-app");
    expect(loaded).not.toBeNull();
    expect(loaded!.name).toBe("my-agent-app");

    // Added to workspace
    const ws = await loadWorkspace("personal");
    expect(ws!.projectIds).toContain("my-agent-app");
  });

  it("interactive mode: runs profile confirmation via ask function", async () => {
    const { ensureOpcomDirs, saveGlobalConfig, saveWorkspace, loadProject, defaultSettings } =
      await import("@opcom/core");
    const { initPipeline } = await import("../../packages/cli/src/commands/init-pipeline.js");

    await ensureOpcomDirs();
    await saveGlobalConfig({ defaultWorkspace: "personal", settings: defaultSettings() });
    await saveWorkspace({
      id: "personal",
      name: "personal",
      projectIds: [],
      createdAt: new Date().toISOString(),
    });

    const projectDir = join(tempDir, "interactive-app");
    await mkdir(projectDir, { recursive: true });

    const result = await initPipeline({
      mode: "interactive",
      path: projectDir,
      ask: async () => "",
    });

    expect(result.config.id).toBe("interactive-app");

    const loaded = await loadProject("interactive-app");
    expect(loaded).not.toBeNull();
  });

  it("applies name/id overrides", async () => {
    const { ensureOpcomDirs, saveGlobalConfig, saveWorkspace, loadProject, defaultSettings } =
      await import("@opcom/core");
    const { initPipeline } = await import("../../packages/cli/src/commands/init-pipeline.js");

    await ensureOpcomDirs();
    await saveGlobalConfig({ defaultWorkspace: "personal", settings: defaultSettings() });
    await saveWorkspace({
      id: "personal",
      name: "personal",
      projectIds: [],
      createdAt: new Date().toISOString(),
    });

    const projectDir = join(tempDir, "folder-name");
    await mkdir(projectDir, { recursive: true });

    const result = await initPipeline({
      mode: "agent",
      path: projectDir,
      overrides: { id: "custom-id", name: "Custom Name" },
      description: "A custom project",
    });

    expect(result.config.id).toBe("custom-id");
    expect(result.config.name).toBe("Custom Name");
    expect(result.config.description).toBe("A custom project");

    const loaded = await loadProject("custom-id");
    expect(loaded).not.toBeNull();
    expect(loaded!.name).toBe("Custom Name");
  });

  it("defaults to cwd when no path given", async () => {
    const { ensureOpcomDirs, saveGlobalConfig, saveWorkspace, defaultSettings } =
      await import("@opcom/core");
    const { initPipeline } = await import("../../packages/cli/src/commands/init-pipeline.js");

    await ensureOpcomDirs();
    await saveGlobalConfig({ defaultWorkspace: "personal", settings: defaultSettings() });
    await saveWorkspace({
      id: "personal",
      name: "personal",
      projectIds: [],
      createdAt: new Date().toISOString(),
    });

    // No path → uses cwd
    const result = await initPipeline({ mode: "agent" });
    expect(result.config.path).toBe(process.cwd());
  });

  it("autoSetup uses initPipeline with agent mode", async () => {
    const { loadProject, loadWorkspace } = await import("@opcom/core");
    const { autoSetup } = await import("../../packages/cli/src/commands/setup.js");

    const projectDir = join(tempDir, "auto-setup-proj");
    await mkdir(projectDir, { recursive: true });
    await writeFile(
      join(projectDir, "package.json"),
      JSON.stringify({ name: "auto-setup-proj" }),
      "utf-8",
    );

    const config = await autoSetup(projectDir);

    expect(config.id).toBe("auto-setup-proj");
    expect(config.path).toBe(projectDir);

    // Project was persisted
    const loaded = await loadProject("auto-setup-proj");
    expect(loaded).not.toBeNull();

    // Workspace was created (first run)
    const ws = await loadWorkspace("personal");
    expect(ws).not.toBeNull();
    expect(ws!.projectIds).toContain("auto-setup-proj");
  });

  it("autoSetup adds to existing workspace on subsequent runs", async () => {
    const { ensureOpcomDirs, saveGlobalConfig, saveWorkspace, loadWorkspace, defaultSettings } =
      await import("@opcom/core");
    const { autoSetup } = await import("../../packages/cli/src/commands/setup.js");

    // Set up existing workspace with one project
    await ensureOpcomDirs();
    await saveGlobalConfig({ defaultWorkspace: "personal", settings: defaultSettings() });
    await saveWorkspace({
      id: "personal",
      name: "personal",
      projectIds: ["first-project"],
      createdAt: new Date().toISOString(),
    });

    const projectDir = join(tempDir, "second-project");
    await mkdir(projectDir, { recursive: true });

    await autoSetup(projectDir);

    const ws = await loadWorkspace("personal");
    expect(ws!.projectIds).toContain("first-project");
    expect(ws!.projectIds).toContain("second-project");
  });

  it("runInitFolder uses initPipeline with interactive mode", async () => {
    const { loadProject, loadWorkspace } = await import("@opcom/core");
    const { runInitFolder } = await import("../../packages/cli/src/commands/init.js");

    const folderPath = join(tempDir, "new-folder-proj");

    // Provide scripted answers: name (accept default), description, template (none)
    const answers = ["", "A test project", ""];
    let answerIdx = 0;

    await runInitFolder({
      folder: folderPath,
      promptFn: async () => answers[answerIdx++] ?? "",
    });

    // Project was persisted via pipeline
    const loaded = await loadProject("new-folder-proj");
    expect(loaded).not.toBeNull();
    expect(loaded!.path).toBe(folderPath);

    // Workspace was created (first run via pipeline's ensureWorkspace)
    const ws = await loadWorkspace("personal");
    expect(ws).not.toBeNull();
    expect(ws!.projectIds).toContain("new-folder-proj");
  });

  it("runAdd uses initPipeline with interactive mode", async () => {
    const { ensureOpcomDirs, saveGlobalConfig, saveWorkspace, loadProject, loadWorkspace, defaultSettings } =
      await import("@opcom/core");
    const { runAdd } = await import("../../packages/cli/src/commands/add.js");

    await ensureOpcomDirs();
    await saveGlobalConfig({ defaultWorkspace: "personal", settings: defaultSettings() });
    await saveWorkspace({
      id: "personal",
      name: "personal",
      projectIds: [],
      createdAt: new Date().toISOString(),
    });

    const projectDir = join(tempDir, "added-project");
    await mkdir(projectDir, { recursive: true });

    await runAdd(projectDir, {
      promptFn: async () => "",
    });

    const loaded = await loadProject("added-project");
    expect(loaded).not.toBeNull();

    const ws = await loadWorkspace("personal");
    expect(ws!.projectIds).toContain("added-project");
  });
});
