import { describe, it, expect, vi, beforeEach } from "vitest";
import { Executor } from "../../packages/core/src/orchestrator/executor.js";
import { defaultConfig } from "../../packages/core/src/orchestrator/persistence.js";
import type { Plan, PlanStep, AgentSession, AgentStartConfig } from "@opcom/types";

// Oracle response fixtures
const ORACLE_RESPONSE_ALL_MET = `## Criteria
- **Criterion**: Feature is implemented
  - **Met**: YES
  - **Reasoning**: The existing code already satisfies this requirement

- **Criterion**: Tests are included
  - **Met**: YES
  - **Reasoning**: Test coverage already exists

## Concerns
None.
`;

const ORACLE_RESPONSE_UNMET = `## Criteria
- **Criterion**: Feature is implemented
  - **Met**: NO
  - **Reasoning**: The feature has not been implemented

## Concerns
- The agent did not make any changes
`;

// Mock SessionManager with oracle event simulation
type EventHandler<T> = (data: T) => void;

class MockSessionManager {
  private listeners = new Map<string, Set<EventHandler<unknown>>>();
  startCalls: Array<{ projectId: string; backend: string; config: AgentStartConfig; ticketId?: string }> = [];
  stopCalls: string[] = [];
  private sessionCounter = 0;
  onOracleStart?: (session: AgentSession) => void;

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
    config: AgentStartConfig,
    workItemId?: string,
  ): Promise<AgentSession> {
    this.startCalls.push({ projectId, backend, config, ticketId: workItemId });
    const id = `session-${++this.sessionCounter}`;
    const session: AgentSession = {
      id,
      backend: backend as "claude-code",
      projectId,
      state: "streaming",
      startedAt: new Date().toISOString(),
      workItemId,
      pid: 12345,
    };

    if (workItemId?.startsWith("oracle:") && this.onOracleStart) {
      setImmediate(() => this.onOracleStart!(session));
    }

    return session;
  }

  async stopSession(sessionId: string): Promise<void> {
    this.stopCalls.push(sessionId);
  }

  simulateOracleResponse(session: AgentSession, responseText: string): void {
    this.emit("agent_event", {
      sessionId: session.id,
      event: {
        type: "message_delta",
        sessionId: session.id,
        timestamp: new Date().toISOString(),
        data: { text: responseText, role: "assistant" },
      },
    });
    this.emit("session_stopped", {
      ...session,
      state: "stopped",
      stoppedAt: new Date().toISOString(),
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
    stack: { languages: [], frameworks: [], packageManagers: [], infrastructure: [], versionManagers: [] },
    testing: null, // No test command — skip test gate
    linting: [],
    services: [],
    git: { branch: "main", remote: null },
  })),
}));

const { mockScanTickets } = vi.hoisted(() => ({
  mockScanTickets: vi.fn(),
}));

vi.mock("../../packages/core/src/detection/tickets.js", () => ({
  scanTickets: mockScanTickets,
}));

vi.mock("../../packages/core/src/agents/context-builder.js", () => ({
  buildContextPacket: vi.fn(async () => ({
    project: { name: "test", path: "/tmp", stack: {}, testing: null, linting: [], services: [] },
    git: { branch: "main", remote: null, clean: true },
  })),
  contextPacketToMarkdown: vi.fn(() => "# Test context"),
}));

const { mockCommitStepChanges, mockCaptureChangeset, mockReadFile, mockWriteFile } = vi.hoisted(() => ({
  mockCommitStepChanges: vi.fn(async () => true),
  mockCaptureChangeset: vi.fn(async () => null),
  mockReadFile: vi.fn(async () => "---\nstatus: in-progress\n---\n"),
  mockWriteFile: vi.fn(async () => {}),
}));

vi.mock("../../packages/core/src/orchestrator/git-ops.js", () => ({
  commitStepChanges: mockCommitStepChanges,
  captureChangeset: mockCaptureChangeset,
}));

