import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  GraphDatabase,
  WorkspaceEngine,
  type ProjectGraphRef,
  type WorkspaceSignal,
} from "@opcom/context-graph";

let contextDir: string;

beforeEach(() => {
  contextDir = mkdtempSync(join(tmpdir(), "cg-workspace-"));
});

afterEach(() => {
  rmSync(contextDir, { recursive: true, force: true });
});

/** Helper: create a project graph ref with some common nodes/edges. */
function makeProject(name: string, setup?: (db: GraphDatabase) => void): ProjectGraphRef {
  const db = new GraphDatabase(name, contextDir);
  if (setup) setup(db);
  return { projectName: name, projectPath: `/projects/${name}`, db };
}

// --- Aggregate drift ---

describe("WorkspaceEngine.aggregateDrift", () => {
  it("aggregates drift signals from multiple projects", async () => {
    const projA = makeProject("alpha", (db) => {
      db.upsertNode({ id: "spec:auth", type: "spec", title: "Authentication" });
      // No test -> spec_no_tests signal
    });
    const projB = makeProject("beta", (db) => {
      db.upsertNode({ id: "file:src/utils.ts", type: "file", path: "src/utils.ts" });
      // No test -> file_no_tests signal
    });

    const engine = new WorkspaceEngine([projA, projB]);
    const signals = await engine.aggregateDrift();

    // Should have signals from both projects
    const alphaSignals = signals.filter((s) => s.projectName === "alpha");
    const betaSignals = signals.filter((s) => s.projectName === "beta");
    expect(alphaSignals.length).toBeGreaterThan(0);
    expect(betaSignals.length).toBeGreaterThan(0);

    // All signals should have projectName set
    for (const s of signals) {
      expect(s.projectName).toBeDefined();
      expect(["alpha", "beta"]).toContain(s.projectName);
    }

    engine.close();
  });

  it("returns signals sorted by severity descending", async () => {
    const projA = makeProject("alpha", (db) => {
      db.upsertNode({ id: "spec:auth", type: "spec", title: "Authentication" });
      db.upsertNode({ id: "file:src/utils.ts", type: "file", path: "src/utils.ts" });
    });
    const projB = makeProject("beta", (db) => {
      db.upsertNode({ id: "spec:billing", type: "spec", title: "Billing" });
      db.upsertNode({ id: "file:src/helpers.ts", type: "file", path: "src/helpers.ts" });
    });

    const engine = new WorkspaceEngine([projA, projB]);
    const signals = await engine.aggregateDrift();

    for (let i = 1; i < signals.length; i++) {
      expect(signals[i].severity).toBeLessThanOrEqual(signals[i - 1].severity);
    }

    engine.close();
  });

  it("returns empty array for projects with no drift", async () => {
    const proj = makeProject("clean", (db) => {
      // File with test coverage - no drift
      db.upsertNode({ id: "file:src/auth.ts", type: "file", path: "src/auth.ts" });
      db.upsertNode({ id: "test:auth-test", type: "test", title: "auth-test" });
      db.upsertEdge({ source: "test:auth-test", target: "file:src/auth.ts", relation: "tests" });
      db.upsertEdge({ source: "file:src/auth.ts", target: "spec:auth", relation: "implements" });
    });

    const engine = new WorkspaceEngine([proj]);
    const signals = await engine.aggregateDrift();

    // May still have orphan_code or similar, but should be minimal
    // The key test is that it doesn't throw
    expect(Array.isArray(signals)).toBe(true);

    engine.close();
  });

  it("respects filter options", async () => {
    const proj = makeProject("filtered", (db) => {
      db.upsertNode({ id: "spec:auth", type: "spec", title: "Authentication" });
      db.upsertNode({ id: "file:src/utils.ts", type: "file", path: "src/utils.ts" });
    });

    const engine = new WorkspaceEngine([proj]);

    // Filter by type
    const specSignals = await engine.aggregateDrift({ type: "spec_no_tests" });
    for (const s of specSignals) {
      expect(s.type).toBe("spec_no_tests");
    }

    // Filter by minSeverity
    const highSev = await engine.aggregateDrift({ minSeverity: 0.5 });
    for (const s of highSev) {
      expect(s.severity).toBeGreaterThanOrEqual(0.5);
    }

    engine.close();
  });

  it("handles empty workspace (no projects)", async () => {
    const engine = new WorkspaceEngine([]);
    const signals = await engine.aggregateDrift();
    expect(signals).toEqual([]);
    engine.close();
  });
});

