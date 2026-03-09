import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, mkdir, writeFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  BUILTIN_SKILLS,
  loadSkill,
  listSkills,
  matchSkills,
  writeBuiltinSkills,
  createSkill,
  parseSkillMd,
} from "@opcom/core";
import type { WorkItem, RoleDefinition } from "@opcom/types";

function makeWorkItem(overrides?: Partial<WorkItem>): WorkItem {
  return {
    id: "test-ticket",
    title: "Test Ticket",
    status: "open",
    priority: 1,
    type: "feature",
    filePath: "/tmp/.tickets/test-ticket/README.md",
    deps: [],
    links: [],
    tags: {},
    ...overrides,
  };
}

describe("BUILTIN_SKILLS", () => {
  it("defines five built-in skills", () => {
    const ids = Object.keys(BUILTIN_SKILLS);
    expect(ids).toEqual(["code-review", "test-writing", "research", "deployment", "planning"]);
  });

  it("each skill has required fields", () => {
    for (const skill of Object.values(BUILTIN_SKILLS)) {
      expect(skill.id).toBeTruthy();
      expect(skill.name).toBeTruthy();
      expect(skill.description).toBeTruthy();
      expect(skill.version).toBe("1.0.0");
      expect(skill.triggers.length).toBeGreaterThan(0);
      expect(skill.compatibleRoles.length).toBeGreaterThan(0);
      expect(skill.content).toBeTruthy();
    }
  });

  it("code-review skill is compatible with reviewer and engineer", () => {
    const skill = BUILTIN_SKILLS["code-review"];
    expect(skill.compatibleRoles).toContain("reviewer");
    expect(skill.compatibleRoles).toContain("engineer");
  });

  it("deployment skill triggers on deploy keywords", () => {
    const skill = BUILTIN_SKILLS["deployment"];
    expect(skill.triggers).toContain("deploy");
    expect(skill.triggers).toContain("deployment");
  });
});

describe("parseSkillMd", () => {
  it("parses a SKILL.md file with frontmatter", () => {
    const md = `---
name: my-skill
description: "A test skill"
version: 2.0.0
triggers:
  - test trigger
  - another
compatible-roles:
  - engineer
  - qa
---

# My Skill

This is the skill body content.`;

    const skill = parseSkillMd(md, "fallback-id");
    expect(skill).not.toBeNull();
    expect(skill!.name).toBe("my-skill");
    expect(skill!.description).toBe("A test skill");
    expect(skill!.version).toBe("2.0.0");
    expect(skill!.triggers).toEqual(["test trigger", "another"]);
    expect(skill!.compatibleRoles).toEqual(["engineer", "qa"]);
    expect(skill!.content).toContain("# My Skill");
    expect(skill!.content).toContain("skill body content");
  });

  it("uses fallback id when name not in frontmatter", () => {
    const md = `---
description: "No name"
version: 1.0.0
triggers: []
---

Content here.`;

    const skill = parseSkillMd(md, "my-fallback");
    expect(skill).not.toBeNull();
    expect(skill!.name).toBe("My-fallback");
  });

  it("returns null for content without frontmatter", () => {
    expect(parseSkillMd("just some text", "id")).toBeNull();
  });

  it("handles empty triggers and roles", () => {
    const md = `---
name: minimal
description: "Minimal skill"
version: 0.1.0
triggers: []
compatible-roles: []
---

Minimal content.`;

    const skill = parseSkillMd(md, "minimal");
    expect(skill).not.toBeNull();
    expect(skill!.triggers).toEqual([]);
    expect(skill!.compatibleRoles).toEqual([]);
  });

  it("handles projects field", () => {
    const md = `---
name: scoped-skill
description: "Scoped"
version: 1.0.0
triggers: []
projects:
  - project-a
  - project-b
---

Scoped content.`;

    const skill = parseSkillMd(md, "scoped");
    expect(skill).not.toBeNull();
    expect(skill!.projects).toEqual(["project-a", "project-b"]);
  });
});

