import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, readFile, readdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { mkdir, writeFile } from "node:fs/promises";
import { scaffoldFromTemplate } from "../../packages/core/src/templates/scaffold.js";
import { BUILTIN_TEMPLATES } from "../../packages/core/src/templates/builtins.js";
import type { ProjectTemplate } from "@opcom/types";

describe("scaffoldFromTemplate", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "opcom-scaffold-"));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it("creates directories from template", async () => {
    const template: ProjectTemplate = {
      id: "test",
      name: "Test",
      description: "Test template",
      directories: [".tickets/impl", "docs", "docs/research"],
      tickets: {},
      agentsMd: "# {{name}}\n",
    };

    const result = await scaffoldFromTemplate({
      projectDir: tempDir,
      template,
      variables: { name: "My Project" },
    });

    expect(existsSync(join(tempDir, ".tickets/impl"))).toBe(true);
    expect(existsSync(join(tempDir, "docs"))).toBe(true);
    expect(existsSync(join(tempDir, "docs/research"))).toBe(true);
    expect(result.directoriesCreated).toContain("docs");
    expect(result.directoriesCreated).toContain("docs/research");
  });

  it("creates ticket files with variable substitution", async () => {
    const template: ProjectTemplate = {
      id: "test",
      name: "Test",
      description: "Test",
      tickets: {
        "my-ticket.md": "# Build {{feature}}\n\nImplement {{feature}} for {{name}}.\n",
      },
      agentsMd: "# {{name}}\n",
    };

    const result = await scaffoldFromTemplate({
      projectDir: tempDir,
      template,
      variables: { name: "Cool App", feature: "auth" },
    });

    expect(result.ticketCount).toBe(1);
    const content = await readFile(join(tempDir, ".tickets/impl/my-ticket.md"), "utf-8");
    expect(content).toBe("# Build auth\n\nImplement auth for Cool App.\n");
  });

  it("creates AGENTS.md with variable substitution", async () => {
    const template: ProjectTemplate = {
      id: "test",
      name: "Test",
      description: "Test",
      tickets: {},
      agentsMd: "# {{name}}\n\n{{description}}\n\nDest: {{destination}}\n",
    };

    const result = await scaffoldFromTemplate({
      projectDir: tempDir,
      template,
      variables: { name: "Japan Trip", description: "Plan Japan trip", destination: "Tokyo" },
    });

    expect(result.agentsMdWritten).toBe(true);
    const content = await readFile(join(tempDir, "AGENTS.md"), "utf-8");
    expect(content).toContain("# Japan Trip");
    expect(content).toContain("Plan Japan trip");
    expect(content).toContain("Dest: Tokyo");
  });

  it("does not overwrite existing AGENTS.md", async () => {
    await writeFile(join(tempDir, "AGENTS.md"), "# Existing\n", "utf-8");

    const template: ProjectTemplate = {
      id: "test",
      name: "Test",
      description: "Test",
      tickets: {},
      agentsMd: "# New content\n",
    };

    const result = await scaffoldFromTemplate({
      projectDir: tempDir,
      template,
      variables: {},
    });

    expect(result.agentsMdWritten).toBe(false);
    const content = await readFile(join(tempDir, "AGENTS.md"), "utf-8");
    expect(content).toBe("# Existing\n");
  });

  it("does not overwrite existing ticket files", async () => {
    await mkdir(join(tempDir, ".tickets/impl"), { recursive: true });
    await writeFile(join(tempDir, ".tickets/impl/existing.md"), "# Keep me\n", "utf-8");

    const template: ProjectTemplate = {
      id: "test",
      name: "Test",
      description: "Test",
      tickets: {
        "existing.md": "# Overwritten\n",
        "new.md": "# New ticket\n",
      },
      agentsMd: "# Test\n",
    };

    const result = await scaffoldFromTemplate({
      projectDir: tempDir,
      template,
      variables: {},
    });

    // Only the new ticket was created
    expect(result.ticketCount).toBe(1);

    const existing = await readFile(join(tempDir, ".tickets/impl/existing.md"), "utf-8");
    expect(existing).toBe("# Keep me\n");

    const newTicket = await readFile(join(tempDir, ".tickets/impl/new.md"), "utf-8");
    expect(newTicket).toBe("# New ticket\n");
  });

  it("scaffolds the travel template with variables", async () => {
    const travel = BUILTIN_TEMPLATES.find((t) => t.id === "travel")!;

    const result = await scaffoldFromTemplate({
      projectDir: tempDir,
      template: travel,
      variables: {
        name: "Japan Trip",
        description: "Two weeks in Japan",
        destination: "Japan (Tokyo + Kyoto)",
        dates: "May 12-20, 2026",
        travelers: "2",
      },
    });

    expect(result.ticketCount).toBe(4);
    expect(result.agentsMdWritten).toBe(true);

    // Check variable substitution in tickets
    const flights = await readFile(join(tempDir, ".tickets/impl/book-flights.md"), "utf-8");
    expect(flights).toContain("Japan (Tokyo + Kyoto)");
    expect(flights).toContain("2 traveler(s)");
    expect(flights).toContain("May 12-20, 2026");

    // Check AGENTS.md
    const agentsMd = await readFile(join(tempDir, "AGENTS.md"), "utf-8");
    expect(agentsMd).toContain("Japan Trip");
    expect(agentsMd).toContain("Japan (Tokyo + Kyoto)");

    // Check directories
    expect(existsSync(join(tempDir, "docs/research"))).toBe(true);
  });

  it("scaffolds the software template without variables", async () => {
    const software = BUILTIN_TEMPLATES.find((t) => t.id === "software")!;

    const result = await scaffoldFromTemplate({
      projectDir: tempDir,
      template: software,
      variables: { name: "My App", description: "A cool app" },
    });

    expect(result.ticketCount).toBe(3);
    expect(result.agentsMdWritten).toBe(true);

    // Tickets have proper frontmatter
    const ci = await readFile(join(tempDir, ".tickets/impl/setup-ci.md"), "utf-8");
    expect(ci).toContain("id: setup-ci");
    expect(ci).toContain("status: open");

    // AGENTS.md has project info
    const agentsMd = await readFile(join(tempDir, "AGENTS.md"), "utf-8");
    expect(agentsMd).toContain("My App");
    expect(agentsMd).toContain("A cool app");
  });
});
