import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

describe("opcom init <folder> with templates", () => {
  let tempDir: string;
  let originalHome: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "opcom-init-tpl-"));
    originalHome = process.env.HOME!;
    process.env.HOME = tempDir;
  });

  afterEach(async () => {
    process.env.HOME = originalHome;
    await rm(tempDir, { recursive: true, force: true });
  });

  it("scaffolds project from travel template with variables", async () => {
    const { ensureOpcomDirs } = await import("@opcom/core");
    const { runInitFolder } = await import("../../packages/cli/src/commands/init.js");

    await ensureOpcomDirs();

    const projectDir = join(tempDir, "japan-trip");
    const prompts: string[] = [];

    await runInitFolder({
      folder: projectDir,
      promptFn: async (q: string) => {
        prompts.push(q);
        if (q.includes("Project name")) return "Japan Trip";
        if (q.includes("What is this project about")) return "Plan Japan trip";
        // Template selection: travel is [3]
        if (q.trim() === ">") return "3";
        if (q.includes("Where are you going")) return "Tokyo";
        if (q.includes("What dates")) return "May 12-20";
        if (q.includes("How many travelers")) return "2";
        return "";
      },
    });

    // Tickets from travel template were created
    expect(existsSync(join(projectDir, ".tickets/impl/book-flights.md"))).toBe(true);
    expect(existsSync(join(projectDir, ".tickets/impl/book-accommodation.md"))).toBe(true);
    expect(existsSync(join(projectDir, ".tickets/impl/plan-activities.md"))).toBe(true);
    expect(existsSync(join(projectDir, ".tickets/impl/create-itinerary.md"))).toBe(true);

    // Variable substitution happened
    const flights = await readFile(join(projectDir, ".tickets/impl/book-flights.md"), "utf-8");
    expect(flights).toContain("Tokyo");
    expect(flights).toContain("2 traveler(s)");
    expect(flights).toContain("May 12-20");

    // AGENTS.md created with template content
    const agentsMd = await readFile(join(projectDir, "AGENTS.md"), "utf-8");
    expect(agentsMd).toContain("Japan Trip");
    expect(agentsMd).toContain("Tokyo");

    // docs/research directory created
    expect(existsSync(join(projectDir, "docs/research"))).toBe(true);

    // Project config saved
    const { loadProject } = await import("@opcom/core");
    const config = await loadProject("japan-trip");
    expect(config).not.toBeNull();
    expect(config!.name).toBe("Japan Trip");
  });

  it("scaffolds project from software template without variables", async () => {
    const { ensureOpcomDirs } = await import("@opcom/core");
    const { runInitFolder } = await import("../../packages/cli/src/commands/init.js");

    await ensureOpcomDirs();

    const projectDir = join(tempDir, "my-app");

    await runInitFolder({
      folder: projectDir,
      promptFn: async (q: string) => {
        if (q.includes("Project name")) return "My App";
        if (q.includes("What is this project about")) return "A web application";
        // Template selection: software is [1]
        if (q.trim() === ">") return "1";
        return "";
      },
    });

    // Software template tickets created
    expect(existsSync(join(projectDir, ".tickets/impl/setup-ci.md"))).toBe(true);
    expect(existsSync(join(projectDir, ".tickets/impl/setup-testing.md"))).toBe(true);
    expect(existsSync(join(projectDir, ".tickets/impl/initial-feature.md"))).toBe(true);

    // AGENTS.md has project info
    const agentsMd = await readFile(join(projectDir, "AGENTS.md"), "utf-8");
    expect(agentsMd).toContain("My App");
    expect(agentsMd).toContain("A web application");
  });

  it("skips template when user selects 'none'", async () => {
    const { ensureOpcomDirs } = await import("@opcom/core");
    const { runInitFolder } = await import("../../packages/cli/src/commands/init.js");

    await ensureOpcomDirs();

    const projectDir = join(tempDir, "empty-proj");

    await runInitFolder({
      folder: projectDir,
      promptFn: async (q: string) => {
        if (q.includes("Project name")) return "";
        if (q.includes("What is this project about")) return "Just a project";
        // Select "none" (last option = 5)
        if (q.trim() === ">") return "5";
        return "";
      },
    });

    // Basic scaffolding still created
    expect(existsSync(join(projectDir, ".tickets/impl"))).toBe(true);
    expect(existsSync(join(projectDir, "AGENTS.md"))).toBe(true);

    // No template tickets
    expect(existsSync(join(projectDir, ".tickets/impl/setup-ci.md"))).toBe(false);
    expect(existsSync(join(projectDir, ".tickets/impl/book-flights.md"))).toBe(false);

    // AGENTS.md is the basic one, not a template
    const agentsMd = await readFile(join(projectDir, "AGENTS.md"), "utf-8");
    expect(agentsMd).toContain("empty-proj");
    expect(agentsMd).toContain("Just a project");
  });

  it("uses default variable value when user enters empty string", async () => {
    const { ensureOpcomDirs } = await import("@opcom/core");
    const { runInitFolder } = await import("../../packages/cli/src/commands/init.js");

    await ensureOpcomDirs();

    const projectDir = join(tempDir, "trip");

    await runInitFolder({
      folder: projectDir,
      promptFn: async (q: string) => {
        if (q.includes("Project name")) return "";
        if (q.includes("What is this project about")) return "A trip";
        if (q.trim() === ">") return "3"; // travel
        if (q.includes("Where are you going")) return "Paris";
        if (q.includes("What dates")) return "June 1-5";
        if (q.includes("How many travelers")) return ""; // default: 1
        return "";
      },
    });

    const flights = await readFile(join(projectDir, ".tickets/impl/book-flights.md"), "utf-8");
    expect(flights).toContain("1 traveler(s)");
  });
});
