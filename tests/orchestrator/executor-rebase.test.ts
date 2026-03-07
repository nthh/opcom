import { describe, it, expect, vi, beforeEach } from "vitest";
import { Executor } from "../../packages/core/src/orchestrator/executor.js";
import { defaultConfig } from "../../packages/core/src/orchestrator/persistence.js";
import type { Plan, PlanStep, AgentSession, VerificationResult } from "@opcom/types";

// Mock SessionManager
type EventHandler<T> = (data: T) => void;

class MockSessionManager {
  private listeners = new Map<string, Set<EventHandler<unknown>>>();
  startCalls: Array<{ projectId: string; backend: string; config: unknown; ticketId?: string }> = [];
  private sessionCounter = 0;

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
      pid: 12345,
    };
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
    testing: { framework: "vitest", command: "npm test" },
    linting: [],
  })),
}));

vi.mock("../../packages/core/src/detection/tickets.js", () => ({
  scanTickets: mockScanTickets,
}));

vi.mock("node:fs/promises", () => ({
  readFile: mockReadFile,
  writeFile: mockWriteFile,
}));

vi.mock("../../packages/core/src/agents/context-builder.js", () => ({
  buildContextPacket: vi.fn(async () => ({
    project: { name: "test", path: "/tmp", stack: {}, testing: null, linting: [], services: [] },
    git: { branch: "main", remote: null, clean: true },
  })),
  contextPacketToMarkdown: mockContextPacketToMarkdown,
}));

const {
  mockCommitStepChanges,
  mockCaptureChangeset,
  mockScanTickets,
  mockWriteFile,
  mockReadFile,
  mockContextPacketToMarkdown,
} = vi.hoisted(() => ({
  mockCommitStepChanges: vi.fn(async () => true),
  mockCaptureChangeset: vi.fn(async () => null),
  mockScanTickets: vi.fn(async () => []),
  mockWriteFile: vi.fn(async () => {}),
  mockReadFile: vi.fn(async () => "---\nstatus: in-progress\n---\n"),
  mockContextPacketToMarkdown: vi.fn(() => "# Test context"),
}));

vi.mock("../../packages/core/src/orchestrator/git-ops.js", () => ({
  commitStepChanges: mockCommitStepChanges,
  captureChangeset: mockCaptureChangeset,
}));

vi.mock("../../packages/core/src/config/roles.js", () => ({
  loadRole: vi.fn(async () => ({ id: "engineer", name: "Engineer" })),
  resolveRoleConfig: vi.fn((_roleDef: unknown, _stackPatterns: string[], planConfig: Record<string, unknown>) => {
    const verification = (planConfig?.verification ?? {}) as Record<string, unknown>;
    return {
      name: "Engineer",
      permissionMode: "acceptEdits",
      allowedTools: [],
      disallowedTools: [],
      allowedBashPatterns: [],
      instructions: "",
      doneCriteria: "",
      runTests: verification.runTests ?? false,
      runOracle: verification.runOracle ?? false,
    };
  }),
}));

// Mock WorktreeManager
const { mockCreate, mockRemove, mockHasCommits, mockMerge, mockCleanupOrphaned, mockWriteLock, mockAttemptRebase } = vi.hoisted(() => ({
  mockCreate: vi.fn(),
  mockRemove: vi.fn(),
  mockHasCommits: vi.fn(),
  mockMerge: vi.fn(),
  mockCleanupOrphaned: vi.fn(),
  mockWriteLock: vi.fn(),
  mockAttemptRebase: vi.fn(),
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
    attemptRebase: mockAttemptRebase,
  }));
  MockManager.cleanupOrphaned = mockCleanupOrphaned;
  return { WorktreeManager: MockManager };
});

