import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const mockComputePlan = vi.fn();
const mockResolveTeam = vi.fn();
const mockSavePlan = vi.fn();

vi.mock("@opcom/core", () => ({
  loadGlobalConfig: vi.fn(async () => ({ defaultWorkspace: "ws" })),
  loadWorkspace: vi.fn(async () => ({ projectIds: ["proj-a"] })),
  loadProject: vi.fn(async () => ({ path: "/projects/a" })),
  scanTickets: vi.fn(async () => [
    {
      id: "add-auth",
      title: "Add auth",
      status: "open",
      priority: 2,
      type: "feature",
      filePath: "/projects/a/.tickets/add-auth.md",
      deps: [],
      links: [],
      tags: {},
    },
    {
      id: "fix-bug",
      title: "Fix bug",
      status: "open",
      priority: 1,
      type: "bug",
      filePath: "/projects/a/.tickets/fix-bug.md",
      deps: [],
      links: [],
      tags: {},
    },
    {
      id: "research-perf",
      title: "Research perf",
      status: "open",
      priority: 3,
      type: "research",
      filePath: "/projects/a/.tickets/research-perf.md",
      deps: [],
      links: [],
      tags: {},
      team: "research",
    },
  ]),
  computePlan: (...args: unknown[]) => {
    mockComputePlan(...args);
    return {
      id: "plan-1",
      name: "test-plan",
      status: "planning",
      scope: {},
      steps: [
        { ticketId: "add-auth/engineer", projectId: "proj-a", status: "ready", blockedBy: [], teamId: "feature-dev", teamStepRole: "engineer" },
        { ticketId: "add-auth/qa", projectId: "proj-a", status: "blocked", blockedBy: ["add-auth/engineer"], teamId: "feature-dev", teamStepRole: "qa" },
        { ticketId: "add-auth/reviewer", projectId: "proj-a", status: "blocked", blockedBy: ["add-auth/qa"], teamId: "feature-dev", teamStepRole: "reviewer" },
        { ticketId: "fix-bug", projectId: "proj-a", status: "ready", blockedBy: [] },
        { ticketId: "research-perf", projectId: "proj-a", status: "ready", blockedBy: [], teamId: "research", teamStepRole: "researcher" },
      ],
      config: {
        maxConcurrentAgents: 3,
        worktree: true,
        pauseOnFailure: true,
        verification: { runTests: true, runOracle: false },
      },
      context: "",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
  },
  resolveTeam: (...args: unknown[]) => mockResolveTeam(...args),
  resolveScope: vi.fn(),
  listPlans: vi.fn(async () => []),
  loadPlan: vi.fn(async () => null),
  savePlan: (...args: unknown[]) => mockSavePlan(...args),
  deletePlan: vi.fn(),
  checkHygiene: vi.fn(),
  defaultOrchestratorConfig: vi.fn(() => ({
    maxConcurrentAgents: 3,
    worktree: true,
    pauseOnFailure: true,
    ticketTransitions: true,
    autoCommit: true,
    verification: { runTests: true, runOracle: false },
  })),
  Executor: vi.fn(),
  SessionManager: vi.fn().mockImplementation(() => ({ init: vi.fn() })),
  EventStore: vi.fn(),
}));

vi.mock("../../packages/cli/src/tui/views/plan-overview.js", () => ({
  computePlanSummary: vi.fn(() => ({
    totalSteps: 5,
    readyCount: 3,
    blockedCount: 2,
    tracks: [],
    criticalPathLength: 1,
    criticalPath: [],
    config: {
      maxConcurrentAgents: 3,
      backend: "claude-code",
      worktree: true,
      autoCommit: true,
      pauseOnFailure: true,
      verification: { runTests: true, runOracle: false },
    },
  })),
}));

import { runPlanCreate } from "../../packages/cli/src/commands/plan.js";

const featureDevTeam = {
  id: "feature-dev",
  name: "Feature Development",
  steps: [
    { role: "engineer", verification: "test-gate" },
    { role: "qa", verification: "test-gate", depends_on: "engineer" },
    { role: "reviewer", verification: "none", depends_on: "qa" },
  ],
  triggers: { types: ["feature"] },
};

const researchTeam = {
  id: "research",
  name: "Research Task",
  steps: [{ role: "researcher", verification: "output-exists" }],
  triggers: { types: ["research"] },
};

describe("runPlanCreate with team resolution", () => {
  let consoleSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    // resolveTeam returns team for feature and research types, null for bug
    mockResolveTeam.mockImplementation((ticket: { type: string; team?: string }) => {
      if (ticket.team === "research") return Promise.resolve(researchTeam);
      if (ticket.type === "feature") return Promise.resolve(featureDevTeam);
      if (ticket.type === "research") return Promise.resolve(researchTeam);
      return Promise.resolve(null);
    });
  });

  afterEach(() => {
    consoleSpy.mockRestore();
  });

  it("resolves teams for all tickets and passes to computePlan", async () => {
    await runPlanCreate({ name: "test-plan" });

    // resolveTeam should be called once per ticket
    expect(mockResolveTeam).toHaveBeenCalledTimes(3);

    // computePlan should receive the team resolutions map
    expect(mockComputePlan).toHaveBeenCalledTimes(1);
    const teamResolutions = mockComputePlan.mock.calls[0][5];
    expect(teamResolutions).toBeInstanceOf(Map);
    expect(teamResolutions.size).toBe(2); // feature + research, not bug
    expect(teamResolutions.get("add-auth")).toEqual(featureDevTeam);
    expect(teamResolutions.get("research-perf")).toEqual(researchTeam);
    expect(teamResolutions.has("fix-bug")).toBe(false);
  });

  it("passes empty map when no teams match", async () => {
    mockResolveTeam.mockResolvedValue(null);

    await runPlanCreate({ name: "no-teams" });

    const teamResolutions = mockComputePlan.mock.calls[0][5];
    expect(teamResolutions).toBeInstanceOf(Map);
    expect(teamResolutions.size).toBe(0);
  });
});
