import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execSync } from "node:child_process";
import { GraphBuilder, GraphDatabase, TypeScriptImportAnalyzer } from "@opcom/context-graph";

let projectDir: string;
let contextDir: string;

beforeEach(() => {
  projectDir = mkdtempSync(join(tmpdir(), "cg-temporal-"));
  contextDir = mkdtempSync(join(tmpdir(), "cg-temporal-ctx-"));

  // Init git repo
  execSync("git init", { cwd: projectDir });
  execSync("git config user.email 'test@test.com'", { cwd: projectDir });
  execSync("git config user.name 'Test'", { cwd: projectDir });
});

afterEach(() => {
  rmSync(projectDir, { recursive: true, force: true });
  rmSync(contextDir, { recursive: true, force: true });
});

function commitAll(msg: string, date?: string) {
  execSync("git add -A", { cwd: projectDir });
  const env = date
    ? { ...process.env, GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date }
    : undefined;
  execSync(`git commit -m "${msg}" --allow-empty`, { cwd: projectDir, env });
}

describe("churn analysis", () => {
  it("ranks files by change frequency", async () => {
    // File A changes 3 times, file B changes once
    writeFileSync(join(projectDir, "a.ts"), "v1");
    writeFileSync(join(projectDir, "b.ts"), "v1");
    commitAll("init");

    writeFileSync(join(projectDir, "a.ts"), "v2");
    commitAll("change a");

    writeFileSync(join(projectDir, "a.ts"), "v3");
    commitAll("change a again");

    const builder = new GraphBuilder("test", projectDir, contextDir);
    await builder.replay();

    const db = builder.getDb();
    const churn = db.churnAnalysis();

    expect(churn.length).toBe(2);
    expect(churn[0].filePath).toBe("a.ts");
    expect(churn[0].changes).toBe(3);
    expect(churn[1].filePath).toBe("b.ts");
    expect(churn[1].changes).toBe(1);

    builder.close();
  });

  it("respects day filter", async () => {
    writeFileSync(join(projectDir, "old.ts"), "v1");
    // Commit with a date far in the past
    commitAll("old commit", "2020-01-01T00:00:00Z");

    writeFileSync(join(projectDir, "new.ts"), "v1");
    commitAll("new commit");

    const builder = new GraphBuilder("test", projectDir, contextDir);
    await builder.replay();

    const db = builder.getDb();
    // Only last 30 days — should exclude old.ts
    const recent = db.churnAnalysis(30);
    expect(recent.length).toBe(1);
    expect(recent[0].filePath).toBe("new.ts");

    // All time — both files
    const all = db.churnAnalysis();
    expect(all.length).toBe(2);

    builder.close();
  });

  it("reports test coverage status", async () => {
    writeFileSync(join(projectDir, "package.json"), '{"name":"test"}');
    mkdirSync(join(projectDir, "src"), { recursive: true });
    mkdirSync(join(projectDir, "tests"), { recursive: true });
    writeFileSync(join(projectDir, "src/covered.ts"), "export function f() {}");
    writeFileSync(join(projectDir, "src/uncovered.ts"), "export function g() {}");
    writeFileSync(
      join(projectDir, "tests/covered.test.ts"),
      'import { f } from "../src/covered.js";\nimport { describe, it, expect } from "vitest";\ndescribe("f", () => { it("works", () => { expect(f).toBeDefined(); }); });',
    );
    commitAll("init");

    writeFileSync(join(projectDir, "src/covered.ts"), "export function f() { return 1; }");
    commitAll("change covered");

    writeFileSync(join(projectDir, "src/uncovered.ts"), "export function g() { return 2; }");
    commitAll("change uncovered");

    const builder = new GraphBuilder("test", projectDir, contextDir);
    builder.register(new TypeScriptImportAnalyzer());
    await builder.build();
    await builder.replay();

    const db = builder.getDb();
    const churn = db.churnAnalysis();

    const covered = churn.find((c) => c.filePath === "src/covered.ts");
    const uncovered = churn.find((c) => c.filePath === "src/uncovered.ts");

    expect(covered?.hasCoverage).toBe(true);
    expect(uncovered?.hasCoverage).toBe(false);

    builder.close();
  });
});

