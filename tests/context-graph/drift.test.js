"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const node_fs_1 = require("node:fs");
const node_path_1 = require("node:path");
const node_os_1 = require("node:os");
const node_child_process_1 = require("node:child_process");
const context_graph_1 = require("@opcom/context-graph");
let contextDir;
(0, vitest_1.beforeEach)(() => {
    contextDir = (0, node_fs_1.mkdtempSync)((0, node_path_1.join)((0, node_os_1.tmpdir)(), "cg-drift-ctx-"));
});
(0, vitest_1.afterEach)(() => {
    (0, node_fs_1.rmSync)(contextDir, { recursive: true, force: true });
});
// --- Heuristic detection tests ---
(0, vitest_1.describe)("UI behavior heuristics", () => {
    (0, vitest_1.it)("detects UI keywords in content", () => {
        (0, vitest_1.expect)((0, context_graph_1.hasUiBehavior)("User can click the button to submit the form", "")).toBe(true);
        (0, vitest_1.expect)((0, context_graph_1.hasUiBehavior)("Toggle the sidebar panel", "")).toBe(true);
        (0, vitest_1.expect)((0, context_graph_1.hasUiBehavior)("Navigate to the modal dialog", "")).toBe(true);
    });
    (0, vitest_1.it)("requires at least 2 keyword matches", () => {
        (0, vitest_1.expect)((0, context_graph_1.hasUiBehavior)("The button is blue", "")).toBe(false);
        (0, vitest_1.expect)((0, context_graph_1.hasUiBehavior)("No UI keywords here", "")).toBe(false);
    });
    (0, vitest_1.it)("detects UI heading keywords", () => {
        (0, vitest_1.expect)((0, context_graph_1.hasUiBehavior)("Some content", "UI Components")).toBe(true);
        (0, vitest_1.expect)((0, context_graph_1.hasUiBehavior)("Some content", "User Flow")).toBe(true);
        (0, vitest_1.expect)((0, context_graph_1.hasUiBehavior)("Some content", "Interface Design")).toBe(true);
        (0, vitest_1.expect)((0, context_graph_1.hasUiBehavior)("Some content", "Interaction Patterns")).toBe(true);
        (0, vitest_1.expect)((0, context_graph_1.hasUiBehavior)("Some content", "Workbench Layout")).toBe(true);
    });
    (0, vitest_1.it)("is case-insensitive", () => {
        (0, vitest_1.expect)((0, context_graph_1.hasUiBehavior)("CLICK the BUTTON to NAVIGATE", "")).toBe(true);
        (0, vitest_1.expect)((0, context_graph_1.hasUiBehavior)("content", "UI COMPONENTS")).toBe(true);
    });
});
(0, vitest_1.describe)("API behavior heuristics", () => {
    (0, vitest_1.it)("detects API patterns (method + URL)", () => {
        (0, vitest_1.expect)((0, context_graph_1.hasApiBehavior)("POST /api/users creates a new user")).toBe(true);
        (0, vitest_1.expect)((0, context_graph_1.hasApiBehavior)("GET /v1/items returns a list")).toBe(true);
    });
    (0, vitest_1.it)("detects API patterns (method + status code)", () => {
        (0, vitest_1.expect)((0, context_graph_1.hasApiBehavior)("DELETE returns 200 on success")).toBe(true);
        (0, vitest_1.expect)((0, context_graph_1.hasApiBehavior)("POST should return 201 on creation")).toBe(true);
    });
    (0, vitest_1.it)("detects API patterns (URL + status code)", () => {
        (0, vitest_1.expect)((0, context_graph_1.hasApiBehavior)("The /api/auth endpoint returns 401 for invalid tokens")).toBe(true);
    });
    (0, vitest_1.it)("requires at least 2 indicators", () => {
        (0, vitest_1.expect)((0, context_graph_1.hasApiBehavior)("Just a regular function")).toBe(false);
        (0, vitest_1.expect)((0, context_graph_1.hasApiBehavior)("GET some data")).toBe(false); // Only method, no URL or status
    });
});
(0, vitest_1.describe)("interaction handler detection", () => {
    (0, vitest_1.it)("detects React handlers", () => {
        (0, vitest_1.expect)((0, context_graph_1.hasInteractionHandlers)('<button onClick={handleClick}>Submit</button>')).toBe(true);
        (0, vitest_1.expect)((0, context_graph_1.hasInteractionHandlers)('<form onSubmit={handleSubmit}>')).toBe(true);
        (0, vitest_1.expect)((0, context_graph_1.hasInteractionHandlers)('<input onChange={handleChange} />')).toBe(true);
    });
    (0, vitest_1.it)("detects Vue handlers", () => {
        (0, vitest_1.expect)((0, context_graph_1.hasInteractionHandlers)('<button @click="handleClick">Submit</button>')).toBe(true);
        (0, vitest_1.expect)((0, context_graph_1.hasInteractionHandlers)('<form @submit="handleSubmit">')).toBe(true);
        (0, vitest_1.expect)((0, context_graph_1.hasInteractionHandlers)('<div v-on:click="handle">')).toBe(true);
    });
    (0, vitest_1.it)("detects Svelte handlers", () => {
        (0, vitest_1.expect)((0, context_graph_1.hasInteractionHandlers)('<button on:click={handleClick}>Submit</button>')).toBe(true);
    });
    (0, vitest_1.it)("returns false for no handlers", () => {
        (0, vitest_1.expect)((0, context_graph_1.hasInteractionHandlers)("const x = 42;")).toBe(false);
        (0, vitest_1.expect)((0, context_graph_1.hasInteractionHandlers)("export function helper() {}")).toBe(false);
    });
});
(0, vitest_1.describe)("route file detection", () => {
    (0, vitest_1.it)("detects files in route directories", () => {
        (0, vitest_1.expect)((0, context_graph_1.isRouteFile)("src/routes/users.ts")).toBe(true);
        (0, vitest_1.expect)((0, context_graph_1.isRouteFile)("src/api/auth.ts")).toBe(true);
        (0, vitest_1.expect)((0, context_graph_1.isRouteFile)("server/handlers/items.py")).toBe(true);
        (0, vitest_1.expect)((0, context_graph_1.isRouteFile)("src/endpoints/health.ts")).toBe(true);
    });
    (0, vitest_1.it)("detects route files from metadata", () => {
        (0, vitest_1.expect)((0, context_graph_1.isRouteFile)("src/users.ts", { hasRoutes: true })).toBe(true);
    });
    (0, vitest_1.it)("returns false for non-route files", () => {
        (0, vitest_1.expect)((0, context_graph_1.isRouteFile)("src/utils/helper.ts")).toBe(false);
        (0, vitest_1.expect)((0, context_graph_1.isRouteFile)("src/models/user.ts")).toBe(false);
    });
});
// --- Signal detection tests ---
(0, vitest_1.describe)("spec_no_tests signal", () => {
    (0, vitest_1.it)("detects specs without test coverage", async () => {
        const db = new context_graph_1.GraphDatabase("drift-spec-test", contextDir);
        db.upsertNode({ id: "spec:auth", type: "spec", title: "Authentication" });
        db.upsertNode({ id: "spec:billing", type: "spec", title: "Billing" });
        // billing has a test
        db.upsertNode({ id: "test:billing-test", type: "test", title: "billing-test" });
        db.upsertEdge({ source: "test:billing-test", target: "spec:billing", relation: "asserts" });
        const engine = new context_graph_1.DriftEngine(db);
        const signals = await engine.detect();
        const specSignals = signals.filter((s) => s.type === "spec_no_tests");
        (0, vitest_1.expect)(specSignals).toHaveLength(1);
        (0, vitest_1.expect)(specSignals[0].subject.nodeId).toBe("spec:auth");
        (0, vitest_1.expect)(specSignals[0].action).toBe("write_test");
        db.close();
    });
});
(0, vitest_1.describe)("file_no_tests signal", () => {
    (0, vitest_1.it)("detects source files without test coverage", async () => {
        const db = new context_graph_1.GraphDatabase("drift-file-test", contextDir);
        db.upsertNode({ id: "file:src/utils.ts", type: "file", path: "src/utils.ts" });
        db.upsertNode({ id: "file:src/auth.ts", type: "file", path: "src/auth.ts" });
        // auth has a test
        db.upsertNode({ id: "test:auth-test", type: "test", title: "auth-test" });
        db.upsertEdge({ source: "test:auth-test", target: "file:src/auth.ts", relation: "tests" });
        const engine = new context_graph_1.DriftEngine(db);
        const signals = await engine.detect();
        const fileSignals = signals.filter((s) => s.type === "file_no_tests");
        (0, vitest_1.expect)(fileSignals).toHaveLength(1);
        (0, vitest_1.expect)(fileSignals[0].subject.path).toBe("src/utils.ts");
        db.close();
    });
    (0, vitest_1.it)("excludes test files from detection", async () => {
        const db = new context_graph_1.GraphDatabase("drift-file-exclude", contextDir);
        db.upsertNode({ id: "file:src/utils.test.ts", type: "file", path: "src/utils.test.ts" });
        db.upsertNode({ id: "file:src/utils.spec.ts", type: "file", path: "src/utils.spec.ts" });
        const engine = new context_graph_1.DriftEngine(db);
        const signals = await engine.detect();
        const fileSignals = signals.filter((s) => s.type === "file_no_tests");
        (0, vitest_1.expect)(fileSignals).toHaveLength(0);
        db.close();
    });
});
(0, vitest_1.describe)("orphan_code signal", () => {
    (0, vitest_1.it)("detects files not referenced by specs or tickets", async () => {
        const db = new context_graph_1.GraphDatabase("drift-orphan-test", contextDir);
        db.upsertNode({ id: "file:src/orphan.ts", type: "file", path: "src/orphan.ts" });
        db.upsertNode({ id: "file:src/linked.ts", type: "file", path: "src/linked.ts" });
        db.upsertEdge({ source: "file:src/linked.ts", target: "spec:feature", relation: "implements" });
        const engine = new context_graph_1.DriftEngine(db);
        const signals = await engine.detect();
        const orphanSignals = signals.filter((s) => s.type === "orphan_code");
        (0, vitest_1.expect)(orphanSignals.some((s) => s.subject.path === "src/orphan.ts")).toBe(true);
        (0, vitest_1.expect)(orphanSignals.some((s) => s.subject.path === "src/linked.ts")).toBe(false);
        db.close();
    });
});
(0, vitest_1.describe)("ticket_no_spec signal", () => {
    (0, vitest_1.it)("detects tickets without spec linkage", async () => {
        const db = new context_graph_1.GraphDatabase("drift-ticket-test", contextDir);
        db.upsertNode({ id: "ticket:123", type: "ticket", title: "Fix auth bug" });
        db.upsertNode({ id: "ticket:456", type: "ticket", title: "Add billing" });
        db.upsertEdge({ source: "ticket:456", target: "spec:billing", relation: "links_to" });
        const engine = new context_graph_1.DriftEngine(db);
        const signals = await engine.detect();
        const ticketSignals = signals.filter((s) => s.type === "ticket_no_spec");
        (0, vitest_1.expect)(ticketSignals).toHaveLength(1);
        (0, vitest_1.expect)(ticketSignals[0].subject.nodeId).toBe("ticket:123");
        (0, vitest_1.expect)(ticketSignals[0].action).toBe("update_spec");
        db.close();
    });
});
(0, vitest_1.describe)("test_regression signal", () => {
    (0, vitest_1.it)("detects tests that started failing", async () => {
        const db = new context_graph_1.GraphDatabase("drift-regression-test", contextDir);
        db.upsertNode({ id: "test:auth-login", type: "test", title: "auth-login" });
        // Run 1: passing
        db.ingestTestRun([{ testId: "test:auth-login", commitHash: "aaa", runId: "run-1", status: "pass", timestamp: "2026-03-01T00:00:00Z" }], { runId: "run-1", commitHash: "aaa", timestamp: "2026-03-01T00:00:00Z", total: 1, passed: 1, failed: 0, skipped: 0 });
        // Run 2: failing
        db.ingestTestRun([{ testId: "test:auth-login", commitHash: "bbb", runId: "run-2", status: "fail", errorMsg: "Expected 200 got 500", timestamp: "2026-03-02T00:00:00Z" }], { runId: "run-2", commitHash: "bbb", timestamp: "2026-03-02T00:00:00Z", total: 1, passed: 0, failed: 1, skipped: 0 });
        const engine = new context_graph_1.DriftEngine(db);
        const signals = await engine.detect();
        const regressions = signals.filter((s) => s.type === "test_regression");
        (0, vitest_1.expect)(regressions).toHaveLength(1);
        (0, vitest_1.expect)(regressions[0].subject.nodeId).toBe("test:auth-login");
        (0, vitest_1.expect)(regressions[0].action).toBe("fix_test");
        db.close();
    });
    (0, vitest_1.it)("does not flag tests that were already failing", async () => {
        const db = new context_graph_1.GraphDatabase("drift-regression-noop", contextDir);
        // Both runs failing
        db.ingestTestRun([{ testId: "test:broken", commitHash: "aaa", runId: "run-1", status: "fail", timestamp: "2026-03-01T00:00:00Z" }], { runId: "run-1", commitHash: "aaa", timestamp: "2026-03-01T00:00:00Z", total: 1, passed: 0, failed: 1, skipped: 0 });
        db.ingestTestRun([{ testId: "test:broken", commitHash: "bbb", runId: "run-2", status: "fail", timestamp: "2026-03-02T00:00:00Z" }], { runId: "run-2", commitHash: "bbb", timestamp: "2026-03-02T00:00:00Z", total: 1, passed: 0, failed: 1, skipped: 0 });
        const engine = new context_graph_1.DriftEngine(db);
        const signals = await engine.detect();
        const regressions = signals.filter((s) => s.type === "test_regression");
        (0, vitest_1.expect)(regressions).toHaveLength(0);
        db.close();
    });
});
(0, vitest_1.describe)("flaky_test signal", () => {
    (0, vitest_1.it)("detects tests with alternating pass/fail", async () => {
        const db = new context_graph_1.GraphDatabase("drift-flaky-test", contextDir);
        const now = new Date();
        // Create alternating results within the last 30 days
        for (let i = 0; i < 6; i++) {
            const ts = new Date(now.getTime() - i * 24 * 60 * 60 * 1000).toISOString();
            const status = i % 2 === 0 ? "pass" : "fail";
            db.insertTestResult({
                testId: "test:flaky-one",
                commitHash: `hash${i}`,
                runId: `run-${i}`,
                status: status,
                timestamp: ts,
            });
            db.insertRunSummary({
                runId: `run-${i}`,
                commitHash: `hash${i}`,
                timestamp: ts,
                total: 1,
                passed: status === "pass" ? 1 : 0,
                failed: status === "fail" ? 1 : 0,
                skipped: 0,
            });
        }
        const engine = new context_graph_1.DriftEngine(db);
        const signals = await engine.detect();
        const flaky = signals.filter((s) => s.type === "flaky_test");
        (0, vitest_1.expect)(flaky).toHaveLength(1);
        (0, vitest_1.expect)(flaky[0].subject.nodeId).toBe("test:flaky-one");
        (0, vitest_1.expect)(flaky[0].action).toBe("fix_test");
        db.close();
    });
});
(0, vitest_1.describe)("stale_assertion signal", () => {
    (0, vitest_1.it)("detects tests that are older than the spec they assert", async () => {
        const db = new context_graph_1.GraphDatabase("drift-stale-test", contextDir);
        // Insert spec with recent last_seen by upserting twice with time gap
        db.upsertNode({ id: "spec:auth", type: "spec", title: "Auth" });
        // Insert test with older last_seen
        db.upsertNode({ id: "test:auth-test", type: "test", title: "auth-test", path: "tests/auth.test.ts" });
        db.upsertEdge({ source: "test:auth-test", target: "spec:auth", relation: "asserts" });
        // Force last_seen values via raw SQL (use the underlying exec method)
        // We need to get direct DB access, so we use a workaround:
        // Re-open the database and run the UPDATE directly
        const Database = (await import("better-sqlite3")).default;
        const rawDb = new Database(db.dbPath);
        rawDb.exec("UPDATE nodes SET last_seen = '2026-03-05T00:00:00Z' WHERE id = 'spec:auth'");
        rawDb.exec("UPDATE nodes SET last_seen = '2026-02-01T00:00:00Z' WHERE id = 'test:auth-test'");
        rawDb.close();
        const engine = new context_graph_1.DriftEngine(db);
        const signals = await engine.detect();
        const stale = signals.filter((s) => s.type === "stale_assertion");
        (0, vitest_1.expect)(stale).toHaveLength(1);
        (0, vitest_1.expect)(stale[0].subject.nodeId).toBe("test:auth-test");
        (0, vitest_1.expect)(stale[0].action).toBe("update_test");
        db.close();
    });
});
(0, vitest_1.describe)("coupling_gap signal", () => {
    (0, vitest_1.it)("detects co-changing files without shared tests", async () => {
        const projectDir = (0, node_fs_1.mkdtempSync)((0, node_path_1.join)((0, node_os_1.tmpdir)(), "cg-drift-coupling-"));
        try {
            (0, node_child_process_1.execSync)("git init", { cwd: projectDir });
            (0, node_child_process_1.execSync)("git config user.email 'test@test.com'", { cwd: projectDir });
            (0, node_child_process_1.execSync)("git config user.name 'Test'", { cwd: projectDir });
            (0, node_fs_1.writeFileSync)((0, node_path_1.join)(projectDir, "a.ts"), "v1");
            (0, node_fs_1.writeFileSync)((0, node_path_1.join)(projectDir, "b.ts"), "v1");
            (0, node_child_process_1.execSync)("git add -A && git commit -m 'init'", { cwd: projectDir });
            for (let i = 2; i <= 4; i++) {
                (0, node_fs_1.writeFileSync)((0, node_path_1.join)(projectDir, "a.ts"), `v${i}`);
                (0, node_fs_1.writeFileSync)((0, node_path_1.join)(projectDir, "b.ts"), `v${i}`);
                (0, node_child_process_1.execSync)(`git add -A && git commit -m 'change ${i}'`, { cwd: projectDir });
            }
            const builder = new context_graph_1.GraphBuilder("test", projectDir, contextDir);
            await builder.replay();
            const db = builder.getDb();
            const engine = new context_graph_1.DriftEngine(db);
            const signals = await engine.detect();
            const gaps = signals.filter((s) => s.type === "coupling_gap");
            (0, vitest_1.expect)(gaps.length).toBeGreaterThanOrEqual(1);
            (0, vitest_1.expect)(gaps[0].testType).toBe("integration");
            (0, vitest_1.expect)(gaps[0].action).toBe("write_test");
            builder.close();
        }
        finally {
            (0, node_fs_1.rmSync)(projectDir, { recursive: true, force: true });
        }
    });
});
(0, vitest_1.describe)("churn_untested signal", () => {
    (0, vitest_1.it)("detects high-churn files with no test coverage", async () => {
        const projectDir = (0, node_fs_1.mkdtempSync)((0, node_path_1.join)((0, node_os_1.tmpdir)(), "cg-drift-churn-"));
        try {
            (0, node_child_process_1.execSync)("git init", { cwd: projectDir });
            (0, node_child_process_1.execSync)("git config user.email 'test@test.com'", { cwd: projectDir });
            (0, node_child_process_1.execSync)("git config user.name 'Test'", { cwd: projectDir });
            (0, node_fs_1.writeFileSync)((0, node_path_1.join)(projectDir, "hot.ts"), "v1");
            (0, node_child_process_1.execSync)("git add -A && git commit -m 'init'", { cwd: projectDir });
            for (let i = 2; i <= 5; i++) {
                (0, node_fs_1.writeFileSync)((0, node_path_1.join)(projectDir, "hot.ts"), `v${i}`);
                (0, node_child_process_1.execSync)(`git add -A && git commit -m 'change ${i}'`, { cwd: projectDir });
            }
            const builder = new context_graph_1.GraphBuilder("test", projectDir, contextDir);
            await builder.replay();
            const db = builder.getDb();
            const engine = new context_graph_1.DriftEngine(db);
            const signals = await engine.detect();
            const churn = signals.filter((s) => s.type === "churn_untested");
            (0, vitest_1.expect)(churn.length).toBeGreaterThanOrEqual(1);
            (0, vitest_1.expect)(churn[0].action).toBe("write_test");
            (0, vitest_1.expect)(churn[0].testType).toBe("unit");
            builder.close();
        }
        finally {
            (0, node_fs_1.rmSync)(projectDir, { recursive: true, force: true });
        }
    });
});
(0, vitest_1.describe)("ui_spec_no_e2e signal", () => {
    (0, vitest_1.it)("detects specs with UI behavior but no e2e test", async () => {
        const db = new context_graph_1.GraphDatabase("drift-ui-spec", contextDir);
        db.upsertNode({
            id: "spec:dashboard",
            type: "spec",
            title: "Dashboard UI Components",
            meta: { content: "Users click the button to toggle the sidebar panel" },
        });
        const engine = new context_graph_1.DriftEngine(db);
        const signals = await engine.detect();
        const uiSignals = signals.filter((s) => s.type === "ui_spec_no_e2e");
        (0, vitest_1.expect)(uiSignals).toHaveLength(1);
        (0, vitest_1.expect)(uiSignals[0].testType).toBe("e2e");
        (0, vitest_1.expect)(uiSignals[0].action).toBe("write_test");
        db.close();
    });
    (0, vitest_1.it)("does not flag specs with existing e2e tests", async () => {
        const db = new context_graph_1.GraphDatabase("drift-ui-spec-covered", contextDir);
        db.upsertNode({
            id: "spec:dashboard",
            type: "spec",
            title: "Dashboard UI",
            meta: { content: "Users click the button to toggle sidebar" },
        });
        db.upsertNode({ id: "test:e2e-dashboard", type: "test", title: "e2e-dashboard", path: "e2e/dashboard.spec.ts" });
        db.upsertEdge({ source: "test:e2e-dashboard", target: "spec:dashboard", relation: "asserts" });
        const engine = new context_graph_1.DriftEngine(db);
        const signals = await engine.detect();
        const uiSignals = signals.filter((s) => s.type === "ui_spec_no_e2e");
        (0, vitest_1.expect)(uiSignals).toHaveLength(0);
        db.close();
    });
});
(0, vitest_1.describe)("component_no_e2e signal", () => {
    (0, vitest_1.it)("detects component files with interaction handlers but no e2e test", async () => {
        const db = new context_graph_1.GraphDatabase("drift-component", contextDir);
        db.upsertNode({
            id: "file:src/Button.tsx",
            type: "file",
            path: "src/Button.tsx",
            title: "Button",
            meta: { hasInteractions: true },
        });
        const engine = new context_graph_1.DriftEngine(db);
        const signals = await engine.detect();
        const compSignals = signals.filter((s) => s.type === "component_no_e2e");
        (0, vitest_1.expect)(compSignals).toHaveLength(1);
        (0, vitest_1.expect)(compSignals[0].testType).toBe("e2e");
        db.close();
    });
    (0, vitest_1.it)("ignores non-component files", async () => {
        const db = new context_graph_1.GraphDatabase("drift-component-skip", contextDir);
        db.upsertNode({
            id: "file:src/utils.ts",
            type: "file",
            path: "src/utils.ts",
            meta: { hasInteractions: true },
        });
        const engine = new context_graph_1.DriftEngine(db);
        const signals = await engine.detect();
        const compSignals = signals.filter((s) => s.type === "component_no_e2e");
        (0, vitest_1.expect)(compSignals).toHaveLength(0);
        db.close();
    });
});
(0, vitest_1.describe)("api_spec_no_test signal", () => {
    (0, vitest_1.it)("detects API specs without API tests", async () => {
        const db = new context_graph_1.GraphDatabase("drift-api-spec", contextDir);
        db.upsertNode({
            id: "spec:users-api",
            type: "spec",
            title: "Users API",
            meta: { content: "POST /api/users returns 201 on success" },
        });
        const engine = new context_graph_1.DriftEngine(db);
        const signals = await engine.detect();
        const apiSignals = signals.filter((s) => s.type === "api_spec_no_test");
        (0, vitest_1.expect)(apiSignals).toHaveLength(1);
        (0, vitest_1.expect)(apiSignals[0].testType).toBe("api");
        db.close();
    });
});
(0, vitest_1.describe)("route_no_test signal", () => {
    (0, vitest_1.it)("detects route handler files without tests", async () => {
        const db = new context_graph_1.GraphDatabase("drift-route", contextDir);
        db.upsertNode({
            id: "file:src/routes/users.ts",
            type: "file",
            path: "src/routes/users.ts",
            title: "users route",
        });
        const engine = new context_graph_1.DriftEngine(db);
        const signals = await engine.detect();
        const routeSignals = signals.filter((s) => s.type === "route_no_test");
        (0, vitest_1.expect)(routeSignals).toHaveLength(1);
        (0, vitest_1.expect)(routeSignals[0].testType).toBe("api");
        (0, vitest_1.expect)(routeSignals[0].action).toBe("write_test");
        db.close();
    });
    (0, vitest_1.it)("does not flag route files with tests", async () => {
        const db = new context_graph_1.GraphDatabase("drift-route-covered", contextDir);
        db.upsertNode({ id: "file:src/routes/users.ts", type: "file", path: "src/routes/users.ts" });
        db.upsertNode({ id: "test:users-route-test", type: "test", title: "users-route-test" });
        db.upsertEdge({ source: "test:users-route-test", target: "file:src/routes/users.ts", relation: "tests" });
        const engine = new context_graph_1.DriftEngine(db);
        const signals = await engine.detect();
        const routeSignals = signals.filter((s) => s.type === "route_no_test");
        (0, vitest_1.expect)(routeSignals).toHaveLength(0);
        db.close();
    });
});
// --- Severity scoring tests ---
(0, vitest_1.describe)("severity scoring", () => {
    (0, vitest_1.it)("assigns highest base severity to test_regression", async () => {
        const db = new context_graph_1.GraphDatabase("drift-severity", contextDir);
        // Set up a regression
        db.ingestTestRun([{ testId: "test:x", commitHash: "aaa", runId: "run-1", status: "pass", timestamp: "2026-03-01T00:00:00Z" }], { runId: "run-1", commitHash: "aaa", timestamp: "2026-03-01T00:00:00Z", total: 1, passed: 1, failed: 0, skipped: 0 });
        db.ingestTestRun([{ testId: "test:x", commitHash: "bbb", runId: "run-2", status: "fail", timestamp: "2026-03-02T00:00:00Z" }], { runId: "run-2", commitHash: "bbb", timestamp: "2026-03-02T00:00:00Z", total: 1, passed: 0, failed: 1, skipped: 0 });
        // Set up an orphan code signal (low severity)
        db.upsertNode({ id: "file:src/orphan.ts", type: "file", path: "src/orphan.ts" });
        const engine = new context_graph_1.DriftEngine(db);
        const signals = await engine.detect();
        const regression = signals.find((s) => s.type === "test_regression");
        const orphan = signals.find((s) => s.type === "orphan_code");
        (0, vitest_1.expect)(regression).toBeDefined();
        (0, vitest_1.expect)(orphan).toBeDefined();
        (0, vitest_1.expect)(regression.severity).toBeGreaterThan(orphan.severity);
        db.close();
    });
    (0, vitest_1.it)("clamps severity to [0.0, 1.0]", async () => {
        const db = new context_graph_1.GraphDatabase("drift-severity-clamp", contextDir);
        // Create a spec with many edges to boost importance
        db.upsertNode({ id: "spec:big", type: "spec", title: "Big Feature" });
        for (let i = 0; i < 20; i++) {
            db.upsertNode({ id: `file:src/f${i}.ts`, type: "file", path: `src/f${i}.ts` });
            db.upsertEdge({ source: `file:src/f${i}.ts`, target: "spec:big", relation: "implements" });
        }
        const engine = new context_graph_1.DriftEngine(db);
        const signals = await engine.detect();
        for (const s of signals) {
            (0, vitest_1.expect)(s.severity).toBeGreaterThanOrEqual(0.0);
            (0, vitest_1.expect)(s.severity).toBeLessThanOrEqual(1.0);
        }
        db.close();
    });
    (0, vitest_1.it)("boosts severity for specs with more edges (spec_importance)", async () => {
        const db = new context_graph_1.GraphDatabase("drift-importance", contextDir);
        // Isolated spec
        db.upsertNode({ id: "spec:isolated", type: "spec", title: "Isolated" });
        // Connected spec (many edges)
        db.upsertNode({ id: "spec:connected", type: "spec", title: "Connected" });
        for (let i = 0; i < 5; i++) {
            db.upsertNode({ id: `file:impl${i}.ts`, type: "file", path: `impl${i}.ts` });
            db.upsertEdge({ source: `file:impl${i}.ts`, target: "spec:connected", relation: "implements" });
        }
        const engine = new context_graph_1.DriftEngine(db);
        const signals = await engine.detect();
        const isolatedSignal = signals.find((s) => s.type === "spec_no_tests" && s.subject.nodeId === "spec:isolated");
        const connectedSignal = signals.find((s) => s.type === "spec_no_tests" && s.subject.nodeId === "spec:connected");
        (0, vitest_1.expect)(isolatedSignal).toBeDefined();
        (0, vitest_1.expect)(connectedSignal).toBeDefined();
        (0, vitest_1.expect)(connectedSignal.severity).toBeGreaterThan(isolatedSignal.severity);
        db.close();
    });
});
// --- Filtering tests ---
(0, vitest_1.describe)("signal filtering", () => {
    (0, vitest_1.it)("filters by signal type", async () => {
        const db = new context_graph_1.GraphDatabase("drift-filter-type", contextDir);
        db.upsertNode({ id: "spec:auth", type: "spec", title: "Auth" });
        db.upsertNode({ id: "file:src/utils.ts", type: "file", path: "src/utils.ts" });
        const engine = new context_graph_1.DriftEngine(db, { type: "spec_no_tests" });
        const signals = await engine.detect();
        (0, vitest_1.expect)(signals.every((s) => s.type === "spec_no_tests")).toBe(true);
        db.close();
    });
    (0, vitest_1.it)("filters by test type", async () => {
        const db = new context_graph_1.GraphDatabase("drift-filter-testtype", contextDir);
        // API spec (testType: api)
        db.upsertNode({
            id: "spec:api",
            type: "spec",
            title: "API",
            meta: { content: "POST /api/items returns 201" },
        });
        // Regular spec (testType: unit)
        db.upsertNode({ id: "spec:utils", type: "spec", title: "Utils" });
        const engine = new context_graph_1.DriftEngine(db, { testType: "api" });
        const signals = await engine.detect();
        (0, vitest_1.expect)(signals.every((s) => s.testType === "api")).toBe(true);
        db.close();
    });
    (0, vitest_1.it)("filters by minimum severity", async () => {
        const db = new context_graph_1.GraphDatabase("drift-filter-severity", contextDir);
        // Regression (high severity)
        db.ingestTestRun([{ testId: "test:x", commitHash: "aaa", runId: "run-1", status: "pass", timestamp: "2026-03-01T00:00:00Z" }], { runId: "run-1", commitHash: "aaa", timestamp: "2026-03-01T00:00:00Z", total: 1, passed: 1, failed: 0, skipped: 0 });
        db.ingestTestRun([{ testId: "test:x", commitHash: "bbb", runId: "run-2", status: "fail", timestamp: "2026-03-02T00:00:00Z" }], { runId: "run-2", commitHash: "bbb", timestamp: "2026-03-02T00:00:00Z", total: 1, passed: 0, failed: 1, skipped: 0 });
        // Orphan (low severity: 0.2)
        db.upsertNode({ id: "file:src/orphan.ts", type: "file", path: "src/orphan.ts" });
        const engine = new context_graph_1.DriftEngine(db, { minSeverity: 0.5 });
        const signals = await engine.detect();
        (0, vitest_1.expect)(signals.every((s) => s.severity >= 0.5)).toBe(true);
        (0, vitest_1.expect)(signals.some((s) => s.type === "test_regression")).toBe(true);
        db.close();
    });
});
// --- Output format tests ---
(0, vitest_1.describe)("signal output", () => {
    (0, vitest_1.it)("sorts signals by severity descending", async () => {
        const db = new context_graph_1.GraphDatabase("drift-sort", contextDir);
        // Multiple signal types with different base severities
        db.upsertNode({ id: "spec:auth", type: "spec", title: "Auth" });
        db.upsertNode({ id: "file:src/orphan.ts", type: "file", path: "src/orphan.ts" });
        db.ingestTestRun([{ testId: "test:x", commitHash: "aaa", runId: "run-1", status: "pass", timestamp: "2026-03-01T00:00:00Z" }], { runId: "run-1", commitHash: "aaa", timestamp: "2026-03-01T00:00:00Z", total: 1, passed: 1, failed: 0, skipped: 0 });
        db.ingestTestRun([{ testId: "test:x", commitHash: "bbb", runId: "run-2", status: "fail", timestamp: "2026-03-02T00:00:00Z" }], { runId: "run-2", commitHash: "bbb", timestamp: "2026-03-02T00:00:00Z", total: 1, passed: 0, failed: 1, skipped: 0 });
        const engine = new context_graph_1.DriftEngine(db);
        const signals = await engine.detect();
        for (let i = 1; i < signals.length; i++) {
            (0, vitest_1.expect)(signals[i - 1].severity).toBeGreaterThanOrEqual(signals[i].severity);
        }
        db.close();
    });
    (0, vitest_1.it)("includes scoring reason in context", async () => {
        const db = new context_graph_1.GraphDatabase("drift-reason", contextDir);
        db.upsertNode({ id: "spec:auth", type: "spec", title: "Auth" });
        const engine = new context_graph_1.DriftEngine(db);
        const signals = await engine.detect();
        for (const s of signals) {
            (0, vitest_1.expect)(s.context.scoringReason).toBeDefined();
            (0, vitest_1.expect)(s.context.scoringReason.length).toBeGreaterThan(0);
        }
        db.close();
    });
    (0, vitest_1.it)("generates unique signal IDs", async () => {
        const db = new context_graph_1.GraphDatabase("drift-ids", contextDir);
        db.upsertNode({ id: "spec:auth", type: "spec", title: "Auth" });
        db.upsertNode({ id: "spec:billing", type: "spec", title: "Billing" });
        db.upsertNode({ id: "file:src/utils.ts", type: "file", path: "src/utils.ts" });
        const engine = new context_graph_1.DriftEngine(db);
        const signals = await engine.detect();
        const ids = signals.map((s) => s.id);
        const uniqueIds = new Set(ids);
        (0, vitest_1.expect)(uniqueIds.size).toBe(ids.length);
        db.close();
    });
});
(0, vitest_1.describe)("empty graph", () => {
    (0, vitest_1.it)("returns no signals for an empty graph", async () => {
        const db = new context_graph_1.GraphDatabase("drift-empty", contextDir);
        const engine = new context_graph_1.DriftEngine(db);
        const signals = await engine.detect();
        (0, vitest_1.expect)(signals).toEqual([]);
        db.close();
    });
});
//# sourceMappingURL=drift.test.js.map