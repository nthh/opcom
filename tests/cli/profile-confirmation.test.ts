import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

describe("formatProfilePrompt", () => {
  it("returns null for empty profile", async () => {
    const { formatProfilePrompt } = await import("../../packages/cli/src/ui/format.js");
    expect(formatProfilePrompt({})).toBeNull();
  });

  it("returns null for profile with empty arrays", async () => {
    const { formatProfilePrompt } = await import("../../packages/cli/src/ui/format.js");
    expect(formatProfilePrompt({ commands: [], fieldMappings: [], agentConstraints: [] })).toBeNull();
  });

  it("formats commands in profile prompt", async () => {
    const { formatProfilePrompt } = await import("../../packages/cli/src/ui/format.js");
    const result = formatProfilePrompt({
      commands: [
        { name: "test", command: "make test-smoke", description: "fast test gate" },
        { name: "build", command: "make build" },
      ],
    });
    expect(result).not.toBeNull();
    expect(result).toContain("Detected profile:");
    expect(result).toContain("test");
    expect(result).toContain("make test-smoke");
    expect(result).toContain("fast test gate");
    expect(result).toContain("build");
    expect(result).toContain("make build");
    // Strip ANSI codes for content matching
    const plain = result!.replace(/\x1b\[[0-9;]*m/g, "");
    expect(plain).toContain("[Enter] accept");
    expect(plain).toContain("[e] edit");
    expect(plain).toContain("[s] skip profile");
  });

  it("formats field mappings in profile prompt", async () => {
    const { formatProfilePrompt } = await import("../../packages/cli/src/ui/format.js");
    const result = formatProfilePrompt({
      fieldMappings: [{ field: "demand", type: "use-case" }],
    });
    expect(result).not.toBeNull();
    expect(result).toContain("Ticket fields:");
    expect(result).toContain("demand");
    expect(result).toContain("use-case");
  });

  it("formats agent constraints in profile prompt", async () => {
    const { formatProfilePrompt } = await import("../../packages/cli/src/ui/format.js");
    const result = formatProfilePrompt({
      agentConstraints: [{ name: "forbidden-commands", rule: "Never run: git reset, git stash" }],
    });
    expect(result).not.toBeNull();
    expect(result).toContain("Agent constraints:");
    expect(result).toContain("forbidden-commands");
    expect(result).toContain("Never run: git reset, git stash");
  });
});

describe("confirmProfile", () => {
  it("returns profile on accept (empty input)", async () => {
    const { confirmProfile } = await import("../../packages/cli/src/commands/add.js");
    const result = {
      name: "test-project",
      path: "/tmp/test",
      confidence: "high" as const,
      stack: { languages: [], frameworks: [], packageManagers: [], infrastructure: [], versionManagers: [] },
      git: null,
      workSystem: null,
      docs: {},
      services: [],
      testing: null,
      linting: [],
      subProjects: [],
      cloudServices: [],
      evidence: [],
      profile: {
        commands: [{ name: "test", command: "make test" }],
      },
    };

    const ask = async (_q: string) => "";
    const confirmed = await confirmProfile(result, ask);
    expect(confirmed).toEqual(result.profile);
  });

  it("returns undefined on skip", async () => {
    const { confirmProfile } = await import("../../packages/cli/src/commands/add.js");
    const result = {
      name: "test-project",
      path: "/tmp/test",
      confidence: "high" as const,
      stack: { languages: [], frameworks: [], packageManagers: [], infrastructure: [], versionManagers: [] },
      git: null,
      workSystem: null,
      docs: {},
      services: [],
      testing: null,
      linting: [],
      subProjects: [],
      cloudServices: [],
      evidence: [],
      profile: {
        commands: [{ name: "test", command: "make test" }],
      },
    };

    const ask = async (_q: string) => "s";
    const confirmed = await confirmProfile(result, ask);
    expect(confirmed).toBeUndefined();
  });

  it("returns undefined when no profile detected", async () => {
    const { confirmProfile } = await import("../../packages/cli/src/commands/add.js");
    const result = {
      name: "test-project",
      path: "/tmp/test",
      confidence: "high" as const,
      stack: { languages: [], frameworks: [], packageManagers: [], infrastructure: [], versionManagers: [] },
      git: null,
      workSystem: null,
      docs: {},
      services: [],
      testing: null,
      linting: [],
      subProjects: [],
      cloudServices: [],
      evidence: [],
    };

    const ask = async (_q: string) => "";
    const confirmed = await confirmProfile(result, ask);
    expect(confirmed).toBeUndefined();
  });

  it("returns profile on edit", async () => {
    const { confirmProfile } = await import("../../packages/cli/src/commands/add.js");
    const result = {
      name: "test-project",
      path: "/tmp/test",
      confidence: "high" as const,
      stack: { languages: [], frameworks: [], packageManagers: [], infrastructure: [], versionManagers: [] },
      git: null,
      workSystem: null,
      docs: {},
      services: [],
      testing: null,
      linting: [],
      subProjects: [],
      cloudServices: [],
      evidence: [],
      profile: {
        commands: [{ name: "test", command: "make test" }],
      },
    };

    const ask = async (_q: string) => "e";
    const confirmed = await confirmProfile(result, ask);
    // Edit returns the profile (user edits YAML file directly)
    expect(confirmed).toEqual(result.profile);
  });
});

describe("runAdd with profile confirmation", () => {
  let tempDir: string;
  let originalHome: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "opcom-add-profile-"));
    originalHome = process.env.HOME!;
    process.env.HOME = tempDir;
  });

  afterEach(async () => {
    process.env.HOME = originalHome;
    await rm(tempDir, { recursive: true, force: true });
  });

  it("saves profile when user accepts", async () => {
    const { ensureOpcomDirs, saveGlobalConfig, saveWorkspace, loadProject, defaultSettings } =
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

    // Create project with a Makefile
    const projectDir = join(tempDir, "my-project");
    await mkdir(projectDir, { recursive: true });
    await writeFile(join(projectDir, "package.json"), JSON.stringify({
      name: "my-project",
      scripts: { test: "vitest run", build: "tsc" },
    }));

    await runAdd(projectDir, {
      promptFn: async (_q: string) => "", // accept (Enter)
    });

    const config = await loadProject("my-project");
    expect(config).not.toBeNull();
    expect(config!.profile).toBeDefined();
    expect(config!.profile!.commands).toBeDefined();
    expect(config!.profile!.commands!.length).toBeGreaterThan(0);
  });

  it("skips profile when user types s", async () => {
    const { ensureOpcomDirs, saveGlobalConfig, saveWorkspace, loadProject, defaultSettings } =
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

    // Create project with a Makefile
    const projectDir = join(tempDir, "skip-project");
    await mkdir(projectDir, { recursive: true });
    await writeFile(join(projectDir, "Makefile"), "test:\n\techo test\nbuild:\n\techo build\n");

    await runAdd(projectDir, {
      promptFn: async (_q: string) => "s", // skip
    });

    const config = await loadProject("skip-project");
    expect(config).not.toBeNull();
    expect(config!.profile).toBeUndefined();
  });
});

