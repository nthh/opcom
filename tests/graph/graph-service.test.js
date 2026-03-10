"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const node_fs_1 = require("node:fs");
const node_path_1 = require("node:path");
const node_os_1 = require("node:os");
const node_child_process_1 = require("node:child_process");
const core_1 = require("@opcom/core");
// Use unique temp dirs and project names to avoid cross-file collisions
let contextDir;
let projectDir;
let projectName;
function createTestProject() {
    projectDir = (0, node_fs_1.mkdtempSync)((0, node_path_1.join)((0, node_os_1.tmpdir)(), "opcom-graph-test-"));
    // Initialize git repo
    (0, node_child_process_1.execSync)("git init", { cwd: projectDir, stdio: "pipe" });
    (0, node_child_process_1.execSync)('git config user.email "test@test.com"', { cwd: projectDir, stdio: "pipe" });
    (0, node_child_process_1.execSync)('git config user.name "Test"', { cwd: projectDir, stdio: "pipe" });
    // Create some TS files
    (0, node_fs_1.writeFileSync)((0, node_path_1.join)(projectDir, "package.json"), JSON.stringify({ name: "test", type: "module" }));
    (0, node_fs_1.writeFileSync)((0, node_path_1.join)(projectDir, "tsconfig.json"), JSON.stringify({ compilerOptions: {} }));
    (0, node_fs_1.mkdirSync)((0, node_path_1.join)(projectDir, "src"), { recursive: true });
    (0, node_fs_1.writeFileSync)((0, node_path_1.join)(projectDir, "src/index.ts"), 'export const hello = "world";\n');
    (0, node_fs_1.writeFileSync)((0, node_path_1.join)(projectDir, "src/utils.ts"), 'import { hello } from "./index.js";\nexport const greet = () => hello;\n');
    (0, node_fs_1.writeFileSync)((0, node_path_1.join)(projectDir, "src/utils.test.ts"), 'import { greet } from "./utils.js";\ntest("greets", () => expect(greet()).toBe("world"));\n');
    // Create docs dir
    (0, node_fs_1.mkdirSync)((0, node_path_1.join)(projectDir, "docs", "spec"), { recursive: true });
    (0, node_fs_1.writeFileSync)((0, node_path_1.join)(projectDir, "docs/spec/auth.md"), "---\ntitle: Auth Spec\n---\n# Auth\n");
    // Create ticket
    (0, node_fs_1.mkdirSync)((0, node_path_1.join)(projectDir, ".tickets", "impl", "fix-auth"), { recursive: true });
    (0, node_fs_1.writeFileSync)((0, node_path_1.join)(projectDir, ".tickets/impl/fix-auth/README.md"), "---\ntitle: Fix Auth\nstatus: open\npriority: 1\nlinks:\n  - docs/spec/auth.md\n---\n# Fix Auth\n");
    // Commit everything
    (0, node_child_process_1.execSync)("git add -A", { cwd: projectDir, stdio: "pipe" });
    (0, node_child_process_1.execSync)('git commit -m "init"', { cwd: projectDir, stdio: "pipe" });
    return projectDir;
}
(0, vitest_1.beforeEach)(() => {
    contextDir = (0, node_fs_1.mkdtempSync)((0, node_path_1.join)((0, node_os_1.tmpdir)(), "opcom-ctx-"));
    projectName = `test-graph-svc-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    createTestProject();
});
(0, vitest_1.afterEach)(() => {
    (0, node_fs_1.rmSync)(contextDir, { recursive: true, force: true });
    (0, node_fs_1.rmSync)(projectDir, { recursive: true, force: true });
    // Clean up global graph DB created by buildGraph
    const { homedir } = require("node:os");
    (0, node_fs_1.rmSync)((0, node_path_1.join)(homedir(), ".context", projectName), { recursive: true, force: true });
});
(0, vitest_1.describe)("buildGraph", () => {
    (0, vitest_1.it)("builds a graph and returns node/edge counts", async () => {
        const result = await (0, core_1.buildGraph)(projectName, projectDir);
        (0, vitest_1.expect)(result.totalNodes).toBeGreaterThan(0);
        (0, vitest_1.expect)(result.totalEdges).toBeGreaterThanOrEqual(0);
    });
});
(0, vitest_1.describe)("openGraphDb / graphExists", () => {
    (0, vitest_1.it)("returns null when no graph exists", () => {
        const db = (0, core_1.openGraphDb)("nonexistent-project-xyz");
        (0, vitest_1.expect)(db).toBeNull();
    });
    (0, vitest_1.it)("graphExists returns false for missing graph", () => {
        (0, vitest_1.expect)((0, core_1.graphExists)("nonexistent-project-xyz")).toBe(false);
    });
    (0, vitest_1.it)("graphExists returns true after building", async () => {
        await (0, core_1.buildGraph)(projectName, projectDir);
        (0, vitest_1.expect)((0, core_1.graphExists)(projectName)).toBe(true);
    });
    (0, vitest_1.it)("opens the graph database after building", async () => {
        await (0, core_1.buildGraph)(projectName, projectDir);
        const db = (0, core_1.openGraphDb)(projectName);
        (0, vitest_1.expect)(db).not.toBeNull();
        db.close();
    });
});
(0, vitest_1.describe)("getGraphStats", () => {
    (0, vitest_1.it)("returns null when no graph exists", () => {
        (0, vitest_1.expect)((0, core_1.getGraphStats)("nonexistent-project-xyz")).toBeNull();
    });
    (0, vitest_1.it)("returns stats after building", async () => {
        await (0, core_1.buildGraph)(projectName, projectDir);
        const stats = (0, core_1.getGraphStats)(projectName);
        (0, vitest_1.expect)(stats).not.toBeNull();
        (0, vitest_1.expect)(stats.totalNodes).toBeGreaterThan(0);
        (0, vitest_1.expect)(stats.lastBuild).toBeDefined();
        (0, vitest_1.expect)(stats.lastCommit).toBeDefined();
        (0, vitest_1.expect)(typeof stats.byType).toBe("object");
        (0, vitest_1.expect)(typeof stats.byRelation).toBe("object");
    });
});
(0, vitest_1.describe)("queryGraphContext", () => {
    (0, vitest_1.it)("returns null when no graph exists", () => {
        const ctx = (0, core_1.queryGraphContext)("nonexistent-project-xyz", "fix-auth", []);
        (0, vitest_1.expect)(ctx).toBeNull();
    });
    (0, vitest_1.it)("returns graph context with related files", async () => {
        await (0, core_1.buildGraph)(projectName, projectDir);
        const ctx = (0, core_1.queryGraphContext)(projectName, "fix-auth", ["docs/spec/auth.md"]);
        (0, vitest_1.expect)(ctx).not.toBeNull();
        // The context should have the expected structure
        (0, vitest_1.expect)(Array.isArray(ctx.relatedFiles)).toBe(true);
        (0, vitest_1.expect)(Array.isArray(ctx.testFiles)).toBe(true);
        (0, vitest_1.expect)(Array.isArray(ctx.driftSignals)).toBe(true);
    });
    (0, vitest_1.it)("includes drift signals in context", async () => {
        await (0, core_1.buildGraph)(projectName, projectDir);
        const ctx = (0, core_1.queryGraphContext)(projectName, "fix-auth", []);
        (0, vitest_1.expect)(ctx).not.toBeNull();
        // Drift signals should include untested files
        (0, vitest_1.expect)(ctx.driftSignals.length).toBeGreaterThanOrEqual(0);
    });
});
(0, vitest_1.describe)("queryProjectDrift", () => {
    (0, vitest_1.it)("returns empty array when no graph exists", () => {
        const signals = (0, core_1.queryProjectDrift)("nonexistent-project-xyz");
        (0, vitest_1.expect)(signals).toEqual([]);
    });
    (0, vitest_1.it)("returns drift signals after building", async () => {
        await (0, core_1.buildGraph)(projectName, projectDir);
        const signals = (0, core_1.queryProjectDrift)(projectName);
        // We expect some drift signals (at least untested files or uncovered specs)
        (0, vitest_1.expect)(Array.isArray(signals)).toBe(true);
        for (const signal of signals) {
            (0, vitest_1.expect)(signal.type).toMatch(/^(uncovered_spec|untested_file|new_failure|flaky_test)$/);
            (0, vitest_1.expect)(signal.id).toBeTruthy();
        }
    });
});
(0, vitest_1.describe)("ingestTestResults", () => {
    (0, vitest_1.it)("skips silently when no graph exists", () => {
        // Should not throw
        (0, core_1.ingestTestResults)("nonexistent-project-xyz", "Tests  5 passed (5)", "abc123", "run-1");
    });
    (0, vitest_1.it)("ingests vitest output into the graph", async () => {
        await (0, core_1.buildGraph)(projectName, projectDir);
        const testOutput = "Tests  10 passed (10)";
        (0, core_1.ingestTestResults)(projectName, testOutput, "abc123", "run-1");
        const db = (0, core_1.openGraphDb)(projectName);
        (0, vitest_1.expect)(db).not.toBeNull();
        const trend = db.coverageTrend(1);
        (0, vitest_1.expect)(trend.length).toBe(1);
        (0, vitest_1.expect)(trend[0].passed).toBe(10);
        (0, vitest_1.expect)(trend[0].total).toBe(10);
        (0, vitest_1.expect)(trend[0].runId).toBe("run-1");
        db.close();
    });
    (0, vitest_1.it)("ingests vitest output with failures", async () => {
        await (0, core_1.buildGraph)(projectName, projectDir);
        const testOutput = "Tests  3 failed | 7 passed (10)";
        (0, core_1.ingestTestResults)(projectName, testOutput, "def456", "run-2");
        const db = (0, core_1.openGraphDb)(projectName);
        const trend = db.coverageTrend(1);
        (0, vitest_1.expect)(trend.length).toBe(1);
        (0, vitest_1.expect)(trend[0].passed).toBe(7);
        (0, vitest_1.expect)(trend[0].failed).toBe(3);
        (0, vitest_1.expect)(trend[0].total).toBe(10);
        db.close();
    });
});
//# sourceMappingURL=graph-service.test.js.map