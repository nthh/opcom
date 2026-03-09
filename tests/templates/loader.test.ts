import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { stringify as stringifyYaml } from "yaml";
import {
  loadTemplateFromDir,
  loadUserTemplates,
  loadAllTemplates,
  findTemplate,
} from "../../packages/core/src/templates/loader.js";
import { BUILTIN_TEMPLATES } from "../../packages/core/src/templates/builtins.js";

describe("loadTemplateFromDir", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "opcom-tpl-"));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it("loads a template from a directory", async () => {
    const templateDir = join(tempDir, "my-template");
    await mkdir(join(templateDir, "tickets"), { recursive: true });

    await writeFile(
      join(templateDir, "template.yaml"),
      stringifyYaml({
        id: "my-template",
        name: "My Template",
        description: "A test template",
        tags: ["test"],
        variables: [{ name: "foo", prompt: "Enter foo" }],
        directories: ["docs"],
      }),
    );

    await writeFile(join(templateDir, "AGENTS.md"), "# {{name}}\n\nAgent config for {{foo}}.\n");
    await writeFile(join(templateDir, "tickets/task-one.md"), "# Task: {{foo}}\n");

    const template = await loadTemplateFromDir(templateDir);

    expect(template.id).toBe("my-template");
    expect(template.name).toBe("My Template");
    expect(template.description).toBe("A test template");
    expect(template.tags).toEqual(["test"]);
    expect(template.variables).toHaveLength(1);
    expect(template.variables![0].name).toBe("foo");
    expect(template.directories).toEqual(["docs"]);
    expect(template.agentsMd).toContain("{{name}}");
    expect(template.tickets["task-one.md"]).toContain("{{foo}}");
  });

  it("throws if no template.yaml", async () => {
    const templateDir = join(tempDir, "empty");
    await mkdir(templateDir, { recursive: true });

    await expect(loadTemplateFromDir(templateDir)).rejects.toThrow("No template.yaml");
  });

  it("provides default AGENTS.md if missing", async () => {
    const templateDir = join(tempDir, "no-agents");
    await mkdir(templateDir, { recursive: true });

    await writeFile(
      join(templateDir, "template.yaml"),
      stringifyYaml({ id: "no-agents", name: "No Agents", description: "Test" }),
    );

    const template = await loadTemplateFromDir(templateDir);
    expect(template.agentsMd).toContain("{{name}}");
    expect(template.agentsMd).toContain("{{description}}");
  });

  it("handles template with no tickets directory", async () => {
    const templateDir = join(tempDir, "no-tickets");
    await mkdir(templateDir, { recursive: true });

    await writeFile(
      join(templateDir, "template.yaml"),
      stringifyYaml({ id: "no-tickets", name: "No Tickets", description: "Test" }),
    );

    const template = await loadTemplateFromDir(templateDir);
    expect(Object.keys(template.tickets)).toHaveLength(0);
  });
});

describe("loadUserTemplates", () => {
  let tempDir: string;
  let originalHome: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "opcom-user-tpl-"));
    originalHome = process.env.HOME!;
    process.env.HOME = tempDir;
  });

  afterEach(async () => {
    process.env.HOME = originalHome;
    await rm(tempDir, { recursive: true, force: true });
  });

  it("returns empty array when templates dir does not exist", async () => {
    const templates = await loadUserTemplates();
    expect(templates).toHaveLength(0);
  });

  it("loads user templates from ~/.opcom/templates/", async () => {
    const tplDir = join(tempDir, ".opcom/templates/custom");
    await mkdir(tplDir, { recursive: true });
    await writeFile(
      join(tplDir, "template.yaml"),
      stringifyYaml({ id: "custom", name: "Custom", description: "Custom template" }),
    );

    const templates = await loadUserTemplates();
    expect(templates).toHaveLength(1);
    expect(templates[0].id).toBe("custom");
  });

  it("skips directories without template.yaml", async () => {
    const tplDir = join(tempDir, ".opcom/templates/invalid");
    await mkdir(tplDir, { recursive: true });
    await writeFile(join(tplDir, "README.md"), "# Not a template\n");

    const templates = await loadUserTemplates();
    expect(templates).toHaveLength(0);
  });
});

describe("loadAllTemplates", () => {
  let tempDir: string;
  let originalHome: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "opcom-all-tpl-"));
    originalHome = process.env.HOME!;
    process.env.HOME = tempDir;
  });

  afterEach(async () => {
    process.env.HOME = originalHome;
    await rm(tempDir, { recursive: true, force: true });
  });

  it("includes built-in templates when no user templates exist", async () => {
    const templates = await loadAllTemplates();
    expect(templates.length).toBe(BUILTIN_TEMPLATES.length);
    const ids = templates.map((t) => t.id);
    expect(ids).toContain("software");
    expect(ids).toContain("travel");
  });

  it("user template overrides built-in with same id", async () => {
    const tplDir = join(tempDir, ".opcom/templates/software");
    await mkdir(tplDir, { recursive: true });
    await writeFile(
      join(tplDir, "template.yaml"),
      stringifyYaml({ id: "software", name: "Custom Software", description: "My custom software template" }),
    );

    const templates = await loadAllTemplates();
    const software = templates.find((t) => t.id === "software")!;
    expect(software.name).toBe("Custom Software");
    expect(software.description).toBe("My custom software template");
  });

  it("includes both built-ins and user templates", async () => {
    const tplDir = join(tempDir, ".opcom/templates/marketing");
    await mkdir(tplDir, { recursive: true });
    await writeFile(
      join(tplDir, "template.yaml"),
      stringifyYaml({ id: "marketing", name: "Marketing", description: "Marketing campaign" }),
    );

    const templates = await loadAllTemplates();
    const ids = templates.map((t) => t.id);
    expect(ids).toContain("software");
    expect(ids).toContain("marketing");
    expect(templates.length).toBe(BUILTIN_TEMPLATES.length + 1);
  });
});

describe("findTemplate", () => {
  let tempDir: string;
  let originalHome: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "opcom-find-tpl-"));
    originalHome = process.env.HOME!;
    process.env.HOME = tempDir;
  });

  afterEach(async () => {
    process.env.HOME = originalHome;
    await rm(tempDir, { recursive: true, force: true });
  });

  it("finds a built-in template by id", async () => {
    const template = await findTemplate("travel");
    expect(template).not.toBeNull();
    expect(template!.id).toBe("travel");
  });

  it("returns null for unknown template", async () => {
    const template = await findTemplate("nonexistent");
    expect(template).toBeNull();
  });

  it("prefers user template over built-in", async () => {
    const tplDir = join(tempDir, ".opcom/templates/travel");
    await mkdir(tplDir, { recursive: true });
    await writeFile(
      join(tplDir, "template.yaml"),
      stringifyYaml({ id: "travel", name: "My Travel", description: "Custom travel" }),
    );

    const template = await findTemplate("travel");
    expect(template!.name).toBe("My Travel");
  });
});
