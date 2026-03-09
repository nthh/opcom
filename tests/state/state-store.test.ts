import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { StateStore } from "../../packages/core/src/state/state-store.js";
import type { DecisionEntry, MetricEntry, ArtifactEntry } from "@opcom/types";

describe("StateStore", () => {
  let tmpDir: string;
  let store: StateStore;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "opcom-state-test-"));
    store = new StateStore(tmpDir);
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  // --- Decisions ---

  describe("decisions", () => {
    const entry: DecisionEntry = {
      timestamp: "2026-03-08T14:30:00Z",
      planId: "plan-1",
      stepId: "auth-migration",
      agent: "oracle",
      decision: "Approved auth migration",
      rationale: "All criteria met",
      confidence: 1.0,
    };

    it("appends and reads a decision", async () => {
      await store.appendDecision(entry);
      const results = await store.readDecisions();
      expect(results).toHaveLength(1);
      expect(results[0]).toEqual(entry);
    });

    it("appends multiple decisions", async () => {
      await store.appendDecision(entry);
      await store.appendDecision({ ...entry, stepId: "db-migration", decision: "Used Postgres" });
      const results = await store.readDecisions();
      expect(results).toHaveLength(2);
    });

    it("filters by planId", async () => {
      await store.appendDecision(entry);
      await store.appendDecision({ ...entry, planId: "plan-2", decision: "Other" });
      const results = await store.readDecisions({ planId: "plan-1" });
      expect(results).toHaveLength(1);
      expect(results[0].planId).toBe("plan-1");
    });

    it("filters by stepId", async () => {
      await store.appendDecision(entry);
      await store.appendDecision({ ...entry, stepId: "db-migration" });
      const results = await store.readDecisions({ stepId: "auth-migration" });
      expect(results).toHaveLength(1);
      expect(results[0].stepId).toBe("auth-migration");
    });

    it("filters by planId and stepId combined", async () => {
      await store.appendDecision(entry);
      await store.appendDecision({ ...entry, planId: "plan-2" });
      await store.appendDecision({ ...entry, stepId: "other" });
      const results = await store.readDecisions({ planId: "plan-1", stepId: "auth-migration" });
      expect(results).toHaveLength(1);
    });

    it("returns empty for non-existent file", async () => {
      const results = await store.readDecisions();
      expect(results).toEqual([]);
    });

    it("writes valid JSONL (one JSON object per line)", async () => {
      await store.appendDecision(entry);
      await store.appendDecision({ ...entry, decision: "Second" });
      const raw = await readFile(join(tmpDir, "decisions.jsonl"), "utf-8");
      const lines = raw.split("\n").filter((l) => l.trim().length > 0);
      expect(lines).toHaveLength(2);
      for (const line of lines) {
        expect(() => JSON.parse(line)).not.toThrow();
      }
    });
  });

  // --- Metrics ---

  describe("metrics", () => {
    const entry: MetricEntry = {
      timestamp: "2026-03-08T14:30:00Z",
      planId: "plan-1",
      stepId: "auth-migration",
      metric: "step_duration_ms",
      value: 720000,
    };

    it("appends and reads a metric", async () => {
      await store.appendMetric(entry);
      const results = await store.readMetrics();
      expect(results).toHaveLength(1);
      expect(results[0]).toEqual(entry);
    });

    it("filters by metric name", async () => {
      await store.appendMetric(entry);
      await store.appendMetric({ ...entry, metric: "test_pass_rate", value: 0.98 });
      const results = await store.readMetrics({ metric: "test_pass_rate" });
      expect(results).toHaveLength(1);
      expect(results[0].metric).toBe("test_pass_rate");
    });

    it("filters by planId", async () => {
      await store.appendMetric(entry);
      await store.appendMetric({ ...entry, planId: "plan-2" });
      const results = await store.readMetrics({ planId: "plan-1" });
      expect(results).toHaveLength(1);
    });

    it("stores detail string", async () => {
      const withDetail: MetricEntry = { ...entry, detail: "147/150 tests passed" };
      await store.appendMetric(withDetail);
      const results = await store.readMetrics();
      expect(results[0].detail).toBe("147/150 tests passed");
    });

    it("handles metrics without stepId", async () => {
      const planMetric: MetricEntry = {
        timestamp: "2026-03-08T15:00:00Z",
        planId: "plan-1",
        metric: "plan_progress",
        value: 0.6,
        detail: "3/5 steps done",
      };
      await store.appendMetric(planMetric);
      const results = await store.readMetrics();
      expect(results[0].stepId).toBeUndefined();
    });
  });

  // --- Artifacts ---

  describe("artifacts", () => {
    const entry: ArtifactEntry = {
      timestamp: "2026-03-08T14:30:00Z",
      planId: "plan-1",
      stepId: "auth-migration",
      type: "commit",
      ref: "abc123",
      path: "src/auth/",
      agent: "engineer",
    };

    it("appends and reads an artifact", async () => {
      await store.appendArtifact(entry);
      const results = await store.readArtifacts();
      expect(results).toHaveLength(1);
      expect(results[0]).toEqual(entry);
    });

    it("filters by type", async () => {
      await store.appendArtifact(entry);
      await store.appendArtifact({ ...entry, type: "merge", ref: "def456" });
      const results = await store.readArtifacts({ type: "commit" });
      expect(results).toHaveLength(1);
      expect(results[0].type).toBe("commit");
    });

    it("filters by planId and type", async () => {
      await store.appendArtifact(entry);
      await store.appendArtifact({ ...entry, planId: "plan-2" });
      await store.appendArtifact({ ...entry, type: "merge" });
      const results = await store.readArtifacts({ planId: "plan-1", type: "commit" });
      expect(results).toHaveLength(1);
    });

    it("handles artifacts without optional fields", async () => {
      const minimal: ArtifactEntry = {
        timestamp: "2026-03-08T14:30:00Z",
        planId: "plan-1",
        stepId: "step-1",
        type: "merge",
      };
      await store.appendArtifact(minimal);
      const results = await store.readArtifacts();
      expect(results[0].ref).toBeUndefined();
      expect(results[0].path).toBeUndefined();
      expect(results[0].agent).toBeUndefined();
    });
  });

  // --- Append-only behavior ---

  describe("append-only", () => {
    it("never overwrites existing entries", async () => {
      const d1: DecisionEntry = {
        timestamp: "2026-03-08T14:00:00Z",
        planId: "p1",
        agent: "oracle",
        decision: "First",
        rationale: "reason 1",
      };
      const d2: DecisionEntry = {
        timestamp: "2026-03-08T15:00:00Z",
        planId: "p1",
        agent: "oracle",
        decision: "Second",
        rationale: "reason 2",
      };
      await store.appendDecision(d1);
      await store.appendDecision(d2);
      const results = await store.readDecisions();
      expect(results).toHaveLength(2);
      expect(results[0].decision).toBe("First");
      expect(results[1].decision).toBe("Second");
    });

    it("writes to separate files per concern", async () => {
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

      const decisions = await readFile(join(tmpDir, "decisions.jsonl"), "utf-8");
      const metrics = await readFile(join(tmpDir, "metrics.jsonl"), "utf-8");
      const artifacts = await readFile(join(tmpDir, "artifacts.jsonl"), "utf-8");

      expect(decisions.split("\n").filter((l) => l.trim()).length).toBe(1);
      expect(metrics.split("\n").filter((l) => l.trim()).length).toBe(1);
      expect(artifacts.split("\n").filter((l) => l.trim()).length).toBe(1);
    });
  });

  // --- Resilience ---

  describe("resilience", () => {
    it("skips malformed JSONL lines", async () => {
      const { writeFile: wf } = await import("node:fs/promises");
      const filePath = join(tmpDir, "decisions.jsonl");
      await wf(filePath, '{"valid":"entry","timestamp":"t","planId":"p","agent":"a","decision":"d","rationale":"r"}\nnot valid json\n{"valid":"entry2","timestamp":"t2","planId":"p2","agent":"a","decision":"d2","rationale":"r2"}\n');
      const results = await store.readDecisions();
      expect(results).toHaveLength(2);
    });
  });
});
