import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  BUILTIN_TEAMS,
  loadTeam,
  listTeams,
  resolveTeam,
  matchesTriggers,
  writeBuiltinTeams,
  parseTeamYaml,
} from "@opcom/core";
import type { WorkItem, TeamDefinition } from "@opcom/types";

function makeWorkItem(overrides: Partial<WorkItem> & { id: string }): WorkItem {
  return {
    title: overrides.id,
    status: "open",
    priority: 2,
    type: "feature",
    filePath: `/project/.tickets/${overrides.id}.md`,
    deps: [],
    links: [],
    tags: {},
    ...overrides,
  };
}

describe("BUILTIN_TEAMS", () => {
  it("defines four built-in teams", () => {
    expect(Object.keys(BUILTIN_TEAMS)).toEqual([
      "solo-engineer",
      "feature-dev",
      "research",
      "ops-task",
    ]);
  });

  it("solo-engineer has a single engineer step", () => {
    const team = BUILTIN_TEAMS["solo-engineer"];
    expect(team.name).toBe("Solo Engineer");
    expect(team.steps).toHaveLength(1);
    expect(team.steps[0].role).toBe("engineer");
    expect(team.steps[0].verification).toBe("test-gate");
  });

  it("feature-dev has engineer → qa → reviewer pipeline", () => {
    const team = BUILTIN_TEAMS["feature-dev"];
    expect(team.name).toBe("Feature Development");
    expect(team.steps).toHaveLength(3);
    expect(team.steps[0].role).toBe("engineer");
    expect(team.steps[1].role).toBe("qa");
    expect(team.steps[1].depends_on).toBe("engineer");
    expect(team.steps[2].role).toBe("reviewer");
    expect(team.steps[2].depends_on).toBe("qa");
  });

  it("feature-dev triggers on type 'feature'", () => {
    const team = BUILTIN_TEAMS["feature-dev"];
    expect(team.triggers?.types).toContain("feature");
  });

  it("research team has single researcher step", () => {
    const team = BUILTIN_TEAMS.research;
    expect(team.steps).toHaveLength(1);
    expect(team.steps[0].role).toBe("researcher");
    expect(team.steps[0].verification).toBe("output-exists");
    expect(team.triggers?.types).toContain("research");
  });

  it("ops-task triggers on task, booking, coordination types", () => {
    const team = BUILTIN_TEAMS["ops-task"];
    expect(team.triggers?.types).toContain("task");
    expect(team.triggers?.types).toContain("booking");
    expect(team.triggers?.types).toContain("coordination");
    expect(team.steps[0].verification).toBe("confirmation");
  });
});

describe("matchesTriggers", () => {
  it("matches when ticket type is in team triggers", () => {
    const team = BUILTIN_TEAMS["feature-dev"];
    const item = makeWorkItem({ id: "t1", type: "feature" });
    expect(matchesTriggers(team, item)).toBe(true);
  });

  it("does not match when ticket type is not in triggers", () => {
    const team = BUILTIN_TEAMS["feature-dev"];
    const item = makeWorkItem({ id: "t1", type: "bug" });
    expect(matchesTriggers(team, item)).toBe(false);
  });

  it("returns false when team has no triggers", () => {
    const team = BUILTIN_TEAMS["solo-engineer"];
    const item = makeWorkItem({ id: "t1", type: "feature" });
    expect(matchesTriggers(team, item)).toBe(false);
  });

  it("respects priority_min", () => {
    const team: TeamDefinition = {
      id: "test",
      name: "Test",
      steps: [{ role: "engineer" }],
      triggers: { types: ["feature"], priority_min: 2 },
    };
    expect(matchesTriggers(team, makeWorkItem({ id: "t1", type: "feature", priority: 1 }))).toBe(false);
    expect(matchesTriggers(team, makeWorkItem({ id: "t2", type: "feature", priority: 2 }))).toBe(true);
    expect(matchesTriggers(team, makeWorkItem({ id: "t3", type: "feature", priority: 3 }))).toBe(true);
  });

  it("matches tag-based triggers", () => {
    const team: TeamDefinition = {
      id: "test",
      name: "Test",
      steps: [{ role: "engineer" }],
      triggers: { tags: { services: ["api"] } },
    };
    expect(matchesTriggers(team, makeWorkItem({ id: "t1", tags: { services: ["api", "web"] } }))).toBe(true);
    expect(matchesTriggers(team, makeWorkItem({ id: "t2", tags: { services: ["web"] } }))).toBe(false);
    expect(matchesTriggers(team, makeWorkItem({ id: "t3", tags: {} }))).toBe(false);
  });
});