describe("coupling analysis", () => {
  it("detects files that co-change", async () => {
    writeFileSync(join(projectDir, "a.ts"), "v1");
    writeFileSync(join(projectDir, "b.ts"), "v1");
    writeFileSync(join(projectDir, "c.ts"), "v1");
    commitAll("init");

    // a and b change together 3 times
    writeFileSync(join(projectDir, "a.ts"), "v2");
    writeFileSync(join(projectDir, "b.ts"), "v2");
    commitAll("change ab 1");

    writeFileSync(join(projectDir, "a.ts"), "v3");
    writeFileSync(join(projectDir, "b.ts"), "v3");
    commitAll("change ab 2");

    writeFileSync(join(projectDir, "a.ts"), "v4");
    writeFileSync(join(projectDir, "b.ts"), "v4");
    commitAll("change ab 3");

    // c changes alone
    writeFileSync(join(projectDir, "c.ts"), "v2");
    commitAll("change c alone");

    const builder = new GraphBuilder("test", projectDir, contextDir);
    await builder.replay();

    const db = builder.getDb();
    const coupling = db.couplingAnalysis(3);

    // a and b co-changed in all 4 commits (init + 3 changes)
    expect(coupling.length).toBeGreaterThanOrEqual(1);
    const abPair = coupling.find(
      (c) => (c.file1 === "a.ts" && c.file2 === "b.ts") || (c.file1 === "b.ts" && c.file2 === "a.ts"),
    );
    expect(abPair).toBeDefined();
    expect(abPair!.cochanges).toBeGreaterThanOrEqual(3);

    builder.close();
  });

  it("respects minimum co-changes threshold", async () => {
    writeFileSync(join(projectDir, "x.ts"), "v1");
    writeFileSync(join(projectDir, "y.ts"), "v1");
    commitAll("init");

    writeFileSync(join(projectDir, "x.ts"), "v2");
    writeFileSync(join(projectDir, "y.ts"), "v2");
    commitAll("change xy");

    const builder = new GraphBuilder("test", projectDir, contextDir);
    await builder.replay();

    const db = builder.getDb();
    // With min 5, the pair x/y (only 2 co-changes) should be excluded
    const high = db.couplingAnalysis(5);
    expect(high.length).toBe(0);

    // With min 2, should appear
    const low = db.couplingAnalysis(2);
    expect(low.length).toBe(1);

    builder.close();
  });

  it("reports shared test coverage", async () => {
    writeFileSync(join(projectDir, "package.json"), '{"name":"test"}');
    mkdirSync(join(projectDir, "src"), { recursive: true });
    mkdirSync(join(projectDir, "tests"), { recursive: true });
    writeFileSync(join(projectDir, "src/a.ts"), "export function a() {}");
    writeFileSync(join(projectDir, "src/b.ts"), "export function b() {}");
    // Test that imports both a and b
    writeFileSync(
      join(projectDir, "tests/ab.test.ts"),
      'import { a } from "../src/a.js";\nimport { b } from "../src/b.js";\nimport { describe, it, expect } from "vitest";\ndescribe("ab", () => { it("works", () => { expect(a).toBeDefined(); expect(b).toBeDefined(); }); });',
    );
    commitAll("init");

    // Co-change a and b twice more
    writeFileSync(join(projectDir, "src/a.ts"), "export function a() { return 1; }");
    writeFileSync(join(projectDir, "src/b.ts"), "export function b() { return 2; }");
    commitAll("change ab 1");

    writeFileSync(join(projectDir, "src/a.ts"), "export function a() { return 3; }");
    writeFileSync(join(projectDir, "src/b.ts"), "export function b() { return 4; }");
    commitAll("change ab 2");

    const builder = new GraphBuilder("test", projectDir, contextDir);
    builder.register(new TypeScriptImportAnalyzer());
    await builder.build();
    await builder.replay();

    const db = builder.getDb();
    const coupling = db.couplingAnalysis(2);

    const abPair = coupling.find(
      (c) => c.file1 === "src/a.ts" && c.file2 === "src/b.ts",
    );
    expect(abPair).toBeDefined();
    expect(abPair!.sharedTests).toBe(true);

    builder.close();
  });
});

describe("velocity tracking", () => {
  it("counts ticket-closing commits per week", async () => {
    writeFileSync(join(projectDir, "a.ts"), "v1");
    commitAll("init");

    writeFileSync(join(projectDir, "a.ts"), "v2");
    commitAll("fix: closes #42");

    writeFileSync(join(projectDir, "a.ts"), "v3");
    commitAll("closes #43 — improve performance");

    writeFileSync(join(projectDir, "a.ts"), "v4");
    commitAll("just a regular commit");

    const builder = new GraphBuilder("test", projectDir, contextDir);
    await builder.replay();

    const db = builder.getDb();
    const velocity = db.velocityTracking(52);

    // At least one week with ticket closures
    const weeksWithTickets = velocity.filter((v) => v.ticketsClosed > 0);
    expect(weeksWithTickets.length).toBeGreaterThanOrEqual(1);

    // Total commits should be 4
    const totalCommits = velocity.reduce((sum, v) => sum + v.commits, 0);
    expect(totalCommits).toBe(4);

    builder.close();
  });

  it("returns empty array for repos with no recent commits", () => {
    const db = new GraphDatabase("empty-velocity", contextDir);
    const velocity = db.velocityTracking(1);
    expect(velocity).toEqual([]);
    db.close();
  });
});