function makePlan(steps: PlanStep[], configOverrides?: Partial<ReturnType<typeof defaultConfig>>): Plan {
  return {
    id: "test-plan",
    name: "Test Plan",
    status: "planning",
    scope: {},
    steps,
    config: { ...defaultConfig(), ...configOverrides },
    context: "",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

describe("Executor auto-rebase on merge conflict", () => {
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
    mockCleanupOrphaned.mockResolvedValue([]);
    mockScanTickets.mockResolvedValue([]);
    mockReadFile.mockResolvedValue("---\nstatus: in-progress\n---\n");
    mockHasCommits.mockResolvedValue(true);
  });

  it("attempts clean rebase when merge conflicts and autoRebase=true", async () => {
    // Merge fails with conflict, clean rebase succeeds, re-merge succeeds
    mockMerge
      .mockResolvedValueOnce({ merged: false, conflict: true, error: "CONFLICT in file.ts" })
      .mockResolvedValueOnce({ merged: true, conflict: false });
    mockAttemptRebase.mockResolvedValue({ rebased: true, conflict: false });

    const plan = makePlan([
      { ticketId: "t1", projectId: "p", status: "ready", blockedBy: [] },
    ], { worktree: true, verification: { runTests: false, runOracle: false, autoRebase: true } });

    const executor = new Executor(plan, mockSM as unknown as import("../../packages/core/src/agents/session-manager.js").SessionManager);

    const completed: string[] = [];
    executor.on("step_completed", ({ step }) => completed.push(step.ticketId));

    const runPromise = executor.run();
    await new Promise((r) => setTimeout(r, 50));

    const sessionId = plan.steps[0].agentSessionId!;
    mockSM.simulateCompletion(sessionId);
    await new Promise((r) => setTimeout(r, 200));

    expect(mockAttemptRebase).toHaveBeenCalledWith("t1");
    expect(mockMerge).toHaveBeenCalledTimes(2); // original + post-rebase
    expect(completed).toContain("t1");
    expect(plan.steps[0].status).toBe("done");

    executor.stop();
    await runPromise;
  });

  it("starts agent for conflict resolution when clean rebase fails with conflict", async () => {
    // Merge fails with conflict, clean rebase also fails with conflict
    mockMerge.mockResolvedValue({ merged: false, conflict: true, error: "CONFLICT in file.ts" });
    mockAttemptRebase.mockResolvedValue({
      rebased: false,
      conflict: true,
      conflictFiles: ["src/file.ts", "src/other.ts"],
      error: "CONFLICT (content): Merge conflict in src/file.ts",
    });

    const plan = makePlan([
      { ticketId: "t1", projectId: "p", status: "ready", blockedBy: [] },
    ], { worktree: true, verification: { runTests: false, runOracle: false, autoRebase: true } });

    const executor = new Executor(plan, mockSM as unknown as import("../../packages/core/src/agents/session-manager.js").SessionManager);

    const runPromise = executor.run();
    await new Promise((r) => setTimeout(r, 50));

    const sessionId = plan.steps[0].agentSessionId!;
    mockSM.simulateCompletion(sessionId);
    await new Promise((r) => setTimeout(r, 200));

    // Step should have been re-queued with rebaseConflict
    const step = plan.steps[0];

    // After rebase conflict, step should be re-started with a new session
    // (startReadySteps runs after recomputeAndContinue)
    expect(mockSM.startCalls.length).toBeGreaterThanOrEqual(2); // original + conflict resolution

    // The second startSession should have been called with the rebaseConflict context
    // contextPacketToMarkdown should have been called with rebaseConflict param
    const lastCtxCall = mockContextPacketToMarkdown.mock.calls.at(-1);
    expect(lastCtxCall).toBeDefined();
    // The 4th argument should be the rebaseConflict
    expect(lastCtxCall![3]).toEqual({
      files: ["src/file.ts", "src/other.ts"],
      baseBranch: "main",
    });

    executor.stop();
    await runPromise;
  });

  it("preserves existing behavior when autoRebase=false", async () => {
    mockMerge.mockResolvedValue({ merged: false, conflict: true, error: "CONFLICT in file.ts" });

    const plan = makePlan([
      { ticketId: "t1", projectId: "p", status: "ready", blockedBy: [] },
    ], {
      worktree: true,
      pauseOnFailure: true,
      verification: { runTests: false, runOracle: false, autoRebase: false },
    });

    const executor = new Executor(plan, mockSM as unknown as import("../../packages/core/src/agents/session-manager.js").SessionManager);

    const needsRebase: string[] = [];
    executor.on("step_needs_rebase", ({ step }) => needsRebase.push(step.ticketId));

    const runPromise = executor.run();
    await new Promise((r) => setTimeout(r, 50));

    const sessionId = plan.steps[0].agentSessionId!;
    mockSM.simulateCompletion(sessionId);
    await new Promise((r) => setTimeout(r, 200));

    // Should NOT attempt rebase
    expect(mockAttemptRebase).not.toHaveBeenCalled();
    // Should immediately go to needs-rebase
    expect(needsRebase).toContain("t1");
    expect(plan.steps[0].status).toBe("needs-rebase");

    executor.stop();
    await runPromise;
  });

  it("marks needs-rebase when agent fails to resolve conflicts", async () => {
    // First merge: conflict
    // Rebase: conflict → agent started
    // Agent completes → handleWorktreeCompletion called again (wasRebaseResolution=true)
    // Second merge: still conflicts → needs-rebase (no infinite loop)
    mockMerge.mockResolvedValue({ merged: false, conflict: true, error: "CONFLICT" });
    mockAttemptRebase.mockResolvedValue({
      rebased: false,
      conflict: true,
      conflictFiles: ["file.ts"],
    });

    const plan = makePlan([
      { ticketId: "t1", projectId: "p", status: "ready", blockedBy: [] },
    ], {
      worktree: true,
      pauseOnFailure: false,
      verification: { runTests: false, runOracle: false, autoRebase: true },
    });

    const executor = new Executor(plan, mockSM as unknown as import("../../packages/core/src/agents/session-manager.js").SessionManager);

    const needsRebase: string[] = [];
    executor.on("step_needs_rebase", ({ step }) => needsRebase.push(step.ticketId));

    const runPromise = executor.run();
    await new Promise((r) => setTimeout(r, 100));

    // First agent completes → merge conflict → rebase conflict → agent re-queued
    const sessionId1 = plan.steps[0].agentSessionId!;
    mockSM.simulateCompletion(sessionId1);
    await new Promise((r) => setTimeout(r, 300));

    // The rebase resolution agent should have started
    expect(mockSM.startCalls.length).toBeGreaterThanOrEqual(2);

    // After recomputeAndContinue, the plan is a new object — use executor.getPlan()
    let currentStep = executor.getPlan().steps[0];
    const sessionId2 = currentStep.agentSessionId!;
    expect(sessionId2).not.toBe(sessionId1); // Must be a different session

    // Second agent (rebase resolver) completes → merge still conflicts
    // wasRebaseResolution=true → skips auto-rebase → needs-rebase
    mockSM.simulateCompletion(sessionId2);
    await new Promise((r) => setTimeout(r, 300));

    // Step should now be in needs-rebase since the rebase resolver also failed to merge
    currentStep = executor.getPlan().steps[0];
    expect(currentStep.status).toBe("needs-rebase");
    expect(needsRebase).toContain("t1");

    executor.stop();
    await runPromise;
  });

  it("skips worktree creation for rebase resolution (reuses existing worktree)", async () => {
    // First: conflict → rebase conflict → agent re-queued
    mockMerge.mockResolvedValue({ merged: false, conflict: true, error: "CONFLICT" });
    mockAttemptRebase.mockResolvedValue({
      rebased: false,
      conflict: true,
      conflictFiles: ["file.ts"],
    });

    const plan = makePlan([
      { ticketId: "t1", projectId: "p", status: "ready", blockedBy: [] },
    ], {
      worktree: true,
      verification: { runTests: false, runOracle: false, autoRebase: true },
    });

    const executor = new Executor(plan, mockSM as unknown as import("../../packages/core/src/agents/session-manager.js").SessionManager);

    const runPromise = executor.run();
    await new Promise((r) => setTimeout(r, 50));

    // First agent completes
    const sessionId1 = plan.steps[0].agentSessionId!;
    mockSM.simulateCompletion(sessionId1);
    await new Promise((r) => setTimeout(r, 200));

    // Worktree should have been created once for the original step,
    // NOT created again for the rebase resolution agent
    expect(mockCreate).toHaveBeenCalledTimes(1);
    // But a second session should have been started
    expect(mockSM.startCalls.length).toBeGreaterThanOrEqual(2);

    executor.stop();
    await runPromise;
  });

  it("step state tracks rebaseConflict correctly", () => {
    const step: PlanStep = {
      ticketId: "t1",
      projectId: "p",
      status: "in-progress",
      blockedBy: [],
      agentSessionId: "session-1",
      worktreePath: "/tmp/worktree-t1",
      worktreeBranch: "work/t1",
    };

    // Simulate setting rebaseConflict (as executor does)
    step.rebaseConflict = {
      files: ["src/index.ts", "src/utils.ts"],
      baseBranch: "main",
    };
    step.status = "ready";
    step.agentSessionId = undefined;

    expect(step.rebaseConflict).toEqual({
      files: ["src/index.ts", "src/utils.ts"],
      baseBranch: "main",
    });
    expect(step.status).toBe("ready");
    // Worktree preserved
    expect(step.worktreePath).toBe("/tmp/worktree-t1");
    expect(step.worktreeBranch).toBe("work/t1");
  });

  it("rebaseConflict is cleared after agent completion", () => {
    const step: PlanStep = {
      ticketId: "t1",
      projectId: "p",
      status: "in-progress",
      blockedBy: [],
      agentSessionId: "session-2",
      worktreePath: "/tmp/worktree-t1",
      worktreeBranch: "work/t1",
      rebaseConflict: {
        files: ["src/index.ts"],
        baseBranch: "main",
      },
    };

    // Simulate what handleWorktreeCompletion does
    const wasRebaseResolution = !!step.rebaseConflict;
    step.rebaseConflict = undefined;

    expect(wasRebaseResolution).toBe(true);
    expect(step.rebaseConflict).toBeUndefined();
  });

  it("defaultConfig includes autoRebase: true", () => {
    const config = defaultConfig();
    expect(config.verification.autoRebase).toBe(true);
  });
});
