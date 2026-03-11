import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  BUILTIN_ROLES,
  resolveRoleConfig,
  parseRoleYaml,
  loadRole,
  writeBuiltinRoles,
} from "@opcom/core";
import type { OrchestratorConfig, RoleDefinition } from "@opcom/types";

function makeOrchestratorConfig(overrides?: Partial<OrchestratorConfig>): OrchestratorConfig {
  return {
    maxConcurrentAgents: 3,
    autoStart: false,
    backend: "claude-code",
    worktree: true,
    pauseOnFailure: true,
    ticketTransitions: true,
    autoCommit: true,
    verification: { runTests: true, runOracle: false },
    ...overrides,
  };
}

describe("BUILTIN_ROLES", () => {
  it("defines six built-in roles", () => {
    expect(Object.keys(BUILTIN_ROLES)).toEqual(["engineer", "qa", "reviewer", "researcher", "devops", "oracle"]);
  });

  it("engineer is the default implementation role", () => {
    const eng = BUILTIN_ROLES.engineer;
    expect(eng.id).toBe("engineer");
    expect(eng.name).toBe("Engineer");
    expect(eng.permissionMode).toBe("acceptEdits");
    expect(eng.runTests).toBe(true);
    expect(eng.disallowedTools).toContain("EnterPlanMode");
    expect(eng.instructions).toContain("tests");
  });

  it("reviewer is read-only", () => {
    const rev = BUILTIN_ROLES.reviewer;
    expect(rev.permissionMode).toBe("default");
    expect(rev.disallowedTools).toContain("Edit");
    expect(rev.disallowedTools).toContain("Write");
    expect(rev.runTests).toBe(false);
    expect(rev.runOracle).toBe(false);
  });

  it("devops has infra bash patterns", () => {
    const devops = BUILTIN_ROLES.devops;
    expect(devops.allowedBashPatterns).toContain("docker *");
    expect(devops.allowedBashPatterns).toContain("kubectl *");
    expect(devops.runTests).toBe(false);
  });

  it("engineer denies writes to .tickets/", () => {
    const eng = BUILTIN_ROLES.engineer;
    expect(eng.denyPaths).toEqual([".tickets/**"]);
  });

  it("devops denies writes to .tickets/", () => {
    const devops = BUILTIN_ROLES.devops;
    expect(devops.denyPaths).toEqual([".tickets/**"]);
  });

  it("planner role has no denyPaths (can modify tickets)", () => {
    // Planner is not a built-in role, but verify no other roles
    // besides engineer and devops have denyPaths
    const qa = BUILTIN_ROLES.qa;
    const reviewer = BUILTIN_ROLES.reviewer;
    const researcher = BUILTIN_ROLES.researcher;
    const oracle = BUILTIN_ROLES.oracle;
    expect(qa.denyPaths).toBeUndefined();
    expect(reviewer.denyPaths).toBeUndefined();
    expect(researcher.denyPaths).toBeUndefined();
    expect(oracle.denyPaths).toBeUndefined();
  });
});

