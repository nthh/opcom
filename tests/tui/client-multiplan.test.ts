import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Plan, PlanStep, WorkItem } from "@opcom/types";

const mockExecutorRun = vi.fn().mockImplementation(() => new Promise<void>(() => {})); // never resolves
const mockExecutorOn = vi.fn();

vi.mock("@opcom/core", async () => {
  const actual = await vi.importActual<typeof import("@opcom/core")>("@opcom/core");
  return {
    ...actual,
    loadGlobalConfig: vi.fn().mockResolvedValue({ defaultWorkspace: "default" }),
    loadWorkspace: vi.fn().mockResolvedValue({ projectIds: ["proj1"] }),
    loadProject: vi.fn().mockImplementation((id: string) =>
      id === "proj1"
        ? Promise.resolve({
            id: "proj1",
            name: "Test Project",
            path: "/tmp/test",
            stack: { languages: [], frameworks: [], packageManagers: [], infrastructure: [], versionManagers: [] },
            testing: null,
            linting: [],
            services: [],
            docs: { agentConfig: null },
            git: { branch: "main", remote: null, clean: true },
            workSystem: null,
            cloudServices: [],
          })
        : Promise.resolve(null),
    ),
    refreshProjectStatus: vi.fn().mockResolvedValue({
      gitFresh: { branch: "main", remote: null, clean: true },
      workSummary: null,
    }),
    scanTickets: vi.fn().mockResolvedValue([]),
    Station: { isRunning: vi.fn().mockResolvedValue({ running: false }) },
    SessionManager: vi.fn().mockImplementation(() => ({
      init: vi.fn().mockResolvedValue(undefined),
      on: vi.fn(),
      off: vi.fn(),
      shutdown: vi.fn().mockResolvedValue(undefined),
    })),
    createLogger: vi.fn().mockReturnValue({
      debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(),
    }),
    Executor: vi.fn().mockImplementation(() => ({
      pause: vi.fn(),
      resume: vi.fn(),
      run: mockExecutorRun,
      on: mockExecutorOn,
    })),
    savePlan: vi.fn().mockResolvedValue(undefined),
    listPlans: vi.fn().mockResolvedValue([]),
    buildContextPacket: vi.fn().mockResolvedValue({}),
  };
});

import { TuiClient } from "../../packages/cli/src/tui/client.js";

function makePlan(overrides: Partial<Plan> = {}): Plan {
  return {
    id: "plan-1",
    name: "Plan One",
    status: "planning",
    scope: { projectIds: ["proj1"], query: "status:open" },
    steps: [
      { ticketId: "t1", projectId: "proj1", status: "ready", blockedBy: [] },
      { ticketId: "t2", projectId: "proj1", status: "ready", blockedBy: [] },
    ],
    config: { worktree: false, pauseOnFailure: false, ticketTransitions: true, verification: { enabled: false, testCommand: "", autoRebase: false } },
    context: "",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  } as Plan;
}

function makeTicket(id: string): WorkItem {
  return {
    id,
    title: `Ticket ${id}`,
    status: "open",
    priority: 1,
    type: "feature",
    source: ".tickets",
    projectPath: "/tmp/test",
    deps: [],
    tags: {},
  } as WorkItem;
}

