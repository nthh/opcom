import { describe, it, expect, vi, beforeEach } from "vitest";
import { Executor } from "../../packages/core/src/orchestrator/executor.js";
import { defaultConfig } from "../../packages/core/src/orchestrator/persistence.js";
import type { Plan, PlanStep, AgentSession, AgentState, StallSignal } from "@opcom/types";

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
    services: [],
    docs: { agentConfig: null },
    git: { branch: "main", remote: null, clean: true },
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
  contextPacketToMarkdown: vi.fn((...args: unknown[]) => {
    // Capture stallWarning argument (5th parameter)
    const stallWarning = args[4];
    if (stallWarning) return `# Test context\n${stallWarning}`;
    return "# Test context";
  }),
}));

vi.mock("../../packages/core/src/orchestrator/git-ops.js", () => ({
  commitStepChanges: vi.fn(async () => true),
  captureChangeset: vi.fn(async () => null),
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
    runTests: true,
    runOracle: false,
    denyPaths: [],
  })),
}));

vi.mock("../../packages/core/src/orchestrator/smoke-test.js", () => ({
  runSmoke: vi.fn(async () => ({ passed: true, buildPassed: true, testsPassed: true, buildOutput: "", testOutput: "", durationMs: 0 })),
}));

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

vi.mock("../../packages/core/src/agents/allowed-bash.js", () => ({
  deriveAllowedBashTools: vi.fn(() => []),
}));

vi.mock("../../packages/core/src/graph/graph-service.js", () => ({
  ingestTestResults: vi.fn(),
  queryGraphContext: vi.fn(() => null),
}));

function makePlan(steps: PlanStep[], configOverrides?: Partial<ReturnType<typeof defaultConfig>>): Plan {
  return {
    id: "test-plan",
    name: "Test Plan",
    status: "executing",
    scope: {},
    steps,
    config: { ...defaultConfig(), worktree: true, ...configOverrides },
    context: "",
    createdAt: "2026-03-01T00:00:00Z",
    updatedAt: "2026-03-01T00:00:00Z",
  };
}