vi.mock("node:fs/promises", () => ({
  readFile: mockReadFile,
  writeFile: mockWriteFile,
}));

const { mockResolveRoleConfig } = vi.hoisted(() => ({
  mockResolveRoleConfig: vi.fn(() => ({
    roleId: "engineer",
    name: "Engineer",
    permissionMode: "acceptEdits",
    allowedTools: [],
    disallowedTools: ["EnterPlanMode", "ExitPlanMode", "EnterWorktree"],
    allowedBashPatterns: [],
    instructions: "",
    doneCriteria: "",
    runTests: false,
    runOracle: true,
  })),
}));

vi.mock("../../packages/core/src/config/roles.js", () => ({
  loadRole: vi.fn(async () => ({ id: "engineer", name: "Engineer" })),
  resolveRoleConfig: mockResolveRoleConfig,
}));

const { mockCreate, mockRemove, mockHasCommits, mockMerge, mockWriteLock } = vi.hoisted(() => ({
  mockCreate: vi.fn(),
  mockRemove: vi.fn(),
  mockHasCommits: vi.fn(),
  mockMerge: vi.fn(),
  mockWriteLock: vi.fn(),
}));

vi.mock("../../packages/core/src/orchestrator/worktree.js", () => {
  const MockManager = vi.fn().mockImplementation(() => ({
    create: mockCreate,
    remove: mockRemove,
    hasCommits: mockHasCommits,
    merge: mockMerge,
    writeLock: mockWriteLock,
    getInfo: vi.fn(),
    restore: vi.fn(),
  }));
  MockManager.cleanupOrphaned = vi.fn(async () => []);
  return { WorktreeManager: MockManager };
});

vi.mock("../../packages/core/src/skills/oracle.js", async (importOriginal) => {
  const mod = await importOriginal() as Record<string, unknown>;
  return {
    ...mod,
    collectOracleInputs: vi.fn(async () => ({
      ticket: { id: "t1", title: "Test ticket", status: "in-progress", deps: [], links: [], tags: {} },
      gitDiff: "", // Empty diff for zero-commit case
      acceptanceCriteria: ["Feature is implemented", "Tests are included"],
    })),
  };
});

