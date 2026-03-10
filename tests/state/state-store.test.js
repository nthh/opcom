"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const promises_1 = require("node:fs/promises");
const node_path_1 = require("node:path");
const node_os_1 = require("node:os");
const state_store_js_1 = require("../../packages/core/src/state/state-store.js");
(0, vitest_1.describe)("StateStore", () => {
    let tmpDir;
    let store;
    (0, vitest_1.beforeEach)(async () => {
        tmpDir = await (0, promises_1.mkdtemp)((0, node_path_1.join)((0, node_os_1.tmpdir)(), "opcom-state-test-"));
        store = new state_store_js_1.StateStore(tmpDir);
    });
    (0, vitest_1.afterEach)(async () => {
        await (0, promises_1.rm)(tmpDir, { recursive: true, force: true });
    });
    // --- Decisions ---
    (0, vitest_1.describe)("decisions", () => {
        const entry = {
            timestamp: "2026-03-08T14:30:00Z",
            planId: "plan-1",
            stepId: "auth-migration",
            agent: "oracle",
            decision: "Approved auth migration",
            rationale: "All criteria met",
            confidence: 1.0,
        };
        (0, vitest_1.it)("appends and reads a decision", async () => {
            await store.appendDecision(entry);
            const results = await store.readDecisions();
            (0, vitest_1.expect)(results).toHaveLength(1);
            (0, vitest_1.expect)(results[0]).toEqual(entry);
        });
        (0, vitest_1.it)("appends multiple decisions", async () => {
            await store.appendDecision(entry);
            await store.appendDecision({ ...entry, stepId: "db-migration", decision: "Used Postgres" });
            const results = await store.readDecisions();
            (0, vitest_1.expect)(results).toHaveLength(2);
        });
        (0, vitest_1.it)("filters by planId", async () => {
            await store.appendDecision(entry);
            await store.appendDecision({ ...entry, planId: "plan-2", decision: "Other" });
            const results = await store.readDecisions({ planId: "plan-1" });
            (0, vitest_1.expect)(results).toHaveLength(1);
            (0, vitest_1.expect)(results[0].planId).toBe("plan-1");
        });
        (0, vitest_1.it)("filters by stepId", async () => {
            await store.appendDecision(entry);
            await store.appendDecision({ ...entry, stepId: "db-migration" });
            const results = await store.readDecisions({ stepId: "auth-migration" });
            (0, vitest_1.expect)(results).toHaveLength(1);
            (0, vitest_1.expect)(results[0].stepId).toBe("auth-migration");
        });
        (0, vitest_1.it)("filters by planId and stepId combined", async () => {
            await store.appendDecision(entry);
            await store.appendDecision({ ...entry, planId: "plan-2" });
            await store.appendDecision({ ...entry, stepId: "other" });
            const results = await store.readDecisions({ planId: "plan-1", stepId: "auth-migration" });
            (0, vitest_1.expect)(results).toHaveLength(1);
        });
        (0, vitest_1.it)("returns empty for non-existent file", async () => {
            const results = await store.readDecisions();
            (0, vitest_1.expect)(results).toEqual([]);
        });
        (0, vitest_1.it)("writes valid JSONL (one JSON object per line)", async () => {
            await store.appendDecision(entry);
            await store.appendDecision({ ...entry, decision: "Second" });
            const raw = await (0, promises_1.readFile)((0, node_path_1.join)(tmpDir, "decisions.jsonl"), "utf-8");
            const lines = raw.split("\n").filter((l) => l.trim().length > 0);
            (0, vitest_1.expect)(lines).toHaveLength(2);
            for (const line of lines) {
                (0, vitest_1.expect)(() => JSON.parse(line)).not.toThrow();
            }
        });
    });
    // --- Metrics ---
    (0, vitest_1.describe)("metrics", () => {
        const entry = {
            timestamp: "2026-03-08T14:30:00Z",
            planId: "plan-1",
            stepId: "auth-migration",
            metric: "step_duration_ms",
            value: 720000,
        };
        (0, vitest_1.it)("appends and reads a metric", async () => {
            await store.appendMetric(entry);
            const results = await store.readMetrics();
            (0, vitest_1.expect)(results).toHaveLength(1);
            (0, vitest_1.expect)(results[0]).toEqual(entry);
        });
        (0, vitest_1.it)("filters by metric name", async () => {
            await store.appendMetric(entry);
            await store.appendMetric({ ...entry, metric: "test_pass_rate", value: 0.98 });
            const results = await store.readMetrics({ metric: "test_pass_rate" });
            (0, vitest_1.expect)(results).toHaveLength(1);
            (0, vitest_1.expect)(results[0].metric).toBe("test_pass_rate");
        });
        (0, vitest_1.it)("filters by planId", async () => {
            await store.appendMetric(entry);
            await store.appendMetric({ ...entry, planId: "plan-2" });
            const results = await store.readMetrics({ planId: "plan-1" });
            (0, vitest_1.expect)(results).toHaveLength(1);
        });
        (0, vitest_1.it)("stores detail string", async () => {
            const withDetail = { ...entry, detail: "147/150 tests passed" };
            await store.appendMetric(withDetail);
            const results = await store.readMetrics();
            (0, vitest_1.expect)(results[0].detail).toBe("147/150 tests passed");
        });
        (0, vitest_1.it)("handles metrics without stepId", async () => {
            const planMetric = {
                timestamp: "2026-03-08T15:00:00Z",
                planId: "plan-1",
                metric: "plan_progress",
                value: 0.6,
                detail: "3/5 steps done",
            };
            await store.appendMetric(planMetric);
            const results = await store.readMetrics();
            (0, vitest_1.expect)(results[0].stepId).toBeUndefined();
        });
    });
    // --- Artifacts ---
    (0, vitest_1.describe)("artifacts", () => {
        const entry = {
            timestamp: "2026-03-08T14:30:00Z",
            planId: "plan-1",
            stepId: "auth-migration",
            type: "commit",
            ref: "abc123",
            path: "src/auth/",
            agent: "engineer",
        };
        (0, vitest_1.it)("appends and reads an artifact", async () => {
            await store.appendArtifact(entry);
            const results = await store.readArtifacts();
            (0, vitest_1.expect)(results).toHaveLength(1);
            (0, vitest_1.expect)(results[0]).toEqual(entry);
        });
        (0, vitest_1.it)("filters by type", async () => {
            await store.appendArtifact(entry);
            await store.appendArtifact({ ...entry, type: "merge", ref: "def456" });
            const results = await store.readArtifacts({ type: "commit" });
            (0, vitest_1.expect)(results).toHaveLength(1);
            (0, vitest_1.expect)(results[0].type).toBe("commit");
        });
        (0, vitest_1.it)("filters by planId and type", async () => {
            await store.appendArtifact(entry);
            await store.appendArtifact({ ...entry, planId: "plan-2" });
            await store.appendArtifact({ ...entry, type: "merge" });
            const results = await store.readArtifacts({ planId: "plan-1", type: "commit" });
            (0, vitest_1.expect)(results).toHaveLength(1);
        });
        (0, vitest_1.it)("handles artifacts without optional fields", async () => {
            const minimal = {
                timestamp: "2026-03-08T14:30:00Z",
                planId: "plan-1",
                stepId: "step-1",
                type: "merge",
            };
            await store.appendArtifact(minimal);
            const results = await store.readArtifacts();
            (0, vitest_1.expect)(results[0].ref).toBeUndefined();
            (0, vitest_1.expect)(results[0].path).toBeUndefined();
            (0, vitest_1.expect)(results[0].agent).toBeUndefined();
        });
    });
    // --- Append-only behavior ---
    (0, vitest_1.describe)("append-only", () => {
        (0, vitest_1.it)("never overwrites existing entries", async () => {
            const d1 = {
                timestamp: "2026-03-08T14:00:00Z",
                planId: "p1",
                agent: "oracle",
                decision: "First",
                rationale: "reason 1",
            };
            const d2 = {
                timestamp: "2026-03-08T15:00:00Z",
                planId: "p1",
                agent: "oracle",
                decision: "Second",
                rationale: "reason 2",
            };
            await store.appendDecision(d1);
            await store.appendDecision(d2);
            const results = await store.readDecisions();
            (0, vitest_1.expect)(results).toHaveLength(2);
            (0, vitest_1.expect)(results[0].decision).toBe("First");
            (0, vitest_1.expect)(results[1].decision).toBe("Second");
        });
        (0, vitest_1.it)("writes to separate files per concern", async () => {
            await store.appendDecision({
                timestamp: "2026-03-08T14:00:00Z",
                planId: "p1",
                agent: "oracle",
                decision: "d",
                rationale: "r",
            });
            await store.appendMetric({
                timestamp: "2026-03-08T14:00:00Z",
                planId: "p1",
                metric: "m",
                value: 1,
            });
            await store.appendArtifact({
                timestamp: "2026-03-08T14:00:00Z",
                planId: "p1",
                type: "commit",
            });
            const decisions = await (0, promises_1.readFile)((0, node_path_1.join)(tmpDir, "decisions.jsonl"), "utf-8");
            const metrics = await (0, promises_1.readFile)((0, node_path_1.join)(tmpDir, "metrics.jsonl"), "utf-8");
            const artifacts = await (0, promises_1.readFile)((0, node_path_1.join)(tmpDir, "artifacts.jsonl"), "utf-8");
            (0, vitest_1.expect)(decisions.split("\n").filter((l) => l.trim()).length).toBe(1);
            (0, vitest_1.expect)(metrics.split("\n").filter((l) => l.trim()).length).toBe(1);
            (0, vitest_1.expect)(artifacts.split("\n").filter((l) => l.trim()).length).toBe(1);
        });
    });
    // --- Resilience ---
    (0, vitest_1.describe)("resilience", () => {
        (0, vitest_1.it)("skips malformed JSONL lines", async () => {
            const { writeFile: wf } = await import("node:fs/promises");
            const filePath = (0, node_path_1.join)(tmpDir, "decisions.jsonl");
            await wf(filePath, '{"valid":"entry","timestamp":"t","planId":"p","agent":"a","decision":"d","rationale":"r"}\nnot valid json\n{"valid":"entry2","timestamp":"t2","planId":"p2","agent":"a","decision":"d2","rationale":"r2"}\n');
            const results = await store.readDecisions();
            (0, vitest_1.expect)(results).toHaveLength(2);
        });
    });
});
//# sourceMappingURL=state-store.test.js.map