describe("loadSkill", () => {
  let tmpDir: string;
  let originalHome: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "opcom-skills-test-"));
    originalHome = process.env.HOME!;
    process.env.HOME = tmpDir;
  });

  afterEach(async () => {
    process.env.HOME = originalHome;
    await rm(tmpDir, { recursive: true });
  });

  it("loads built-in skill when no user file exists", async () => {
    const skill = await loadSkill("code-review");
    expect(skill).not.toBeNull();
    expect(skill!.id).toBe("code-review");
    expect(skill!.name).toBe("Code Review");
  });

  it("loads user-defined skill from disk", async () => {
    const skillDir = join(tmpDir, ".opcom", "skills", "custom-skill");
    await mkdir(skillDir, { recursive: true });
    await writeFile(join(skillDir, "SKILL.md"), `---
name: custom-skill
description: "Custom skill"
version: 1.0.0
triggers:
  - custom
compatible-roles:
  - engineer
---

# Custom Skill Content
`);

    const skill = await loadSkill("custom-skill");
    expect(skill).not.toBeNull();
    expect(skill!.id).toBe("custom-skill");
    expect(skill!.description).toBe("Custom skill");
    expect(skill!.content).toContain("Custom Skill Content");
  });

  it("user skill overrides built-in with same id", async () => {
    const skillDir = join(tmpDir, ".opcom", "skills", "code-review");
    await mkdir(skillDir, { recursive: true });
    await writeFile(join(skillDir, "SKILL.md"), `---
name: code-review
description: "My custom review process"
version: 2.0.0
triggers:
  - review
compatible-roles:
  - engineer
---

# Custom Review
`);

    const skill = await loadSkill("code-review");
    expect(skill).not.toBeNull();
    expect(skill!.id).toBe("code-review");
    expect(skill!.description).toBe("My custom review process");
    expect(skill!.version).toBe("2.0.0");
  });

  it("returns null for unknown skill", async () => {
    const skill = await loadSkill("nonexistent");
    expect(skill).toBeNull();
  });
});

describe("listSkills", () => {
  let tmpDir: string;
  let originalHome: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "opcom-skills-list-"));
    originalHome = process.env.HOME!;
    process.env.HOME = tmpDir;
  });

  afterEach(async () => {
    process.env.HOME = originalHome;
    await rm(tmpDir, { recursive: true });
  });

  it("lists all built-in skills when no user skills exist", async () => {
    const skills = await listSkills();
    expect(skills.length).toBe(5);
    const ids = skills.map(s => s.id);
    expect(ids).toContain("code-review");
    expect(ids).toContain("test-writing");
    expect(ids).toContain("research");
    expect(ids).toContain("deployment");
    expect(ids).toContain("planning");
  });

  it("includes user-defined skills alongside built-ins", async () => {
    const skillDir = join(tmpDir, ".opcom", "skills", "my-custom");
    await mkdir(skillDir, { recursive: true });
    await writeFile(join(skillDir, "SKILL.md"), `---
name: my-custom
description: "A custom skill"
version: 1.0.0
triggers: []
---

Custom body.
`);

    const skills = await listSkills();
    expect(skills.length).toBe(6);
    expect(skills.find(s => s.id === "my-custom")).toBeDefined();
  });

  it("returns skills sorted by id", async () => {
    const skills = await listSkills();
    const ids = skills.map(s => s.id);
    const sorted = [...ids].sort();
    expect(ids).toEqual(sorted);
  });
});

describe("matchSkills", () => {
  let tmpDir: string;
  let originalHome: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "opcom-skills-match-"));
    originalHome = process.env.HOME!;
    process.env.HOME = tmpDir;
  });

  afterEach(async () => {
    process.env.HOME = originalHome;
    await rm(tmpDir, { recursive: true });
  });

  it("matches skills by work item title triggers", async () => {
    const workItem = makeWorkItem({ title: "Add deployment pipeline" });
    const skills = await matchSkills(workItem, undefined);
    const ids = skills.map(s => s.id);
    expect(ids).toContain("deployment");
  });

  it("matches skills by work item type", async () => {
    const workItem = makeWorkItem({ type: "review" });
    const skills = await matchSkills(workItem, undefined);
    const ids = skills.map(s => s.id);
    expect(ids).toContain("code-review");
  });

  it("matches skills declared in role.skills", async () => {
    const role: RoleDefinition = { id: "engineer", skills: ["research"] };
    const workItem = makeWorkItem();
    const skills = await matchSkills(workItem, role);
    const ids = skills.map(s => s.id);
    expect(ids).toContain("research");
  });

  it("matches skills declared in work item tags", async () => {
    const workItem = makeWorkItem({ tags: { skills: ["deployment", "test-writing"] } });
    const skills = await matchSkills(workItem, undefined);
    const ids = skills.map(s => s.id);
    expect(ids).toContain("deployment");
    expect(ids).toContain("test-writing");
  });

  it("filters by compatible role", async () => {
    // research is compatible with researcher, engineer, planner — not reviewer
    const role: RoleDefinition = { id: "reviewer", skills: ["research"] };
    const skills = await matchSkills(undefined, role);
    // research is not compatible with reviewer
    expect(skills.find(s => s.id === "research")).toBeUndefined();
  });

  it("filters by project scope", async () => {
    // Create a project-scoped skill
    const skillDir = join(tmpDir, ".opcom", "skills", "scoped-skill");
    await mkdir(skillDir, { recursive: true });
    await writeFile(join(skillDir, "SKILL.md"), `---
name: scoped-skill
description: "Only for project-a"
version: 1.0.0
triggers:
  - scoped
projects:
  - project-a
compatible-roles: []
---

Scoped content.
`);

    const workItem = makeWorkItem({ title: "Something scoped" });

    // Matches project-a
    const matched = await matchSkills(workItem, undefined, "project-a");
    expect(matched.find(s => s.id === "scoped-skill")).toBeDefined();

    // Filtered out for project-b
    const filtered = await matchSkills(workItem, undefined, "project-b");
    expect(filtered.find(s => s.id === "scoped-skill")).toBeUndefined();
  });

  it("returns empty when no triggers match and no explicit skills", async () => {
    const workItem = makeWorkItem({ title: "Fix login bug", type: "bug" });
    const role: RoleDefinition = { id: "engineer" };
    const skills = await matchSkills(workItem, role);
    // "bug" and "Fix login bug" don't match any triggers
    expect(skills.length).toBe(0);
  });

  it("returns empty when no work item and no role skills", async () => {
    const skills = await matchSkills(undefined, undefined);
    expect(skills.length).toBe(0);
  });

  it("deduplicates when skill matches via both trigger and explicit declaration", async () => {
    const role: RoleDefinition = { id: "engineer", skills: ["deployment"] };
    const workItem = makeWorkItem({ title: "Deploy the app" });
    const skills = await matchSkills(workItem, role);
    const deploySkills = skills.filter(s => s.id === "deployment");
    expect(deploySkills.length).toBe(1);
  });
});