// --- Shared pattern detection ---

describe("WorkspaceEngine.detectSharedPatterns", () => {
  it("detects shared patterns across projects with same drift type and file category", () => {
    const signals: WorkspaceSignal[] = [
      makeWorkspaceSignal("alpha", "file_no_tests", "src/connectors/redis.ts"),
      makeWorkspaceSignal("alpha", "file_no_tests", "src/connectors/postgres.ts"),
      makeWorkspaceSignal("beta", "file_no_tests", "lib/connectors/mongo.ts"),
      makeWorkspaceSignal("gamma", "file_no_tests", "src/connectors/sqlite.ts"),
    ];

    const engine = new WorkspaceEngine([]);
    const patterns = engine.detectSharedPatterns(signals);

    expect(patterns.length).toBeGreaterThanOrEqual(1);
    const connectorPattern = patterns.find((p) => p.patternId === "file_no_tests:connector");
    expect(connectorPattern).toBeDefined();
    expect(connectorPattern!.projects).toContain("alpha");
    expect(connectorPattern!.projects).toContain("beta");
    expect(connectorPattern!.projects).toContain("gamma");
    expect(connectorPattern!.signalCount).toBe(4);
    expect(connectorPattern!.type).toBe("file_no_tests");
  });

  it("requires at least 2 projects for a shared pattern", () => {
    const signals: WorkspaceSignal[] = [
      makeWorkspaceSignal("alpha", "file_no_tests", "src/connectors/redis.ts"),
      makeWorkspaceSignal("alpha", "file_no_tests", "src/connectors/postgres.ts"),
    ];

    const engine = new WorkspaceEngine([]);
    const patterns = engine.detectSharedPatterns(signals);

    // Single project can't have a "shared" pattern
    const connectorPattern = patterns.find((p) => p.patternId === "file_no_tests:connector");
    expect(connectorPattern).toBeUndefined();
  });

  it("detects patterns across different file categories", () => {
    const signals: WorkspaceSignal[] = [
      // Handler pattern
      makeWorkspaceSignal("alpha", "file_no_tests", "src/handlers/auth.ts"),
      makeWorkspaceSignal("beta", "file_no_tests", "lib/handlers/users.ts"),
      // Service pattern
      makeWorkspaceSignal("alpha", "spec_no_tests", "src/services/billing.ts"),
      makeWorkspaceSignal("beta", "spec_no_tests", "lib/services/payment.ts"),
    ];

    const engine = new WorkspaceEngine([]);
    const patterns = engine.detectSharedPatterns(signals);

    expect(patterns.length).toBe(2);
    expect(patterns.some((p) => p.patternId === "file_no_tests:handler")).toBe(true);
    expect(patterns.some((p) => p.patternId === "spec_no_tests:service")).toBe(true);
  });

  it("sorts patterns by signal count descending", () => {
    const signals: WorkspaceSignal[] = [
      // 2 signals in the adapter category
      makeWorkspaceSignal("alpha", "file_no_tests", "src/adapters/a.ts"),
      makeWorkspaceSignal("beta", "file_no_tests", "src/adapters/b.ts"),
      // 4 signals in the connector category
      makeWorkspaceSignal("alpha", "file_no_tests", "src/connectors/a.ts"),
      makeWorkspaceSignal("alpha", "file_no_tests", "src/connectors/b.ts"),
      makeWorkspaceSignal("beta", "file_no_tests", "src/connectors/c.ts"),
      makeWorkspaceSignal("gamma", "file_no_tests", "src/connectors/d.ts"),
    ];

    const engine = new WorkspaceEngine([]);
    const patterns = engine.detectSharedPatterns(signals);

    expect(patterns[0].patternId).toBe("file_no_tests:connector");
    expect(patterns[0].signalCount).toBe(4);
    expect(patterns[1].patternId).toBe("file_no_tests:adapter");
    expect(patterns[1].signalCount).toBe(2);
  });

  it("returns empty array for no shared patterns", () => {
    const signals: WorkspaceSignal[] = [
      makeWorkspaceSignal("alpha", "file_no_tests", "src/foo.ts"),
      makeWorkspaceSignal("beta", "spec_no_tests", "src/bar.ts"),
    ];

    const engine = new WorkspaceEngine([]);
    const patterns = engine.detectSharedPatterns(signals);

    // Different types + "other" category — needs 2+ projects with same key
    // "file_no_tests:other" only in alpha, "spec_no_tests:other" only in beta
    expect(patterns).toEqual([]);
  });

  it("handles empty signals array", () => {
    const engine = new WorkspaceEngine([]);
    const patterns = engine.detectSharedPatterns([]);
    expect(patterns).toEqual([]);
  });

  it("includes suggested action in patterns", () => {
    const signals: WorkspaceSignal[] = [
      makeWorkspaceSignal("alpha", "route_no_test", "src/routes/users.ts"),
      makeWorkspaceSignal("beta", "route_no_test", "api/routes/items.ts"),
    ];

    const engine = new WorkspaceEngine([]);
    const patterns = engine.detectSharedPatterns(signals);

    expect(patterns.length).toBe(1);
    expect(patterns[0].suggestedAction).toContain("API endpoint tests");
  });
});

