"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const promises_1 = require("node:fs/promises");
const node_path_1 = require("node:path");
const node_os_1 = require("node:os");
const core_1 = require("@opcom/core");
function makeOrchestratorConfig(overrides) {
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
(0, vitest_1.describe)("BUILTIN_ROLES", () => {
    (0, vitest_1.it)("defines six built-in roles", () => {
        (0, vitest_1.expect)(Object.keys(core_1.BUILTIN_ROLES)).toEqual(["engineer", "qa", "reviewer", "researcher", "devops", "oracle"]);
    });
    (0, vitest_1.it)("engineer is the default implementation role", () => {
        const eng = core_1.BUILTIN_ROLES.engineer;
        (0, vitest_1.expect)(eng.id).toBe("engineer");
        (0, vitest_1.expect)(eng.name).toBe("Engineer");
        (0, vitest_1.expect)(eng.permissionMode).toBe("acceptEdits");
        (0, vitest_1.expect)(eng.runTests).toBe(true);
        (0, vitest_1.expect)(eng.disallowedTools).toContain("EnterPlanMode");
        (0, vitest_1.expect)(eng.instructions).toContain("tests");
    });
    (0, vitest_1.it)("reviewer is read-only", () => {
        const rev = core_1.BUILTIN_ROLES.reviewer;
        (0, vitest_1.expect)(rev.permissionMode).toBe("default");
        (0, vitest_1.expect)(rev.disallowedTools).toContain("Edit");
        (0, vitest_1.expect)(rev.disallowedTools).toContain("Write");
        (0, vitest_1.expect)(rev.runTests).toBe(false);
        (0, vitest_1.expect)(rev.runOracle).toBe(false);
    });
    (0, vitest_1.it)("devops has infra bash patterns", () => {
        const devops = core_1.BUILTIN_ROLES.devops;
        (0, vitest_1.expect)(devops.allowedBashPatterns).toContain("docker *");
        (0, vitest_1.expect)(devops.allowedBashPatterns).toContain("kubectl *");
        (0, vitest_1.expect)(devops.runTests).toBe(false);
    });
});
(0, vitest_1.describe)("resolveRoleConfig", () => {
    (0, vitest_1.it)("resolves engineer role with all fields populated", () => {
        const role = core_1.BUILTIN_ROLES.engineer;
        const resolved = (0, core_1.resolveRoleConfig)(role, ["git status*", "npm test*"], makeOrchestratorConfig());
        (0, vitest_1.expect)(resolved.roleId).toBe("engineer");
        (0, vitest_1.expect)(resolved.name).toBe("Engineer");
        (0, vitest_1.expect)(resolved.permissionMode).toBe("acceptEdits");
        (0, vitest_1.expect)(resolved.disallowedTools).toContain("EnterPlanMode");
        (0, vitest_1.expect)(resolved.allowedBashPatterns).toContain("git status*");
        (0, vitest_1.expect)(resolved.allowedBashPatterns).toContain("npm test*");
        (0, vitest_1.expect)(resolved.instructions).toContain("tests");
        (0, vitest_1.expect)(resolved.doneCriteria).toContain("Relevant tests passing");
        (0, vitest_1.expect)(resolved.runTests).toBe(true);
        // runOracle is null on engineer → falls back to plan config (false)
        (0, vitest_1.expect)(resolved.runOracle).toBe(false);
    });
    (0, vitest_1.it)("merges allowedBashPatterns from role + stack + plan", () => {
        const role = {
            id: "custom",
            allowedBashPatterns: ["docker *"],
        };
        const stackPatterns = ["git status*", "npm test*"];
        const planConfig = makeOrchestratorConfig({ allowedBashPatterns: ["make *"] });
        const resolved = (0, core_1.resolveRoleConfig)(role, stackPatterns, planConfig);
        (0, vitest_1.expect)(resolved.allowedBashPatterns).toContain("docker *");
        (0, vitest_1.expect)(resolved.allowedBashPatterns).toContain("git status*");
        (0, vitest_1.expect)(resolved.allowedBashPatterns).toContain("npm test*");
        (0, vitest_1.expect)(resolved.allowedBashPatterns).toContain("make *");
    });
    (0, vitest_1.it)("role runOracle overrides plan config when non-null", () => {
        const role = {
            id: "strict",
            runOracle: true,
        };
        const planConfig = makeOrchestratorConfig({ verification: { runTests: true, runOracle: false } });
        const resolved = (0, core_1.resolveRoleConfig)(role, [], planConfig);
        (0, vitest_1.expect)(resolved.runOracle).toBe(true);
    });
    (0, vitest_1.it)("role runOracle falls back to plan when null", () => {
        const role = {
            id: "default",
            runOracle: null,
        };
        const planConfig = makeOrchestratorConfig({ verification: { runTests: false, runOracle: true } });
        const resolved = (0, core_1.resolveRoleConfig)(role, [], planConfig);
        (0, vitest_1.expect)(resolved.runOracle).toBe(true);
    });
    (0, vitest_1.it)("role runTests overrides plan config", () => {
        const role = {
            id: "notesting",
            runTests: false,
        };
        const planConfig = makeOrchestratorConfig({ verification: { runTests: true, runOracle: false } });
        const resolved = (0, core_1.resolveRoleConfig)(role, [], planConfig);
        (0, vitest_1.expect)(resolved.runTests).toBe(false);
    });
    (0, vitest_1.it)("capitalizes name from id when name not provided", () => {
        const role = { id: "myRole" };
        const resolved = (0, core_1.resolveRoleConfig)(role, [], makeOrchestratorConfig());
        (0, vitest_1.expect)(resolved.name).toBe("MyRole");
    });
    (0, vitest_1.it)("uses default disallowedTools when role doesn't specify them", () => {
        const role = { id: "minimal" };
        const resolved = (0, core_1.resolveRoleConfig)(role, [], makeOrchestratorConfig());
        (0, vitest_1.expect)(resolved.disallowedTools).toEqual(["EnterPlanMode", "ExitPlanMode", "EnterWorktree"]);
    });
    (0, vitest_1.it)("deduplicates bash patterns", () => {
        const role = {
            id: "dup",
            allowedBashPatterns: ["git status*"],
        };
        const resolved = (0, core_1.resolveRoleConfig)(role, ["git status*"], makeOrchestratorConfig());
        const count = resolved.allowedBashPatterns.filter((p) => p === "git status*").length;
        (0, vitest_1.expect)(count).toBe(1);
    });
});
(0, vitest_1.describe)("parseRoleYaml", () => {
    (0, vitest_1.it)("parses a role YAML string", () => {
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
        const role = (0, core_1.parseRoleYaml)(yaml);
        (0, vitest_1.expect)(role).not.toBeNull();
        (0, vitest_1.expect)(role.id).toBe("custom-role");
        (0, vitest_1.expect)(role.name).toBe("Custom");
        (0, vitest_1.expect)(role.permissionMode).toBe("default");
        (0, vitest_1.expect)(role.disallowedTools).toEqual(["Edit", "Write"]);
        (0, vitest_1.expect)(role.runTests).toBe(false);
        (0, vitest_1.expect)(role.runOracle).toBe(true);
        (0, vitest_1.expect)(role.doneCriteria).toBe("Review complete.");
    });
    (0, vitest_1.it)("parses YAML without frontmatter delimiters", () => {
        const yaml = `id: plain
name: Plain Role
permissionMode: acceptEdits
runTests: true`;
        const role = (0, core_1.parseRoleYaml)(yaml);
        (0, vitest_1.expect)(role).not.toBeNull();
        (0, vitest_1.expect)(role.id).toBe("plain");
        (0, vitest_1.expect)(role.name).toBe("Plain Role");
    });
    (0, vitest_1.it)("returns null for empty content", () => {
        (0, vitest_1.expect)((0, core_1.parseRoleYaml)("")).toBeNull();
    });
    (0, vitest_1.it)("returns null for content without id", () => {
        const yaml = `---
name: No ID Role
---`;
        (0, vitest_1.expect)((0, core_1.parseRoleYaml)(yaml)).toBeNull();
    });
});
(0, vitest_1.describe)("loadRole", () => {
    let tmpDir;
    let originalHome;
    (0, vitest_1.beforeEach)(async () => {
        tmpDir = await (0, promises_1.mkdtemp)((0, node_path_1.join)((0, node_os_1.tmpdir)(), "opcom-roles-test-"));
        originalHome = process.env.HOME;
        process.env.HOME = tmpDir;
    });
    (0, vitest_1.afterEach)(async () => {
        process.env.HOME = originalHome;
        await (0, promises_1.rm)(tmpDir, { recursive: true });
    });
    (0, vitest_1.it)("loads built-in role when no user file exists", async () => {
        const role = await (0, core_1.loadRole)("engineer");
        (0, vitest_1.expect)(role.id).toBe("engineer");
        (0, vitest_1.expect)(role.name).toBe("Engineer");
    });
    (0, vitest_1.it)("loads user-defined role from disk", async () => {
        const rolesPath = (0, node_path_1.join)(tmpDir, ".opcom", "roles");
        await (0, promises_1.mkdir)(rolesPath, { recursive: true });
        await (0, promises_1.writeFile)((0, node_path_1.join)(rolesPath, "custom.yaml"), `---
id: custom
name: My Custom Role
permissionMode: default
runTests: false
---`);
        const role = await (0, core_1.loadRole)("custom");
        (0, vitest_1.expect)(role.id).toBe("custom");
        (0, vitest_1.expect)(role.name).toBe("My Custom Role");
        (0, vitest_1.expect)(role.runTests).toBe(false);
    });
    (0, vitest_1.it)("user file overrides built-in role", async () => {
        const rolesPath = (0, node_path_1.join)(tmpDir, ".opcom", "roles");
        await (0, promises_1.mkdir)(rolesPath, { recursive: true });
        await (0, promises_1.writeFile)((0, node_path_1.join)(rolesPath, "engineer.yaml"), `---
id: engineer
name: Custom Engineer
permissionMode: bypassPermissions
runTests: false
---`);
        const role = await (0, core_1.loadRole)("engineer");
        (0, vitest_1.expect)(role.name).toBe("Custom Engineer");
        (0, vitest_1.expect)(role.permissionMode).toBe("bypassPermissions");
        (0, vitest_1.expect)(role.runTests).toBe(false);
    });
    (0, vitest_1.it)("returns minimal definition for unknown role", async () => {
        const role = await (0, core_1.loadRole)("nonexistent");
        (0, vitest_1.expect)(role.id).toBe("nonexistent");
        (0, vitest_1.expect)(role.name).toBeUndefined();
    });
});
(0, vitest_1.describe)("writeBuiltinRoles", () => {
    let tmpDir;
    let originalHome;
    (0, vitest_1.beforeEach)(async () => {
        tmpDir = await (0, promises_1.mkdtemp)((0, node_path_1.join)((0, node_os_1.tmpdir)(), "opcom-roles-write-"));
        originalHome = process.env.HOME;
        process.env.HOME = tmpDir;
    });
    (0, vitest_1.afterEach)(async () => {
        process.env.HOME = originalHome;
        await (0, promises_1.rm)(tmpDir, { recursive: true });
    });
    (0, vitest_1.it)("writes all five built-in roles", async () => {
        await (0, core_1.writeBuiltinRoles)();
        const { readdir } = await import("node:fs/promises");
        const files = await readdir((0, node_path_1.join)(tmpDir, ".opcom", "roles"));
        (0, vitest_1.expect)(files).toContain("engineer.yaml");
        (0, vitest_1.expect)(files).toContain("qa.yaml");
        (0, vitest_1.expect)(files).toContain("reviewer.yaml");
        (0, vitest_1.expect)(files).toContain("researcher.yaml");
        (0, vitest_1.expect)(files).toContain("devops.yaml");
    });
    (0, vitest_1.it)("does not overwrite existing files", async () => {
        const rolesPath = (0, node_path_1.join)(tmpDir, ".opcom", "roles");
        await (0, promises_1.mkdir)(rolesPath, { recursive: true });
        await (0, promises_1.writeFile)((0, node_path_1.join)(rolesPath, "engineer.yaml"), "id: engineer\nname: CustomEng\n");
        await (0, core_1.writeBuiltinRoles)();
        const { readFile } = await import("node:fs/promises");
        const content = await readFile((0, node_path_1.join)(rolesPath, "engineer.yaml"), "utf-8");
        (0, vitest_1.expect)(content).toContain("CustomEng");
    });
});
//# sourceMappingURL=roles.test.js.map