describe("resolveRoleConfig", () => {
  it("resolves engineer role with all fields populated", () => {
    const role = BUILTIN_ROLES.engineer;
    const resolved = resolveRoleConfig(role, ["git status*", "npm test*"], makeOrchestratorConfig());

    expect(resolved.roleId).toBe("engineer");
    expect(resolved.name).toBe("Engineer");
    expect(resolved.permissionMode).toBe("acceptEdits");
    expect(resolved.disallowedTools).toContain("EnterPlanMode");
    expect(resolved.allowedBashPatterns).toContain("git status*");
    expect(resolved.allowedBashPatterns).toContain("npm test*");
    expect(resolved.instructions).toContain("tests");
    expect(resolved.doneCriteria).toContain("Relevant tests passing");
    expect(resolved.runTests).toBe(true);
    // runOracle is null on engineer → falls back to plan config (false)
    expect(resolved.runOracle).toBe(false);
  });

  it("merges allowedBashPatterns from role + stack + plan", () => {
    const role: RoleDefinition = {
      id: "custom",
      allowedBashPatterns: ["docker *"],
    };
    const stackPatterns = ["git status*", "npm test*"];
    const planConfig = makeOrchestratorConfig({ allowedBashPatterns: ["make *"] });

    const resolved = resolveRoleConfig(role, stackPatterns, planConfig);

    expect(resolved.allowedBashPatterns).toContain("docker *");
    expect(resolved.allowedBashPatterns).toContain("git status*");
    expect(resolved.allowedBashPatterns).toContain("npm test*");
    expect(resolved.allowedBashPatterns).toContain("make *");
  });

  it("role runOracle overrides plan config when non-null", () => {
    const role: RoleDefinition = {
      id: "strict",
      runOracle: true,
    };
    const planConfig = makeOrchestratorConfig({ verification: { runTests: true, runOracle: false } });

    const resolved = resolveRoleConfig(role, [], planConfig);
    expect(resolved.runOracle).toBe(true);
  });

  it("role runOracle falls back to plan when null", () => {
    const role: RoleDefinition = {
      id: "default",
      runOracle: null,
    };
    const planConfig = makeOrchestratorConfig({ verification: { runTests: false, runOracle: true } });

    const resolved = resolveRoleConfig(role, [], planConfig);
    expect(resolved.runOracle).toBe(true);
  });

  it("role runTests overrides plan config", () => {
    const role: RoleDefinition = {
      id: "notesting",
      runTests: false,
    };
    const planConfig = makeOrchestratorConfig({ verification: { runTests: true, runOracle: false } });

    const resolved = resolveRoleConfig(role, [], planConfig);
    expect(resolved.runTests).toBe(false);
  });

  it("capitalizes name from id when name not provided", () => {
    const role: RoleDefinition = { id: "myRole" };
    const resolved = resolveRoleConfig(role, [], makeOrchestratorConfig());
    expect(resolved.name).toBe("MyRole");
  });

  it("uses default disallowedTools when role doesn't specify them", () => {
    const role: RoleDefinition = { id: "minimal" };
    const resolved = resolveRoleConfig(role, [], makeOrchestratorConfig());
    expect(resolved.disallowedTools).toEqual(["EnterPlanMode", "ExitPlanMode", "EnterWorktree"]);
  });

  it("passes denyPaths through from role definition", () => {
    const role = BUILTIN_ROLES.engineer;
    const resolved = resolveRoleConfig(role, [], makeOrchestratorConfig());
    expect(resolved.denyPaths).toEqual([".tickets/**"]);
  });

  it("defaults denyPaths to empty array when role has none", () => {
    const role: RoleDefinition = { id: "unrestricted" };
    const resolved = resolveRoleConfig(role, [], makeOrchestratorConfig());
    expect(resolved.denyPaths).toEqual([]);
  });

  it("deduplicates bash patterns", () => {
    const role: RoleDefinition = {
      id: "dup",
      allowedBashPatterns: ["git status*"],
    };
    const resolved = resolveRoleConfig(role, ["git status*"], makeOrchestratorConfig());
    const count = resolved.allowedBashPatterns.filter((p) => p === "git status*").length;
    expect(count).toBe(1);
  });
});

