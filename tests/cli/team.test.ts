import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const { mockListTeams, mockLoadTeam } = vi.hoisted(() => ({
  mockListTeams: vi.fn(),
  mockLoadTeam: vi.fn(),
}));

vi.mock("@opcom/core", () => ({
  listTeams: mockListTeams,
  loadTeam: mockLoadTeam,
}));

import { runTeamList, runTeamShow } from "../../packages/cli/src/commands/team.js";
import type { TeamDefinition } from "@opcom/types";

function strip(s: string): string {
  return s.replace(/\x1b\[[0-9;]*m/g, "");
}

function makeTeam(overrides: Partial<TeamDefinition> & { id: string }): TeamDefinition {
  return {
    name: overrides.id,
    steps: [{ role: "engineer" }],
    ...overrides,
  };
}

describe("runTeamList", () => {
  let consoleSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
  });

  afterEach(() => {
    consoleSpy.mockRestore();
  });

  it("lists all available teams", async () => {
    mockListTeams.mockResolvedValue([
      makeTeam({ id: "solo-engineer", name: "Solo Engineer", description: "Single engineer" }),
      makeTeam({
        id: "feature-dev",
        name: "Feature Development",
        description: "Engineer → QA → Reviewer",
        steps: [
          { role: "engineer", verification: "test-gate" },
          { role: "qa", depends_on: "engineer" },
          { role: "reviewer", depends_on: "qa" },
        ],
      }),
    ]);

    await runTeamList();

    const output = strip(consoleSpy.mock.calls.map((c) => c[0]).join("\n"));
    expect(output).toContain("Teams");
    expect(output).toContain("2");
    expect(output).toContain("solo-engineer");
    expect(output).toContain("feature-dev");
    expect(output).toContain("engineer → qa → reviewer");
  });

  it("shows message when no teams available", async () => {
    mockListTeams.mockResolvedValue([]);

    await runTeamList();

    const output = strip(consoleSpy.mock.calls.map((c) => c[0]).join("\n"));
    expect(output).toContain("No teams available");
  });
});

describe("runTeamShow", () => {
  let consoleSpy: ReturnType<typeof vi.spyOn>;
  let exitSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    exitSpy = vi.spyOn(process, "exit").mockImplementation(() => { throw new Error("exit"); });
  });

  afterEach(() => {
    consoleSpy.mockRestore();
    exitSpy.mockRestore();
  });

  it("shows team details with steps", async () => {
    mockLoadTeam.mockResolvedValue(
      makeTeam({
        id: "feature-dev",
        name: "Feature Development",
        description: "Standard feature pipeline",
        steps: [
          { role: "engineer", verification: "test-gate" },
          { role: "qa", verification: "test-gate", depends_on: "engineer" },
          { role: "reviewer", verification: "none", depends_on: "qa" },
        ],
        triggers: { types: ["feature"] },
      }),
    );

    await runTeamShow("feature-dev");

    const output = strip(consoleSpy.mock.calls.map((c) => c[0]).join("\n"));
    expect(output).toContain("Feature Development");
    expect(output).toContain("Standard feature pipeline");
    expect(output).toContain("engineer");
    expect(output).toContain("qa");
    expect(output).toContain("reviewer");
    expect(output).toContain("verification: test-gate");
    expect(output).toContain("after: engineer");
    expect(output).toContain("feature");
  });

  it("errors when team not found", async () => {
    mockLoadTeam.mockResolvedValue(null);

    await expect(runTeamShow("nonexistent")).rejects.toThrow("exit");
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it("shows team with skills in steps", async () => {
    mockLoadTeam.mockResolvedValue(
      makeTeam({
        id: "custom",
        name: "Custom",
        steps: [
          { role: "engineer", skills: ["testing", "debugging"] },
        ],
      }),
    );

    await runTeamShow("custom");

    const output = strip(consoleSpy.mock.calls.map((c) => c[0]).join("\n"));
    expect(output).toContain("testing, debugging");
  });
});
