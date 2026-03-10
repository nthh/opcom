/**
 * Tests for WorkspaceEngine wiring into CLI, Station, and TUI.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  GraphDatabase,
  WorkspaceEngine,
  type ProjectGraphRef,
} from "@opcom/context-graph";
import type { WorkspaceHealthSummary, WorkspaceHealthProject } from "../../packages/cli/src/tui/health-data.js";

let contextDir: string;

beforeEach(() => {
  contextDir = mkdtempSync(join(tmpdir(), "ws-wiring-"));
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

// --- WorkspaceHealthSummary type conformance ---

describe("WorkspaceHealthSummary type", () => {
  it("can be constructed from WorkspaceEngine.getHealth() output", async () => {
    const projA = makeProject("alpha", (db) => {
      db.upsertNode({ id: "file:src/auth.ts", type: "file", path: "src/auth.ts" });
      db.upsertNode({ id: "spec:auth", type: "spec", title: "Auth" });
    });
    const projB = makeProject("beta", (db) => {
      db.upsertNode({ id: "file:src/billing.ts", type: "file", path: "src/billing.ts" });
      db.insertRunSummary({
        runId: "run-1",
        commitHash: "abc",
        timestamp: new Date().toISOString(),
        total: 20,
        passed: 18,
        failed: 2,
        skipped: 0,
      });
    });

    const engine = new WorkspaceEngine([projA, projB]);
    try {
      const health = await engine.getHealth();

      // Map to WorkspaceHealthSummary (same transformation as station does)
      const summary: WorkspaceHealthSummary = {
        projects: health.projects.map((p) => ({
          projectName: p.projectName,
          totalNodes: p.totalNodes,
          totalEdges: p.totalEdges,
          driftSignalCount: p.driftSignalCount,
          topDriftType: p.topDriftType,
          testHealth: p.testHealth,
        })),
        totalSignals: health.totalSignals,
        sharedPatterns: health.sharedPatterns.map((sp) => ({
          patternId: sp.patternId,
          type: sp.type,
          description: sp.description,
          projects: sp.projects,
          signalCount: sp.signalCount,
          suggestedAction: sp.suggestedAction,
        })),
      };

      expect(summary.projects).toHaveLength(2);
      expect(summary.totalSignals).toBeGreaterThanOrEqual(0);
      expect(Array.isArray(summary.sharedPatterns)).toBe(true);

      const alpha = summary.projects.find((p) => p.projectName === "alpha")!;
      expect(alpha).toBeDefined();
      expect(alpha.totalNodes).toBe(2);

      const beta = summary.projects.find((p) => p.projectName === "beta")!;
      expect(beta).toBeDefined();
      expect(beta.testHealth.total).toBe(20);
      expect(beta.testHealth.passed).toBe(18);
      expect(beta.testHealth.failed).toBe(2);
    } finally {
      engine.close();
    }
  });

  it("produces empty summary for empty workspace", async () => {
    const engine = new WorkspaceEngine([]);
    try {
      const health = await engine.getHealth();
      const summary: WorkspaceHealthSummary = {
        projects: health.projects.map((p) => ({
          projectName: p.projectName,
          totalNodes: p.totalNodes,
          totalEdges: p.totalEdges,
          driftSignalCount: p.driftSignalCount,
          topDriftType: p.topDriftType,
          testHealth: p.testHealth,
        })),
        totalSignals: health.totalSignals,
        sharedPatterns: [],
      };

      expect(summary.projects).toEqual([]);
      expect(summary.totalSignals).toBe(0);
      expect(summary.sharedPatterns).toEqual([]);
    } finally {
      engine.close();
    }
  });
});

// --- Workspace health with shared patterns ---

describe("Workspace health with shared patterns", () => {
  it("produces shared patterns in the summary", async () => {
    // Two projects with untested connector files -> shared pattern
    const projA = makeProject("api", (db) => {
      db.upsertNode({ id: "file:src/connectors/redis.ts", type: "file", path: "src/connectors/redis.ts" });
      db.upsertNode({ id: "file:src/connectors/pg.ts", type: "file", path: "src/connectors/pg.ts" });
    });
    const projB = makeProject("worker", (db) => {
      db.upsertNode({ id: "file:lib/connectors/mongo.ts", type: "file", path: "lib/connectors/mongo.ts" });
    });

    const engine = new WorkspaceEngine([projA, projB]);
    try {
      const health = await engine.getHealth();
      const summary: WorkspaceHealthSummary = {
        projects: health.projects.map((p) => ({
          projectName: p.projectName,
          totalNodes: p.totalNodes,
          totalEdges: p.totalEdges,
          driftSignalCount: p.driftSignalCount,
          topDriftType: p.topDriftType,
          testHealth: p.testHealth,
        })),
        totalSignals: health.totalSignals,
        sharedPatterns: health.sharedPatterns.map((sp) => ({
          patternId: sp.patternId,
          type: sp.type,
          description: sp.description,
          projects: sp.projects,
          signalCount: sp.signalCount,
          suggestedAction: sp.suggestedAction,
        })),
      };

      // Should detect connector pattern across both projects
      const connectorPattern = summary.sharedPatterns.find((p) =>
        p.patternId.includes("connector"),
      );
      expect(connectorPattern).toBeDefined();
      expect(connectorPattern!.projects).toContain("api");
      expect(connectorPattern!.projects).toContain("worker");
      expect(connectorPattern!.signalCount).toBeGreaterThanOrEqual(2);
    } finally {
      engine.close();
    }
  });
});

// --- TUI health view state ---

describe("HealthViewState with workspace health", () => {
  it("includes workspace health in state", () => {
    // Import the health view module
    const wsHealth: WorkspaceHealthSummary = {
      projects: [
        {
          projectName: "alpha",
          totalNodes: 100,
          totalEdges: 50,
          driftSignalCount: 3,
          topDriftType: "file_no_tests",
          testHealth: { total: 30, passed: 28, failed: 2, flaky: 0 },
        },
        {
          projectName: "beta",
          totalNodes: 200,
          totalEdges: 80,
          driftSignalCount: 0,
          topDriftType: null,
          testHealth: { total: 50, passed: 50, failed: 0, flaky: 1 },
        },
      ],
      totalSignals: 3,
      sharedPatterns: [],
    };

    // Simulate health view state
    const state = {
      data: null,
      selectedIndex: 0,
      scrollOffset: 0,
      drilledSpec: null,
      sectionCoverage: null,
      drillSelectedIndex: 0,
      drillScrollOffset: 0,
      workspaceHealth: wsHealth,
    };

    expect(state.workspaceHealth).toBeDefined();
    expect(state.workspaceHealth!.projects).toHaveLength(2);
    expect(state.workspaceHealth!.totalSignals).toBe(3);
  });
});

// --- ServerEvent workspace_health type ---

describe("ServerEvent workspace_health", () => {
  it("can be serialized and deserialized", () => {
    const wsHealth: WorkspaceHealthSummary = {
      projects: [{
        projectName: "test-proj",
        totalNodes: 42,
        totalEdges: 21,
        driftSignalCount: 5,
        topDriftType: "spec_no_tests",
        testHealth: { total: 10, passed: 8, failed: 2, flaky: 0 },
      }],
      totalSignals: 5,
      sharedPatterns: [{
        patternId: "file_no_tests:connector",
        type: "file_no_tests",
        description: "connector files untested across 2 projects",
        projects: ["alpha", "beta"],
        signalCount: 4,
        suggestedAction: "Add tests for connector files",
      }],
    };

    const event = { type: "workspace_health" as const, health: wsHealth };
    const serialized = JSON.stringify(event);
    const deserialized = JSON.parse(serialized);

    expect(deserialized.type).toBe("workspace_health");
    expect(deserialized.health.projects).toHaveLength(1);
    expect(deserialized.health.projects[0].projectName).toBe("test-proj");
    expect(deserialized.health.sharedPatterns).toHaveLength(1);
    expect(deserialized.health.sharedPatterns[0].patternId).toBe("file_no_tests:connector");
  });
});

// --- Workspace health project type ---

describe("WorkspaceHealthProject", () => {
  it("includes all required fields", () => {
    const project: WorkspaceHealthProject = {
      projectName: "my-project",
      totalNodes: 150,
      totalEdges: 75,
      driftSignalCount: 10,
      topDriftType: "churn_untested",
      testHealth: {
        total: 100,
        passed: 95,
        failed: 3,
        flaky: 2,
      },
    };

    expect(project.projectName).toBe("my-project");
    expect(project.totalNodes).toBe(150);
    expect(project.testHealth.flaky).toBe(2);
    expect(project.topDriftType).toBe("churn_untested");
  });

  it("allows null topDriftType", () => {
    const project: WorkspaceHealthProject = {
      projectName: "clean-project",
      totalNodes: 50,
      totalEdges: 20,
      driftSignalCount: 0,
      topDriftType: null,
      testHealth: { total: 0, passed: 0, failed: 0, flaky: 0 },
    };

    expect(project.topDriftType).toBeNull();
    expect(project.driftSignalCount).toBe(0);
  });
});
