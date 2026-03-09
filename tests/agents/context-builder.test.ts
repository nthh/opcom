import { describe, it, expect } from "vitest";
import { buildContextPacket, contextPacketToMarkdown, buildTicketCreationPrompt, buildTicketChatPrompt } from "@opcom/core";
import type { ProjectConfig, WorkItem, ResolvedRoleConfig } from "@opcom/types";

function makeProject(overrides?: Partial<ProjectConfig>): ProjectConfig {
  return {
    id: "test-project",
    name: "test-project",
    path: "/tmp/test-project",
    stack: {
      languages: [{ name: "typescript", version: "5.7", sourceFile: "package.json" }],
      frameworks: [{ name: "express", sourceFile: "package.json" }],
      packageManagers: [{ name: "npm", sourceFile: "package-lock.json" }],
      infrastructure: [{ name: "docker", sourceFile: "Dockerfile" }],
      versionManagers: [],
    },
    git: { branch: "main", clean: true, remote: "origin" },
    workSystem: { type: "tickets-dir", ticketDir: ".tickets" },
    docs: {},
    services: [
      { name: "api", command: "npm start", port: 3000 },
      { name: "postgres", command: "docker compose up postgres", port: 5432 },
    ],
    environments: [],
    testing: { framework: "vitest", command: "npm test" },
    linting: [{ name: "eslint", sourceFile: "eslint.config.js" }],
    subProjects: [],
    cloudServices: [],
    lastScannedAt: "2026-02-27T00:00:00Z",
    ...overrides,
  };
}

function makeWorkItem(overrides?: Partial<WorkItem>): WorkItem {
  return {
    id: "test-ticket",
    title: "Test Ticket",
    status: "open",
    priority: 1,
    type: "feature",
    filePath: "/tmp/test-project/.tickets/test-ticket/README.md",
    deps: [],
    links: [],
    tags: {},
    ...overrides,
  };
}

