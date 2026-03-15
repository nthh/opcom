import { describe, it, expect } from "vitest";
import type { Plan, PlanSummary } from "@opcom/types";
import { ScreenBuffer } from "../renderer.js";
import {
  createDashboardState,
  renderDashboard,
  getNextPlanId,
  getPlansForProject,
  getBestPlanForProject,
} from "./dashboard.js";

function makePlan(overrides: Partial<Plan> = {}): Plan {
  return {
    id: "plan-1",
    name: "test-plan",
    status: "executing",
    scope: {},
    steps: [
      { ticketId: "t-1", projectId: "p-1", status: "done", blockedBy: [], track: "core" },
      { ticketId: "t-2", projectId: "p-1", status: "in-progress", blockedBy: ["t-1"], track: "core" },
      { ticketId: "t-3", projectId: "p-1", status: "blocked", blockedBy: ["t-2"], track: "core" },
    ],
    config: {
      maxConcurrentAgents: 3,
      autoStart: false,
      backend: "claude-code",
      worktree: true,
      pauseOnFailure: true,
      ticketTransitions: true,
      autoCommit: true,
      verification: { runTests: true, runOracle: true },
      stall: { enabled: true, agentTimeoutMs: 1200000, planStallTimeoutMs: 1800000, maxIdenticalFailures: 2 },
    },
    context: "",
    createdAt: "2026-03-01T00:00:00Z",
    updatedAt: "2026-03-01T01:00:00Z",
    ...overrides,
  };
}

function makeSummary(id: string, name: string, status: Plan["status"] = "executing", projectIds?: string[]): PlanSummary {
  return { id, name, status, stepsDone: 1, stepsTotal: 3, updatedAt: "2026-03-01T00:00:00Z", projectIds };
}

const panels = [
  { id: "projects", x: 0, y: 0, width: 40, height: 15, title: "Projects" },
  { id: "workqueue", x: 0, y: 15, width: 40, height: 15, title: "Work Queue" },
  { id: "agents", x: 40, y: 0, width: 40, height: 20, title: "Agents" },
  { id: "chat", x: 40, y: 20, width: 40, height: 10, title: "Chat" },
];

