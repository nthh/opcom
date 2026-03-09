import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtemp, rm, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { existsSync } from "node:fs";
import type { Plan, PlanStatus } from "@opcom/types";

// Mock paths to use temp dir
let tempPlansDir: string;

vi.mock("../config/paths.js", () => ({
  plansDir: () => tempPlansDir,
  planPath: (id: string) => join(tempPlansDir, `${id}.yaml`),
  planContextPath: (id: string) => join(tempPlansDir, `${id}.context.md`),
}));

// Import AFTER mock setup
const { savePlan, loadPlan, listPlans, deletePlan } = await import("./persistence.js");

function makePlan(overrides: Partial<Plan> = {}): Plan {
  return {
    id: "test-plan",
    name: "Test Plan",
    status: "planning",
    scope: {},
    steps: [],
    config: {
      maxConcurrentAgents: 3,
      autoStart: false,
      backend: "claude-code",
      worktree: true,
      pauseOnFailure: true,
      ticketTransitions: true,
      autoCommit: true,
      verification: { runTests: true, runOracle: true, maxRetries: 2, autoRebase: true },
      stall: { enabled: true, agentTimeoutMs: 1200000, planStallTimeoutMs: 1800000, maxIdenticalFailures: 2 },
    },
    context: "",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

describe("plan lifecycle", () => {
  beforeEach(async () => {
    tempPlansDir = await mkdtemp(join(tmpdir(), "opcom-plan-lifecycle-"));
  });

  afterEach(async () => {
    await rm(tempPlansDir, { recursive: true, force: true });
  });

  describe("cancel plan", () => {
    it("sets status to cancelled and persists", async () => {
      const plan = makePlan({ id: "cancel-me", status: "planning" });
      await savePlan(plan);

      // Simulate cancel
      plan.status = "cancelled";
      plan.updatedAt = new Date().toISOString();
      await savePlan(plan);

      const loaded = await loadPlan("cancel-me");
      expect(loaded).not.toBeNull();
      expect(loaded!.status).toBe("cancelled");
    });

    it("cancelled plan is excluded from active plan selection", async () => {
      // Create a cancelled plan (most recent)
      const cancelled = makePlan({ id: "old-cancelled", status: "cancelled" });
      await savePlan(cancelled);

      // Create an executing plan (older updatedAt)
      const executing = makePlan({
        id: "active-exec",
        status: "executing",
        updatedAt: new Date(Date.now() - 60000).toISOString(),
      });
      await savePlan(executing);

      const plans = await listPlans();
      // listPlans sorts by updatedAt desc, so cancelled is first
      // But when filtering for active plans, cancelled should be skipped
      const active = plans.find((p) =>
        p.status === "executing" || p.status === "paused" || p.status === "planning",
      );
      expect(active).toBeDefined();
      expect(active!.id).toBe("active-exec");
    });

    it("loadActivePlan logic skips cancelled, done, and failed plans", async () => {
      await savePlan(makePlan({ id: "p-cancelled", status: "cancelled" }));
      await savePlan(makePlan({ id: "p-done", status: "done" }));
      await savePlan(makePlan({ id: "p-failed", status: "failed" }));

      const plans = await listPlans();
      const active = plans.find((p) =>
        p.status === "executing" || p.status === "paused" || p.status === "planning",
      );
      // No active plans
      expect(active).toBeUndefined();

      // Fallback should also skip terminal plans
      const fallback = plans.find((p) =>
        p.status !== "cancelled" && p.status !== "done" && p.status !== "failed",
      );
      expect(fallback).toBeUndefined();
    });

    it("cancelled status is a valid PlanStatus value", () => {
      const statuses: PlanStatus[] = ["planning", "executing", "paused", "done", "failed", "cancelled"];
      expect(statuses).toContain("cancelled");
    });
  });

  describe("delete plan", () => {
    it("removes plan file from disk", async () => {
      const plan = makePlan({ id: "delete-me" });
      await savePlan(plan);

      // Verify it exists
      const loaded = await loadPlan("delete-me");
      expect(loaded).not.toBeNull();

      // Delete
      await deletePlan("delete-me");

      // Verify it's gone
      const afterDelete = await loadPlan("delete-me");
      expect(afterDelete).toBeNull();
    });

    it("removes context file alongside plan file", async () => {
      const plan = makePlan({ id: "with-context" });
      await savePlan(plan);

      // Write a context file
      const { savePlanContext } = await import("./persistence.js");
      await savePlanContext("with-context", "Some planning context");

      // Delete
      await deletePlan("with-context");

      // Both files should be gone
      const { planPath, planContextPath } = await import("../config/paths.js");
      expect(existsSync(planPath("with-context"))).toBe(false);
      expect(existsSync(planContextPath("with-context"))).toBe(false);
    });

    it("deleting non-existent plan is a no-op", async () => {
      // Should not throw
      await deletePlan("does-not-exist");
    });

    it("deleted plan no longer appears in listPlans", async () => {
      await savePlan(makePlan({ id: "keep-me" }));
      await savePlan(makePlan({ id: "delete-me" }));

      let plans = await listPlans();
      expect(plans).toHaveLength(2);

      await deletePlan("delete-me");

      plans = await listPlans();
      expect(plans).toHaveLength(1);
      expect(plans[0].id).toBe("keep-me");
    });
  });

  describe("active plan selection with mixed statuses", () => {
    it("prefers executing plan over cancelled plan", async () => {
      // cancelled plan is more recent
      await savePlan(makePlan({
        id: "cancelled-plan",
        status: "cancelled",
        updatedAt: new Date().toISOString(),
      }));

      // executing plan is older
      await savePlan(makePlan({
        id: "executing-plan",
        status: "executing",
        updatedAt: new Date(Date.now() - 120000).toISOString(),
      }));

      const plans = await listPlans();
      const active = plans.find((p) =>
        p.status === "executing" || p.status === "paused" || p.status === "planning",
      );
      expect(active).toBeDefined();
      expect(active!.id).toBe("executing-plan");
      expect(active!.status).toBe("executing");
    });

    it("falls back to planning plan when no executing plan exists", async () => {
      await savePlan(makePlan({ id: "cancelled-1", status: "cancelled" }));
      await savePlan(makePlan({ id: "done-1", status: "done" }));
      await savePlan(makePlan({
        id: "planning-1",
        status: "planning",
        updatedAt: new Date(Date.now() - 60000).toISOString(),
      }));

      const plans = await listPlans();
      const active = plans.find((p) =>
        p.status === "executing" || p.status === "paused" || p.status === "planning",
      );
      expect(active).toBeDefined();
      expect(active!.id).toBe("planning-1");
    });

    it("returns null when all plans are terminal", async () => {
      await savePlan(makePlan({ id: "c1", status: "cancelled" }));
      await savePlan(makePlan({ id: "d1", status: "done" }));
      await savePlan(makePlan({ id: "f1", status: "failed" }));

      const plans = await listPlans();

      const active = plans.find((p) =>
        p.status === "executing" || p.status === "paused" || p.status === "planning",
      );
      expect(active).toBeUndefined();

      const fallback = plans.find((p) =>
        p.status !== "cancelled" && p.status !== "done" && p.status !== "failed",
      );
      expect(fallback).toBeUndefined();
    });
  });
});
