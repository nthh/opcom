import { describe, it, expect, vi, beforeEach } from "vitest";
import { Executor } from "../../packages/core/src/orchestrator/executor.js";
import { defaultConfig } from "../../packages/core/src/orchestrator/persistence.js";
import type { Plan, PlanStep, PlanStage, AgentSession, IntegrationTestResult } from "@opcom/types";
import { waitFor } from "./_helpers.js";

// Mock SessionManager
type EventHandler<T> = (data: T) => void;

class MockSessionManager {
  private listeners = new Map<string, Set<EventHandler<unknown>>>();
  startCalls: Array<{ projectId: string; backend: string; config: unknown; ticketId?: string }> = [];
  stopCalls: string[] = [];
  private sessionCounter = 0;

  getSession(_id: string): undefined { return undefined; }
  on(event: string, handler: EventHandler<unknown>): void {
    if (!this.listeners.has(event)) this.listeners.set(event, new Set());
    this.listeners.get(event)!.add(handler);
  }

  off(event: string, handler: EventHandler<unknown>): void {
    this.listeners.get(event)?.delete(handler);
  }

  emit(event: string, data: unknown): void {
    const handlers = this.listeners.get(event);
    if (handlers) {
      for (const h of handlers) h(data);
    }
  }

  async startSession(
    projectId: string,
    backend: string,
    config: unknown,
    workItemId?: string,
  ): Promise<AgentSession> {
    this.startCalls.push({ projectId, backend, config, ticketId: workItemId });
    const id = `session-${++this.sessionCounter}`;
    return {
      id,
      backend: backend as "claude-code",
      projectId,
      state: "streaming",
      startedAt: new Date().toISOString(),
      workItemId,
    };
  }

  async stopSession(sessionId: string): Promise<void> {
    this.stopCalls.push(sessionId);
  }

  simulateWrite(sessionId: string): void {
    this.emit("agent_event", {
      sessionId,
      event: {
        type: "tool_end",
        sessionId,
        timestamp: new Date().toISOString(),
        data: { toolName: "Edit", toolSuccess: true },
      },
    });
  }

  simulateCompletion(sessionId: string): void {
    const session: AgentSession = {
      id: sessionId,
      backend: "claude-code",
      projectId: "p",
      state: "stopped",
      startedAt: new Date().toISOString(),
      stoppedAt: new Date().toISOString(),
    };
    this.emit("session_stopped", session);
  }
}

// Mock dependencies
vi.mock("../../packages/core/src/orchestrator/persistence.js", async (importOriginal) => {
  const mod = await importOriginal() as Record<string, unknown>;
  return {
    ...mod,
    savePlan: vi.fn(async () => {}),
    savePlanContext: vi.fn(async () => {}),
  };
});

vi.mock("../../packages/core/src/config/loader.js", () => ({
  loadProject: vi.fn(async (id: string) => ({
    id,
    name: id,
    path: `/tmp/test-${id}`,
    stack: { languages: [], frameworks: [], packageManagers: [{ name: "npm", sourceFile: "package-lock.json" }], infrastructure: [], versionManagers: [] },
    testing: { framework: "vitest", command: "npm test" },
    linting: [{ name: "eslint", sourceFile: ".eslintrc.json" }],
  })),
}));

vi.mock("../../packages/core/src/detection/tickets.js", () => ({
  scanTickets: vi.fn(async () => []),
}));

vi.mock("../../packages/core/src/agents/context-builder.js", () => ({
  buildContextPacket: vi.fn(async () => ({
    project: { name: "test", path: "/tmp", stack: {}, testing: null, linting: [], services: [] },
    git: { branch: "main", remote: null, clean: true },
  })),
  contextPacketToMarkdown: vi.fn(() => "# Test context"),
}));

const mockCommitStepChanges = vi.fn(async () => true);
const mockCaptureChangeset = vi.fn(async () => null);
vi.mock("../../packages/core/src/orchestrator/git-ops.js", () => ({
  commitStepChanges: (...args: unknown[]) => mockCommitStepChanges(...args),
  captureChangeset: (...args: unknown[]) => mockCaptureChangeset(...args),
}));

