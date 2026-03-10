"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const promises_1 = require("node:fs/promises");
const node_path_1 = require("node:path");
const node_os_1 = require("node:os");
const core_1 = require("@opcom/core");
function makeWorkItem(overrides) {
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
(0, vitest_1.describe)("BUILTIN_SKILLS", () => {
    (0, vitest_1.it)("defines five built-in skills", () => {
        const ids = Object.keys(core_1.BUILTIN_SKILLS);
        (0, vitest_1.expect)(ids).toEqual(["code-review", "test-writing", "research", "deployment", "planning"]);
    });
    (0, vitest_1.it)("each skill has required fields", () => {
        for (const skill of Object.values(core_1.BUILTIN_SKILLS)) {
            (0, vitest_1.expect)(skill.id).toBeTruthy();
            (0, vitest_1.expect)(skill.name).toBeTruthy();
            (0, vitest_1.expect)(skill.description).toBeTruthy();
            (0, vitest_1.expect)(skill.version).toBe("1.0.0");
            (0, vitest_1.expect)(skill.triggers.length).toBeGreaterThan(0);
            (0, vitest_1.expect)(skill.compatibleRoles.length).toBeGreaterThan(0);
            (0, vitest_1.expect)(skill.content).toBeTruthy();
        }
    });
    (0, vitest_1.it)("code-review skill is compatible with reviewer and engineer", () => {
        const skill = core_1.BUILTIN_SKILLS["code-review"];
        (0, vitest_1.expect)(skill.compatibleRoles).toContain("reviewer");
        (0, vitest_1.expect)(skill.compatibleRoles).toContain("engineer");
    });
    (0, vitest_1.it)("deployment skill triggers on deploy keywords", () => {
        const skill = core_1.BUILTIN_SKILLS["deployment"];
        (0, vitest_1.expect)(skill.triggers).toContain("deploy");
        (0, vitest_1.expect)(skill.triggers).toContain("deployment");
    });
});
(0, vitest_1.describe)("parseSkillMd", () => {
    (0, vitest_1.it)("parses a SKILL.md file with frontmatter", () => {
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
        const skill = (0, core_1.parseSkillMd)(md, "fallback-id");
        (0, vitest_1.expect)(skill).not.toBeNull();
        (0, vitest_1.expect)(skill.name).toBe("my-skill");
        (0, vitest_1.expect)(skill.description).toBe("A test skill");
        (0, vitest_1.expect)(skill.version).toBe("2.0.0");
        (0, vitest_1.expect)(skill.triggers).toEqual(["test trigger", "another"]);
        (0, vitest_1.expect)(skill.compatibleRoles).toEqual(["engineer", "qa"]);
        (0, vitest_1.expect)(skill.content).toContain("# My Skill");
        (0, vitest_1.expect)(skill.content).toContain("skill body content");
    });
    (0, vitest_1.it)("uses fallback id when name not in frontmatter", () => {
        const md = `---
description: "No name"
version: 1.0.0
triggers: []
---

Content here.`;
        const skill = (0, core_1.parseSkillMd)(md, "my-fallback");
        (0, vitest_1.expect)(skill).not.toBeNull();
        (0, vitest_1.expect)(skill.name).toBe("My-fallback");
    });
    (0, vitest_1.it)("returns null for content without frontmatter", () => {
        (0, vitest_1.expect)((0, core_1.parseSkillMd)("just some text", "id")).toBeNull();
    });
    (0, vitest_1.it)("handles empty triggers and roles", () => {
        const md = `---
name: minimal
description: "Minimal skill"
version: 0.1.0
triggers: []
compatible-roles: []
---

Minimal content.`;
        const skill = (0, core_1.parseSkillMd)(md, "minimal");
        (0, vitest_1.expect)(skill).not.toBeNull();
        (0, vitest_1.expect)(skill.triggers).toEqual([]);
        (0, vitest_1.expect)(skill.compatibleRoles).toEqual([]);
    });
    (0, vitest_1.it)("handles projects field", () => {
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
        const skill = (0, core_1.parseSkillMd)(md, "scoped");
        (0, vitest_1.expect)(skill).not.toBeNull();
        (0, vitest_1.expect)(skill.projects).toEqual(["project-a", "project-b"]);
    });
});
(0, vitest_1.describe)("loadSkill", () => {
    let tmpDir;
    let originalHome;
    (0, vitest_1.beforeEach)(async () => {
        tmpDir = await (0, promises_1.mkdtemp)((0, node_path_1.join)((0, node_os_1.tmpdir)(), "opcom-skills-test-"));
        originalHome = process.env.HOME;
        process.env.HOME = tmpDir;
    });
    (0, vitest_1.afterEach)(async () => {
        process.env.HOME = originalHome;
        await (0, promises_1.rm)(tmpDir, { recursive: true });
    });
    (0, vitest_1.it)("loads built-in skill when no user file exists", async () => {
        const skill = await (0, core_1.loadSkill)("code-review");
        (0, vitest_1.expect)(skill).not.toBeNull();
        (0, vitest_1.expect)(skill.id).toBe("code-review");
        (0, vitest_1.expect)(skill.name).toBe("Code Review");
    });
    (0, vitest_1.it)("loads user-defined skill from disk", async () => {
        const skillDir = (0, node_path_1.join)(tmpDir, ".opcom", "skills", "custom-skill");
        await (0, promises_1.mkdir)(skillDir, { recursive: true });
        await (0, promises_1.writeFile)((0, node_path_1.join)(skillDir, "SKILL.md"), `---
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
        const skill = await (0, core_1.loadSkill)("custom-skill");
        (0, vitest_1.expect)(skill).not.toBeNull();
        (0, vitest_1.expect)(skill.id).toBe("custom-skill");
        (0, vitest_1.expect)(skill.description).toBe("Custom skill");
        (0, vitest_1.expect)(skill.content).toContain("Custom Skill Content");
    });
    (0, vitest_1.it)("user skill overrides built-in with same id", async () => {
        const skillDir = (0, node_path_1.join)(tmpDir, ".opcom", "skills", "code-review");
        await (0, promises_1.mkdir)(skillDir, { recursive: true });
        await (0, promises_1.writeFile)((0, node_path_1.join)(skillDir, "SKILL.md"), `---
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
        const skill = await (0, core_1.loadSkill)("code-review");
        (0, vitest_1.expect)(skill).not.toBeNull();
        (0, vitest_1.expect)(skill.id).toBe("code-review");
        (0, vitest_1.expect)(skill.description).toBe("My custom review process");
        (0, vitest_1.expect)(skill.version).toBe("2.0.0");
    });
    (0, vitest_1.it)("returns null for unknown skill", async () => {
        const skill = await (0, core_1.loadSkill)("nonexistent");
        (0, vitest_1.expect)(skill).toBeNull();
    });
});
(0, vitest_1.describe)("listSkills", () => {
    let tmpDir;
    let originalHome;
    (0, vitest_1.beforeEach)(async () => {
        tmpDir = await (0, promises_1.mkdtemp)((0, node_path_1.join)((0, node_os_1.tmpdir)(), "opcom-skills-list-"));
        originalHome = process.env.HOME;
        process.env.HOME = tmpDir;
    });
    (0, vitest_1.afterEach)(async () => {
        process.env.HOME = originalHome;
        await (0, promises_1.rm)(tmpDir, { recursive: true });
    });
    (0, vitest_1.it)("lists all built-in skills when no user skills exist", async () => {
        const skills = await (0, core_1.listSkills)();
        (0, vitest_1.expect)(skills.length).toBe(5);
        const ids = skills.map(s => s.id);
        (0, vitest_1.expect)(ids).toContain("code-review");
        (0, vitest_1.expect)(ids).toContain("test-writing");
        (0, vitest_1.expect)(ids).toContain("research");
        (0, vitest_1.expect)(ids).toContain("deployment");
        (0, vitest_1.expect)(ids).toContain("planning");
    });
    (0, vitest_1.it)("includes user-defined skills alongside built-ins", async () => {
        const skillDir = (0, node_path_1.join)(tmpDir, ".opcom", "skills", "my-custom");
        await (0, promises_1.mkdir)(skillDir, { recursive: true });
        await (0, promises_1.writeFile)((0, node_path_1.join)(skillDir, "SKILL.md"), `---
name: my-custom
description: "A custom skill"
version: 1.0.0
triggers: []
---

Custom body.
`);
        const skills = await (0, core_1.listSkills)();
        (0, vitest_1.expect)(skills.length).toBe(6);
        (0, vitest_1.expect)(skills.find(s => s.id === "my-custom")).toBeDefined();
    });
    (0, vitest_1.it)("returns skills sorted by id", async () => {
        const skills = await (0, core_1.listSkills)();
        const ids = skills.map(s => s.id);
        const sorted = [...ids].sort();
        (0, vitest_1.expect)(ids).toEqual(sorted);
    });
});
(0, vitest_1.describe)("matchSkills", () => {
    let tmpDir;
    let originalHome;
    (0, vitest_1.beforeEach)(async () => {
        tmpDir = await (0, promises_1.mkdtemp)((0, node_path_1.join)((0, node_os_1.tmpdir)(), "opcom-skills-match-"));
        originalHome = process.env.HOME;
        process.env.HOME = tmpDir;
    });
    (0, vitest_1.afterEach)(async () => {
        process.env.HOME = originalHome;
        await (0, promises_1.rm)(tmpDir, { recursive: true });
    });
    (0, vitest_1.it)("matches skills by work item title triggers", async () => {
        const workItem = makeWorkItem({ title: "Add deployment pipeline" });
        const skills = await (0, core_1.matchSkills)(workItem, undefined);
        const ids = skills.map(s => s.id);
        (0, vitest_1.expect)(ids).toContain("deployment");
    });
    (0, vitest_1.it)("matches skills by work item type", async () => {
        const workItem = makeWorkItem({ type: "review" });
        const skills = await (0, core_1.matchSkills)(workItem, undefined);
        const ids = skills.map(s => s.id);
        (0, vitest_1.expect)(ids).toContain("code-review");
    });
    (0, vitest_1.it)("matches skills declared in role.skills", async () => {
        const role = { id: "engineer", skills: ["research"] };
        const workItem = makeWorkItem();
        const skills = await (0, core_1.matchSkills)(workItem, role);
        const ids = skills.map(s => s.id);
        (0, vitest_1.expect)(ids).toContain("research");
    });
    (0, vitest_1.it)("matches skills declared in work item tags", async () => {
        const workItem = makeWorkItem({ tags: { skills: ["deployment", "test-writing"] } });
        const skills = await (0, core_1.matchSkills)(workItem, undefined);
        const ids = skills.map(s => s.id);
        (0, vitest_1.expect)(ids).toContain("deployment");
        (0, vitest_1.expect)(ids).toContain("test-writing");
    });
    (0, vitest_1.it)("filters by compatible role", async () => {
        // research is compatible with researcher, engineer, planner — not reviewer
        const role = { id: "reviewer", skills: ["research"] };
        const skills = await (0, core_1.matchSkills)(undefined, role);
        // research is not compatible with reviewer
        (0, vitest_1.expect)(skills.find(s => s.id === "research")).toBeUndefined();
    });
    (0, vitest_1.it)("filters by project scope", async () => {
        // Create a project-scoped skill
        const skillDir = (0, node_path_1.join)(tmpDir, ".opcom", "skills", "scoped-skill");
        await (0, promises_1.mkdir)(skillDir, { recursive: true });
        await (0, promises_1.writeFile)((0, node_path_1.join)(skillDir, "SKILL.md"), `---
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
        const matched = await (0, core_1.matchSkills)(workItem, undefined, "project-a");
        (0, vitest_1.expect)(matched.find(s => s.id === "scoped-skill")).toBeDefined();
        // Filtered out for project-b
        const filtered = await (0, core_1.matchSkills)(workItem, undefined, "project-b");
        (0, vitest_1.expect)(filtered.find(s => s.id === "scoped-skill")).toBeUndefined();
    });
    (0, vitest_1.it)("returns empty when no triggers match and no explicit skills", async () => {
        const workItem = makeWorkItem({ title: "Fix login bug", type: "bug" });
        const role = { id: "engineer" };
        const skills = await (0, core_1.matchSkills)(workItem, role);
        // "bug" and "Fix login bug" don't match any triggers
        (0, vitest_1.expect)(skills.length).toBe(0);
    });
    (0, vitest_1.it)("returns empty when no work item and no role skills", async () => {
        const skills = await (0, core_1.matchSkills)(undefined, undefined);
        (0, vitest_1.expect)(skills.length).toBe(0);
    });
    (0, vitest_1.it)("deduplicates when skill matches via both trigger and explicit declaration", async () => {
        const role = { id: "engineer", skills: ["deployment"] };
        const workItem = makeWorkItem({ title: "Deploy the app" });
        const skills = await (0, core_1.matchSkills)(workItem, role);
        const deploySkills = skills.filter(s => s.id === "deployment");
        (0, vitest_1.expect)(deploySkills.length).toBe(1);
    });
});
(0, vitest_1.describe)("writeBuiltinSkills", () => {
    let tmpDir;
    let originalHome;
    (0, vitest_1.beforeEach)(async () => {
        tmpDir = await (0, promises_1.mkdtemp)((0, node_path_1.join)((0, node_os_1.tmpdir)(), "opcom-skills-write-"));
        originalHome = process.env.HOME;
        process.env.HOME = tmpDir;
    });
    (0, vitest_1.afterEach)(async () => {
        process.env.HOME = originalHome;
        await (0, promises_1.rm)(tmpDir, { recursive: true });
    });
    (0, vitest_1.it)("writes all built-in skills to disk", async () => {
        await (0, core_1.writeBuiltinSkills)();
        const dirs = await (0, promises_1.readdir)((0, node_path_1.join)(tmpDir, ".opcom", "skills"));
        (0, vitest_1.expect)(dirs).toContain("code-review");
        (0, vitest_1.expect)(dirs).toContain("test-writing");
        (0, vitest_1.expect)(dirs).toContain("research");
        (0, vitest_1.expect)(dirs).toContain("deployment");
        (0, vitest_1.expect)(dirs).toContain("planning");
    });
    (0, vitest_1.it)("does not overwrite existing skill files", async () => {
        const skillDir = (0, node_path_1.join)(tmpDir, ".opcom", "skills", "code-review");
        await (0, promises_1.mkdir)(skillDir, { recursive: true });
        await (0, promises_1.writeFile)((0, node_path_1.join)(skillDir, "SKILL.md"), "custom content");
        await (0, core_1.writeBuiltinSkills)();
        const { readFile: rf } = await import("node:fs/promises");
        const content = await rf((0, node_path_1.join)(skillDir, "SKILL.md"), "utf-8");
        (0, vitest_1.expect)(content).toBe("custom content");
    });
    (0, vitest_1.it)("written skills are loadable", async () => {
        await (0, core_1.writeBuiltinSkills)();
        // Load a written skill by reading from disk
        const skill = await (0, core_1.loadSkill)("research");
        (0, vitest_1.expect)(skill).not.toBeNull();
        (0, vitest_1.expect)(skill.name).toBe("Deep Research");
    });
    (0, vitest_1.it)("written skills preserve triggers through roundtrip", async () => {
        await (0, core_1.writeBuiltinSkills)();
        const skill = await (0, core_1.loadSkill)("deployment");
        (0, vitest_1.expect)(skill).not.toBeNull();
        (0, vitest_1.expect)(skill.triggers).toContain("deploy");
        (0, vitest_1.expect)(skill.triggers).toContain("deployment");
    });
});
(0, vitest_1.describe)("createSkill", () => {
    let tmpDir;
    let originalHome;
    (0, vitest_1.beforeEach)(async () => {
        tmpDir = await (0, promises_1.mkdtemp)((0, node_path_1.join)((0, node_os_1.tmpdir)(), "opcom-skills-create-"));
        originalHome = process.env.HOME;
        process.env.HOME = tmpDir;
    });
    (0, vitest_1.afterEach)(async () => {
        process.env.HOME = originalHome;
        await (0, promises_1.rm)(tmpDir, { recursive: true });
    });
    (0, vitest_1.it)("creates a new skill directory with SKILL.md", async () => {
        const mdPath = await (0, core_1.createSkill)("my-new-skill");
        (0, vitest_1.expect)(mdPath).toContain("my-new-skill");
        (0, vitest_1.expect)(mdPath).toContain("SKILL.md");
        const { existsSync } = await import("node:fs");
        (0, vitest_1.expect)(existsSync(mdPath)).toBe(true);
    });
    (0, vitest_1.it)("created skill is loadable", async () => {
        await (0, core_1.createSkill)("loadable-skill", { name: "Loadable Skill", description: "A loadable skill" });
        const skill = await (0, core_1.loadSkill)("loadable-skill");
        (0, vitest_1.expect)(skill).not.toBeNull();
        (0, vitest_1.expect)(skill.id).toBe("loadable-skill");
        (0, vitest_1.expect)(skill.name).toBe("Loadable Skill");
        (0, vitest_1.expect)(skill.description).toBe("A loadable skill");
        (0, vitest_1.expect)(skill.version).toBe("1.0.0");
    });
    (0, vitest_1.it)("uses capitalized id as default name", async () => {
        await (0, core_1.createSkill)("deep-research");
        const skill = await (0, core_1.loadSkill)("deep-research");
        (0, vitest_1.expect)(skill).not.toBeNull();
        (0, vitest_1.expect)(skill.name).toBe("Deep research");
    });
    (0, vitest_1.it)("throws if skill already exists", async () => {
        await (0, core_1.createSkill)("duplicate-skill");
        await (0, vitest_1.expect)((0, core_1.createSkill)("duplicate-skill")).rejects.toThrow("already exists");
    });
    (0, vitest_1.it)("created skill appears in listSkills", async () => {
        await (0, core_1.createSkill)("listed-skill");
        const skills = await (0, core_1.listSkills)();
        (0, vitest_1.expect)(skills.find(s => s.id === "listed-skill")).toBeDefined();
    });
});
//# sourceMappingURL=skills.test.js.map