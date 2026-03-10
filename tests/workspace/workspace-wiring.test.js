"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
/**
 * Tests for WorkspaceEngine wiring into CLI, Station, and TUI.
 */
const vitest_1 = require("vitest");
const node_fs_1 = require("node:fs");
const node_path_1 = require("node:path");
const node_os_1 = require("node:os");
const context_graph_1 = require("@opcom/context-graph");
let contextDir;
(0, vitest_1.beforeEach)(() => {
    contextDir = (0, node_fs_1.mkdtempSync)((0, node_path_1.join)((0, node_os_1.tmpdir)(), "ws-wiring-"));
});
(0, vitest_1.afterEach)(() => {
    (0, node_fs_1.rmSync)(contextDir, { recursive: true, force: true });
});
/** Helper: create a project graph ref with some common nodes/edges. */
function makeProject(name, setup) {
    const db = new context_graph_1.GraphDatabase(name, contextDir);
    if (setup)
        setup(db);
    return { projectName: name, projectPath: `/projects/${name}`, db };
}
// --- WorkspaceHealthSummary type conformance ---
(0, vitest_1.describe)("WorkspaceHealthSummary type", () => {
    (0, vitest_1.it)("can be constructed from WorkspaceEngine.getHealth() output", async () => {
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
        const engine = new context_graph_1.WorkspaceEngine([projA, projB]);
        try {
            const health = await engine.getHealth();
            // Map to WorkspaceHealthSummary (same transformation as station does)
            const summary = {
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
            (0, vitest_1.expect)(summary.projects).toHaveLength(2);
            (0, vitest_1.expect)(summary.totalSignals).toBeGreaterThanOrEqual(0);
            (0, vitest_1.expect)(Array.isArray(summary.sharedPatterns)).toBe(true);
            const alpha = summary.projects.find((p) => p.projectName === "alpha");
            (0, vitest_1.expect)(alpha).toBeDefined();
            (0, vitest_1.expect)(alpha.totalNodes).toBe(2);
            const beta = summary.projects.find((p) => p.projectName === "beta");
            (0, vitest_1.expect)(beta).toBeDefined();
            (0, vitest_1.expect)(beta.testHealth.total).toBe(20);
            (0, vitest_1.expect)(beta.testHealth.passed).toBe(18);
            (0, vitest_1.expect)(beta.testHealth.failed).toBe(2);
        }
        finally {
            engine.close();
        }
    });
    (0, vitest_1.it)("produces empty summary for empty workspace", async () => {
        const engine = new context_graph_1.WorkspaceEngine([]);
        try {
            const health = await engine.getHealth();
            const summary = {
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
            (0, vitest_1.expect)(summary.projects).toEqual([]);
            (0, vitest_1.expect)(summary.totalSignals).toBe(0);
            (0, vitest_1.expect)(summary.sharedPatterns).toEqual([]);
        }
        finally {
            engine.close();
        }
    });
});
// --- Workspace health with shared patterns ---
(0, vitest_1.describe)("Workspace health with shared patterns", () => {
    (0, vitest_1.it)("produces shared patterns in the summary", async () => {
        // Two projects with untested connector files -> shared pattern
        const projA = makeProject("api", (db) => {
            db.upsertNode({ id: "file:src/connectors/redis.ts", type: "file", path: "src/connectors/redis.ts" });
            db.upsertNode({ id: "file:src/connectors/pg.ts", type: "file", path: "src/connectors/pg.ts" });
        });
        const projB = makeProject("worker", (db) => {
            db.upsertNode({ id: "file:lib/connectors/mongo.ts", type: "file", path: "lib/connectors/mongo.ts" });
        });
        const engine = new context_graph_1.WorkspaceEngine([projA, projB]);
        try {
            const health = await engine.getHealth();
            const summary = {
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
            const connectorPattern = summary.sharedPatterns.find((p) => p.patternId.includes("connector"));
            (0, vitest_1.expect)(connectorPattern).toBeDefined();
            (0, vitest_1.expect)(connectorPattern.projects).toContain("api");
            (0, vitest_1.expect)(connectorPattern.projects).toContain("worker");
            (0, vitest_1.expect)(connectorPattern.signalCount).toBeGreaterThanOrEqual(2);
        }
        finally {
            engine.close();
        }
    });
});
// --- TUI health view state ---
(0, vitest_1.describe)("HealthViewState with workspace health", () => {
    (0, vitest_1.it)("includes workspace health in state", () => {
        // Import the health view module
        const wsHealth = {
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
        (0, vitest_1.expect)(state.workspaceHealth).toBeDefined();
        (0, vitest_1.expect)(state.workspaceHealth.projects).toHaveLength(2);
        (0, vitest_1.expect)(state.workspaceHealth.totalSignals).toBe(3);
    });
});
// --- ServerEvent workspace_health type ---
(0, vitest_1.describe)("ServerEvent workspace_health", () => {
    (0, vitest_1.it)("can be serialized and deserialized", () => {
        const wsHealth = {
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
        const event = { type: "workspace_health", health: wsHealth };
        const serialized = JSON.stringify(event);
        const deserialized = JSON.parse(serialized);
        (0, vitest_1.expect)(deserialized.type).toBe("workspace_health");
        (0, vitest_1.expect)(deserialized.health.projects).toHaveLength(1);
        (0, vitest_1.expect)(deserialized.health.projects[0].projectName).toBe("test-proj");
        (0, vitest_1.expect)(deserialized.health.sharedPatterns).toHaveLength(1);
        (0, vitest_1.expect)(deserialized.health.sharedPatterns[0].patternId).toBe("file_no_tests:connector");
    });
});
// --- Workspace health project type ---
(0, vitest_1.describe)("WorkspaceHealthProject", () => {
    (0, vitest_1.it)("includes all required fields", () => {
        const project = {
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
        (0, vitest_1.expect)(project.projectName).toBe("my-project");
        (0, vitest_1.expect)(project.totalNodes).toBe(150);
        (0, vitest_1.expect)(project.testHealth.flaky).toBe(2);
        (0, vitest_1.expect)(project.topDriftType).toBe("churn_untested");
    });
    (0, vitest_1.it)("allows null topDriftType", () => {
        const project = {
            projectName: "clean-project",
            totalNodes: 50,
            totalEdges: 20,
            driftSignalCount: 0,
            topDriftType: null,
            testHealth: { total: 0, passed: 0, failed: 0, flaky: 0 },
        };
        (0, vitest_1.expect)(project.topDriftType).toBeNull();
        (0, vitest_1.expect)(project.driftSignalCount).toBe(0);
    });
});
//# sourceMappingURL=workspace-wiring.test.js.map