describe("writeBuiltinSkills", () => {
  let tmpDir: string;
  let originalHome: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "opcom-skills-write-"));
    originalHome = process.env.HOME!;
    process.env.HOME = tmpDir;
  });

  afterEach(async () => {
    process.env.HOME = originalHome;
    await rm(tmpDir, { recursive: true });
  });

  it("writes all built-in skills to disk", async () => {
    await writeBuiltinSkills();

    const dirs = await readdir(join(tmpDir, ".opcom", "skills"));
    expect(dirs).toContain("code-review");
    expect(dirs).toContain("test-writing");
    expect(dirs).toContain("research");
    expect(dirs).toContain("deployment");
    expect(dirs).toContain("planning");
  });

  it("does not overwrite existing skill files", async () => {
    const skillDir = join(tmpDir, ".opcom", "skills", "code-review");
    await mkdir(skillDir, { recursive: true });
    await writeFile(join(skillDir, "SKILL.md"), "custom content");

    await writeBuiltinSkills();

    const { readFile: rf } = await import("node:fs/promises");
    const content = await rf(join(skillDir, "SKILL.md"), "utf-8");
    expect(content).toBe("custom content");
  });

  it("written skills are loadable", async () => {
    await writeBuiltinSkills();

    // Load a written skill by reading from disk
    const skill = await loadSkill("research");
    expect(skill).not.toBeNull();
    expect(skill!.name).toBe("Deep Research");
  });

  it("written skills preserve triggers through roundtrip", async () => {
    await writeBuiltinSkills();

    const skill = await loadSkill("deployment");
    expect(skill).not.toBeNull();
    expect(skill!.triggers).toContain("deploy");
    expect(skill!.triggers).toContain("deployment");
  });
});

describe("createSkill", () => {
  let tmpDir: string;
  let originalHome: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "opcom-skills-create-"));
    originalHome = process.env.HOME!;
    process.env.HOME = tmpDir;
  });

  afterEach(async () => {
    process.env.HOME = originalHome;
    await rm(tmpDir, { recursive: true });
  });

  it("creates a new skill directory with SKILL.md", async () => {
    const mdPath = await createSkill("my-new-skill");
    expect(mdPath).toContain("my-new-skill");
    expect(mdPath).toContain("SKILL.md");

    const { existsSync } = await import("node:fs");
    expect(existsSync(mdPath)).toBe(true);
  });

  it("created skill is loadable", async () => {
    await createSkill("loadable-skill", { name: "Loadable Skill", description: "A loadable skill" });
    const skill = await loadSkill("loadable-skill");
    expect(skill).not.toBeNull();
    expect(skill!.id).toBe("loadable-skill");
    expect(skill!.name).toBe("Loadable Skill");
    expect(skill!.description).toBe("A loadable skill");
    expect(skill!.version).toBe("1.0.0");
  });

  it("uses capitalized id as default name", async () => {
    await createSkill("deep-research");
    const skill = await loadSkill("deep-research");
    expect(skill).not.toBeNull();
    expect(skill!.name).toBe("Deep research");
  });

  it("throws if skill already exists", async () => {
    await createSkill("duplicate-skill");
    await expect(createSkill("duplicate-skill")).rejects.toThrow("already exists");
  });

  it("created skill appears in listSkills", async () => {
    await createSkill("listed-skill");
    const skills = await listSkills();
    expect(skills.find(s => s.id === "listed-skill")).toBeDefined();
  });
});
