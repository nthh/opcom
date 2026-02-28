import { describe, it, expect } from "vitest";
import { join } from "node:path";
import { detectProject } from "@opcom/core";

const FIXTURE_PATH = join(import.meta.dirname, "../fixtures/mock-project");

describe("detectProject — fixture", () => {
  it("detects full stack from mock project", async () => {
    const result = await detectProject(FIXTURE_PATH);

    expect(result.name).toBe("mock-project");
    expect(result.confidence).toBe("high");

    // Languages
    const langNames = result.stack.languages.map((l) => l.name);
    expect(langNames).toContain("typescript");
    expect(langNames).toContain("python");

    // Frameworks
    const fwNames = result.stack.frameworks.map((f) => f.name);
    expect(fwNames).toContain("Next.js");
    expect(fwNames).toContain("React");
    expect(fwNames).toContain("FastAPI");

    // Infrastructure
    expect(result.stack.infrastructure.map((i) => i.name)).toContain("docker");

    // Version managers
    expect(result.stack.versionManagers.map((v) => v.name)).toContain("mise");

    // Testing — vitest from package.json or pytest from pyproject.toml
    expect(result.testing).not.toBeNull();

    // Linting
    const lintNames = result.linting.map((l) => l.name);
    expect(lintNames).toContain("eslint");
    expect(lintNames).toContain("ruff");

    // Docker services
    expect(result.services.length).toBeGreaterThanOrEqual(2);

    // Tickets
    expect(result.workSystem).not.toBeNull();
    expect(result.workSystem!.type).toBe("tickets-dir");

    // Evidence
    expect(result.evidence.length).toBeGreaterThan(5);
  });
});

describe("detectProject — real projects", () => {
  const realProjects = [
    { path: join(process.env.HOME ?? "", "projects/mtnmap"), name: "mtnmap" },
    { path: join(process.env.HOME ?? "", "projects/folia"), name: "folia" },
    { path: join(process.env.HOME ?? "", "projects/conversi"), name: "conversi" },
    { path: join(process.env.HOME ?? "", "projects/costli"), name: "costli" },
  ];

  for (const { path, name } of realProjects) {
    it(`detects ${name}`, async () => {
      const result = await detectProject(path);
      expect(result.name).toBe(name);
      expect(result.evidence.length).toBeGreaterThan(0);
      // Just verify it runs without error — specific assertions per-project below
    });
  }

  it("mtnmap: Expo + Firebase + Cloudflare Workers", async () => {
    const result = await detectProject(realProjects[0].path);
    const infraNames = result.stack.infrastructure.map((i) => i.name);
    expect(infraNames).toContain("firebase");
    expect(result.workSystem).not.toBeNull();
  });

  it("folia: Python + Docker with tickets (trk)", async () => {
    const result = await detectProject(realProjects[1].path);
    const langNames = result.stack.languages.map((l) => l.name);
    expect(langNames).toContain("python");
    expect(result.stack.infrastructure.map((i) => i.name)).toContain("docker");
    expect(result.workSystem?.type).toBe("trk");
  });

  it("conversi: FastAPI + Docker", async () => {
    const result = await detectProject(realProjects[2].path);
    expect(result.stack.frameworks.map((f) => f.name)).toContain("FastAPI");
    expect(result.stack.infrastructure.map((i) => i.name)).toContain("docker");
  });

  it("costli: minimal project (no manifests, source glob fallback)", async () => {
    const result = await detectProject(realProjects[3].path);
    // With source file glob fallback, costli may detect languages from *.py etc.
    // Confidence is "medium" (language found) rather than "low" (nothing found)
    expect(["low", "medium"]).toContain(result.confidence);
    expect(result.stack.frameworks).toHaveLength(0);
  });
});