describe("Executor stall detection", () => {
  let sm: MockSessionManager;

  beforeEach(() => {
    sm = new MockSessionManager();
    vi.clearAllMocks();
  });

  it("defaultConfig includes stall config with correct defaults", () => {
    const config = defaultConfig();
    expect(config.stall).toBeDefined();
    expect(config.stall.enabled).toBe(true);
    expect(config.stall.agentTimeoutMs).toBe(20 * 60 * 1000);
    expect(config.stall.planStallTimeoutMs).toBe(30 * 60 * 1000);
    expect(config.stall.maxIdenticalFailures).toBe(2);
  });

  it("executor creates a StallDetector from plan config", () => {
    const plan = makePlan([]);
    const executor = new Executor(plan, sm as never);
    const detector = executor.getStallDetector();
    expect(detector).toBeDefined();
  });

  it("emits stall_detected when agent exceeds timeout", async () => {
    const step: PlanStep = {
      ticketId: "step-1",
      projectId: "p",
      status: "in-progress",
      blockedBy: [],
      startedAt: new Date(Date.now() - 25 * 60 * 1000).toISOString(), // 25 min ago
      agentSessionId: "sess-old",
    };

    // Use very short timeout to trigger stall immediately
    const plan = makePlan([step], {
      stall: { enabled: true, agentTimeoutMs: 1, planStallTimeoutMs: 999999999, maxIdenticalFailures: 2 },
    });

    const executor = new Executor(plan, sm as never);

    const stallSignals: StallSignal[] = [];
    executor.on("stall_detected", ({ signal }) => stallSignals.push(signal));

    // Manually trigger the stall check (rather than waiting for the interval)
    // Access the private method via the event system
    // @ts-expect-error — testing private method
    await executor.runStallChecks();

    expect(stallSignals.length).toBe(1);
    expect(stallSignals[0].type).toBe("long-running");
    expect(stallSignals[0].stepId).toBe("step-1");
  });

  it("sets stallSignal on step during stall check", async () => {
    const step: PlanStep = {
      ticketId: "step-1",
      projectId: "p",
      status: "in-progress",
      blockedBy: [],
      startedAt: new Date(Date.now() - 25 * 60 * 1000).toISOString(),
      agentSessionId: "sess-old",
    };

    const plan = makePlan([step], {
      stall: { enabled: true, agentTimeoutMs: 1, planStallTimeoutMs: 999999999, maxIdenticalFailures: 2 },
    });

    const executor = new Executor(plan, sm as never);

    // @ts-expect-error — testing private method
    await executor.runStallChecks();

    expect(step.stallSignal).toBeDefined();
    expect(step.stallSignal!.type).toBe("long-running");
  });

  it("does not emit stall_detected when stall detection is disabled", async () => {
    const step: PlanStep = {
      ticketId: "step-1",
      projectId: "p",
      status: "in-progress",
      blockedBy: [],
      startedAt: new Date(Date.now() - 25 * 60 * 1000).toISOString(),
    };

    const plan = makePlan([step], {
      stall: { enabled: false, agentTimeoutMs: 1, planStallTimeoutMs: 1, maxIdenticalFailures: 2 },
    });

    const executor = new Executor(plan, sm as never);
    const stallSignals: StallSignal[] = [];
    executor.on("stall_detected", ({ signal }) => stallSignals.push(signal));

    // @ts-expect-error — testing private method
    await executor.runStallChecks();

    expect(stallSignals.length).toBe(0);
  });

  it("pauses plan on plan-level stall when pauseOnFailure is true", async () => {
    const step: PlanStep = {
      ticketId: "step-1",
      projectId: "p",
      status: "in-progress",
      blockedBy: [],
      startedAt: new Date().toISOString(),
    };

    const plan = makePlan([step], {
      pauseOnFailure: true,
      stall: { enabled: true, agentTimeoutMs: 999999999, planStallTimeoutMs: 1, maxIdenticalFailures: 2 },
    });

    const executor = new Executor(plan, sm as never);

    // Force the plan stall timer to be old
    const detector = executor.getStallDetector();
    // @ts-expect-error — testing private field
    detector.lastStepTransitionAt = Date.now() - 35 * 60 * 1000;

    const pauseEvents: Plan[] = [];
    executor.on("plan_paused", ({ plan: p }) => pauseEvents.push(p));

    // @ts-expect-error — testing private method
    await executor.runStallChecks();

    expect(plan.status).toBe("paused");
    expect(pauseEvents.length).toBe(1);
  });

  it("does not set stallSignal on step that already has one", async () => {
    const existingSignal: StallSignal = {
      type: "long-running",
      stepId: "step-1",
      message: "existing",
      suggestion: "existing",
      durationMs: 1000,
    };

    const step: PlanStep = {
      ticketId: "step-1",
      projectId: "p",
      status: "in-progress",
      blockedBy: [],
      startedAt: new Date(Date.now() - 25 * 60 * 1000).toISOString(),
      stallSignal: existingSignal,
    };

    const plan = makePlan([step], {
      stall: { enabled: true, agentTimeoutMs: 1, planStallTimeoutMs: 999999999, maxIdenticalFailures: 2 },
    });

    const executor = new Executor(plan, sm as never);

    // @ts-expect-error — testing private method
    await executor.runStallChecks();

    // Should keep the existing signal, not overwrite
    expect(step.stallSignal).toBe(existingSignal);
  });

  it("clears stallSignal when step transitions to in-progress", async () => {
    // Simpler test: verify that startStep clears stallSignal
    const step: PlanStep = {
      ticketId: "step-1",
      projectId: "p",
      status: "ready",
      blockedBy: [],
      stallSignal: {
        type: "long-running",
        stepId: "step-1",
        message: "stalled",
        suggestion: "check",
        durationMs: 1000,
      },
    };

    const plan = makePlan([step], {
      verification: { runTests: false, runOracle: false },
    });

    const executor = new Executor(plan, sm as never);

    // Run executor in background
    const runPromise = executor.run();

    // Wait for step to start
    await vi.waitFor(() => {
      expect(sm.startCalls.length).toBeGreaterThan(0);
    });

    // stallSignal should be cleared when step moved to in-progress
    expect(step.stallSignal).toBeUndefined();
    expect(step.status).toBe("in-progress");

    // Cleanup
    executor.stop();
    await runPromise;
  });

  it("injects stall warning into retry context when failures repeat", async () => {
    const { contextPacketToMarkdown } = await import("../../packages/core/src/agents/context-builder.js");
    const mockFn = vi.mocked(contextPacketToMarkdown);

    const failedVerification = {
      stepTicketId: "step-1",
      passed: false,
      failureReasons: ["Tests failed: 3/10 failed"],
      testGate: {
        passed: false,
        testCommand: "npm test",
        totalTests: 10,
        passedTests: 7,
        failedTests: 3,
        output: "FAIL src/test.ts",
        durationMs: 5000,
      },
    };

    const step: PlanStep = {
      ticketId: "step-1",
      projectId: "p",
      status: "ready",
      blockedBy: [],
      attempt: 2,
      previousVerification: failedVerification,
      verification: failedVerification,
    };

    const plan = makePlan([step], {
      verification: { runTests: false, runOracle: false },
    });

    const executor = new Executor(plan, sm as never);

    // Run executor
    const runPromise = executor.run();

    // Wait for step to start
    await vi.waitFor(() => {
      expect(sm.startCalls.length).toBeGreaterThan(0);
    });

    // Check that contextPacketToMarkdown was called with a stall warning
    const lastCall = mockFn.mock.calls[mockFn.mock.calls.length - 1];
    const stallWarningArg = lastCall[4]; // 5th parameter
    expect(stallWarningArg).toBeDefined();
    expect(stallWarningArg).toContain("Stall Warning");

    // Cleanup
    executor.stop();
    await runPromise;
  });
});