vi.mock("../../packages/core/src/config/roles.js", () => ({
  loadRole: vi.fn(async () => ({ id: "engineer", name: "Engineer" })),
  resolveRoleConfig: vi.fn((_roleDef: unknown, stackPatterns: string[], planConfig: Record<string, unknown>) => ({
    roleId: "engineer",
    name: "Engineer",
    permissionMode: "acceptEdits",
    allowedTools: [],
    disallowedTools: ["EnterPlanMode", "ExitPlanMode", "EnterWorktree"],
    allowedBashPatterns: [...(stackPatterns ?? []), ...((planConfig?.allowedBashPatterns as string[]) ?? [])],
    instructions: "",
    doneCriteria: "",
    runTests: false,
    runOracle: false,
    denyPaths: [],
  })),
}));

// Mock worktree manager
const mockHasCommits = vi.fn(async () => true);
const mockMerge = vi.fn(async () => ({ merged: true, conflict: false }));
const mockCreate = vi.fn(async (_projectPath: string, ticketId: string) => ({
  worktreePath: `/tmp/worktree-${ticketId}`,
  branch: `opcom/${ticketId}`,
}));
const mockRemove = vi.fn(async () => {});
const mockWriteLock = vi.fn(async () => {});

vi.mock("../../packages/core/src/orchestrator/worktree.js", () => {
  return {
    WorktreeManager: vi.fn().mockImplementation(() => ({
      create: mockCreate,
      remove: mockRemove,
      hasCommits: mockHasCommits,
      merge: mockMerge,
      attemptRebase: vi.fn(async () => ({ rebased: false, conflict: false, error: "not implemented" })),
      getInfo: vi.fn(),
      restore: vi.fn(),
      writeLock: mockWriteLock,
    })),
  };
});

vi.mock("../../packages/core/src/skills/oracle.js", () => ({
  collectOracleInputs: vi.fn(async () => ({})),
  formatOraclePrompt: vi.fn(() => "oracle prompt"),
  parseOracleResponse: vi.fn(() => ({ passed: true, criteria: [], concerns: [] })),
}));

vi.mock("../../packages/core/src/graph/graph-service.js", () => ({
  queryGraphContext: vi.fn(() => null),
  ingestTestResults: vi.fn(),
}));

const mockUpdateProjectSummary = vi.fn(async () => {});
vi.mock("../../packages/core/src/config/summary.js", () => ({
  readProjectSummary: vi.fn(async () => null),
  writeProjectSummary: vi.fn(async () => {}),
  updateProjectSummary: (...args: unknown[]) => mockUpdateProjectSummary(...args),
  createInitialSummaryFromDescription: vi.fn(() => ""),
}));

// Mock smoke test — this is the key mock for these tests
const mockRunSmoke = vi.fn<[], Promise<IntegrationTestResult>>();
vi.mock("../../packages/core/src/orchestrator/smoke-test.js", () => ({
  runSmoke: (...args: unknown[]) => mockRunSmoke(...args as []),
}));