describe("plan switcher", () => {
  describe("getNextPlanId", () => {
    it("returns null when no plans", () => {
      const state = createDashboardState();
      state.allPlans = [];
      expect(getNextPlanId(state, 1)).toBeNull();
    });

    it("returns null when only one plan", () => {
      const state = createDashboardState();
      state.allPlans = [makeSummary("plan-1", "solo")];
      state.planPanel = { plan: makePlan({ id: "plan-1" }) };
      expect(getNextPlanId(state, 1)).toBeNull();
    });

    it("cycles forward through plans", () => {
      const state = createDashboardState();
      state.allPlans = [
        makeSummary("plan-a", "alpha"),
        makeSummary("plan-b", "beta"),
        makeSummary("plan-c", "gamma"),
      ];
      state.planPanel = { plan: makePlan({ id: "plan-a", name: "alpha" }) };

      expect(getNextPlanId(state, 1)).toBe("plan-b");
    });

    it("cycles backward through plans", () => {
      const state = createDashboardState();
      state.allPlans = [
        makeSummary("plan-a", "alpha"),
        makeSummary("plan-b", "beta"),
        makeSummary("plan-c", "gamma"),
      ];
      state.planPanel = { plan: makePlan({ id: "plan-a", name: "alpha" }) };

      expect(getNextPlanId(state, -1)).toBe("plan-c");
    });

    it("wraps around forward", () => {
      const state = createDashboardState();
      state.allPlans = [
        makeSummary("plan-a", "alpha"),
        makeSummary("plan-b", "beta"),
      ];
      state.planPanel = { plan: makePlan({ id: "plan-b", name: "beta" }) };

      expect(getNextPlanId(state, 1)).toBe("plan-a");
    });

    it("wraps around backward", () => {
      const state = createDashboardState();
      state.allPlans = [
        makeSummary("plan-a", "alpha"),
        makeSummary("plan-b", "beta"),
      ];
      state.planPanel = { plan: makePlan({ id: "plan-a", name: "alpha" }) };

      expect(getNextPlanId(state, -1)).toBe("plan-b");
    });

    it("falls back to first plan when no active plan", () => {
      const state = createDashboardState();
      state.allPlans = [
        makeSummary("plan-a", "alpha"),
        makeSummary("plan-b", "beta"),
      ];
      state.planPanel = null;

      expect(getNextPlanId(state, 1)).toBe("plan-a");
    });

    it("skips cancelled/done plans when cycling forward", () => {
      const state = createDashboardState();
      state.allPlans = [
        makeSummary("plan-a", "alpha", "executing"),
        makeSummary("plan-b", "beta", "cancelled"),
        makeSummary("plan-c", "gamma", "cancelled"),
        makeSummary("plan-d", "delta", "paused"),
      ];
      state.planPanel = { plan: makePlan({ id: "plan-a", name: "alpha" }) };

      // Should skip cancelled plans and land on paused
      expect(getNextPlanId(state, 1)).toBe("plan-d");
    });

    it("skips cancelled/done plans when cycling backward", () => {
      const state = createDashboardState();
      state.allPlans = [
        makeSummary("plan-a", "alpha", "executing"),
        makeSummary("plan-b", "beta", "cancelled"),
        makeSummary("plan-c", "gamma", "done"),
        makeSummary("plan-d", "delta", "paused"),
      ];
      state.planPanel = { plan: makePlan({ id: "plan-a", name: "alpha" }) };

      // Backward from first non-terminal → last non-terminal (plan-d)
      expect(getNextPlanId(state, -1)).toBe("plan-d");
    });

    it("jumps to executing plan from a cancelled plan", () => {
      const state = createDashboardState();
      state.allPlans = [
        makeSummary("plan-a", "alpha", "cancelled"),
        makeSummary("plan-b", "beta", "executing"),
        makeSummary("plan-c", "gamma", "cancelled"),
      ];
      state.planPanel = { plan: makePlan({ id: "plan-a", name: "alpha", status: "cancelled" }) };

      // Only one non-terminal plan — jump directly to it
      expect(getNextPlanId(state, 1)).toBe("plan-b");
    });

    it("returns null when on the only non-terminal plan", () => {
      const state = createDashboardState();
      state.allPlans = [
        makeSummary("plan-a", "alpha", "cancelled"),
        makeSummary("plan-b", "beta", "executing"),
        makeSummary("plan-c", "gamma", "done"),
      ];
      state.planPanel = { plan: makePlan({ id: "plan-b", name: "beta" }) };

      // Only one non-terminal plan and we're on it — nothing to cycle to
      expect(getNextPlanId(state, 1)).toBeNull();
    });

    it("cycles through all plans when all are terminal", () => {
      const state = createDashboardState();
      state.allPlans = [
        makeSummary("plan-a", "alpha", "cancelled"),
        makeSummary("plan-b", "beta", "done"),
        makeSummary("plan-c", "gamma", "cancelled"),
      ];
      state.planPanel = { plan: makePlan({ id: "plan-a", name: "alpha", status: "cancelled" }) };

      // All terminal — normal cycling
      expect(getNextPlanId(state, 1)).toBe("plan-b");
      state.planPanel = { plan: makePlan({ id: "plan-b", name: "beta", status: "done" }) };
      expect(getNextPlanId(state, 1)).toBe("plan-c");
    });
  });

  describe("plan panel header", () => {
    it("renders plan panel without index when single plan", () => {
      const state = createDashboardState();
      const plan = makePlan();
      state.planPanel = { plan };
      state.allPlans = [makeSummary("plan-1", "test-plan")];

      const buf = new ScreenBuffer(80, 30);
      renderDashboard(buf, panels, state);
      // Should render without throwing — single plan has no index indicator
      expect(state.allPlans.length).toBe(1);
    });

    it("renders plan panel with index when multiple plans", () => {
      const state = createDashboardState();
      const plan = makePlan({ id: "plan-b", name: "beta" });
      state.planPanel = { plan };
      state.allPlans = [
        makeSummary("plan-a", "alpha"),
        makeSummary("plan-b", "beta"),
        makeSummary("plan-c", "gamma"),
      ];

      const buf = new ScreenBuffer(80, 30);
      renderDashboard(buf, panels, state);
      // Should render without throwing — plan index is (2/3)
      expect(state.allPlans.length).toBe(3);
    });
  });

  describe("plan status badges in summaries", () => {
    it("tracks step progress in summary", () => {
      const plan = makePlan();
      const summary: PlanSummary = {
        id: plan.id,
        name: plan.name,
        status: plan.status,
        stepsDone: plan.steps.filter((s) => s.status === "done" || s.status === "skipped").length,
        stepsTotal: plan.steps.length,
        updatedAt: plan.updatedAt,
      };
      expect(summary.stepsDone).toBe(1);
      expect(summary.stepsTotal).toBe(3);
    });

    it("reflects different statuses", () => {
      const summaries: PlanSummary[] = [
        makeSummary("a", "executing-plan", "executing"),
        makeSummary("b", "paused-plan", "paused"),
        makeSummary("c", "done-plan", "done"),
        makeSummary("d", "cancelled-plan", "cancelled"),
      ];
      expect(summaries.map((s) => s.status)).toEqual(["executing", "paused", "done", "cancelled"]);
    });
  });

  describe("selecting a plan updates panel", () => {
    it("switching plan updates planPanel", () => {
      const state = createDashboardState();
      const planA = makePlan({ id: "plan-a", name: "alpha" });
      const planB = makePlan({ id: "plan-b", name: "beta", status: "paused" });

      state.planPanel = { plan: planA };
      state.allPlans = [
        makeSummary("plan-a", "alpha"),
        makeSummary("plan-b", "beta", "paused"),
      ];

      // Simulate switching to plan-b
      const nextId = getNextPlanId(state, 1);
      expect(nextId).toBe("plan-b");

      // After switch, planPanel would show planB
      state.planPanel = { plan: planB };
      expect(state.planPanel.plan.id).toBe("plan-b");
      expect(state.planPanel.plan.status).toBe("paused");

      // Render with the updated plan
      const buf = new ScreenBuffer(80, 30);
      renderDashboard(buf, panels, state);
    });
  });

  describe("getPlansForProject", () => {
    it("returns plans matching the project", () => {
      const plans = [
        makeSummary("plan-a", "alpha", "executing", ["proj-1"]),
        makeSummary("plan-b", "beta", "paused", ["proj-2"]),
        makeSummary("plan-c", "gamma", "executing", ["proj-1", "proj-2"]),
      ];
      const result = getPlansForProject(plans, "proj-1");
      expect(result.map((p) => p.id)).toEqual(["plan-a", "plan-c"]);
    });

    it("includes plans with no projectIds (global plans)", () => {
      const plans = [
        makeSummary("plan-a", "alpha", "executing", ["proj-1"]),
        makeSummary("plan-b", "beta", "paused"), // no projectIds
        makeSummary("plan-c", "gamma", "executing", []), // empty projectIds
      ];
      const result = getPlansForProject(plans, "proj-1");
      expect(result.map((p) => p.id)).toEqual(["plan-a", "plan-b", "plan-c"]);
    });

    it("returns empty array when no plans match", () => {
      const plans = [
        makeSummary("plan-a", "alpha", "executing", ["proj-2"]),
        makeSummary("plan-b", "beta", "paused", ["proj-3"]),
      ];
      const result = getPlansForProject(plans, "proj-1");
      expect(result).toEqual([]);
    });
  });

  describe("getBestPlanForProject", () => {
    it("prefers executing plan over paused", () => {
      const plans = [
        makeSummary("plan-a", "alpha", "paused", ["proj-1"]),
        makeSummary("plan-b", "beta", "executing", ["proj-1"]),
      ];
      expect(getBestPlanForProject(plans, "proj-1")).toBe("plan-b");
    });

    it("prefers paused over done", () => {
      const plans = [
        makeSummary("plan-a", "alpha", "done", ["proj-1"]),
        makeSummary("plan-b", "beta", "paused", ["proj-1"]),
      ];
      expect(getBestPlanForProject(plans, "proj-1")).toBe("plan-b");
    });

    it("prefers planning over failed", () => {
      const plans = [
        makeSummary("plan-a", "alpha", "failed", ["proj-1"]),
        makeSummary("plan-b", "beta", "planning", ["proj-1"]),
      ];
      expect(getBestPlanForProject(plans, "proj-1")).toBe("plan-b");
    });

    it("returns null when no plans match project", () => {
      const plans = [
        makeSummary("plan-a", "alpha", "executing", ["proj-2"]),
      ];
      expect(getBestPlanForProject(plans, "proj-1")).toBeNull();
    });

    it("breaks ties by most recently updated", () => {
      const plans: PlanSummary[] = [
        { id: "plan-a", name: "alpha", status: "executing", stepsDone: 1, stepsTotal: 3, updatedAt: "2026-03-01T00:00:00Z", projectIds: ["proj-1"] },
        { id: "plan-b", name: "beta", status: "executing", stepsDone: 1, stepsTotal: 3, updatedAt: "2026-03-02T00:00:00Z", projectIds: ["proj-1"] },
      ];
      expect(getBestPlanForProject(plans, "proj-1")).toBe("plan-b");
    });

    it("only considers plans for the given project", () => {
      const plans = [
        makeSummary("plan-a", "alpha", "executing", ["proj-2"]),
        makeSummary("plan-b", "beta", "paused", ["proj-1"]),
      ];
      expect(getBestPlanForProject(plans, "proj-1")).toBe("plan-b");
    });
  });

  describe("project-scoped plan cycling", () => {
    it("cycles only through plans for the given project", () => {
      const state = createDashboardState();
      state.allPlans = [
        makeSummary("plan-a", "alpha", "executing", ["proj-1"]),
        makeSummary("plan-b", "beta", "executing", ["proj-2"]),
        makeSummary("plan-c", "gamma", "executing", ["proj-1"]),
      ];
      state.planPanel = { plan: makePlan({ id: "plan-a", name: "alpha" }) };

      // Cycling scoped to proj-1 should skip plan-b (proj-2)
      expect(getNextPlanId(state, 1, "proj-1")).toBe("plan-c");
    });

    it("wraps around within project-scoped plans", () => {
      const state = createDashboardState();
      state.allPlans = [
        makeSummary("plan-a", "alpha", "executing", ["proj-1"]),
        makeSummary("plan-b", "beta", "executing", ["proj-2"]),
        makeSummary("plan-c", "gamma", "executing", ["proj-1"]),
      ];
      state.planPanel = { plan: makePlan({ id: "plan-c", name: "gamma" }) };

      // Forward wrap: plan-c → plan-a
      expect(getNextPlanId(state, 1, "proj-1")).toBe("plan-a");
    });

    it("returns null when only one plan for the project", () => {
      const state = createDashboardState();
      state.allPlans = [
        makeSummary("plan-a", "alpha", "executing", ["proj-1"]),
        makeSummary("plan-b", "beta", "executing", ["proj-2"]),
      ];
      state.planPanel = { plan: makePlan({ id: "plan-a", name: "alpha" }) };

      expect(getNextPlanId(state, 1, "proj-1")).toBeNull();
    });

    it("falls through to all plans when no projectId given", () => {
      const state = createDashboardState();
      state.allPlans = [
        makeSummary("plan-a", "alpha", "executing", ["proj-1"]),
        makeSummary("plan-b", "beta", "executing", ["proj-2"]),
      ];
      state.planPanel = { plan: makePlan({ id: "plan-a", name: "alpha" }) };

      // Without projectId, cycles through all plans
      expect(getNextPlanId(state, 1)).toBe("plan-b");
    });

    it("applies terminal-skip logic within project scope", () => {
      const state = createDashboardState();
      state.allPlans = [
        makeSummary("plan-a", "alpha", "executing", ["proj-1"]),
        makeSummary("plan-b", "beta", "cancelled", ["proj-1"]),
        makeSummary("plan-c", "gamma", "paused", ["proj-1"]),
      ];
      state.planPanel = { plan: makePlan({ id: "plan-a", name: "alpha" }) };

      // Should skip cancelled plan-b and land on paused plan-c
      expect(getNextPlanId(state, 1, "proj-1")).toBe("plan-c");
    });
  });
});