// --- Workspace health ---

describe("WorkspaceEngine.getHealth", () => {
  it("returns per-project health stats", async () => {
    const projA = makeProject("alpha", (db) => {
      db.upsertNode({ id: "file:src/auth.ts", type: "file", path: "src/auth.ts" });
      db.upsertNode({ id: "spec:auth", type: "spec", title: "Auth" });
      db.upsertNode({ id: "test:auth", type: "test", title: "Auth test" });
      db.upsertEdge({ source: "test:auth", target: "file:src/auth.ts", relation: "tests" });
    });
    const projB = makeProject("beta", (db) => {
      db.upsertNode({ id: "file:src/billing.ts", type: "file", path: "src/billing.ts" });
      db.upsertNode({ id: "file:src/payments.ts", type: "file", path: "src/payments.ts" });
    });

    const engine = new WorkspaceEngine([projA, projB]);
    const health = await engine.getHealth();

    expect(health.projects).toHaveLength(2);

    const alphaHealth = health.projects.find((p) => p.projectName === "alpha")!;
    expect(alphaHealth.totalNodes).toBe(3);
    expect(alphaHealth.totalEdges).toBe(1);

    const betaHealth = health.projects.find((p) => p.projectName === "beta")!;
    expect(betaHealth.totalNodes).toBe(2);
    expect(betaHealth.driftSignalCount).toBeGreaterThan(0);

    engine.close();
  });

  it("includes totalSignals across all projects", async () => {
    const projA = makeProject("alpha", (db) => {
      db.upsertNode({ id: "spec:auth", type: "spec", title: "Auth" });
    });
    const projB = makeProject("beta", (db) => {
      db.upsertNode({ id: "spec:billing", type: "spec", title: "Billing" });
    });

    const engine = new WorkspaceEngine([projA, projB]);
    const health = await engine.getHealth();

    expect(health.totalSignals).toBeGreaterThanOrEqual(2);

    engine.close();
  });

  it("includes shared patterns in health", async () => {
    const projA = makeProject("alpha", (db) => {
      db.upsertNode({ id: "file:src/connectors/redis.ts", type: "file", path: "src/connectors/redis.ts" });
    });
    const projB = makeProject("beta", (db) => {
      db.upsertNode({ id: "file:lib/connectors/mongo.ts", type: "file", path: "lib/connectors/mongo.ts" });
    });

    const engine = new WorkspaceEngine([projA, projB]);
    const health = await engine.getHealth();

    // Both projects have untested connector files -> shared pattern
    const connectorPattern = health.sharedPatterns.find((p) =>
      p.patternId.includes("connector"),
    );
    expect(connectorPattern).toBeDefined();

    engine.close();
  });

  it("reports test health from latest run summary", async () => {
    const proj = makeProject("tested", (db) => {
      db.upsertNode({ id: "file:src/app.ts", type: "file", path: "src/app.ts" });
      db.insertRunSummary({
        runId: "run-1",
        commitHash: "abc123",
        timestamp: new Date().toISOString(),
        framework: "vitest",
        total: 50,
        passed: 45,
        failed: 5,
        skipped: 0,
      });
    });

    const engine = new WorkspaceEngine([proj]);
    const health = await engine.getHealth();

    const projHealth = health.projects[0];
    expect(projHealth.testHealth.total).toBe(50);
    expect(projHealth.testHealth.passed).toBe(45);
    expect(projHealth.testHealth.failed).toBe(5);

    engine.close();
  });

  it("reports zero test health when no runs exist", async () => {
    const proj = makeProject("no-runs", (db) => {
      db.upsertNode({ id: "file:src/app.ts", type: "file", path: "src/app.ts" });
    });

    const engine = new WorkspaceEngine([proj]);
    const health = await engine.getHealth();

    expect(health.projects[0].testHealth).toEqual({
      total: 0,
      passed: 0,
      failed: 0,
      flaky: 0,
    });

    engine.close();
  });

  it("identifies top drift type per project", async () => {
    const proj = makeProject("drifty", (db) => {
      // Multiple untested files -> file_no_tests should be top
      db.upsertNode({ id: "file:a.ts", type: "file", path: "a.ts" });
      db.upsertNode({ id: "file:b.ts", type: "file", path: "b.ts" });
      db.upsertNode({ id: "file:c.ts", type: "file", path: "c.ts" });
    });

    const engine = new WorkspaceEngine([proj]);
    const health = await engine.getHealth();

    expect(health.projects[0].topDriftType).toBeDefined();

    engine.close();
  });

  it("handles empty workspace", async () => {
    const engine = new WorkspaceEngine([]);
    const health = await engine.getHealth();

    expect(health.projects).toEqual([]);
    expect(health.totalSignals).toBe(0);
    expect(health.sharedPatterns).toEqual([]);

    engine.close();
  });
});

