import { describe, it, expect } from "vitest";
import { buildProjectProfile, buildContextPacket, contextPacketToMarkdown, applyFieldMappings, validateProjectConfig } from "@opcom/core";
import type { ProjectConfig, WorkItem, FieldMapping } from "@opcom/types";

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

describe("ProjectProfile with commands, fieldMappings, agentConstraints", () => {
  it("includes commands from profile config", () => {
    const project = makeProject({
      profile: {
        commands: [
          { name: "build", command: "npm run build", description: "Build the project" },
          { name: "test", command: "npx vitest run" },
          { name: "dev", command: "npm run dev" },
        ],
      },
    });
    const profile = buildProjectProfile(project);

    expect(profile.commands).toHaveLength(3);
    expect(profile.commands![0]).toEqual({ name: "build", command: "npm run build", description: "Build the project" });
    expect(profile.commands![1]).toEqual({ name: "test", command: "npx vitest run" });
    expect(profile.commands![2]).toEqual({ name: "dev", command: "npm run dev" });
  });

  it("includes fieldMappings from profile config", () => {
    const project = makeProject({
      profile: {
        fieldMappings: [
          { field: "use-case", type: "use-case" as const, targetPath: "docs/use-cases/" },
          { field: "component", type: "tag" as const },
        ],
      },
    });
    const profile = buildProjectProfile(project);

    expect(profile.fieldMappings).toHaveLength(2);
    expect(profile.fieldMappings![0].field).toBe("use-case");
    expect(profile.fieldMappings![0].type).toBe("use-case");
    expect(profile.fieldMappings![1].type).toBe("tag");
  });

  it("includes agentConstraints from profile config", () => {
    const project = makeProject({
      profile: {
        agentConstraints: [
          { name: "test-required", rule: "All changes must include tests" },
          { name: "no-force-push", rule: "Never force push to main" },
        ],
      },
    });
    const profile = buildProjectProfile(project);

    expect(profile.agentConstraints).toHaveLength(2);
    expect(profile.agentConstraints![0]).toEqual({ name: "test-required", rule: "All changes must include tests" });
    expect(profile.agentConstraints![1]).toEqual({ name: "no-force-push", rule: "Never force push to main" });
  });

  it("omits commands/fieldMappings/agentConstraints when profile absent", () => {
    const project = makeProject();
    const profile = buildProjectProfile(project);

    expect(profile.commands).toBeUndefined();
    expect(profile.fieldMappings).toBeUndefined();
    expect(profile.agentConstraints).toBeUndefined();
  });

  it("omits commands/fieldMappings/agentConstraints when arrays are empty", () => {
    const project = makeProject({
      profile: { commands: [], fieldMappings: [], agentConstraints: [] },
    });
    const profile = buildProjectProfile(project);

    expect(profile.commands).toBeUndefined();
    expect(profile.fieldMappings).toBeUndefined();
    expect(profile.agentConstraints).toBeUndefined();
  });
});

describe("contextPacketToMarkdown with commands and constraints", () => {
  it("renders commands section", async () => {
    const project = makeProject({
      profile: {
        commands: [
          { name: "build", command: "npm run build", description: "Build the project" },
          { name: "test", command: "npx vitest run" },
        ],
      },
    });
    const packet = await buildContextPacket(project);
    const md = contextPacketToMarkdown(packet);

    expect(md).toContain("## Commands");
    expect(md).toContain("`build`: `npm run build` — Build the project");
    expect(md).toContain("`test`: `npx vitest run`");
  });

  it("renders dev command in agent guide output", async () => {
    const project = makeProject({
      profile: {
        commands: [
          { name: "dev", command: "npm run dev", description: "dev environment startup" },
          { name: "test", command: "npx vitest run" },
        ],
      },
    });
    const packet = await buildContextPacket(project);
    const md = contextPacketToMarkdown(packet);

    expect(md).toContain("## Commands");
    expect(md).toContain("`dev`: `npm run dev` — dev environment startup");
  });

  it("renders agent constraints section", async () => {
    const project = makeProject({
      profile: {
        agentConstraints: [
          { name: "test-required", rule: "All changes must include tests" },
        ],
      },
    });
    const packet = await buildContextPacket(project);
    const md = contextPacketToMarkdown(packet);

    expect(md).toContain("## Agent Constraints");
    expect(md).toContain("**test-required**: All changes must include tests");
  });

  it("omits commands/constraints sections when empty", async () => {
    const project = makeProject();
    const packet = await buildContextPacket(project);
    const md = contextPacketToMarkdown(packet);

    expect(md).not.toContain("## Commands");
    expect(md).not.toContain("## Agent Constraints");
  });
});