describe("parseRoleYaml", () => {
  it("parses a role YAML string", () => {
    const yaml = `---
id: custom-role
name: Custom
permissionMode: default
disallowedTools:
  - Edit
  - Write
runTests: false
runOracle: true
doneCriteria: "Review complete."
instructions: Do not modify files.
---`;
    const role = parseRoleYaml(yaml);
    expect(role).not.toBeNull();
    expect(role!.id).toBe("custom-role");
    expect(role!.name).toBe("Custom");
    expect(role!.permissionMode).toBe("default");
    expect(role!.disallowedTools).toEqual(["Edit", "Write"]);
    expect(role!.runTests).toBe(false);
    expect(role!.runOracle).toBe(true);
    expect(role!.doneCriteria).toBe("Review complete.");
  });

  it("parses YAML without frontmatter delimiters", () => {
    const yaml = `id: plain
name: Plain Role
permissionMode: acceptEdits
runTests: true`;
    const role = parseRoleYaml(yaml);
    expect(role).not.toBeNull();
    expect(role!.id).toBe("plain");
    expect(role!.name).toBe("Plain Role");
  });

  it("returns null for empty content", () => {
    expect(parseRoleYaml("")).toBeNull();
  });

  it("parses denyPaths from YAML", () => {
    const yaml = `---
id: restricted
name: Restricted
denyPaths:
  - .tickets/**
  - docs/**
---`;
    const role = parseRoleYaml(yaml);
    expect(role).not.toBeNull();
    expect(role!.denyPaths).toEqual([".tickets/**", "docs/**"]);
  });

  it("returns null for content without id", () => {
    const yaml = `---
name: No ID Role
---`;
    expect(parseRoleYaml(yaml)).toBeNull();
  });
});

describe("loadRole", () => {
  let tmpDir: string;
  let originalHome: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "opcom-roles-test-"));
    originalHome = process.env.HOME!;
    process.env.HOME = tmpDir;
  });

  afterEach(async () => {
    process.env.HOME = originalHome;
    await rm(tmpDir, { recursive: true });
  });

  it("loads built-in role when no user file exists", async () => {
    const role = await loadRole("engineer");
    expect(role.id).toBe("engineer");
    expect(role.name).toBe("Engineer");
  });

  it("loads user-defined role from disk", async () => {
    const rolesPath = join(tmpDir, ".opcom", "roles");
    await mkdir(rolesPath, { recursive: true });
    await writeFile(join(rolesPath, "custom.yaml"), `---
id: custom
name: My Custom Role
permissionMode: default
runTests: false
---`);

    const role = await loadRole("custom");
    expect(role.id).toBe("custom");
    expect(role.name).toBe("My Custom Role");
    expect(role.runTests).toBe(false);
  });

  it("user file overrides built-in role", async () => {
    const rolesPath = join(tmpDir, ".opcom", "roles");
    await mkdir(rolesPath, { recursive: true });
    await writeFile(join(rolesPath, "engineer.yaml"), `---
id: engineer
name: Custom Engineer
permissionMode: bypassPermissions
runTests: false
---`);

    const role = await loadRole("engineer");
    expect(role.name).toBe("Custom Engineer");
    expect(role.permissionMode).toBe("bypassPermissions");
    expect(role.runTests).toBe(false);
  });

  it("returns minimal definition for unknown role", async () => {
    const role = await loadRole("nonexistent");
    expect(role.id).toBe("nonexistent");
    expect(role.name).toBeUndefined();
  });
});

describe("writeBuiltinRoles", () => {
  let tmpDir: string;
  let originalHome: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "opcom-roles-write-"));
    originalHome = process.env.HOME!;
    process.env.HOME = tmpDir;
  });

  afterEach(async () => {
    process.env.HOME = originalHome;
    await rm(tmpDir, { recursive: true });
  });

  it("writes all five built-in roles", async () => {
    await writeBuiltinRoles();

    const { readdir } = await import("node:fs/promises");
    const files = await readdir(join(tmpDir, ".opcom", "roles"));
    expect(files).toContain("engineer.yaml");
    expect(files).toContain("qa.yaml");
    expect(files).toContain("reviewer.yaml");
    expect(files).toContain("researcher.yaml");
    expect(files).toContain("devops.yaml");
  });

  it("does not overwrite existing files", async () => {
    const rolesPath = join(tmpDir, ".opcom", "roles");
    await mkdir(rolesPath, { recursive: true });
    await writeFile(join(rolesPath, "engineer.yaml"), "id: engineer\nname: CustomEng\n");

    await writeBuiltinRoles();

    const { readFile } = await import("node:fs/promises");
    const content = await readFile(join(rolesPath, "engineer.yaml"), "utf-8");
    expect(content).toContain("CustomEng");
  });
});
