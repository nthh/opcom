import { describe, it, expect, vi, beforeEach } from "vitest";
import { runPlanExecute, runPlanResume } from "../../packages/cli/src/commands/plan.js";
import type { Plan } from "@opcom/types";

// Mock all heavy dependencies so we never start real executors
const mockLoadPlan = vi.fn();
const mockListPlans = vi.fn();
const mockSavePlan = vi.fn();

vi.mock("@opcom/core", () => ({
  loadPlan: (...args: unknown[]) => mockLoadPlan(...args),
  listPlans: (...args: unknown[]) => mockListPlans(...args),
  savePlan: (...args: unknown[]) => mockSavePlan(...args),
  loadGlobalConfig: vi.fn(async () => ({})),
  loadWorkspace: vi.fn(async () => null),
  loadProject: vi.fn(async () => null),
  scanTickets: vi.fn(async () => []),
  computePlan: vi.fn(),
  resolveScope: vi.fn(),
  deletePlan: vi.fn(),
  checkHygiene: vi.fn(),
  assessTicketsForDecomposition: vi.fn(() => []),
  generateDecomposition: vi.fn(),
  writeSubTickets: vi.fn(async () => []),
  defaultOrchestratorConfig: vi.fn(() => ({
    maxConcurrentAgents: 3,
    worktree: true,
    pauseOnFailure: true,
    ticketTransitions: true,
    autoCommit: true,
    verification: { runTests: true, runOracle: false },
  })),
  Executor: vi.fn(),
  SessionManager: vi.fn().mockImplementation(() => ({
    init: vi.fn(),
  })),
  EventStore: vi.fn(),
}));

function makePlan(overrides: Partial<Plan> = {}): Plan {
  return {
    id: "test-plan",
    name: "Test",
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
      verification: { runTests: true, runOracle: false },
    },
    context: "",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

describe("runPlanExecute guards", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "log").mockImplementation(() => {});
  });

  it("rejects when plan status is 'executing'", async () => {
    const plan = makePlan({ status: "executing" });
    mockLoadPlan.mockResolvedValue(plan);

    await runPlanExecute("test-plan");

    expect(console.error).toHaveBeenCalledWith(
      expect.stringContaining("already executing"),
    );
  });

  it("rejects when plan status is 'done'", async () => {
    const plan = makePlan({ status: "done" });
    mockLoadPlan.mockResolvedValue(plan);

    await runPlanExecute("test-plan");

    expect(console.error).toHaveBeenCalledWith(
      expect.stringContaining("already done"),
    );
  });

  it("rejects when no plan found", async () => {
    mockLoadPlan.mockResolvedValue(null);
    mockListPlans.mockResolvedValue([]);

    await runPlanExecute("nonexistent");

    expect(console.error).toHaveBeenCalledWith(
      expect.stringContaining("No plan found"),
    );
  });
});

describe("runPlanResume guards", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "log").mockImplementation(() => {});
  });

  it("rejects when plan is not paused", async () => {
    const plan = makePlan({ status: "executing" });
    mockLoadPlan.mockResolvedValue(plan);

    await runPlanResume("test-plan");

    expect(console.error).toHaveBeenCalledWith(
      expect.stringContaining("not paused"),
    );
  });
});
