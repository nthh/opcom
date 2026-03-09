import { describe, it, expect } from "vitest";
import {
  computePlan,
  expandTeamSteps,
  baseTicketId,
} from "../../packages/core/src/orchestrator/planner.js";
import type { WorkItem, PlanStep, TeamDefinition } from "@opcom/types";
import type { TicketSet } from "../../packages/core/src/orchestrator/planner.js";

function makeTicket(overrides: Partial<WorkItem> & { id: string }): WorkItem {
  return {
    title: overrides.id,
    status: "open",
    priority: 2,
    type: "feature",
    filePath: `/project/.tickets/${overrides.id}.md`,
    deps: [],
    links: [],
    tags: {},
    ...overrides,
  };
}

const featureDevTeam: TeamDefinition = {
  id: "feature-dev",
  name: "Feature Development",
  steps: [
    { role: "engineer", verification: "test-gate" },
    { role: "qa", verification: "test-gate", depends_on: "engineer" },
    { role: "reviewer", verification: "none", depends_on: "qa" },
  ],
  triggers: { types: ["feature"] },
};

const soloEngineerTeam: TeamDefinition = {
  id: "solo-engineer",
  name: "Solo Engineer",
  steps: [{ role: "engineer", verification: "test-gate" }],
};

describe("baseTicketId", () => {
  it("extracts base from team step id", () => {
    expect(baseTicketId("implement-auth/engineer")).toBe("implement-auth");
    expect(baseTicketId("implement-auth/qa")).toBe("implement-auth");
  });

  it("returns original for non-team step id", () => {
    expect(baseTicketId("implement-auth")).toBe("implement-auth");
    expect(baseTicketId("setup-db")).toBe("setup-db");
  });

  it("handles nested slashes correctly", () => {
    expect(baseTicketId("my-project/sub/engineer")).toBe("my-project/sub");
  });
});

describe("expandTeamSteps", () => {
  it("expands a multi-step team into sub-steps", () => {
    const steps: PlanStep[] = [
      { ticketId: "implement-auth", projectId: "p", status: "ready", blockedBy: [] },
    ];

    const teams = new Map<string, TeamDefinition>();
    teams.set("implement-auth", featureDevTeam);

    const expanded = expandTeamSteps(steps, teams);
    expect(expanded).toHaveLength(3);

    expect(expanded[0].ticketId).toBe("implement-auth/engineer");
    expect(expanded[0].role).toBe("engineer");
    expect(expanded[0].teamId).toBe("feature-dev");
    expect(expanded[0].teamStepRole).toBe("engineer");
    expect(expanded[0].verificationMode).toBe("test-gate");
    expect(expanded[0].blockedBy).toEqual([]);
    expect(expanded[0].status).toBe("ready");

    expect(expanded[1].ticketId).toBe("implement-auth/qa");
    expect(expanded[1].role).toBe("qa");
    expect(expanded[1].teamId).toBe("feature-dev");
    expect(expanded[1].blockedBy).toEqual(["implement-auth/engineer"]);
    expect(expanded[1].status).toBe("blocked");

    expect(expanded[2].ticketId).toBe("implement-auth/reviewer");
    expect(expanded[2].role).toBe("reviewer");
    expect(expanded[2].teamId).toBe("feature-dev");
    expect(expanded[2].blockedBy).toEqual(["implement-auth/qa"]);
    expect(expanded[2].status).toBe("blocked");
    expect(expanded[2].verificationMode).toBe("none");
  });

  it("preserves original blockedBy for first team step", () => {
    const steps: PlanStep[] = [
      { ticketId: "setup-db", projectId: "p", status: "ready", blockedBy: [] },
      { ticketId: "add-api", projectId: "p", status: "blocked", blockedBy: ["setup-db"] },
    ];

    const teams = new Map<string, TeamDefinition>();
    teams.set("add-api", featureDevTeam);

    const expanded = expandTeamSteps(steps, teams);
    expect(expanded).toHaveLength(4); // 1 original + 3 expanded

    // First team step inherits original blockedBy
    const engineerStep = expanded.find((s) => s.ticketId === "add-api/engineer")!;
    expect(engineerStep.blockedBy).toEqual(["setup-db"]);
    expect(engineerStep.status).toBe("blocked");
  });

  it("updates downstream steps to block on last team sub-step", () => {
    const steps: PlanStep[] = [
      { ticketId: "implement-auth", projectId: "p", status: "ready", blockedBy: [] },
      { ticketId: "add-ui", projectId: "p", status: "blocked", blockedBy: ["implement-auth"] },
    ];

    const teams = new Map<string, TeamDefinition>();
    teams.set("implement-auth", featureDevTeam);

    const expanded = expandTeamSteps(steps, teams);

    // add-ui should now be blocked by the last sub-step (reviewer)
    const uiStep = expanded.find((s) => s.ticketId === "add-ui")!;
    expect(uiStep.blockedBy).toEqual(["implement-auth/reviewer"]);
  });

  it("keeps single-step teams as-is but applies role and verification", () => {
    const steps: PlanStep[] = [
      { ticketId: "simple-task", projectId: "p", status: "ready", blockedBy: [] },
    ];

    const teams = new Map<string, TeamDefinition>();
    teams.set("simple-task", soloEngineerTeam);

    const expanded = expandTeamSteps(steps, teams);
    expect(expanded).toHaveLength(1);
    expect(expanded[0].ticketId).toBe("simple-task"); // not renamed
    expect(expanded[0].role).toBe("engineer");
    expect(expanded[0].teamId).toBe("solo-engineer");
    expect(expanded[0].verificationMode).toBe("test-gate");
  });

  it("leaves steps without team resolution unchanged", () => {
    const steps: PlanStep[] = [
      { ticketId: "no-team", projectId: "p", status: "ready", blockedBy: [] },
    ];

    const expanded = expandTeamSteps(steps, new Map());
    expect(expanded).toHaveLength(1);
    expect(expanded[0].ticketId).toBe("no-team");
    expect(expanded[0].teamId).toBeUndefined();
  });

  it("handles multiple tickets with different teams", () => {
    const steps: PlanStep[] = [
      { ticketId: "feature-a", projectId: "p", status: "ready", blockedBy: [] },
      { ticketId: "research-b", projectId: "p", status: "ready", blockedBy: [] },
    ];

    const researchTeam: TeamDefinition = {
      id: "research",
      name: "Research",
      steps: [{ role: "researcher", verification: "output-exists" }],
    };

    const teams = new Map<string, TeamDefinition>();
    teams.set("feature-a", featureDevTeam);
    teams.set("research-b", researchTeam);

    const expanded = expandTeamSteps(steps, teams);
    // feature-a expands to 3 sub-steps, research-b stays as 1
    expect(expanded).toHaveLength(4);
    expect(expanded.filter((s) => s.ticketId.startsWith("feature-a/"))).toHaveLength(3);
    expect(expanded.find((s) => s.ticketId === "research-b")!.teamId).toBe("research");
  });
});

