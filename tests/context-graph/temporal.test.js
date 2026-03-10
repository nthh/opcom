"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const node_fs_1 = require("node:fs");
const node_path_1 = require("node:path");
const node_os_1 = require("node:os");
const node_child_process_1 = require("node:child_process");
const context_graph_1 = require("@opcom/context-graph");
let projectDir;
let contextDir;
(0, vitest_1.beforeEach)(() => {
    projectDir = (0, node_fs_1.mkdtempSync)((0, node_path_1.join)((0, node_os_1.tmpdir)(), "cg-temporal-"));
    contextDir = (0, node_fs_1.mkdtempSync)((0, node_path_1.join)((0, node_os_1.tmpdir)(), "cg-temporal-ctx-"));
    // Init git repo
    (0, node_child_process_1.execSync)("git init", { cwd: projectDir });
    (0, node_child_process_1.execSync)("git config user.email 'test@test.com'", { cwd: projectDir });
    (0, node_child_process_1.execSync)("git config user.name 'Test'", { cwd: projectDir });
});
(0, vitest_1.afterEach)(() => {
    (0, node_fs_1.rmSync)(projectDir, { recursive: true, force: true });
    (0, node_fs_1.rmSync)(contextDir, { recursive: true, force: true });
});
function commitAll(msg, date) {
    (0, node_child_process_1.execSync)("git add -A", { cwd: projectDir });
    const env = date
        ? { ...process.env, GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date }
        : undefined;
    (0, node_child_process_1.execSync)(`git commit -m "${msg}" --allow-empty`, { cwd: projectDir, env });
}
(0, vitest_1.describe)("churn analysis", () => {
    (0, vitest_1.it)("ranks files by change frequency", async () => {
        // File A changes 3 times, file B changes once
        (0, node_fs_1.writeFileSync)((0, node_path_1.join)(projectDir, "a.ts"), "v1");
        (0, node_fs_1.writeFileSync)((0, node_path_1.join)(projectDir, "b.ts"), "v1");
        commitAll("init");
        (0, node_fs_1.writeFileSync)((0, node_path_1.join)(projectDir, "a.ts"), "v2");
        commitAll("change a");
        (0, node_fs_1.writeFileSync)((0, node_path_1.join)(projectDir, "a.ts"), "v3");
        commitAll("change a again");
        const builder = new context_graph_1.GraphBuilder("test", projectDir, contextDir);
        await builder.replay();
        const db = builder.getDb();
        const churn = db.churnAnalysis();
        (0, vitest_1.expect)(churn.length).toBe(2);
        (0, vitest_1.expect)(churn[0].filePath).toBe("a.ts");
        (0, vitest_1.expect)(churn[0].changes).toBe(3);
        (0, vitest_1.expect)(churn[1].filePath).toBe("b.ts");
        (0, vitest_1.expect)(churn[1].changes).toBe(1);
        builder.close();
    });
    (0, vitest_1.it)("respects day filter", async () => {
        (0, node_fs_1.writeFileSync)((0, node_path_1.join)(projectDir, "old.ts"), "v1");
        // Commit with a date far in the past
        commitAll("old commit", "2020-01-01T00:00:00Z");
        (0, node_fs_1.writeFileSync)((0, node_path_1.join)(projectDir, "new.ts"), "v1");
        commitAll("new commit");
        const builder = new context_graph_1.GraphBuilder("test", projectDir, contextDir);
        await builder.replay();
        const db = builder.getDb();
        // Only last 30 days — should exclude old.ts
        const recent = db.churnAnalysis(30);
        (0, vitest_1.expect)(recent.length).toBe(1);
        (0, vitest_1.expect)(recent[0].filePath).toBe("new.ts");
        // All time — both files
        const all = db.churnAnalysis();
        (0, vitest_1.expect)(all.length).toBe(2);
        builder.close();
    });
    (0, vitest_1.it)("reports test coverage status", async () => {
        (0, node_fs_1.writeFileSync)((0, node_path_1.join)(projectDir, "package.json"), '{"name":"test"}');
        (0, node_fs_1.mkdirSync)((0, node_path_1.join)(projectDir, "src"), { recursive: true });
        (0, node_fs_1.mkdirSync)((0, node_path_1.join)(projectDir, "tests"), { recursive: true });
        (0, node_fs_1.writeFileSync)((0, node_path_1.join)(projectDir, "src/covered.ts"), "export function f() {}");
        (0, node_fs_1.writeFileSync)((0, node_path_1.join)(projectDir, "src/uncovered.ts"), "export function g() {}");
        (0, node_fs_1.writeFileSync)((0, node_path_1.join)(projectDir, "tests/covered.test.ts"), 'import { f } from "../src/covered.js";\nimport { describe, it, expect } from "vitest";\ndescribe("f", () => { it("works", () => { expect(f).toBeDefined(); }); });');
        commitAll("init");
        (0, node_fs_1.writeFileSync)((0, node_path_1.join)(projectDir, "src/covered.ts"), "export function f() { return 1; }");
        commitAll("change covered");
        (0, node_fs_1.writeFileSync)((0, node_path_1.join)(projectDir, "src/uncovered.ts"), "export function g() { return 2; }");
        commitAll("change uncovered");
        const builder = new context_graph_1.GraphBuilder("test", projectDir, contextDir);
        builder.register(new context_graph_1.TypeScriptImportAnalyzer());
        await builder.build();
        await builder.replay();
        const db = builder.getDb();
        const churn = db.churnAnalysis();
        const covered = churn.find((c) => c.filePath === "src/covered.ts");
        const uncovered = churn.find((c) => c.filePath === "src/uncovered.ts");
        (0, vitest_1.expect)(covered?.hasCoverage).toBe(true);
        (0, vitest_1.expect)(uncovered?.hasCoverage).toBe(false);
        builder.close();
    });
});
(0, vitest_1.describe)("coupling analysis", () => {
    (0, vitest_1.it)("detects files that co-change", async () => {
        (0, node_fs_1.writeFileSync)((0, node_path_1.join)(projectDir, "a.ts"), "v1");
        (0, node_fs_1.writeFileSync)((0, node_path_1.join)(projectDir, "b.ts"), "v1");
        (0, node_fs_1.writeFileSync)((0, node_path_1.join)(projectDir, "c.ts"), "v1");
        commitAll("init");
        // a and b change together 3 times
        (0, node_fs_1.writeFileSync)((0, node_path_1.join)(projectDir, "a.ts"), "v2");
        (0, node_fs_1.writeFileSync)((0, node_path_1.join)(projectDir, "b.ts"), "v2");
        commitAll("change ab 1");
        (0, node_fs_1.writeFileSync)((0, node_path_1.join)(projectDir, "a.ts"), "v3");
        (0, node_fs_1.writeFileSync)((0, node_path_1.join)(projectDir, "b.ts"), "v3");
        commitAll("change ab 2");
        (0, node_fs_1.writeFileSync)((0, node_path_1.join)(projectDir, "a.ts"), "v4");
        (0, node_fs_1.writeFileSync)((0, node_path_1.join)(projectDir, "b.ts"), "v4");
        commitAll("change ab 3");
        // c changes alone
        (0, node_fs_1.writeFileSync)((0, node_path_1.join)(projectDir, "c.ts"), "v2");
        commitAll("change c alone");
        const builder = new context_graph_1.GraphBuilder("test", projectDir, contextDir);
        await builder.replay();
        const db = builder.getDb();
        const coupling = db.couplingAnalysis(3);
        // a and b co-changed in all 4 commits (init + 3 changes)
        (0, vitest_1.expect)(coupling.length).toBeGreaterThanOrEqual(1);
        const abPair = coupling.find((c) => (c.file1 === "a.ts" && c.file2 === "b.ts") || (c.file1 === "b.ts" && c.file2 === "a.ts"));
        (0, vitest_1.expect)(abPair).toBeDefined();
        (0, vitest_1.expect)(abPair.cochanges).toBeGreaterThanOrEqual(3);
        builder.close();
    });
    (0, vitest_1.it)("respects minimum co-changes threshold", async () => {
        (0, node_fs_1.writeFileSync)((0, node_path_1.join)(projectDir, "x.ts"), "v1");
        (0, node_fs_1.writeFileSync)((0, node_path_1.join)(projectDir, "y.ts"), "v1");
        commitAll("init");
        (0, node_fs_1.writeFileSync)((0, node_path_1.join)(projectDir, "x.ts"), "v2");
        (0, node_fs_1.writeFileSync)((0, node_path_1.join)(projectDir, "y.ts"), "v2");
        commitAll("change xy");
        const builder = new context_graph_1.GraphBuilder("test", projectDir, contextDir);
        await builder.replay();
        const db = builder.getDb();
        // With min 5, the pair x/y (only 2 co-changes) should be excluded
        const high = db.couplingAnalysis(5);
        (0, vitest_1.expect)(high.length).toBe(0);
        // With min 2, should appear
        const low = db.couplingAnalysis(2);
        (0, vitest_1.expect)(low.length).toBe(1);
        builder.close();
    });
    (0, vitest_1.it)("reports shared test coverage", async () => {
        (0, node_fs_1.writeFileSync)((0, node_path_1.join)(projectDir, "package.json"), '{"name":"test"}');
        (0, node_fs_1.mkdirSync)((0, node_path_1.join)(projectDir, "src"), { recursive: true });
        (0, node_fs_1.mkdirSync)((0, node_path_1.join)(projectDir, "tests"), { recursive: true });
        (0, node_fs_1.writeFileSync)((0, node_path_1.join)(projectDir, "src/a.ts"), "export function a() {}");
        (0, node_fs_1.writeFileSync)((0, node_path_1.join)(projectDir, "src/b.ts"), "export function b() {}");
        // Test that imports both a and b
        (0, node_fs_1.writeFileSync)((0, node_path_1.join)(projectDir, "tests/ab.test.ts"), 'import { a } from "../src/a.js";\nimport { b } from "../src/b.js";\nimport { describe, it, expect } from "vitest";\ndescribe("ab", () => { it("works", () => { expect(a).toBeDefined(); expect(b).toBeDefined(); }); });');
        commitAll("init");
        // Co-change a and b twice more
        (0, node_fs_1.writeFileSync)((0, node_path_1.join)(projectDir, "src/a.ts"), "export function a() { return 1; }");
        (0, node_fs_1.writeFileSync)((0, node_path_1.join)(projectDir, "src/b.ts"), "export function b() { return 2; }");
        commitAll("change ab 1");
        (0, node_fs_1.writeFileSync)((0, node_path_1.join)(projectDir, "src/a.ts"), "export function a() { return 3; }");
        (0, node_fs_1.writeFileSync)((0, node_path_1.join)(projectDir, "src/b.ts"), "export function b() { return 4; }");
        commitAll("change ab 2");
        const builder = new context_graph_1.GraphBuilder("test", projectDir, contextDir);
        builder.register(new context_graph_1.TypeScriptImportAnalyzer());
        await builder.build();
        await builder.replay();
        const db = builder.getDb();
        const coupling = db.couplingAnalysis(2);
        const abPair = coupling.find((c) => c.file1 === "src/a.ts" && c.file2 === "src/b.ts");
        (0, vitest_1.expect)(abPair).toBeDefined();
        (0, vitest_1.expect)(abPair.sharedTests).toBe(true);
        builder.close();
    });
});
(0, vitest_1.describe)("velocity tracking", () => {
    (0, vitest_1.it)("counts ticket-closing commits per week", async () => {
        (0, node_fs_1.writeFileSync)((0, node_path_1.join)(projectDir, "a.ts"), "v1");
        commitAll("init");
        (0, node_fs_1.writeFileSync)((0, node_path_1.join)(projectDir, "a.ts"), "v2");
        commitAll("fix: closes #42");
        (0, node_fs_1.writeFileSync)((0, node_path_1.join)(projectDir, "a.ts"), "v3");
        commitAll("closes #43 — improve performance");
        (0, node_fs_1.writeFileSync)((0, node_path_1.join)(projectDir, "a.ts"), "v4");
        commitAll("just a regular commit");
        const builder = new context_graph_1.GraphBuilder("test", projectDir, contextDir);
        await builder.replay();
        const db = builder.getDb();
        const velocity = db.velocityTracking(52);
        // At least one week with ticket closures
        const weeksWithTickets = velocity.filter((v) => v.ticketsClosed > 0);
        (0, vitest_1.expect)(weeksWithTickets.length).toBeGreaterThanOrEqual(1);
        // Total commits should be 4
        const totalCommits = velocity.reduce((sum, v) => sum + v.commits, 0);
        (0, vitest_1.expect)(totalCommits).toBe(4);
        builder.close();
    });
    (0, vitest_1.it)("returns empty array for repos with no recent commits", () => {
        const db = new context_graph_1.GraphDatabase("empty-velocity", contextDir);
        const velocity = db.velocityTracking(1);
        (0, vitest_1.expect)(velocity).toEqual([]);
        db.close();
    });
});
(0, vitest_1.describe)("coverage regression", () => {
    (0, vitest_1.it)("detects specs that lost test coverage between runs", () => {
        const db = new context_graph_1.GraphDatabase("regression-test", contextDir);
        // Create a spec node and a test that asserts it
        db.upsertNode({ id: "spec:auth", type: "spec", title: "Auth Spec" });
        db.upsertNode({ id: "test:auth-test", type: "test", title: "auth-test" });
        db.upsertEdge({ source: "test:auth-test", target: "spec:auth", relation: "asserts" });
        // Run 1: test passes
        db.ingestTestRun([{ testId: "test:auth-test", commitHash: "aaa", runId: "run-1", status: "pass", timestamp: "2026-03-01T00:00:00Z" }], { runId: "run-1", commitHash: "aaa", timestamp: "2026-03-01T00:00:00Z", total: 1, passed: 1, failed: 0, skipped: 0 });
        // Run 2: test fails — regression
        db.ingestTestRun([{ testId: "test:auth-test", commitHash: "bbb", runId: "run-2", status: "fail", timestamp: "2026-03-02T00:00:00Z" }], { runId: "run-2", commitHash: "bbb", timestamp: "2026-03-02T00:00:00Z", total: 1, passed: 0, failed: 1, skipped: 0 });
        const regressions = db.coverageRegression("run-2", "run-1");
        (0, vitest_1.expect)(regressions).toHaveLength(1);
        (0, vitest_1.expect)(regressions[0].specId).toBe("spec:auth");
        (0, vitest_1.expect)(regressions[0].testId).toBe("test:auth-test");
        (0, vitest_1.expect)(regressions[0].status).toBe("fail");
        db.close();
    });
    (0, vitest_1.it)("reports no regression when tests stay passing", () => {
        const db = new context_graph_1.GraphDatabase("no-regression", contextDir);
        db.upsertNode({ id: "spec:auth", type: "spec", title: "Auth Spec" });
        db.upsertNode({ id: "test:auth-test", type: "test", title: "auth-test" });
        db.upsertEdge({ source: "test:auth-test", target: "spec:auth", relation: "asserts" });
        db.ingestTestRun([{ testId: "test:auth-test", commitHash: "aaa", runId: "run-1", status: "pass", timestamp: "2026-03-01T00:00:00Z" }], { runId: "run-1", commitHash: "aaa", timestamp: "2026-03-01T00:00:00Z", total: 1, passed: 1, failed: 0, skipped: 0 });
        db.ingestTestRun([{ testId: "test:auth-test", commitHash: "bbb", runId: "run-2", status: "pass", timestamp: "2026-03-02T00:00:00Z" }], { runId: "run-2", commitHash: "bbb", timestamp: "2026-03-02T00:00:00Z", total: 1, passed: 1, failed: 0, skipped: 0 });
        const regressions = db.coverageRegression("run-2", "run-1");
        (0, vitest_1.expect)(regressions).toHaveLength(0);
        db.close();
    });
    (0, vitest_1.it)("detects file-level coverage regression via tests edges", () => {
        const db = new context_graph_1.GraphDatabase("file-regression", contextDir);
        db.upsertNode({ id: "file:src/utils.ts", type: "file", path: "src/utils.ts" });
        db.upsertNode({ id: "test:utils-test", type: "test", title: "utils-test" });
        db.upsertEdge({ source: "test:utils-test", target: "file:src/utils.ts", relation: "tests" });
        db.ingestTestRun([{ testId: "test:utils-test", commitHash: "aaa", runId: "run-1", status: "pass", timestamp: "2026-03-01T00:00:00Z" }], { runId: "run-1", commitHash: "aaa", timestamp: "2026-03-01T00:00:00Z", total: 1, passed: 1, failed: 0, skipped: 0 });
        db.ingestTestRun([{ testId: "test:utils-test", commitHash: "bbb", runId: "run-2", status: "error", timestamp: "2026-03-02T00:00:00Z" }], { runId: "run-2", commitHash: "bbb", timestamp: "2026-03-02T00:00:00Z", total: 1, passed: 0, failed: 0, skipped: 0 });
        const regressions = db.coverageRegression("run-2", "run-1");
        (0, vitest_1.expect)(regressions).toHaveLength(1);
        (0, vitest_1.expect)(regressions[0].specId).toBe("file:src/utils.ts");
        db.close();
    });
});
(0, vitest_1.describe)("risk score", () => {
    (0, vitest_1.it)("ranks high-churn untested files highest", async () => {
        (0, node_fs_1.writeFileSync)((0, node_path_1.join)(projectDir, "package.json"), '{"name":"test"}');
        (0, node_fs_1.mkdirSync)((0, node_path_1.join)(projectDir, "src"), { recursive: true });
        (0, node_fs_1.mkdirSync)((0, node_path_1.join)(projectDir, "tests"), { recursive: true });
        (0, node_fs_1.writeFileSync)((0, node_path_1.join)(projectDir, "src/risky.ts"), "export function risky() {}");
        (0, node_fs_1.writeFileSync)((0, node_path_1.join)(projectDir, "src/safe.ts"), "export function safe() {}");
        (0, node_fs_1.writeFileSync)((0, node_path_1.join)(projectDir, "tests/safe.test.ts"), 'import { safe } from "../src/safe.js";\nimport { describe, it, expect } from "vitest";\ndescribe("safe", () => { it("works", () => { expect(safe).toBeDefined(); }); });');
        commitAll("init");
        // Churn on both files equally
        for (let i = 2; i <= 5; i++) {
            (0, node_fs_1.writeFileSync)((0, node_path_1.join)(projectDir, "src/risky.ts"), `export function risky() { return ${i}; }`);
            (0, node_fs_1.writeFileSync)((0, node_path_1.join)(projectDir, "src/safe.ts"), `export function safe() { return ${i}; }`);
            commitAll(`change ${i}`);
        }
        const builder = new context_graph_1.GraphBuilder("test", projectDir, contextDir);
        builder.register(new context_graph_1.TypeScriptImportAnalyzer());
        await builder.build();
        await builder.replay();
        const db = builder.getDb();
        const risks = db.riskScore();
        // risky.ts should have higher risk (no test coverage)
        const riskyIdx = risks.findIndex((r) => r.filePath === "src/risky.ts");
        const safeIdx = risks.findIndex((r) => r.filePath === "src/safe.ts");
        (0, vitest_1.expect)(riskyIdx).toBeGreaterThanOrEqual(0);
        (0, vitest_1.expect)(safeIdx).toBeGreaterThanOrEqual(0);
        (0, vitest_1.expect)(risks[riskyIdx].riskScore).toBeGreaterThan(risks[safeIdx].riskScore);
        builder.close();
    });
    (0, vitest_1.it)("returns empty array for empty graph", () => {
        const db = new context_graph_1.GraphDatabase("empty-risk", contextDir);
        const risks = db.riskScore();
        (0, vitest_1.expect)(risks).toEqual([]);
        db.close();
    });
    (0, vitest_1.it)("applies recency multiplier — recent changes score higher", async () => {
        // Old file committed long ago
        (0, node_fs_1.writeFileSync)((0, node_path_1.join)(projectDir, "old.ts"), "v1");
        commitAll("old commit", "2020-01-01T00:00:00Z");
        (0, node_fs_1.writeFileSync)((0, node_path_1.join)(projectDir, "old.ts"), "v2");
        commitAll("old change", "2020-01-02T00:00:00Z");
        // New file committed recently
        (0, node_fs_1.writeFileSync)((0, node_path_1.join)(projectDir, "new.ts"), "v1");
        commitAll("new commit");
        (0, node_fs_1.writeFileSync)((0, node_path_1.join)(projectDir, "new.ts"), "v2");
        commitAll("new change");
        const builder = new context_graph_1.GraphBuilder("test", projectDir, contextDir);
        await builder.replay();
        const db = builder.getDb();
        // Use a large window to include both
        const risks = db.riskScore(99999);
        const oldRisk = risks.find((r) => r.filePath === "old.ts");
        const newRisk = risks.find((r) => r.filePath === "new.ts");
        (0, vitest_1.expect)(oldRisk).toBeDefined();
        (0, vitest_1.expect)(newRisk).toBeDefined();
        // Same churn (2 changes each), but recent one should score higher
        (0, vitest_1.expect)(newRisk.riskScore).toBeGreaterThan(oldRisk.riskScore);
        builder.close();
    });
});
(0, vitest_1.describe)("replay robustness", () => {
    (0, vitest_1.it)("handles repos with many commits", async () => {
        (0, node_fs_1.writeFileSync)((0, node_path_1.join)(projectDir, "file.ts"), "v0");
        commitAll("init");
        // Create 15 commits (enough to test multi-commit handling without being slow)
        for (let i = 1; i <= 15; i++) {
            (0, node_fs_1.writeFileSync)((0, node_path_1.join)(projectDir, "file.ts"), `v${i}`);
            commitAll(`commit ${i}`);
        }
        const builder = new context_graph_1.GraphBuilder("test", projectDir, contextDir);
        const result = await builder.replay();
        (0, vitest_1.expect)(result.commits).toBe(16); // init + 15
        const db = builder.getDb();
        const churn = db.churnAnalysis();
        (0, vitest_1.expect)(churn[0].filePath).toBe("file.ts");
        (0, vitest_1.expect)(churn[0].changes).toBe(16);
        builder.close();
    });
    (0, vitest_1.it)("handles file renames in coupling analysis", async () => {
        (0, node_fs_1.writeFileSync)((0, node_path_1.join)(projectDir, "original.ts"), "content");
        commitAll("init");
        // Rename via git mv
        (0, node_child_process_1.execSync)("git mv original.ts renamed.ts", { cwd: projectDir });
        commitAll("rename file");
        const builder = new context_graph_1.GraphBuilder("test", projectDir, contextDir);
        await builder.replay();
        const db = builder.getDb();
        const churn = db.churnAnalysis();
        // Both the original name and the renamed file should appear in history
        (0, vitest_1.expect)(churn.length).toBeGreaterThanOrEqual(1);
        builder.close();
    });
});
//# sourceMappingURL=temporal.test.js.map