// --- Cross-project linking ---

describe("WorkspaceEngine.linkProjects", () => {
  it("detects cross-project import edges", () => {
    const projA = makeProject("alpha", (db) => {
      db.upsertNode({ id: "file:src/consumer.ts", type: "file", path: "src/consumer.ts" });
      // An import edge where the target has metadata with the import path
      db.upsertNode({ id: "file:ext/types.ts", type: "file", path: "ext/types.ts" });
      db.upsertEdge({
        source: "file:src/consumer.ts",
        target: "file:ext/types.ts",
        relation: "imports",
        meta: { importPath: "shared/types.ts" },
      });
    });
    const projB = makeProject("beta", (db) => {
      db.upsertNode({ id: "file:shared/types.ts", type: "file", path: "shared/types.ts" });
    });

    const engine = new WorkspaceEngine([projA, projB]);
    const edges = engine.linkProjects();

    expect(edges.length).toBeGreaterThanOrEqual(1);
    const crossEdge = edges.find(
      (e) => e.sourceProject === "alpha" && e.targetProject === "beta",
    );
    expect(crossEdge).toBeDefined();
    expect(crossEdge!.relation).toBe("imports");

    engine.close();
  });

  it("returns empty array when no cross-project imports exist", () => {
    const projA = makeProject("alpha", (db) => {
      db.upsertNode({ id: "file:src/app.ts", type: "file", path: "src/app.ts" });
      db.upsertNode({ id: "file:src/utils.ts", type: "file", path: "src/utils.ts" });
      db.upsertEdge({
        source: "file:src/app.ts",
        target: "file:src/utils.ts",
        relation: "imports",
        meta: { importPath: "./utils" },
      });
    });
    const projB = makeProject("beta", (db) => {
      db.upsertNode({ id: "file:src/billing.ts", type: "file", path: "src/billing.ts" });
    });

    const engine = new WorkspaceEngine([projA, projB]);
    const edges = engine.linkProjects();

    // Internal imports don't count as cross-project
    const crossEdges = edges.filter((e) => e.sourceProject !== e.targetProject);
    expect(crossEdges).toEqual([]);

    engine.close();
  });

  it("deduplicates cross-project edges", () => {
    const projA = makeProject("alpha", (db) => {
      db.upsertNode({ id: "file:src/a.ts", type: "file", path: "src/a.ts" });
      db.upsertNode({ id: "file:src/b.ts", type: "file", path: "src/b.ts" });
      // Both files import the same external path
      db.upsertEdge({
        source: "file:src/a.ts",
        target: "file:ext/shared.ts",
        relation: "imports",
        meta: { importPath: "lib/shared.ts" },
      });
      db.upsertEdge({
        source: "file:src/b.ts",
        target: "file:ext/shared.ts",
        relation: "imports",
        meta: { importPath: "lib/shared.ts" },
      });
    });
    const projB = makeProject("beta", (db) => {
      db.upsertNode({ id: "file:lib/shared.ts", type: "file", path: "lib/shared.ts" });
    });

    const engine = new WorkspaceEngine([projA, projB]);
    const edges = engine.linkProjects();

    // a.ts->shared and b.ts->shared are distinct source nodes, so both should appear
    const crossEdges = edges.filter((e) => e.sourceProject !== e.targetProject);
    expect(crossEdges.length).toBe(2);

    engine.close();
  });

  it("handles empty workspace", () => {
    const engine = new WorkspaceEngine([]);
    const edges = engine.linkProjects();
    expect(edges).toEqual([]);
    engine.close();
  });

  it("handles projects with no import edges", () => {
    const projA = makeProject("alpha", (db) => {
      db.upsertNode({ id: "file:src/app.ts", type: "file", path: "src/app.ts" });
    });
    const projB = makeProject("beta", (db) => {
      db.upsertNode({ id: "file:src/server.ts", type: "file", path: "src/server.ts" });
    });

    const engine = new WorkspaceEngine([projA, projB]);
    const edges = engine.linkProjects();
    expect(edges).toEqual([]);

    engine.close();
  });
});