describe("runInitFolder with profile confirmation", () => {
  let tempDir: string;
  let originalHome: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "opcom-initfolder-profile-"));
    originalHome = process.env.HOME!;
    process.env.HOME = tempDir;
  });

  afterEach(async () => {
    process.env.HOME = originalHome;
    await rm(tempDir, { recursive: true, force: true });
  });

  it("saves profile when user accepts during init folder", async () => {
    const { ensureOpcomDirs, loadProject } = await import("@opcom/core");
    const { runInitFolder } = await import("../../packages/cli/src/commands/init.js");

    await ensureOpcomDirs();

    const projectDir = join(tempDir, "init-accept");
    await mkdir(projectDir, { recursive: true });
    await writeFile(join(projectDir, "Makefile"), "test:\n\techo test\nbuild:\n\techo build\n");

    await runInitFolder({
      folder: projectDir,
      promptFn: async (q: string) => {
        if (q.includes("Project name")) return "";
        if (q.includes("What is this project about")) return "test project";
        return ""; // accept profile (Enter)
      },
    });

    const config = await loadProject("init-accept");
    expect(config).not.toBeNull();
    expect(config!.profile).toBeDefined();
    expect(config!.profile!.commands).toBeDefined();
  });

  it("skips profile when user types s during init folder", async () => {
    const { ensureOpcomDirs, loadProject } = await import("@opcom/core");
    const { runInitFolder } = await import("../../packages/cli/src/commands/init.js");

    await ensureOpcomDirs();

    const projectDir = join(tempDir, "init-skip");
    await mkdir(projectDir, { recursive: true });
    await writeFile(join(projectDir, "Makefile"), "test:\n\techo test\nbuild:\n\techo build\n");

    let profilePromptSeen = false;
    await runInitFolder({
      folder: projectDir,
      promptFn: async (q: string) => {
        if (q.includes("Project name")) return "";
        if (q.includes("What is this project about")) return "test project";
        // The profile prompt uses "> " as the question
        if (q.trim() === ">") {
          profilePromptSeen = true;
          return "s"; // skip profile
        }
        return "";
      },
    });

    expect(profilePromptSeen).toBe(true);
    const config = await loadProject("init-skip");
    expect(config).not.toBeNull();
    expect(config!.profile).toBeUndefined();
  });
});