describe("TuiClient multi-plan isolation", () => {
  let client: TuiClient;

  beforeEach(async () => {
    mockExecutorRun.mockClear();
    mockExecutorOn.mockClear();
    client = new TuiClient();
    await client.connect();
  });

  describe("createPlan while executor is running", () => {
    it("switches activePlan to new plan even when an executor is running", async () => {
      // Start with an executing plan
      const executingPlan = makePlan({
        id: "plan-executing",
        name: "Executing",
        status: "planning",
        steps: [
          { ticketId: "t1", projectId: "proj1", status: "in-progress", blockedBy: [] } as PlanStep,
          { ticketId: "t2", projectId: "proj1", status: "ready", blockedBy: [] } as PlanStep,
        ],
      });
      client.activePlan = executingPlan;
      await client.executePlan("plan-executing");
      await new Promise((r) => setTimeout(r, 50));

      // Now create a new plan while executor is running
      client.projectTickets.set("proj1", [makeTicket("t1"), makeTicket("t2"), makeTicket("t3")]);
      const result = await client.createPlan("proj1");

      // activePlan should switch to the new plan — user just created it
      expect(client.activePlan!.id).not.toBe("plan-executing");
      expect(result).not.toBeNull();
      expect(client.activePlan!.id).toBe(result!.plan.id);
    });

    it("switches activePlan when no executor is running", async () => {
      client.activePlan = null;
      client.projectTickets.set("proj1", [makeTicket("t1"), makeTicket("t2")]);

      const result = await client.createPlan("proj1");

      expect(result).not.toBeNull();
      expect(client.activePlan).not.toBeNull();
      expect(client.activePlan!.id).toBe(result!.plan.id);
    });

    it("updates allPlans when a new plan is created", async () => {
      client.allPlans = [];
      client.projectTickets.set("proj1", [makeTicket("t1")]);

      const result = await client.createPlan("proj1");

      expect(client.allPlans.length).toBe(1);
      expect(client.allPlans[0].id).toBe(result!.plan.id);
      expect(client.allPlans[0].status).toBe("planning");
    });
  });

  describe("plan_updated event isolation", () => {
    it("does not overwrite activePlan when viewing a different plan", async () => {
      // Set up: user is viewing plan-B
      const planB = makePlan({ id: "plan-b", name: "Plan B" });
      client.activePlan = planB;

      // Executor fires update for plan-A (a different executing plan)
      const updatedPlanA = makePlan({
        id: "plan-a",
        name: "Plan A",
        status: "executing",
        steps: [
          { ticketId: "t1", projectId: "proj1", status: "done", blockedBy: [] } as PlanStep,
        ],
      });

      // Simulate the event handler being called (as the executor would)
      (client as any).handleServerEvent({ type: "plan_updated", plan: updatedPlanA });

      // activePlan should still be plan-B
      expect(client.activePlan!.id).toBe("plan-b");
    });

    it("updates activePlan when viewing the same plan", async () => {
      const planA = makePlan({ id: "plan-a", name: "Plan A", status: "executing" });
      client.activePlan = planA;

      const updatedPlanA = makePlan({
        id: "plan-a",
        name: "Plan A",
        status: "executing",
        steps: [
          { ticketId: "t1", projectId: "proj1", status: "done", blockedBy: [] } as PlanStep,
        ],
      });

      (client as any).handleServerEvent({ type: "plan_updated", plan: updatedPlanA });

      expect(client.activePlan!.id).toBe("plan-a");
      expect(client.activePlan!.steps[0].status).toBe("done");
    });

    it("updates allPlans summary even when viewing a different plan", async () => {
      const planB = makePlan({ id: "plan-b", name: "Plan B" });
      client.activePlan = planB;
      client.allPlans = [
        { id: "plan-a", name: "Plan A", status: "executing", stepsDone: 0, stepsTotal: 2, updatedAt: new Date().toISOString() },
        { id: "plan-b", name: "Plan B", status: "planning", stepsDone: 0, stepsTotal: 1, updatedAt: new Date().toISOString() },
      ];

      const updatedPlanA = makePlan({
        id: "plan-a",
        name: "Plan A",
        status: "executing",
        steps: [
          { ticketId: "t1", projectId: "proj1", status: "done", blockedBy: [] } as PlanStep,
          { ticketId: "t2", projectId: "proj1", status: "in-progress", blockedBy: [] } as PlanStep,
        ],
      });

      (client as any).handleServerEvent({ type: "plan_updated", plan: updatedPlanA });

      // allPlans should be updated with the new progress
      const planASummary = client.allPlans.find((p) => p.id === "plan-a");
      expect(planASummary!.stepsDone).toBe(1); // t1 is done
      expect(planASummary!.stepsTotal).toBe(2);
    });
  });

  describe("plan_completed event isolation", () => {
    it("does not overwrite activePlan when viewing a different plan", async () => {
      const planB = makePlan({ id: "plan-b", name: "Plan B" });
      client.activePlan = planB;

      const completedPlanA = makePlan({
        id: "plan-a",
        name: "Plan A",
        status: "done",
      });

      (client as any).handleServerEvent({ type: "plan_completed", plan: completedPlanA });

      expect(client.activePlan!.id).toBe("plan-b");
    });
  });
});
