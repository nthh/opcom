import { describe, it, expect } from "vitest";
import { buildProjectProfile, buildContextPacket, contextPacketToMarkdown } from "@opcom/core";
import type { ProjectConfig } from "@opcom/types";

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
    environments: [
      { name: "local", type: "local", url: "http://localhost:3000" },
      { name: "staging", type: "staging", url: "https://staging.example.com" },
      { name: "production", type: "production", url: "https://example.com" },
    ],
    testing: { framework: "vitest", command: "npm test" },
    linting: [{ name: "eslint", sourceFile: "eslint.config.js" }],
    subProjects: [],
    cloudServices: [],
    lastScannedAt: "2026-02-27T00:00:00Z",
    ...overrides,
  };
}

describe("buildProjectProfile", () => {
  it("extracts core fields from ProjectConfig", () => {
    const project = makeProject();
    const profile = buildProjectProfile(project);

    expect(profile.name).toBe("test-project");
    expect(profile.path).toBe("/tmp/test-project");
    expect(profile.stack.languages).toHaveLength(1);
    expect(profile.stack.languages[0].name).toBe("typescript");
    expect(profile.testing?.framework).toBe("vitest");
    expect(profile.linting).toHaveLength(1);
    expect(profile.services).toHaveLength(2);
  });

  it("includes description when present", () => {
    const project = makeProject({ description: "Multi-service app with FastAPI backend" });
    const profile = buildProjectProfile(project);

    expect(profile.description).toBe("Multi-service app with FastAPI backend");
  });

  it("omits description when absent", () => {
    const project = makeProject();
    const profile = buildProjectProfile(project);

    expect(profile.description).toBeUndefined();
  });

  it("includes environments", () => {
    const project = makeProject();
    const profile = buildProjectProfile(project);

    expect(profile.environments).toHaveLength(3);
    expect(profile.environments![0]).toEqual({ name: "local", type: "local", url: "http://localhost:3000" });
    expect(profile.environments![1]).toEqual({ name: "staging", type: "staging", url: "https://staging.example.com" });
    expect(profile.environments![2]).toEqual({ name: "production", type: "production", url: "https://example.com" });
  });

  it("handles empty environments", () => {
    const project = makeProject({ environments: [] });
    const profile = buildProjectProfile(project);

    expect(profile.environments).toEqual([]);
  });

  it("handles empty stack", () => {
    const project = makeProject({
      stack: {
        languages: [],
        frameworks: [],
        packageManagers: [],
        infrastructure: [],
        versionManagers: [],
      },
    });
    const profile = buildProjectProfile(project);

    expect(profile.stack.languages).toHaveLength(0);
    expect(profile.stack.frameworks).toHaveLength(0);
  });

  it("handles null testing", () => {
    const project = makeProject({ testing: null });
    const profile = buildProjectProfile(project);

    expect(profile.testing).toBeNull();
  });
});

describe("contextPacketToMarkdown with profile fields", () => {
  it("renders description when present", async () => {
    const project = makeProject({ description: "FastAPI backend on Vultr K8s" });
    const packet = await buildContextPacket(project);
    const md = contextPacketToMarkdown(packet);

    expect(md).toContain("Description: FastAPI backend on Vultr K8s");
  });

  it("omits description when absent", async () => {
    const project = makeProject();
    const packet = await buildContextPacket(project);
    const md = contextPacketToMarkdown(packet);

    expect(md).not.toContain("Description:");
  });

  it("renders environments when present", async () => {
    const project = makeProject();
    const packet = await buildContextPacket(project);
    const md = contextPacketToMarkdown(packet);

    expect(md).toContain("## Environments");
    expect(md).toContain("local (local) — http://localhost:3000");
    expect(md).toContain("staging (staging) — https://staging.example.com");
    expect(md).toContain("production (production) — https://example.com");
  });

  it("omits environments section when empty", async () => {
    const project = makeProject({ environments: [] });
    const packet = await buildContextPacket(project);
    const md = contextPacketToMarkdown(packet);

    expect(md).not.toContain("## Environments");
  });

  it("renders environment without URL", async () => {
    const project = makeProject({
      environments: [{ name: "local", type: "local" }],
    });
    const packet = await buildContextPacket(project);
    const md = contextPacketToMarkdown(packet);

    expect(md).toContain("local (local)");
    expect(md).not.toContain("local (local) —");
  });
});

describe("buildContextPacket uses buildProjectProfile", () => {
  it("populates project field via profile", async () => {
    const project = makeProject({ description: "Test app" });
    const packet = await buildContextPacket(project);

    expect(packet.project.name).toBe("test-project");
    expect(packet.project.description).toBe("Test app");
    expect(packet.project.environments).toHaveLength(3);
  });
});