function makePlan(steps: PlanStep[], configOverrides?: Partial<ReturnType<typeof defaultConfig>>): Plan {
  return {
    id: "test-plan",
    name: "Test Plan",
    status: "planning",
    scope: {},
    steps,
    config: {
      ...defaultConfig(),
      worktree: true,
      verification: { runTests: false, runOracle: true, maxRetries: 0 },
      ...configOverrides,
    },
    context: "",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

describe("Zero-commit oracle arbitration", () => {
  let mockSM: MockSessionManager;

  beforeEach(() => {
    mockSM = new MockSessionManager();
    vi.clearAllMocks();
    mockCreate.mockResolvedValue({
      stepId: "t1",
      ticketId: "t1",
      projectPath: "/tmp/test-p",
      worktreePath: "/tmp/test-p/.opcom/worktrees/t1",
      branch: "work/t1",
    });
    mockRemove.mockResolvedValue(undefined);
    mockWriteLock.mockResolvedValue(undefined);
    // Zero commits — agent didn't do anything
    mockHasCommits.mockResolvedValue(false);
    mockMerge.mockResolvedValue({ merged: true, conflict: false });
    mockScanTickets.mockResolvedValue([
      {
        id: "t1", title: "Test ticket", status: "in-progress",
        filePath: "/tmp/test-p/.tickets/impl/t1/README.md",
        deps: [], links: [], tags: {},
      },
    ]);
    mockReadFile.mockResolvedValue("---\nstatus: in-progress\n---\n");
  });

  it("step completes as done when oracle says criteria are already met (zero commits)", async () => {
    mockSM.onOracleStart = (session) => {
      mockSM.simulateOracleResponse(session, ORACLE_RESPONSE_ALL_MET);
    };

    const plan = makePlan([
      { ticketId: "t1", projectId: "p", status: "ready", blockedBy: [] },
    ]);

    const executor = new Executor(plan, mockSM as unknown as import("../../packages/core/src/agents/session-manager.js").SessionManager);

    const completed: string[] = [];
    executor.on("step_completed", ({ step }) => completed.push(step.ticketId));

    const runPromise = executor.run();
    await new Promise((r) => setTimeout(r, 50));

    // Complete the coding agent (which made no commits)
    mockSM.simulateCompletion(plan.steps[0].agentSessionId!);
    await new Promise((r) => setTimeout(r, 300));

    expect(completed).toContain("t1");
    expect(plan.steps[0].status).toBe("done");
    expect(plan.steps[0].verification).toBeDefined();
    expect(plan.steps[0].verification!.passed).toBe(true);
    expect(plan.steps[0].verification!.oracle!.passed).toBe(true);

    executor.stop();
    await runPromise;
  });

  it("step fails when oracle says criteria are unmet (zero commits)", async () => {
    mockSM.onOracleStart = (session) => {
      mockSM.simulateOracleResponse(session, ORACLE_RESPONSE_UNMET);
    };

    const plan = makePlan([
      { ticketId: "t1", projectId: "p", status: "ready", blockedBy: [] },
    ], { pauseOnFailure: false });

    const executor = new Executor(plan, mockSM as unknown as import("../../packages/core/src/agents/session-manager.js").SessionManager);

    const failed: string[] = [];
    executor.on("step_failed", ({ step }) => failed.push(step.ticketId));

    const runPromise = executor.run();
    await new Promise((r) => setTimeout(r, 50));

    mockSM.simulateCompletion(plan.steps[0].agentSessionId!);
    await new Promise((r) => setTimeout(r, 300));

    expect(failed).toContain("t1");
    expect(plan.steps[0].status).toBe("failed");
    expect(plan.steps[0].verification).toBeDefined();
    expect(plan.steps[0].verification!.passed).toBe(false);

    executor.stop();
    await runPromise;
  });

  it("skips oracle and fails immediately when oracle is disabled (zero commits)", async () => {
    // Override role config to also disable oracle
    mockResolveRoleConfig.mockReturnValueOnce({
      roleId: "engineer",
      name: "Engineer",
      permissionMode: "acceptEdits",
      allowedTools: [],
      disallowedTools: ["EnterPlanMode", "ExitPlanMode", "EnterWorktree"],
      allowedBashPatterns: [],
      instructions: "",
      doneCriteria: "",
      runTests: false,
      runOracle: false,
    });

    const plan = makePlan([
      { ticketId: "t1", projectId: "p", status: "ready", blockedBy: [] },
    ], {
      pauseOnFailure: false,
      verification: { runTests: false, runOracle: false, maxRetries: 0 },
    });

    const executor = new Executor(plan, mockSM as unknown as import("../../packages/core/src/agents/session-manager.js").SessionManager);

    const failed: string[] = [];
    executor.on("step_failed", ({ step }) => failed.push(step.ticketId));

    const runPromise = executor.run();
    await new Promise((r) => setTimeout(r, 50));

    mockSM.simulateCompletion(plan.steps[0].agentSessionId!);
    await new Promise((r) => setTimeout(r, 200));

    expect(failed).toContain("t1");
    expect(plan.steps[0].status).toBe("failed");
    // No oracle session should have been started
    const oracleCalls = mockSM.startCalls.filter((c) => c.ticketId?.startsWith("oracle:"));
    expect(oracleCalls).toHaveLength(0);

    executor.stop();
    await runPromise;
  });

  it("enters verifying status while oracle arbitrates zero-commit step", async () => {
    let verifyingObserved = false;

    mockSM.onOracleStart = (session) => {
      setTimeout(() => {
        if (plan.steps[0].status === "verifying") {
          verifyingObserved = true;
        }
        mockSM.simulateOracleResponse(session, ORACLE_RESPONSE_ALL_MET);
      }, 20);
    };

    const plan = makePlan([
      { ticketId: "t1", projectId: "p", status: "ready", blockedBy: [] },
    ]);

    const executor = new Executor(plan, mockSM as unknown as import("../../packages/core/src/agents/session-manager.js").SessionManager);

    const runPromise = executor.run();
    await new Promise((r) => setTimeout(r, 50));

    mockSM.simulateCompletion(plan.steps[0].agentSessionId!);
    await new Promise((r) => setTimeout(r, 300));

    expect(verifyingObserved).toBe(true);

    executor.stop();
    await runPromise;
  });

  it("runs oracle with runTests: false for zero-commit case", async () => {
    mockSM.onOracleStart = (session) => {
      mockSM.simulateOracleResponse(session, ORACLE_RESPONSE_ALL_MET);
    };

    const plan = makePlan([
      { ticketId: "t1", projectId: "p", status: "ready", blockedBy: [] },
    ], {
      // Both tests and oracle enabled at plan level
      verification: { runTests: true, runOracle: true, maxRetries: 0 },
    });

    const executor = new Executor(plan, mockSM as unknown as import("../../packages/core/src/agents/session-manager.js").SessionManager);

    const runPromise = executor.run();
    await new Promise((r) => setTimeout(r, 50));

    mockSM.simulateCompletion(plan.steps[0].agentSessionId!);
    await new Promise((r) => setTimeout(r, 300));

    // Oracle should have been called (for zero-commit arbitration)
    const oracleCalls = mockSM.startCalls.filter((c) => c.ticketId?.startsWith("oracle:"));
    expect(oracleCalls).toHaveLength(1);

    // Step should complete successfully (oracle passes)
    expect(plan.steps[0].status).toBe("done");
    // Test gate should NOT be in the verification result (tests skipped for zero-commit)
    expect(plan.steps[0].verification!.testGate).toBeUndefined();

    executor.stop();
    await runPromise;
  });

  it("cleans up worktree when zero-commit oracle passes", async () => {
    mockSM.onOracleStart = (session) => {
      mockSM.simulateOracleResponse(session, ORACLE_RESPONSE_ALL_MET);
    };

    const plan = makePlan([
      { ticketId: "t1", projectId: "p", status: "ready", blockedBy: [] },
    ]);

    const executor = new Executor(plan, mockSM as unknown as import("../../packages/core/src/agents/session-manager.js").SessionManager);

    const runPromise = executor.run();
    await new Promise((r) => setTimeout(r, 50));

    mockSM.simulateCompletion(plan.steps[0].agentSessionId!);
    await new Promise((r) => setTimeout(r, 300));

    // Worktree should be cleaned up
    expect(mockRemove).toHaveBeenCalledWith("t1");
    expect(plan.steps[0].worktreePath).toBeUndefined();
    expect(plan.steps[0].worktreeBranch).toBeUndefined();

    executor.stop();
    await runPromise;
  });

  it("does not attempt merge when zero-commit oracle passes", async () => {
    mockSM.onOracleStart = (session) => {
      mockSM.simulateOracleResponse(session, ORACLE_RESPONSE_ALL_MET);
    };

    const plan = makePlan([
      { ticketId: "t1", projectId: "p", status: "ready", blockedBy: [] },
    ]);

    const executor = new Executor(plan, mockSM as unknown as import("../../packages/core/src/agents/session-manager.js").SessionManager);

    const runPromise = executor.run();
    await new Promise((r) => setTimeout(r, 50));

    mockSM.simulateCompletion(plan.steps[0].agentSessionId!);
    await new Promise((r) => setTimeout(r, 300));

    // No merge should be attempted — no commits to merge
    expect(mockMerge).not.toHaveBeenCalled();

    executor.stop();
    await runPromise;
  });
});