describe("profile persists in project YAML", () => {
  it("validateProjectConfig preserves profile with commands", () => {
    const raw = {
      id: "my-project",
      path: "/tmp/my-project",
      profile: {
        commands: [
          { name: "build", command: "npm run build" },
          { name: "test", command: "npx vitest run" },
        ],
        fieldMappings: [
          { field: "use-case", type: "use-case", targetPath: "docs/use-cases/" },
        ],
        agentConstraints: [
          { name: "test-required", rule: "All changes must include tests" },
        ],
      },
    };
    const config = validateProjectConfig(raw);

    expect(config.profile).toBeDefined();
    expect(config.profile!.commands).toHaveLength(2);
    expect(config.profile!.commands![0].name).toBe("build");
    expect(config.profile!.fieldMappings).toHaveLength(1);
    expect(config.profile!.fieldMappings![0].type).toBe("use-case");
    expect(config.profile!.agentConstraints).toHaveLength(1);
    expect(config.profile!.agentConstraints![0].name).toBe("test-required");
  });

  it("validateProjectConfig returns undefined profile when absent", () => {
    const raw = { id: "my-project", path: "/tmp/my-project" };
    const config = validateProjectConfig(raw);

    expect(config.profile).toBeUndefined();
  });

  it("validateProjectConfig filters invalid profile entries", () => {
    const raw = {
      id: "my-project",
      path: "/tmp/my-project",
      profile: {
        commands: [
          { name: "build", command: "npm run build" },
          { name: "bad" }, // missing command
          "not-an-object",
        ],
        fieldMappings: [
          { field: "use-case", type: "use-case" },
          { field: "bad", type: "invalid-type" }, // invalid type
        ],
        agentConstraints: [
          { name: "test-required", rule: "test rule" },
          { name: "missing-rule" }, // missing rule
        ],
      },
    };
    const config = validateProjectConfig(raw);

    expect(config.profile!.commands).toHaveLength(1);
    expect(config.profile!.fieldMappings).toHaveLength(1);
    expect(config.profile!.agentConstraints).toHaveLength(1);
  });
});

describe("applyFieldMappings", () => {
  function makeWorkItem(overrides?: Partial<WorkItem>): WorkItem {
    return {
      id: "test-ticket",
      title: "Test ticket",
      status: "open",
      priority: 2,
      type: "feature",
      filePath: "/tmp/test-ticket/README.md",
      deps: [],
      links: ["docs/spec/adapters.md"],
      tags: {},
      ...overrides,
    };
  }

  it("converts use-case tag values to links", () => {
    const items = [
      makeWorkItem({
        tags: { "use-case": ["authentication", "onboarding"] },
      }),
    ];
    const mappings: FieldMapping[] = [
      { field: "use-case", type: "use-case", targetPath: "docs/use-cases/" },
    ];

    const result = applyFieldMappings(items, mappings);

    expect(result[0].links).toContain("docs/spec/adapters.md"); // original link preserved
    expect(result[0].links).toContain("docs/use-cases/authentication.md");
    expect(result[0].links).toContain("docs/use-cases/onboarding.md");
    expect(result[0].tags["use-case"]).toBeUndefined(); // removed from tags
  });

  it("uses default targetPath when not specified", () => {
    const items = [
      makeWorkItem({ tags: { "use-case": ["login"] } }),
    ];
    const mappings: FieldMapping[] = [
      { field: "use-case", type: "use-case" },
    ];

    const result = applyFieldMappings(items, mappings);

    expect(result[0].links).toContain("docs/use-cases/login.md");
  });

  it("does not duplicate existing links", () => {
    const items = [
      makeWorkItem({
        links: ["docs/use-cases/auth.md"],
        tags: { "use-case": ["auth"] },
      }),
    ];
    const mappings: FieldMapping[] = [
      { field: "use-case", type: "use-case" },
    ];

    const result = applyFieldMappings(items, mappings);

    const authLinks = result[0].links.filter((l) => l === "docs/use-cases/auth.md");
    expect(authLinks).toHaveLength(1);
  });

  it("ignores tag-type field mappings (leaves tags alone)", () => {
    const items = [
      makeWorkItem({ tags: { component: ["frontend"] } }),
    ];
    const mappings: FieldMapping[] = [
      { field: "component", type: "tag" },
    ];

    const result = applyFieldMappings(items, mappings);

    expect(result[0].tags.component).toEqual(["frontend"]);
    expect(result[0].links).toEqual(["docs/spec/adapters.md"]); // unchanged
  });

  it("returns items unchanged when no mappings provided", () => {
    const items = [makeWorkItem({ tags: { "use-case": ["test"] } })];

    const result = applyFieldMappings(items, []);
    expect(result).toEqual(items);
  });

  it("handles items without matching tag fields", () => {
    const items = [makeWorkItem({ tags: { component: ["api"] } })];
    const mappings: FieldMapping[] = [
      { field: "use-case", type: "use-case" },
    ];

    const result = applyFieldMappings(items, mappings);

    expect(result[0].tags.component).toEqual(["api"]);
    expect(result[0].links).toEqual(["docs/spec/adapters.md"]);
  });
});