describe("computePlan with teams", () => {
  it("expands tickets with team resolutions into sub-steps", () => {
    const tickets: TicketSet[] = [
      {
        projectId: "proj-a",
        tickets: [
          makeTicket({ id: "implement-auth", type: "feature" }),
          makeTicket({ id: "setup-db", type: "task", deps: [] }),
        ],
      },
    ];

    const teams = new Map<string, TeamDefinition>();
    teams.set("implement-auth", featureDevTeam);

    const plan = computePlan(tickets, {}, "team-plan", undefined, undefined, teams);

    // setup-db stays as 1, implement-auth expands to 3
    expect(plan.steps).toHaveLength(4);

    const authSteps = plan.steps.filter((s) => s.ticketId.startsWith("implement-auth/"));
    expect(authSteps).toHaveLength(3);
    expect(authSteps.map((s) => s.teamStepRole)).toEqual(["engineer", "qa", "reviewer"]);
  });

  it("preserves ticket deps through team expansion", () => {
    const tickets: TicketSet[] = [
      {
        projectId: "proj-a",
        tickets: [
          makeTicket({ id: "setup-db" }),
          makeTicket({ id: "add-api", deps: ["setup-db"] }),
          makeTicket({ id: "add-ui", deps: ["add-api"] }),
        ],
      },
    ];

    const teams = new Map<string, TeamDefinition>();
    teams.set("add-api", featureDevTeam);

    const plan = computePlan(tickets, {}, "deps-plan", undefined, undefined, teams);

    // add-ui should be blocked by add-api/reviewer (last sub-step)
    const uiStep = plan.steps.find((s) => s.ticketId === "add-ui")!;
    expect(uiStep.blockedBy).toContain("add-api/reviewer");

    // add-api/engineer should be blocked by setup-db
    const engStep = plan.steps.find((s) => s.ticketId === "add-api/engineer")!;
    expect(engStep.blockedBy).toContain("setup-db");
  });

  it("works without team resolutions (backward compatible)", () => {
    const tickets: TicketSet[] = [
      {
        projectId: "proj-a",
        tickets: [makeTicket({ id: "t1" }), makeTicket({ id: "t2" })],
      },
    ];

    const plan = computePlan(tickets, {}, "no-teams");
    expect(plan.steps).toHaveLength(2);
    expect(plan.steps[0].teamId).toBeUndefined();
  });
});
