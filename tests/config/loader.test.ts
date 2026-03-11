import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { WorkspaceConfig, ProjectConfig } from "@opcom/types";

// We need to mock the opcom root for tests
// Use dynamic imports after setting env

describe("config roundtrip", () => {
  let tempDir: string;
  let originalHome: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "opcom-test-"));
    originalHome = process.env.HOME!;
    process.env.HOME = tempDir;
  });

  afterEach(async () => {
    process.env.HOME = originalHome;
    await rm(tempDir, { recursive: true, force: true });
  });

  it("saves and loads workspace config", async () => {
    // Dynamic import so HOME is set before module loads
    const { ensureOpcomDirs, saveWorkspace, loadWorkspace } = await import("@opcom/core");

    await ensureOpcomDirs();

    const ws: WorkspaceConfig = {
      id: "test-ws",
      name: "Test Workspace",
      description: "For testing",
      projectIds: ["proj-1", "proj-2"],
      createdAt: "2026-02-27T00:00:00Z",
    };

    await saveWorkspace(ws);
    const loaded = await loadWorkspace("test-ws");

    expect(loaded).not.toBeNull();
    expect(loaded!.id).toBe("test-ws");
    expect(loaded!.name).toBe("Test Workspace");
    expect(loaded!.projectIds).toEqual(["proj-1", "proj-2"]);
  });

  it("saves and loads project config", async () => {
    const { ensureOpcomDirs, saveProject, loadProject, emptyStack } = await import("@opcom/core");

    await ensureOpcomDirs();

    const proj: ProjectConfig = {
      id: "test-proj",
      name: "Test Project",
      path: "/tmp/test",
      stack: {
        ...emptyStack(),
        languages: [{ name: "typescript", version: "5.0", sourceFile: "package.json" }],
      },
      git: { branch: "main", clean: true, remote: null },
      workSystem: { type: "tickets-dir", ticketDir: ".tickets/impl" },
      docs: {},
      services: [{ name: "api", port: 3000 }],
      environments: [],
      testing: [{ name: "vitest", framework: "vitest", command: "npx vitest run" }],
      linting: [{ name: "eslint", sourceFile: "eslint.config.js" }],
      subProjects: [],
      cloudServices: [],
      lastScannedAt: "2026-02-27T00:00:00Z",
    };

    await saveProject(proj);
    const loaded = await loadProject("test-proj");

    expect(loaded).not.toBeNull();
    expect(loaded!.id).toBe("test-proj");
    expect(loaded!.name).toBe("Test Project");
    expect(loaded!.stack.languages[0].name).toBe("typescript");
    expect(loaded!.git?.branch).toBe("main");
    expect(loaded!.workSystem?.type).toBe("tickets-dir");
    expect(loaded!.services[0].port).toBe(3000);
    expect(loaded!.testing[0]?.framework).toBe("vitest");
  });

  it("lists workspaces and projects", async () => {
    const { ensureOpcomDirs, saveWorkspace, listWorkspaces, saveProject, listProjects, emptyStack } = await import("@opcom/core");

    await ensureOpcomDirs();

    await saveWorkspace({ id: "ws-1", name: "WS 1", projectIds: [], createdAt: "2026-01-01T00:00:00Z" });
    await saveWorkspace({ id: "ws-2", name: "WS 2", projectIds: [], createdAt: "2026-01-01T00:00:00Z" });

    const workspaces = await listWorkspaces();
    expect(workspaces).toHaveLength(2);

    await saveProject({ id: "p1", name: "P1", path: "/tmp/p1", stack: emptyStack(), git: null, workSystem: null, docs: {}, services: [], environments: [], testing: [], linting: [], subProjects: [], cloudServices: [], lastScannedAt: "2026-01-01T00:00:00Z" });
    const projects = await listProjects();
    expect(projects).toHaveLength(1);
  });
});