describe("resolveTeam", () => {
  it("returns team from explicit team field", async () => {
    const item = makeWorkItem({ id: "t1", team: "feature-dev" });
    const team = await resolveTeam(item);
    expect(team).not.toBeNull();
    expect(team!.id).toBe("feature-dev");
  });

  it("matches by ticket type when no explicit team", async () => {
    const item = makeWorkItem({ id: "t1", type: "feature" });
    const team = await resolveTeam(item);
    expect(team).not.toBeNull();
    expect(team!.id).toBe("feature-dev");
  });

  it("returns null when no match", async () => {
    const item = makeWorkItem({ id: "t1", type: "bug" });
    const team = await resolveTeam(item);
    expect(team).toBeNull();
  });

  it("explicit team field takes priority over type match", async () => {
    const item = makeWorkItem({ id: "t1", type: "feature", team: "ops-task" });
    const team = await resolveTeam(item);
    expect(team).not.toBeNull();
    expect(team!.id).toBe("ops-task");
  });
});

describe("parseTeamYaml", () => {
  it("parses a team YAML with steps and triggers", () => {
    const yaml = `id: custom-team
name: Custom Team
description: A custom team
steps:
  - role: engineer
    verification: test-gate
  - role: qa
    verification: test-gate
    depends_on: engineer
triggers:
  types: [feature, enhancement]
  priority_min: 1
`;
    const team = parseTeamYaml(yaml);
    expect(team).not.toBeNull();
    expect(team!.id).toBe("custom-team");
    expect(team!.name).toBe("Custom Team");
    expect(team!.description).toBe("A custom team");
    expect(team!.steps).toHaveLength(2);
    expect(team!.steps[0].role).toBe("engineer");
    expect(team!.steps[0].verification).toBe("test-gate");
    expect(team!.steps[1].role).toBe("qa");
    expect(team!.steps[1].depends_on).toBe("engineer");
    expect(team!.triggers?.types).toEqual(["feature", "enhancement"]);
    expect(team!.triggers?.priority_min).toBe(1);
  });

  it("parses YAML with frontmatter delimiters", () => {
    const yaml = `---
id: delimited
name: Delimited Team
steps:
  - role: researcher
    verification: output-exists
---`;
    const team = parseTeamYaml(yaml);
    expect(team).not.toBeNull();
    expect(team!.id).toBe("delimited");
    expect(team!.steps).toHaveLength(1);
    expect(team!.steps[0].role).toBe("researcher");
  });

  it("returns null for content without steps", () => {
    const yaml = `id: no-steps
name: No Steps Team`;
    expect(parseTeamYaml(yaml)).toBeNull();
  });

  it("returns null for content without id", () => {
    const yaml = `name: No ID
steps:
  - role: engineer`;
    expect(parseTeamYaml(yaml)).toBeNull();
  });
});

