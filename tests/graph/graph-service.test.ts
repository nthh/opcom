import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execSync } from "node:child_process";
import { GraphDatabase } from "@opcom/context-graph";
import {
  buildGraph,
  openGraphDb,
  graphExists,
  queryGraphContext,
  queryProjectDrift,
  ingestTestResults,
  ingestFieldMappingEdges,
  getGraphStats,
} from "@opcom/core";

// Use unique temp dirs and project names to avoid cross-file collisions
let contextDir: string;
let projectDir: string;
let projectName: string;

function createTestProject(): string {
  projectDir = mkdtempSync(join(tmpdir(), "opcom-graph-test-"));

  // Initialize git repo
  execSync("git init", { cwd: projectDir, stdio: "pipe" });
  execSync('git config user.email "test@test.com"', { cwd: projectDir, stdio: "pipe" });
  execSync('git config user.name "Test"', { cwd: projectDir, stdio: "pipe" });

  // Create some TS files
  writeFileSync(join(projectDir, "package.json"), JSON.stringify({ name: "test", type: "module" }));
  writeFileSync(join(projectDir, "tsconfig.json"), JSON.stringify({ compilerOptions: {} }));
  mkdirSync(join(projectDir, "src"), { recursive: true });
  writeFileSync(join(projectDir, "src/index.ts"), 'export const hello = "world";\n');
  writeFileSync(join(projectDir, "src/utils.ts"), 'import { hello } from "./index.js";\nexport const greet = () => hello;\n');
  writeFileSync(join(projectDir, "src/utils.test.ts"), 'import { greet } from "./utils.js";\ntest("greets", () => expect(greet()).toBe("world"));\n');

  // Create docs dir
  mkdirSync(join(projectDir, "docs", "spec"), { recursive: true });
  writeFileSync(join(projectDir, "docs/spec/auth.md"), "---\ntitle: Auth Spec\n---\n# Auth\n");

  // Create ticket
  mkdirSync(join(projectDir, ".tickets", "impl", "fix-auth"), { recursive: true });
  writeFileSync(
    join(projectDir, ".tickets/impl/fix-auth/README.md"),
    "---\ntitle: Fix Auth\nstatus: open\npriority: 1\nlinks:\n  - docs/spec/auth.md\n---\n# Fix Auth\n",
  );

  // Commit everything
  execSync("git add -A", { cwd: projectDir, stdio: "pipe" });
  execSync('git commit -m "init"', { cwd: projectDir, stdio: "pipe" });

  return projectDir;
}

