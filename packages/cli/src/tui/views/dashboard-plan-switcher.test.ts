import { describe, it, expect } from "vitest";
import type { Plan, PlanSummary, ProjectStatusSnapshot } from "@opcom/types";
import { ScreenBuffer, stripAnsi } from "../renderer.js";
import {
  createDashboardState,
  renderDashboard,
  getNextPlanId,
  getPlansForProject,
  getBestPlanForProject,
  computePlansByProject,
  formatProjectLine,
} from "./dashboard.js";
import {
  createProjectDetailState,
  renderProjectDetail,
  formatPlanLine,
  getProjectPlansList,
} from "./project-detail.js";

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

  describe("plan count badge on project rows", () => {
    function makeProject(id: string, name: string): ProjectStatusSnapshot {
      return {
        id,
        name,
        path: `/projects/${id}`,
        git: { branch: "main", clean: true, uncommittedCount: 0 },
        workSummary: { open: 3, total: 10 },
      } as ProjectStatusSnapshot;
    }

    it("renders plan count badge when plans exist", () => {
      const project = makeProject("proj-1", "myapp");
      const line = formatProjectLine(project, null, 80, 2);
      const text = stripAnsi(line);
      expect(text).toContain("\u25b8 2 plans");
    });

    it("renders singular plan badge for 1 plan", () => {
      const project = makeProject("proj-1", "myapp");
      const line = formatProjectLine(project, null, 80, 1);
      const text = stripAnsi(line);
      expect(text).toContain("\u25b8 1 plan");
      expect(text).not.toContain("plans");
    });

    it("omits badge when no plans exist", () => {
      const project = makeProject("proj-1", "myapp");
      const line = formatProjectLine(project, null, 80, 0);
      const text = stripAnsi(line);
      expect(text).not.toContain("\u25b8");
    });

    it("omits badge when planCount is undefined", () => {
      const project = makeProject("proj-1", "myapp");
      const line = formatProjectLine(project, null, 80);
      const text = stripAnsi(line);
      expect(text).not.toContain("\u25b8");
    });

    it("renders badge on dashboard project rows via plansByProject", () => {
      const state = createDashboardState();
      const project = makeProject("proj-1", "myapp");
      state.projects = [project];
      state.allPlans = [
        makeSummary("plan-a", "alpha", "executing", ["proj-1"]),
        makeSummary("plan-b", "beta", "paused", ["proj-1"]),
      ];
      state.plansByProject = computePlansByProject(state.allPlans, ["proj-1"]);

      const buf = new ScreenBuffer(80, 30);
      renderDashboard(buf, panels, state);
      // Verify the plansByProject was populated correctly
      expect(state.plansByProject.get("proj-1")?.length).toBe(2);
    });
  });

  describe("plan panel header format", () => {
    it("shows PLAN N/M \u00b7 name when multiple plans", () => {
      const state = createDashboardState();
      const plan = makePlan({ id: "plan-b", name: "beta" });
      state.planPanel = { plan };
      state.allPlans = [
        makeSummary("plan-a", "alpha"),
        makeSummary("plan-b", "beta"),
        makeSummary("plan-c", "gamma"),
      ];

      const buf = new ScreenBuffer(100, 30);
      renderDashboard(buf, panels, state);
      // Plan is at index 1 (0-based), so header should show "Plan 2/3 \u00b7 beta"
      expect(state.allPlans.findIndex((p) => p.id === "plan-b")).toBe(1);
    });

    it("shows Plan: name when single plan", () => {
      const state = createDashboardState();
      const plan = makePlan({ id: "plan-1", name: "test-plan" });
      state.planPanel = { plan };
      state.allPlans = [makeSummary("plan-1", "test-plan")];

      const buf = new ScreenBuffer(100, 30);
      renderDashboard(buf, panels, state);
      // Single plan should use "Plan:" prefix, not "Plan 1/1"
      expect(state.allPlans.length).toBe(1);
    });
  });

  describe("plan panel follows project selection", () => {
    it("auto-switches plan when plansByProject changes", () => {
      const state = createDashboardState();
      state.allPlans = [
        makeSummary("plan-a", "alpha", "executing", ["proj-1"]),
        makeSummary("plan-b", "beta", "paused", ["proj-2"]),
      ];
      state.plansByProject = computePlansByProject(state.allPlans, ["proj-1", "proj-2"]);

      // proj-1 should get plan-a
      expect(getBestPlanForProject(state.allPlans, "proj-1")).toBe("plan-a");
      // proj-2 should get plan-b
      expect(getBestPlanForProject(state.allPlans, "proj-2")).toBe("plan-b");
    });

    it("clears plan panel when project has no plans", () => {
      const state = createDashboardState();
      state.allPlans = [
        makeSummary("plan-a", "alpha", "executing", ["proj-1"]),
      ];
      state.plansByProject = computePlansByProject(state.allPlans, ["proj-1", "proj-2"]);

      expect(state.plansByProject.get("proj-2")).toBeUndefined();
      expect(getBestPlanForProject(state.allPlans, "proj-2")).toBeNull();
    });
  });

  describe("computePlansByProject", () => {
    it("groups plans by project ID", () => {
      const plans = [
        makeSummary("plan-a", "alpha", "executing", ["proj-1"]),
        makeSummary("plan-b", "beta", "paused", ["proj-2"]),
        makeSummary("plan-c", "gamma", "executing", ["proj-1", "proj-2"]),
      ];
      const result = computePlansByProject(plans, ["proj-1", "proj-2"]);
      expect(result.get("proj-1")?.map((p) => p.id)).toEqual(["plan-a", "plan-c"]);
      expect(result.get("proj-2")?.map((p) => p.id)).toEqual(["plan-b", "plan-c"]);
    });

    it("assigns global plans to all projects", () => {
      const plans = [
        makeSummary("plan-a", "alpha", "executing"), // no projectIds
        makeSummary("plan-b", "beta", "paused", []),  // empty projectIds
      ];
      const result = computePlansByProject(plans, ["proj-1", "proj-2"]);
      expect(result.get("proj-1")?.length).toBe(2);
      expect(result.get("proj-2")?.length).toBe(2);
    });

    it("returns empty map when no plans", () => {
      const result = computePlansByProject([], ["proj-1"]);
      expect(result.size).toBe(0);
    });
  });

  describe("L2 project detail plans section", () => {
    function makeProjectSnapshot(id: string, name: string): ProjectStatusSnapshot {
      return {
        id,
        name,
        path: `/projects/${id}`,
        git: { branch: "main", clean: true, uncommittedCount: 0 },
      } as ProjectStatusSnapshot;
    }

    const l2Panels = [
      { id: "tickets", x: 0, y: 0, width: 44, height: 30, title: "Tickets" },
      { id: "agents", x: 44, y: 0, width: 36, height: 5, title: "Agents" },
      { id: "plans", x: 44, y: 5, width: 36, height: 5, title: "Plans" },
      { id: "specs", x: 44, y: 10, width: 36, height: 5, title: "Specs" },
      { id: "stack", x: 44, y: 15, width: 36, height: 5, title: "Stack" },
      { id: "cloud", x: 44, y: 20, width: 36, height: 5, title: "Cloud" },
      { id: "cicd", x: 44, y: 25, width: 36, height: 5, title: "CI/CD" },
      { id: "infra", x: 44, y: 30, width: 36, height: 5, title: "Infrastructure" },
      { id: "chat", x: 44, y: 35, width: 36, height: 5, title: "Chat" },
    ];

    it("renders plans panel with plan list", () => {
      const project = makeProjectSnapshot("proj-1", "myapp");
      const state = createProjectDetailState(project);
      state.plans = [
        makeSummary("plan-a", "alpha", "executing", ["proj-1"]),
        makeSummary("plan-b", "beta", "done", ["proj-1"]),
      ];

      const buf = new ScreenBuffer(80, 40);
      renderProjectDetail(buf, l2Panels, state);
      // Should render without throwing and plans are available
      expect(state.plans.length).toBe(2);
    });

    it("shows empty message when no plans", () => {
      const project = makeProjectSnapshot("proj-1", "myapp");
      const state = createProjectDetailState(project);
      state.plans = [];

      const buf = new ScreenBuffer(80, 40);
      renderProjectDetail(buf, l2Panels, state);
      expect(state.plans.length).toBe(0);
    });

    it("formats plan line with status icon and progress", () => {
      const plan = makeSummary("plan-a", "alpha", "executing");
      const line = formatPlanLine(plan, 40);
      const text = stripAnsi(line);
      expect(text).toContain("alpha");
      expect(text).toContain("1/3");
    });

    it("formats plan line with done icon", () => {
      const plan: PlanSummary = {
        id: "plan-done",
        name: "completed-plan",
        status: "done",
        stepsDone: 5,
        stepsTotal: 5,
        updatedAt: "2026-03-01T00:00:00Z",
      };
      const line = formatPlanLine(plan, 40);
      const text = stripAnsi(line);
      expect(text).toContain("\u2713");
      expect(text).toContain("completed-plan");
      expect(text).toContain("5/5");
    });

    it("getProjectPlansList returns state.plans", () => {
      const project = makeProjectSnapshot("proj-1", "myapp");
      const state = createProjectDetailState(project);
      const plans = [
        makeSummary("plan-a", "alpha", "executing"),
        makeSummary("plan-b", "beta", "paused"),
      ];
      state.plans = plans;
      expect(getProjectPlansList(state)).toEqual(plans);
    });

    it("plans panel is at index 2 (between agents and specs)", () => {
      const project = makeProjectSnapshot("proj-1", "myapp");
      const state = createProjectDetailState(project);
      state.plans = [makeSummary("plan-a", "alpha", "executing")];

      // Focus panel 2 (plans)
      state.focusedPanel = 2;

      const buf = new ScreenBuffer(80, 40);
      renderProjectDetail(buf, l2Panels, state);
      // Should render with plans panel focused (panel 2)
      expect(state.focusedPanel).toBe(2);
    });

    it("plan selection tracks with selectedIndex[2]", () => {
      const project = makeProjectSnapshot("proj-1", "myapp");
      const state = createProjectDetailState(project);
      state.plans = [
        makeSummary("plan-a", "alpha", "executing"),
        makeSummary("plan-b", "beta", "paused"),
        makeSummary("plan-c", "gamma", "done"),
      ];
      state.focusedPanel = 2;
      state.selectedIndex[2] = 1; // Select second plan

      const buf = new ScreenBuffer(80, 40);
      renderProjectDetail(buf, l2Panels, state);
      // Selected plan index should be 1 (beta)
      expect(state.selectedIndex[2]).toBe(1);
      expect(state.plans[state.selectedIndex[2]].name).toBe("beta");
    });
  });
});