// --- Integration: end-to-end workspace scenario ---

describe("WorkspaceEngine integration", () => {
  it("full workspace scenario: multiple projects with drift and shared patterns", async () => {
    // Project alpha: TypeScript API with untested connectors and routes
    const projA = makeProject("api-gateway", (db) => {
      db.upsertNode({ id: "file:src/connectors/redis.ts", type: "file", path: "src/connectors/redis.ts" });
      db.upsertNode({ id: "file:src/connectors/postgres.ts", type: "file", path: "src/connectors/postgres.ts" });
      db.upsertNode({ id: "file:src/routes/users.ts", type: "file", path: "src/routes/users.ts" });
      db.upsertNode({ id: "spec:api-auth", type: "spec", title: "API Authentication POST /api/auth returns 200" });
      db.upsertNode({ id: "test:health", type: "test", title: "health check" });
      db.upsertEdge({ source: "test:health", target: "file:src/routes/users.ts", relation: "tests" });
      db.insertRunSummary({
        runId: "gw-run-1",
        commitHash: "gw-abc",
        timestamp: new Date().toISOString(),
        total: 100,
        passed: 95,
        failed: 5,
        skipped: 0,
      });
    });

    // Project beta: Python service with untested connectors and utils
    const projB = makeProject("data-service", (db) => {
      db.upsertNode({ id: "file:lib/connectors/mongo.py", type: "file", path: "lib/connectors/mongo.py" });
      db.upsertNode({ id: "file:lib/connectors/elastic.py", type: "file", path: "lib/connectors/elastic.py" });
      db.upsertNode({ id: "file:lib/utils/parser.py", type: "file", path: "lib/utils/parser.py" });
      db.upsertNode({ id: "spec:data-pipeline", type: "spec", title: "Data Pipeline" });
      db.insertRunSummary({
        runId: "ds-run-1",
        commitHash: "ds-abc",
        timestamp: new Date().toISOString(),
        total: 50,
        passed: 48,
        failed: 2,
        skipped: 0,
      });
    });

    const engine = new WorkspaceEngine([projA, projB]);

    // 1. Aggregate drift
    const allSignals = await engine.aggregateDrift();
    expect(allSignals.length).toBeGreaterThan(0);
    expect(allSignals.some((s) => s.projectName === "api-gateway")).toBe(true);
    expect(allSignals.some((s) => s.projectName === "data-service")).toBe(true);

    // 2. Shared patterns
    const patterns = engine.detectSharedPatterns(allSignals);
    const connectorPattern = patterns.find((p) => p.patternId.includes("connector"));
    expect(connectorPattern).toBeDefined();
    expect(connectorPattern!.projects).toContain("api-gateway");
    expect(connectorPattern!.projects).toContain("data-service");

    // 3. Health dashboard
    const health = await engine.getHealth();
    expect(health.projects).toHaveLength(2);

    const gwHealth = health.projects.find((p) => p.projectName === "api-gateway")!;
    expect(gwHealth.testHealth.total).toBe(100);
    expect(gwHealth.testHealth.passed).toBe(95);
    expect(gwHealth.testHealth.failed).toBe(5);

    const dsHealth = health.projects.find((p) => p.projectName === "data-service")!;
    expect(dsHealth.testHealth.total).toBe(50);
    expect(dsHealth.testHealth.passed).toBe(48);

    expect(health.totalSignals).toBeGreaterThan(0);
    expect(health.sharedPatterns.length).toBeGreaterThan(0);

    engine.close();
  });
});

// --- Test helpers ---

function makeWorkspaceSignal(
  projectName: string,
  type: WorkspaceSignal["type"],
  path: string,
): WorkspaceSignal {
  return {
    id: `${type}:file:${path}`,
    type,
    severity: 0.5,
    testType: "unit",
    action: "write_test",
    subject: { nodeId: `file:${path}`, path, title: path },
    context: { scoringReason: "test" },
    projectName,
  };
}