describe("coverage regression", () => {
  it("detects specs that lost test coverage between runs", () => {
    const db = new GraphDatabase("regression-test", contextDir);

    // Create a spec node and a test that asserts it
    db.upsertNode({ id: "spec:auth", type: "spec", title: "Auth Spec" });
    db.upsertNode({ id: "test:auth-test", type: "test", title: "auth-test" });
    db.upsertEdge({ source: "test:auth-test", target: "spec:auth", relation: "asserts" });

    // Run 1: test passes
    db.ingestTestRun(
      [{ testId: "test:auth-test", commitHash: "aaa", runId: "run-1", status: "pass", timestamp: "2026-03-01T00:00:00Z" }],
      { runId: "run-1", commitHash: "aaa", timestamp: "2026-03-01T00:00:00Z", total: 1, passed: 1, failed: 0, skipped: 0 },
    );

    // Run 2: test fails — regression
    db.ingestTestRun(
      [{ testId: "test:auth-test", commitHash: "bbb", runId: "run-2", status: "fail", timestamp: "2026-03-02T00:00:00Z" }],
      { runId: "run-2", commitHash: "bbb", timestamp: "2026-03-02T00:00:00Z", total: 1, passed: 0, failed: 1, skipped: 0 },
    );

    const regressions = db.coverageRegression("run-2", "run-1");
    expect(regressions).toHaveLength(1);
    expect(regressions[0].specId).toBe("spec:auth");
    expect(regressions[0].testId).toBe("test:auth-test");
    expect(regressions[0].status).toBe("fail");

    db.close();
  });

  it("reports no regression when tests stay passing", () => {
    const db = new GraphDatabase("no-regression", contextDir);

    db.upsertNode({ id: "spec:auth", type: "spec", title: "Auth Spec" });
    db.upsertNode({ id: "test:auth-test", type: "test", title: "auth-test" });
    db.upsertEdge({ source: "test:auth-test", target: "spec:auth", relation: "asserts" });

    db.ingestTestRun(
      [{ testId: "test:auth-test", commitHash: "aaa", runId: "run-1", status: "pass", timestamp: "2026-03-01T00:00:00Z" }],
      { runId: "run-1", commitHash: "aaa", timestamp: "2026-03-01T00:00:00Z", total: 1, passed: 1, failed: 0, skipped: 0 },
    );

    db.ingestTestRun(
      [{ testId: "test:auth-test", commitHash: "bbb", runId: "run-2", status: "pass", timestamp: "2026-03-02T00:00:00Z" }],
      { runId: "run-2", commitHash: "bbb", timestamp: "2026-03-02T00:00:00Z", total: 1, passed: 1, failed: 0, skipped: 0 },
    );

    const regressions = db.coverageRegression("run-2", "run-1");
    expect(regressions).toHaveLength(0);

    db.close();
  });

  it("detects file-level coverage regression via tests edges", () => {
    const db = new GraphDatabase("file-regression", contextDir);

    db.upsertNode({ id: "file:src/utils.ts", type: "file", path: "src/utils.ts" });
    db.upsertNode({ id: "test:utils-test", type: "test", title: "utils-test" });
    db.upsertEdge({ source: "test:utils-test", target: "file:src/utils.ts", relation: "tests" });

    db.ingestTestRun(
      [{ testId: "test:utils-test", commitHash: "aaa", runId: "run-1", status: "pass", timestamp: "2026-03-01T00:00:00Z" }],
      { runId: "run-1", commitHash: "aaa", timestamp: "2026-03-01T00:00:00Z", total: 1, passed: 1, failed: 0, skipped: 0 },
    );

    db.ingestTestRun(
      [{ testId: "test:utils-test", commitHash: "bbb", runId: "run-2", status: "error", timestamp: "2026-03-02T00:00:00Z" }],
      { runId: "run-2", commitHash: "bbb", timestamp: "2026-03-02T00:00:00Z", total: 1, passed: 0, failed: 0, skipped: 0 },
    );

    const regressions = db.coverageRegression("run-2", "run-1");
    expect(regressions).toHaveLength(1);
    expect(regressions[0].specId).toBe("file:src/utils.ts");

    db.close();
  });
});