describe("buildContextPacket", () => {
  it("builds packet from project without work item", async () => {
    const project = makeProject();
    const packet = await buildContextPacket(project);

    expect(packet.project.name).toBe("test-project");
    expect(packet.project.path).toBe("/tmp/test-project");
    expect(packet.project.stack.languages).toHaveLength(1);
    expect(packet.project.stack.languages[0].name).toBe("typescript");
    expect(packet.project.testing?.framework).toBe("vitest");
    expect(packet.project.linting).toHaveLength(1);
    expect(packet.project.services).toHaveLength(2);
    expect(packet.git.branch).toBe("main");
    expect(packet.git.clean).toBe(true);
    expect(packet.workItem).toBeUndefined();
  });

  it("builds packet with work item", async () => {
    const project = makeProject();
    const workItem = makeWorkItem();
    const packet = await buildContextPacket(project, workItem);

    expect(packet.workItem).toBeDefined();
    expect(packet.workItem!.ticket.id).toBe("test-ticket");
    expect(packet.workItem!.ticket.title).toBe("Test Ticket");
  });

  it("handles missing git gracefully", async () => {
    const project = makeProject({ git: null });
    const packet = await buildContextPacket(project);

    expect(packet.git.branch).toBe("main");
    expect(packet.git.clean).toBe(true);
  });

  it("loads summary into packet when summary file exists", async () => {
    const { mkdtemp, rm } = await import("node:fs/promises");
    const { join } = await import("node:path");
    const { tmpdir } = await import("node:os");
    const { writeProjectSummary, ensureOpcomDirs } = await import("@opcom/core");

    const tempDir = await mkdtemp(join(tmpdir(), "opcom-ctx-summary-"));
    const originalHome = process.env.HOME!;
    process.env.HOME = tempDir;

    try {
      await ensureOpcomDirs();
      const summaryContent = "# test-project — Project Summary\n\n## Current State\n- Last activity: 2026-03-09\n";
      await writeProjectSummary("test-project", summaryContent);

      const project = makeProject();
      const packet = await buildContextPacket(project);

      expect(packet.summary).toBe(summaryContent);
    } finally {
      process.env.HOME = originalHome;
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it("handles empty stack gracefully", async () => {
    const project = makeProject({
      stack: {
        languages: [],
        frameworks: [],
        packageManagers: [],
        infrastructure: [],
        versionManagers: [],
      },
    });
    const packet = await buildContextPacket(project);
    expect(packet.project.stack.languages).toHaveLength(0);
  });
});

describe("contextPacketToMarkdown", () => {
  it("generates markdown from packet", async () => {
    const project = makeProject();
    const workItem = makeWorkItem({ title: "Add caching layer" });
    const packet = await buildContextPacket(project, workItem);
    const md = contextPacketToMarkdown(packet);

    expect(md).toContain("# Project: test-project");
    expect(md).toContain("typescript 5.7");
    expect(md).toContain("express");
    expect(md).toContain("vitest");
    expect(md).toContain("`npm test`");
    expect(md).toContain("eslint");
    expect(md).toContain("api:3000");
    expect(md).toContain("## Task: Add caching layer");
    expect(md).toContain("test-ticket");
  });

  it("generates markdown without work item", async () => {
    const project = makeProject();
    const packet = await buildContextPacket(project);
    const md = contextPacketToMarkdown(packet);

    expect(md).toContain("# Project: test-project");
    expect(md).not.toContain("## Task");
  });

  it("injects role instructions when roleConfig provided", async () => {
    const project = makeProject();
    const packet = await buildContextPacket(project);
    const roleConfig: ResolvedRoleConfig = {
      roleId: "reviewer",
      name: "Reviewer",
      permissionMode: "default",
      allowedTools: [],
      disallowedTools: ["Edit", "Write"],
      allowedBashPatterns: [],
      instructions: "- Review code for correctness.\n- Do NOT modify any files.",
      doneCriteria: "Review report written to stdout.",
      runTests: false,
      runOracle: false,
    };

    const md = contextPacketToMarkdown(packet, roleConfig);

    expect(md).toContain("## Role: Reviewer");
    expect(md).toContain("Review code for correctness");
    expect(md).toContain("Do NOT modify any files");
    expect(md).toContain("## Done Criteria");
    expect(md).toContain("Review report written to stdout");
    // Should NOT contain the default engineer instructions
    expect(md).not.toContain("All changes MUST include tests");
  });

  it("uses default requirements when no roleConfig provided", async () => {
    const project = makeProject();
    const packet = await buildContextPacket(project);
    const md = contextPacketToMarkdown(packet);

    expect(md).toContain("All changes MUST include tests");
    expect(md).not.toContain("## Role:");
    expect(md).not.toContain("## Done Criteria");
  });

  it("includes summary in markdown when present", async () => {
    const project = makeProject();
    const packet = await buildContextPacket(project);
    packet.summary = "# MyApp Summary\n\n## Current State\n- Phase: Building\n";
    const md = contextPacketToMarkdown(packet);

    expect(md).toContain("## Project Summary");
    expect(md).toContain("Phase: Building");
  });

  it("omits summary section when not present", async () => {
    const project = makeProject();
    const packet = await buildContextPacket(project);
    const md = contextPacketToMarkdown(packet);

    expect(md).not.toContain("## Project Summary");
  });

  it("always includes git stash warning even with role instructions", async () => {
    const project = makeProject();
    const packet = await buildContextPacket(project);
    const roleConfig: ResolvedRoleConfig = {
      roleId: "qa",
      name: "QA Tester",
      permissionMode: "acceptEdits",
      allowedTools: [],
      disallowedTools: [],
      allowedBashPatterns: [],
      instructions: "- Write tests only.",
      doneCriteria: "Tests passing.",
      runTests: true,
      runOracle: false,
    };

    const md = contextPacketToMarkdown(packet, roleConfig);

    expect(md).toContain("git stash");
    expect(md).toContain("Write tests only");
  });
});

describe("buildTicketCreationPrompt", () => {
  it("generates prompt with user description and ticket dir", () => {
    const project = makeProject();
    const prompt = buildTicketCreationPrompt(project, "add rate limiting to API", []);

    expect(prompt).toContain("add rate limiting to API");
    expect(prompt).toContain("test-project");
    expect(prompt).toContain(".tickets/<id>/README.md");
    expect(prompt).toContain("kebab-case");
    expect(prompt).toContain("frontmatter");
    expect(prompt).toContain("## Goal");
    expect(prompt).toContain("## Tasks");
    expect(prompt).toContain("## Acceptance Criteria");
  });

  it("includes existing tickets for dependency awareness", () => {
    const project = makeProject();
    const existing = [
      makeWorkItem({ id: "auth-system", title: "Build auth system", status: "in-progress", priority: 1 }),
      makeWorkItem({ id: "db-schema", title: "Design DB schema", status: "closed", priority: 2 }),
    ];
    const prompt = buildTicketCreationPrompt(project, "add user profiles", existing);

    expect(prompt).toContain("Existing tickets");
    expect(prompt).toContain("auth-system: Build auth system (in-progress, P1");
    expect(prompt).toContain("db-schema: Design DB schema (closed, P2");
    expect(prompt).toContain("deps");
  });

  it("omits existing tickets section when none exist", () => {
    const project = makeProject();
    const prompt = buildTicketCreationPrompt(project, "new feature", []);

    expect(prompt).not.toContain("Existing tickets");
  });

  it("uses custom ticketDir from project config", () => {
    const project = makeProject({ workSystem: { type: "trk", ticketDir: ".tickets/impl" } });
    const prompt = buildTicketCreationPrompt(project, "fix bug", []);

    expect(prompt).toContain(".tickets/impl/<id>/README.md");
  });

  it("falls back to .tickets when no workSystem configured", () => {
    const project = makeProject({ workSystem: null });
    const prompt = buildTicketCreationPrompt(project, "fix bug", []);

    expect(prompt).toContain(".tickets/<id>/README.md");
  });
});

describe("buildTicketChatPrompt", () => {
  it("includes ticket details and user message", () => {
    const project = makeProject();
    const ticket = makeWorkItem({ id: "auth-flow", title: "Fix auth flow", priority: 1, type: "bug" });
    const prompt = buildTicketChatPrompt(project, ticket, "implement this ticket");

    expect(prompt).toContain("test-project");
    expect(prompt).toContain("Fix auth flow");
    expect(prompt).toContain("auth-flow");
    expect(prompt).toContain("P1");
    expect(prompt).toContain("bug");
    expect(prompt).toContain("implement this ticket");
  });

  it("includes ticket dependencies", () => {
    const project = makeProject();
    const ticket = makeWorkItem({ deps: ["db-schema", "api-design"] });
    const prompt = buildTicketChatPrompt(project, ticket, "break into subtasks");

    expect(prompt).toContain("db-schema, api-design");
  });

  it("includes ticket file path", () => {
    const project = makeProject();
    const ticket = makeWorkItem({ filePath: "/tmp/test-project/.tickets/my-ticket/README.md" });
    const prompt = buildTicketChatPrompt(project, ticket, "update priority");

    expect(prompt).toContain("/tmp/test-project/.tickets/my-ticket/README.md");
  });
});