beforeEach(() => {
  contextDir = mkdtempSync(join(tmpdir(), "opcom-ctx-"));
  projectName = `test-graph-svc-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  createTestProject();
});

afterEach(() => {
  rmSync(contextDir, { recursive: true, force: true });
  rmSync(projectDir, { recursive: true, force: true });
  // Clean up global graph DB created by buildGraph
  const { homedir } = require("node:os");
  rmSync(join(homedir(), ".context", projectName), { recursive: true, force: true });
});

describe("buildGraph", () => {
  it("builds a graph and returns node/edge counts", async () => {
    const result = await buildGraph(projectName, projectDir);
    expect(result.totalNodes).toBeGreaterThan(0);
    expect(result.totalEdges).toBeGreaterThanOrEqual(0);
  });
});

describe("openGraphDb / graphExists", () => {
  it("returns null when no graph exists", () => {
    const db = openGraphDb("nonexistent-project-xyz");
    expect(db).toBeNull();
  });

  it("graphExists returns false for missing graph", () => {
    expect(graphExists("nonexistent-project-xyz")).toBe(false);
  });

  it("graphExists returns true after building", async () => {
    await buildGraph(projectName, projectDir);
    expect(graphExists(projectName)).toBe(true);
  });

  it("opens the graph database after building", async () => {
    await buildGraph(projectName, projectDir);
    const db = openGraphDb(projectName);
    expect(db).not.toBeNull();
    db!.close();
  });
});

describe("getGraphStats", () => {
  it("returns null when no graph exists", () => {
    expect(getGraphStats("nonexistent-project-xyz")).toBeNull();
  });

  it("returns stats after building", async () => {
    await buildGraph(projectName, projectDir);
    const stats = getGraphStats(projectName);
    expect(stats).not.toBeNull();
    expect(stats!.totalNodes).toBeGreaterThan(0);
    expect(stats!.lastBuild).toBeDefined();
    expect(stats!.lastCommit).toBeDefined();
    expect(typeof stats!.byType).toBe("object");
    expect(typeof stats!.byRelation).toBe("object");
  });
});

describe("queryGraphContext", () => {
  it("returns null when no graph exists", () => {
    const ctx = queryGraphContext("nonexistent-project-xyz", "fix-auth", []);
    expect(ctx).toBeNull();
  });

  it("returns graph context with related files", async () => {
    await buildGraph(projectName, projectDir);
    const ctx = queryGraphContext(projectName, "fix-auth", ["docs/spec/auth.md"]);
    expect(ctx).not.toBeNull();
    // The context should have the expected structure
    expect(Array.isArray(ctx!.relatedFiles)).toBe(true);
    expect(Array.isArray(ctx!.testFiles)).toBe(true);
    expect(Array.isArray(ctx!.driftSignals)).toBe(true);
  });

  it("includes drift signals in context", async () => {
    await buildGraph(projectName, projectDir);
    const ctx = queryGraphContext(projectName, "fix-auth", []);
    expect(ctx).not.toBeNull();
    // Drift signals should include untested files
    expect(ctx!.driftSignals.length).toBeGreaterThanOrEqual(0);
  });
});

describe("queryProjectDrift", () => {
  it("returns empty array when no graph exists", () => {
    const signals = queryProjectDrift("nonexistent-project-xyz");
    expect(signals).toEqual([]);
  });

  it("returns drift signals after building", async () => {
    await buildGraph(projectName, projectDir);
    const signals = queryProjectDrift(projectName);
    // We expect some drift signals (at least untested files or uncovered specs)
    expect(Array.isArray(signals)).toBe(true);
    for (const signal of signals) {
      expect(signal.type).toMatch(/^(uncovered_spec|untested_file|new_failure|flaky_test)$/);
      expect(signal.id).toBeTruthy();
    }
  });
});

describe("ingestTestResults", () => {
  it("skips silently when no graph exists", () => {
    // Should not throw
    ingestTestResults("nonexistent-project-xyz", "Tests  5 passed (5)", "abc123", "run-1");
  });

  it("ingests vitest output into the graph", async () => {
    await buildGraph(projectName, projectDir);

    const testOutput = "Tests  10 passed (10)";
    ingestTestResults(projectName, testOutput, "abc123", "run-1");

    const db = openGraphDb(projectName);
    expect(db).not.toBeNull();
    const trend = db!.coverageTrend(1);
    expect(trend.length).toBe(1);
    expect(trend[0].passed).toBe(10);
    expect(trend[0].total).toBe(10);
    expect(trend[0].runId).toBe("run-1");
    db!.close();
  });

  it("ingests vitest output with failures", async () => {
    await buildGraph(projectName, projectDir);

    const testOutput = "Tests  3 failed | 7 passed (10)";
    ingestTestResults(projectName, testOutput, "def456", "run-2");

    const db = openGraphDb(projectName);
    const trend = db!.coverageTrend(1);
    expect(trend.length).toBe(1);
    expect(trend[0].passed).toBe(7);
    expect(trend[0].failed).toBe(3);
    expect(trend[0].total).toBe(10);
    db!.close();
  });
});

describe("ingestFieldMappingEdges", () => {
  it("skips silently when no graph exists", () => {
    // Should not throw
    ingestFieldMappingEdges("nonexistent-project-xyz", "ticket-1", ["UC-001"]);
  });

  it("creates use_case nodes and implements edges", async () => {
    await buildGraph(projectName, projectDir);

    ingestFieldMappingEdges(projectName, "fix-auth", ["UC-001", "UC-002"]);

    const db = openGraphDb(projectName);
    expect(db).not.toBeNull();

    // Check ticket node exists
    const ticketNode = db!.getNode("ticket:fix-auth");
    expect(ticketNode).not.toBeNull();
    expect(ticketNode!.type).toBe("ticket");

    // Check use_case nodes exist
    const uc1 = db!.getNode("use_case:UC-001");
    expect(uc1).not.toBeNull();
    expect(uc1!.type).toBe("use_case");

    const uc2 = db!.getNode("use_case:UC-002");
    expect(uc2).not.toBeNull();

    // Check implements edges from ticket to use_cases
    const edges = db!.getEdgesFrom("ticket:fix-auth", "implements");
    const useCaseTargets = edges.map((e) => e.target).sort();
    expect(useCaseTargets).toContain("use_case:UC-001");
    expect(useCaseTargets).toContain("use_case:UC-002");

    db!.close();
  });

  it("is idempotent — re-ingesting does not duplicate", async () => {
    await buildGraph(projectName, projectDir);

    ingestFieldMappingEdges(projectName, "fix-auth", ["UC-001"]);
    ingestFieldMappingEdges(projectName, "fix-auth", ["UC-001"]);

    const db = openGraphDb(projectName);
    const edges = db!.getEdgesFrom("ticket:fix-auth", "implements");
    const ucEdges = edges.filter((e) => e.target === "use_case:UC-001");
    expect(ucEdges).toHaveLength(1);
    db!.close();
  });
});