describe("risk score", () => {
  it("ranks high-churn untested files highest", async () => {
    writeFileSync(join(projectDir, "package.json"), '{"name":"test"}');
    mkdirSync(join(projectDir, "src"), { recursive: true });
    mkdirSync(join(projectDir, "tests"), { recursive: true });

    writeFileSync(join(projectDir, "src/risky.ts"), "export function risky() {}");
    writeFileSync(join(projectDir, "src/safe.ts"), "export function safe() {}");
    writeFileSync(
      join(projectDir, "tests/safe.test.ts"),
      'import { safe } from "../src/safe.js";\nimport { describe, it, expect } from "vitest";\ndescribe("safe", () => { it("works", () => { expect(safe).toBeDefined(); }); });',
    );
    commitAll("init");

    // Churn on both files equally
    for (let i = 2; i <= 5; i++) {
      writeFileSync(join(projectDir, "src/risky.ts"), `export function risky() { return ${i}; }`);
      writeFileSync(join(projectDir, "src/safe.ts"), `export function safe() { return ${i}; }`);
      commitAll(`change ${i}`);
    }

    const builder = new GraphBuilder("test", projectDir, contextDir);
    builder.register(new TypeScriptImportAnalyzer());
    await builder.build();
    await builder.replay();

    const db = builder.getDb();
    const risks = db.riskScore();

    // risky.ts should have higher risk (no test coverage)
    const riskyIdx = risks.findIndex((r) => r.filePath === "src/risky.ts");
    const safeIdx = risks.findIndex((r) => r.filePath === "src/safe.ts");

    expect(riskyIdx).toBeGreaterThanOrEqual(0);
    expect(safeIdx).toBeGreaterThanOrEqual(0);

    expect(risks[riskyIdx].riskScore).toBeGreaterThan(risks[safeIdx].riskScore);

    builder.close();
  });

  it("returns empty array for empty graph", () => {
    const db = new GraphDatabase("empty-risk", contextDir);
    const risks = db.riskScore();
    expect(risks).toEqual([]);
    db.close();
  });

  it("applies recency multiplier — recent changes score higher", async () => {
    // Old file committed long ago
    writeFileSync(join(projectDir, "old.ts"), "v1");
    commitAll("old commit", "2020-01-01T00:00:00Z");

    writeFileSync(join(projectDir, "old.ts"), "v2");
    commitAll("old change", "2020-01-02T00:00:00Z");

    // New file committed recently
    writeFileSync(join(projectDir, "new.ts"), "v1");
    commitAll("new commit");

    writeFileSync(join(projectDir, "new.ts"), "v2");
    commitAll("new change");

    const builder = new GraphBuilder("test", projectDir, contextDir);
    await builder.replay();

    const db = builder.getDb();
    // Use a large window to include both
    const risks = db.riskScore(99999);

    const oldRisk = risks.find((r) => r.filePath === "old.ts");
    const newRisk = risks.find((r) => r.filePath === "new.ts");

    expect(oldRisk).toBeDefined();
    expect(newRisk).toBeDefined();
    // Same churn (2 changes each), but recent one should score higher
    expect(newRisk!.riskScore).toBeGreaterThan(oldRisk!.riskScore);

    builder.close();
  });
});

describe("replay robustness", () => {
  it("handles repos with many commits", async () => {
    writeFileSync(join(projectDir, "file.ts"), "v0");
    commitAll("init");

    // Create 50 commits
    for (let i = 1; i <= 50; i++) {
      writeFileSync(join(projectDir, "file.ts"), `v${i}`);
      commitAll(`commit ${i}`);
    }

    const builder = new GraphBuilder("test", projectDir, contextDir);
    const result = await builder.replay();

    expect(result.commits).toBe(51); // init + 50

    const db = builder.getDb();
    const churn = db.churnAnalysis();
    expect(churn[0].filePath).toBe("file.ts");
    expect(churn[0].changes).toBe(51);

    builder.close();
  });

  it("handles file renames in coupling analysis", async () => {
    writeFileSync(join(projectDir, "original.ts"), "content");
    commitAll("init");

    // Rename via git mv
    execSync("git mv original.ts renamed.ts", { cwd: projectDir });
    commitAll("rename file");

    const builder = new GraphBuilder("test", projectDir, contextDir);
    await builder.replay();

    const db = builder.getDb();
    const churn = db.churnAnalysis();
    // Both the original name and the renamed file should appear in history
    expect(churn.length).toBeGreaterThanOrEqual(1);

    builder.close();
  });
});