function makePlan(steps: PlanStep[], configOverrides?: Partial<ReturnType<typeof defaultConfig>>): Plan {
  return {
    id: "test-plan",
    name: "Test Plan",
    status: "planning",
    scope: {},
    steps,
    config: { ...defaultConfig(), worktree: true, verification: { runTests: false, runOracle: false }, ...configOverrides },
    context: "",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

function makeStagedPlan(
  steps: PlanStep[],
  stages: PlanStage[],
  configOverrides?: Partial<ReturnType<typeof defaultConfig>>,
): Plan {
  return {
    ...makePlan(steps, configOverrides),
    stages,
    currentStage: 0,
  };
}

describe("Executor smoke tests — plan completion", () => {
  let mockSM: MockSessionManager;

  beforeEach(() => {
    mockSM = new MockSessionManager();
    vi.clearAllMocks();
    mockHasCommits.mockResolvedValue(true);
    mockMerge.mockResolvedValue({ merged: true, conflict: false });
  });

  it("runs final smoke test when plan completes", async () => {
    mockRunSmoke.mockResolvedValue({
      passed: true,
      buildPassed: true,
      testsPassed: true,
      buildOutput: "Build OK",
      testOutput: "Tests OK",
      durationMs: 3000,
    });

    const plan = makePlan([
      { ticketId: "t1", projectId: "p", status: "ready", blockedBy: [] },
    ]);

    const planEvents: Array<{ planId: string; eventType: string; opts?: unknown }> = [];
    const mockEventStore = {
      insertPlanEvent: (planId: string, eventType: string, opts?: unknown) => {
        planEvents.push({ planId, eventType, opts });
      },
      insertChangeset: vi.fn(),
    };

    const executor = new Executor(
      plan,
      mockSM as unknown as import("../../packages/core/src/agents/session-manager.js").SessionManager,
      mockEventStore as unknown as import("../../packages/core/src/agents/event-store.js").EventStore,
    );

    const smokeEvents: Array<{ result: IntegrationTestResult; trigger: string }> = [];
    executor.on("smoke_test", (data) => smokeEvents.push(data as { result: IntegrationTestResult; trigger: string }));

    const runPromise = executor.run();
    await waitFor(() => plan.steps[0].status === "in-progress");

    // Complete the step
    const sessionId = plan.steps[0].agentSessionId!;
    mockSM.simulateWrite(sessionId);
    mockSM.simulateCompletion(sessionId);
    await waitFor(() => executor.getPlan().status === "done" || executor.getPlan().status === "paused");

    const currentPlan = executor.getPlan();
    expect(currentPlan.status).toBe("done");
    expect(mockRunSmoke).toHaveBeenCalled();
    expect(currentPlan.smokeTestResult).toBeDefined();
    expect(currentPlan.smokeTestResult!.passed).toBe(true);

    // Smoke test event emitted
    expect(smokeEvents).toHaveLength(1);
    expect(smokeEvents[0].trigger).toBe("plan_completion");

    // Event store logged
    expect(planEvents.some((e) => e.eventType === "smoke_test")).toBe(true);

    executor.stop();
    await runPromise;
  });

  it("includes smoke test result in plan_completed event detail", async () => {
    mockRunSmoke.mockResolvedValue({
      passed: false,
      buildPassed: true,
      testsPassed: false,
      buildOutput: "Build OK",
      testOutput: "FAIL some.test.ts",
      durationMs: 5000,
    });

    const plan = makePlan([
      { ticketId: "t1", projectId: "p", status: "ready", blockedBy: [] },
    ]);

    const planEvents: Array<{ planId: string; eventType: string; opts?: unknown }> = [];
    const mockEventStore = {
      insertPlanEvent: (planId: string, eventType: string, opts?: unknown) => {
        planEvents.push({ planId, eventType, opts });
      },
      insertChangeset: vi.fn(),
    };

    const executor = new Executor(
      plan,
      mockSM as unknown as import("../../packages/core/src/agents/session-manager.js").SessionManager,
      mockEventStore as unknown as import("../../packages/core/src/agents/event-store.js").EventStore,
    );

    const runPromise = executor.run();
    await waitFor(() => plan.steps[0].status === "in-progress");

    const sessionId = plan.steps[0].agentSessionId!;
    mockSM.simulateWrite(sessionId);
    mockSM.simulateCompletion(sessionId);
    await waitFor(() => executor.getPlan().status === "done" || executor.getPlan().status === "paused");

    // Plan still completes (smoke test is non-fatal at plan completion)
    const currentPlan = executor.getPlan();
    expect(currentPlan.status).toBe("done");
    expect(currentPlan.smokeTestResult).toBeDefined();
    expect(currentPlan.smokeTestResult!.passed).toBe(false);
    expect(currentPlan.smokeTestResult!.testsPassed).toBe(false);

    // plan_completed event includes smoke test detail
    const completedEvent = planEvents.find((e) => e.eventType === "plan_completed");
    expect(completedEvent).toBeDefined();
    const detail = (completedEvent!.opts as { detail: Record<string, unknown> }).detail;
    expect(detail.smokeTest).toBeDefined();

    executor.stop();
    await runPromise;
  });
});

describe("Executor smoke tests — stage completion", () => {
  let mockSM: MockSessionManager;

  beforeEach(() => {
    mockSM = new MockSessionManager();
    vi.clearAllMocks();
    mockHasCommits.mockResolvedValue(true);
    mockMerge.mockResolvedValue({ merged: true, conflict: false });
  });

  it("runs smoke test after stage completes", async () => {
    mockRunSmoke.mockResolvedValue({
      passed: true,
      buildPassed: true,
      testsPassed: true,
      buildOutput: "Build OK",
      testOutput: "Tests OK",
      durationMs: 2000,
    });

    const plan = makeStagedPlan(
      [
        { ticketId: "t1", projectId: "p", status: "ready", blockedBy: [] },
        { ticketId: "t2", projectId: "p", status: "blocked", blockedBy: ["t1"] },
      ],
      [
        { index: 0, stepTicketIds: ["t1"], status: "executing", startedAt: new Date().toISOString() },
        { index: 1, stepTicketIds: ["t2"], status: "pending" },
      ],
      { autoContinue: true },
    );

    const smokeEvents: Array<{ result: IntegrationTestResult; trigger: string; stageIndex?: number }> = [];
    const executor = new Executor(plan, mockSM as unknown as import("../../packages/core/src/agents/session-manager.js").SessionManager);
    executor.on("smoke_test", (data) => smokeEvents.push(data as { result: IntegrationTestResult; trigger: string; stageIndex?: number }));

    const runPromise = executor.run();
    await waitFor(() => plan.steps[0].status === "in-progress");

    // Complete t1 (stage 0)
    const sessionId = plan.steps[0].agentSessionId!;
    mockSM.simulateWrite(sessionId);
    mockSM.simulateCompletion(sessionId);
    await waitFor(() => smokeEvents.some((e) => e.trigger === "stage" && e.stageIndex === 0));

    // Smoke test should have been called for stage 0
    expect(smokeEvents.some((e) => e.trigger === "stage" && e.stageIndex === 0)).toBe(true);

    // Stage 0 summary should have smoke test result
    expect(plan.stages![0].summary?.smokeTest).toBeDefined();
    expect(plan.stages![0].summary?.smokeTest?.passed).toBe(true);

    executor.stop();
    await runPromise;
  });

  it("pauses plan when smoke test fails after stage", async () => {
    mockRunSmoke.mockResolvedValue({
      passed: false,
      buildPassed: false,
      testsPassed: false,
      buildOutput: "error TS2322: type mismatch",
      testOutput: "",
      durationMs: 1500,
    });

    const plan = makeStagedPlan(
      [
        { ticketId: "t1", projectId: "p", status: "ready", blockedBy: [] },
        { ticketId: "t2", projectId: "p", status: "blocked", blockedBy: ["t1"] },
      ],
      [
        { index: 0, stepTicketIds: ["t1"], status: "executing", startedAt: new Date().toISOString() },
        { index: 1, stepTicketIds: ["t2"], status: "pending" },
      ],
      { autoContinue: true },
    );

    let paused = false;
    const executor = new Executor(plan, mockSM as unknown as import("../../packages/core/src/agents/session-manager.js").SessionManager);
    executor.on("plan_paused", () => { paused = true; });

    const runPromise = executor.run();
    await waitFor(() => plan.steps[0].status === "in-progress");

    // Complete t1
    const sessionId = plan.steps[0].agentSessionId!;
    mockSM.simulateWrite(sessionId);
    mockSM.simulateCompletion(sessionId);
    await waitFor(() => executor.getPlan().status === "done" || executor.getPlan().status === "paused");

    // Plan should be paused because smoke test failed
    expect(paused).toBe(true);
    expect(executor.getPlan().status).toBe("paused");

    // Stage 1 should NOT have started
    expect(executor.getPlan().stages![1].status).toBe("pending");

    executor.stop();
    await runPromise;
  });

  it("reports build failure distinctly from test failure in pause reason", async () => {
    // Test failure (build passes, tests fail)
    mockRunSmoke.mockResolvedValue({
      passed: false,
      buildPassed: true,
      testsPassed: false,
      buildOutput: "Build OK",
      testOutput: "FAIL src/utils.test.ts",
      durationMs: 3000,
    });

    const planEvents: Array<{ planId: string; eventType: string; opts?: unknown }> = [];
    const mockEventStore = {
      insertPlanEvent: (planId: string, eventType: string, opts?: unknown) => {
        planEvents.push({ planId, eventType, opts });
      },
      insertChangeset: vi.fn(),
    };

    const plan = makeStagedPlan(
      [
        { ticketId: "t1", projectId: "p", status: "ready", blockedBy: [] },
        { ticketId: "t2", projectId: "p", status: "blocked", blockedBy: ["t1"] },
      ],
      [
        { index: 0, stepTicketIds: ["t1"], status: "executing", startedAt: new Date().toISOString() },
        { index: 1, stepTicketIds: ["t2"], status: "pending" },
      ],
      { autoContinue: true },
    );

    const executor = new Executor(
      plan,
      mockSM as unknown as import("../../packages/core/src/agents/session-manager.js").SessionManager,
      mockEventStore as unknown as import("../../packages/core/src/agents/event-store.js").EventStore,
    );

    const runPromise = executor.run();
    await waitFor(() => plan.steps[0].status === "in-progress");

    const sessionId = plan.steps[0].agentSessionId!;
    mockSM.simulateWrite(sessionId);
    mockSM.simulateCompletion(sessionId);
    await waitFor(() => executor.getPlan().status === "done" || executor.getPlan().status === "paused");

    // Should have a plan_paused event with test failure reason
    const pausedEvent = planEvents.find((e) => e.eventType === "plan_paused");
    expect(pausedEvent).toBeDefined();
    const detail = (pausedEvent!.opts as { detail: Record<string, unknown> }).detail;
    expect((detail.reason as string)).toContain("tests failed");

    executor.stop();
    await runPromise;
  });

  it("stores smoke test results in event store", async () => {
    mockRunSmoke.mockResolvedValue({
      passed: true,
      buildPassed: true,
      testsPassed: true,
      buildOutput: "OK",
      testOutput: "OK",
      durationMs: 1000,
    });

    const planEvents: Array<{ planId: string; eventType: string; opts?: unknown }> = [];
    const mockEventStore = {
      insertPlanEvent: (planId: string, eventType: string, opts?: unknown) => {
        planEvents.push({ planId, eventType, opts });
      },
      insertChangeset: vi.fn(),
    };

    const plan = makeStagedPlan(
      [
        { ticketId: "t1", projectId: "p", status: "ready", blockedBy: [] },
      ],
      [
        { index: 0, stepTicketIds: ["t1"], status: "executing", startedAt: new Date().toISOString() },
      ],
    );

    const executor = new Executor(
      plan,
      mockSM as unknown as import("../../packages/core/src/agents/session-manager.js").SessionManager,
      mockEventStore as unknown as import("../../packages/core/src/agents/event-store.js").EventStore,
    );

    const runPromise = executor.run();
    await waitFor(() => plan.steps[0].status === "in-progress");

    const sessionId = plan.steps[0].agentSessionId!;
    mockSM.simulateWrite(sessionId);
    mockSM.simulateCompletion(sessionId);
    await waitFor(() => executor.getPlan().status === "done" || executor.getPlan().status === "paused");

    // smoke_test events should be in the event store
    const smokeEvents = planEvents.filter((e) => e.eventType === "smoke_test");
    expect(smokeEvents.length).toBeGreaterThanOrEqual(1);

    // Verify structure
    const smokeEvent = smokeEvents[0];
    const detail = (smokeEvent.opts as { detail: Record<string, unknown> }).detail;
    expect(detail.result).toBeDefined();
    expect((detail.result as IntegrationTestResult).passed).toBe(true);

    executor.stop();
    await runPromise;
  });
});

describe("Executor smoke tests — non-staged plans", () => {
  let mockSM: MockSessionManager;

  beforeEach(() => {
    mockSM = new MockSessionManager();
    vi.clearAllMocks();
    mockHasCommits.mockResolvedValue(true);
    mockMerge.mockResolvedValue({ merged: true, conflict: false });
  });

  it("runs final smoke test on plan completion even without stages", async () => {
    mockRunSmoke.mockResolvedValue({
      passed: true,
      buildPassed: true,
      testsPassed: true,
      buildOutput: "Build OK",
      testOutput: "Tests OK",
      durationMs: 2000,
    });

    const plan = makePlan([
      { ticketId: "t1", projectId: "p", status: "ready", blockedBy: [] },
      { ticketId: "t2", projectId: "p", status: "ready", blockedBy: [] },
    ], { maxConcurrentAgents: 2 });

    const executor = new Executor(plan, mockSM as unknown as import("../../packages/core/src/agents/session-manager.js").SessionManager);

    const runPromise = executor.run();
    await waitFor(() => plan.steps.every((s) => s.status === "in-progress"));

    // Complete both steps
    for (const step of plan.steps) {
      const sid = step.agentSessionId!;
      mockSM.simulateWrite(sid);
      mockSM.simulateCompletion(sid);
    }
    // Wait for the async completion chain (worktree verification, merge, smoke test)
    await vi.waitFor(() => {
      expect(executor.getPlan().status).toBe("done");
    }, { timeout: 5000, interval: 10 });

    const currentPlan = executor.getPlan();
    expect(mockRunSmoke).toHaveBeenCalled();
    expect(currentPlan.smokeTestResult).toBeDefined();
    expect(currentPlan.smokeTestResult!.passed).toBe(true);

    executor.stop();
    await runPromise;
  });
});

describe("Executor — project summary updates", () => {
  let mockSM: MockSessionManager;

  beforeEach(() => {
    mockSM = new MockSessionManager();
    vi.clearAllMocks();
    mockHasCommits.mockResolvedValue(true);
    mockMerge.mockResolvedValue({ merged: true, conflict: false });
  });

  it("calls updateProjectSummary after step completion", async () => {
    const plan = makePlan([
      { ticketId: "t1", projectId: "p", status: "ready", blockedBy: [] },
    ]);

    const executor = new Executor(plan, mockSM as unknown as import("../../packages/core/src/agents/session-manager.js").SessionManager);

    const runPromise = executor.run();
    await waitFor(() => plan.steps[0].status === "in-progress");

    const sessionId = plan.steps[0].agentSessionId!;
    mockSM.simulateWrite(sessionId);
    mockSM.simulateCompletion(sessionId);
    await waitFor(() => executor.getPlan().status === "done" || executor.getPlan().status === "paused");

    expect(mockUpdateProjectSummary).toHaveBeenCalledWith(
      "p",
      "p",
      expect.objectContaining({
        completedTicketId: "t1",
      }),
    );

    executor.stop();
    await runPromise;
  });

  it("calls updateProjectSummary for each step in multi-step plan", async () => {
    const plan = makePlan([
      { ticketId: "t1", projectId: "p", status: "ready", blockedBy: [] },
      { ticketId: "t2", projectId: "p", status: "ready", blockedBy: [] },
    ], { maxConcurrentAgents: 2 });

    const executor = new Executor(plan, mockSM as unknown as import("../../packages/core/src/agents/session-manager.js").SessionManager);

    const runPromise = executor.run();
    await waitFor(() => plan.steps.every((s) => s.status === "in-progress"));

    for (const step of plan.steps) {
      const sid = step.agentSessionId!;
      mockSM.simulateWrite(sid);
      mockSM.simulateCompletion(sid);
    }
    await waitFor(() => executor.getPlan().status === "done");

    expect(mockUpdateProjectSummary).toHaveBeenCalledTimes(2);
    expect(mockUpdateProjectSummary).toHaveBeenCalledWith(
      "p", "p", expect.objectContaining({ completedTicketId: "t1" }),
    );
    expect(mockUpdateProjectSummary).toHaveBeenCalledWith(
      "p", "p", expect.objectContaining({ completedTicketId: "t2" }),
    );

    executor.stop();
    await runPromise;
  });
});