describe("loadTeam", () => {
  let tmpDir: string;
  let originalHome: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "opcom-teams-test-"));
    originalHome = process.env.HOME!;
    process.env.HOME = tmpDir;
  });

  afterEach(async () => {
    process.env.HOME = originalHome;
    await rm(tmpDir, { recursive: true });
  });

  it("loads built-in team when no user file exists", async () => {
    const team = await loadTeam("feature-dev");
    expect(team).not.toBeNull();
    expect(team!.id).toBe("feature-dev");
    expect(team!.steps).toHaveLength(3);
  });

  it("loads user-defined team from disk", async () => {
    const teamsPath = join(tmpDir, ".opcom", "teams");
    await mkdir(teamsPath, { recursive: true });
    await writeFile(
      join(teamsPath, "custom.yaml"),
      `id: custom
name: Custom Pipeline
steps:
  - role: engineer
    verification: test-gate
  - role: reviewer
    verification: none
    depends_on: engineer
`,
    );

    const team = await loadTeam("custom");
    expect(team).not.toBeNull();
    expect(team!.id).toBe("custom");
    expect(team!.name).toBe("Custom Pipeline");
    expect(team!.steps).toHaveLength(2);
    expect(team!.steps[1].depends_on).toBe("engineer");
  });

  it("user file overrides built-in team", async () => {
    const teamsPath = join(tmpDir, ".opcom", "teams");
    await mkdir(teamsPath, { recursive: true });
    await writeFile(
      join(teamsPath, "feature-dev.yaml"),
      `id: feature-dev
name: Custom Feature Dev
steps:
  - role: engineer
    verification: test-gate
  - role: reviewer
    verification: none
    depends_on: engineer
`,
    );

    const team = await loadTeam("feature-dev");
    expect(team).not.toBeNull();
    expect(team!.name).toBe("Custom Feature Dev");
    expect(team!.steps).toHaveLength(2); // only 2 instead of built-in 3
  });

  it("returns null for unknown team", async () => {
    const team = await loadTeam("nonexistent");
    expect(team).toBeNull();
  });
});

describe("listTeams", () => {
  let tmpDir: string;
  let originalHome: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "opcom-teams-list-"));
    originalHome = process.env.HOME!;
    process.env.HOME = tmpDir;
  });

  afterEach(async () => {
    process.env.HOME = originalHome;
    await rm(tmpDir, { recursive: true });
  });

  it("lists all built-in teams when no user teams exist", async () => {
    const teams = await listTeams();
    const ids = teams.map((t) => t.id);
    expect(ids).toContain("solo-engineer");
    expect(ids).toContain("feature-dev");
    expect(ids).toContain("research");
    expect(ids).toContain("ops-task");
  });

  it("includes user-defined teams", async () => {
    const teamsPath = join(tmpDir, ".opcom", "teams");
    await mkdir(teamsPath, { recursive: true });
    await writeFile(
      join(teamsPath, "my-team.yaml"),
      `id: my-team
name: My Team
steps:
  - role: engineer
    verification: test-gate
`,
    );

    const teams = await listTeams();
    const ids = teams.map((t) => t.id);
    expect(ids).toContain("my-team");
    expect(ids).toContain("feature-dev");
  });
});

describe("writeBuiltinTeams", () => {
  let tmpDir: string;
  let originalHome: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "opcom-teams-write-"));
    originalHome = process.env.HOME!;
    process.env.HOME = tmpDir;
  });

  afterEach(async () => {
    process.env.HOME = originalHome;
    await rm(tmpDir, { recursive: true });
  });

  it("writes all four built-in teams", async () => {
    await writeBuiltinTeams();

    const { readdir } = await import("node:fs/promises");
    const files = await readdir(join(tmpDir, ".opcom", "teams"));
    expect(files).toContain("solo-engineer.yaml");
    expect(files).toContain("feature-dev.yaml");
    expect(files).toContain("research.yaml");
    expect(files).toContain("ops-task.yaml");
  });

  it("does not overwrite existing files", async () => {
    const teamsPath = join(tmpDir, ".opcom", "teams");
    await mkdir(teamsPath, { recursive: true });
    await writeFile(join(teamsPath, "feature-dev.yaml"), "id: feature-dev\nname: CustomDev\nsteps:\n  - role: engineer\n");

    await writeBuiltinTeams();

    const { readFile } = await import("node:fs/promises");
    const content = await readFile(join(teamsPath, "feature-dev.yaml"), "utf-8");
    expect(content).toContain("CustomDev");
  });
});
