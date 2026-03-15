import { describe, it, expect, vi, beforeEach } from "vitest";
import { Executor } from "../../packages/core/src/orchestrator/executor.js";
import { defaultConfig } from "../../packages/core/src/orchestrator/persistence.js";
import type { Plan, PlanStep, AgentSession } from "@opcom/types";
import { waitFor } from "./_helpers.js";

// Mock SessionManager
type EventHandler<T> = (data: T) => void;

class MockSessionManager {
  private listeners = new Map<string, Set<EventHandler<unknown>>>();
  startCalls: Array<{ projectId: string; backend: string; config: unknown; ticketId?: string }> = [];
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
      pid: 12345,
    };
  }

  async stopSession(_sessionId: string): Promise<void> {}

  async promptSession(_sessionId: string, _message: string): Promise<void> {}

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
    testing: null,
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
  contextPacketToMarkdown: vi.fn(() => "# Test context"),
}));

const {
  mockCommitStepChanges, mockCaptureChangeset, mockScanTickets,
  mockWriteFile, mockReadFile, mockExecFile, mockRunSmoke,
} = vi.hoisted(() => ({
  mockCommitStepChanges: vi.fn(async () => true),
  mockCaptureChangeset: vi.fn(async () => null),
  mockScanTickets: vi.fn(async () => []),
  mockWriteFile: vi.fn(async () => {}),
  mockReadFile: vi.fn(async () => "---\nstatus: in-progress\n---\n"),
  mockExecFile: vi.fn((_cmd: string, _args: string[], _opts: unknown, cb: (err: Error | null, result: { stdout: string; stderr: string }) => void) => {
    cb(null, { stdout: "", stderr: "" });
  }),
  mockRunSmoke: vi.fn(async () => ({
    passed: true,
    buildPassed: true,
    testsPassed: true,
    buildOutput: "",
    testOutput: "",
    durationMs: 100,
  })),
}));

vi.mock("node:child_process", () => ({
  execFile: mockExecFile,
}));

vi.mock("../../packages/core/src/orchestrator/git-ops.js", () => ({
  commitStepChanges: mockCommitStepChanges,
  captureChangeset: mockCaptureChangeset,
}));

vi.mock("../../packages/core/src/orchestrator/smoke-test.js", () => ({
  runSmoke: (...args: unknown[]) => mockRunSmoke(...args as []),
}));

vi.mock("../../packages/core/src/config/roles.js", () => ({
  loadRole: vi.fn(async () => ({ id: "engineer", name: "Engineer" })),
  resolveRoleConfig: vi.fn(() => ({
    roleId: "engineer",
    name: "Engineer",
    permissionMode: "acceptEdits",
    allowedTools: [],
    disallowedTools: [],
    allowedBashPatterns: [],
    instructions: "",
    doneCriteria: "",
    runTests: true,
    runOracle: false,
    denyPaths: [],
  })),
}));

// Mock WorktreeManager
const {
  mockCreate, mockRemove, mockHasCommits, mockMerge,
  mockCleanupOrphaned, mockWriteLock, mockAttemptRebase,
  mockCreateBranch, mockDeleteBranch, mockMergeIntegrationBranch,
} = vi.hoisted(() => ({
  mockCreate: vi.fn(),
  mockRemove: vi.fn(),
  mockHasCommits: vi.fn(),
  mockMerge: vi.fn(),
  mockCleanupOrphaned: vi.fn(),
  mockWriteLock: vi.fn(),
  mockAttemptRebase: vi.fn(),
  mockCreateBranch: vi.fn(),
  mockDeleteBranch: vi.fn(),
  mockMergeIntegrationBranch: vi.fn(),
}));

vi.mock("../../packages/core/src/orchestrator/worktree.js", () => {
  const MockManager = vi.fn().mockImplementation(() => ({
    create: mockCreate,
    remove: mockRemove,
    hasCommits: mockHasCommits,
    merge: mockMerge,
    writeLock: mockWriteLock,
    attemptRebase: mockAttemptRebase,
    getInfo: vi.fn(),
    restore: vi.fn(),
  }));
  // Static methods
  MockManager.cleanupOrphaned = mockCleanupOrphaned;
  MockManager.createBranch = mockCreateBranch;
  MockManager.deleteBranch = mockDeleteBranch;
  MockManager.mergeIntegrationBranch = mockMergeIntegrationBranch;
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

describe("Executor integration branch lifecycle", () => {
  let mockSM: MockSessionManager;

  beforeEach(() => {
    mockSM = new MockSessionManager();
    vi.clearAllMocks();
    mockCreate.mockResolvedValue({
      stepId: "child-a",
      ticketId: "child-a",
      projectPath: "/tmp/test-p",
      worktreePath: "/tmp/test-p/.opcom/worktrees/child-a",
      branch: "work/child-a",
    });
    mockRemove.mockResolvedValue(undefined);
    mockWriteLock.mockResolvedValue(undefined);
    mockCleanupOrphaned.mockResolvedValue([]);
    mockScanTickets.mockResolvedValue([]);
    mockReadFile.mockResolvedValue("---\nstatus: in-progress\n---\n");
    mockExecFile.mockImplementation((_cmd: string, _args: string[], _opts: unknown, cb: (err: Error | null, result: { stdout: string; stderr: string }) => void) => {
      cb(null, { stdout: "", stderr: "" });
    });
    mockCreateBranch.mockResolvedValue(undefined);
    mockDeleteBranch.mockResolvedValue(undefined);
    mockMergeIntegrationBranch.mockResolvedValue({ merged: true, conflict: false });
    mockRunSmoke.mockResolvedValue({
      passed: true,
      buildPassed: true,
      testsPassed: true,
      buildOutput: "",
      testOutput: "",
      durationMs: 100,
    });
  });

  it("creates integration branch lazily before first child step starts", async () => {
    const plan = makePlan([
      { ticketId: "child-a", projectId: "p", status: "ready", blockedBy: [], integrationBranch: "work/parent" },
    ], { worktree: true });

    const executor = new Executor(plan, mockSM as unknown as import("../../packages/core/src/agents/session-manager.js").SessionManager);

    const runPromise = executor.run();
    await waitFor(() => plan.steps[0].status === "in-progress");

    // Integration branch should have been created
    expect(mockCreateBranch).toHaveBeenCalledWith("/tmp/test-p", "work/parent");

    executor.stop();
    await runPromise;
  });

  it("creates integration branch only once for multiple children", async () => {
    // Setup: return different worktree info for each child
    let createCount = 0;
    mockCreate.mockImplementation(async (_path: string, stepId: string, ticketId: string) => {
      createCount++;
      return {
        stepId,
        ticketId,
        projectPath: "/tmp/test-p",
        worktreePath: `/tmp/test-p/.opcom/worktrees/${stepId}`,
        branch: `work/${ticketId}`,
      };
    });

    const plan = makePlan([
      { ticketId: "child-a", projectId: "p", status: "ready", blockedBy: [], integrationBranch: "work/parent" },
      { ticketId: "child-b", projectId: "p", status: "ready", blockedBy: [], integrationBranch: "work/parent" },
    ], { worktree: true, maxConcurrentAgents: 2 });

    const executor = new Executor(plan, mockSM as unknown as import("../../packages/core/src/agents/session-manager.js").SessionManager);

    const runPromise = executor.run();
    await waitFor(() => plan.steps.every((s) => s.status === "in-progress"));

    // createBranch called only once despite two children starting
    expect(mockCreateBranch).toHaveBeenCalledTimes(1);

    executor.stop();
    await runPromise;
  });

  it("passes integration branch as baseBranch when creating child worktree", async () => {
    const plan = makePlan([
      { ticketId: "child-a", projectId: "p", status: "ready", blockedBy: [], integrationBranch: "work/parent" },
    ], { worktree: true });

    const executor = new Executor(plan, mockSM as unknown as import("../../packages/core/src/agents/session-manager.js").SessionManager);

    const runPromise = executor.run();
    await waitFor(() => plan.steps[0].status === "in-progress");

    // Worktree should be created with integration branch as baseBranch
    expect(mockCreate).toHaveBeenCalledWith(
      "/tmp/test-p",
      "child-a",
      "child-a",
      "work/parent",
    );

    executor.stop();
    await runPromise;
  });

  it("merges child to integration branch (not main)", async () => {
    mockHasCommits.mockResolvedValue(true);
    mockMerge.mockResolvedValue({ merged: true, conflict: false });

    const plan = makePlan([
      { ticketId: "child-a", projectId: "p", status: "ready", blockedBy: [], integrationBranch: "work/parent" },
      { ticketId: "child-b", projectId: "p", status: "ready", blockedBy: ["child-a"], integrationBranch: "work/parent" },
    ], { worktree: true });

    const executor = new Executor(plan, mockSM as unknown as import("../../packages/core/src/agents/session-manager.js").SessionManager);

    const completed: string[] = [];
    executor.on("step_completed", ({ step }) => completed.push(step.ticketId));

    const runPromise = executor.run();
    await waitFor(() => plan.steps[0].status === "in-progress");

    // Complete child-a
    const sessionId = plan.steps[0].agentSessionId!;
    mockSM.simulateCompletion(sessionId);
    await waitFor(() => completed.includes("child-a"));

    // merge() should have been called with integration branch as target
    expect(mockMerge).toHaveBeenCalledWith("child-a", "work/parent");

    executor.stop();
    await runPromise;
  });

  it("compares hasCommits against integration branch HEAD for child steps", async () => {
    mockHasCommits.mockResolvedValue(true);
    mockMerge.mockResolvedValue({ merged: true, conflict: false });

    const plan = makePlan([
      { ticketId: "child-a", projectId: "p", status: "ready", blockedBy: [], integrationBranch: "work/parent" },
    ], { worktree: true });

    const executor = new Executor(plan, mockSM as unknown as import("../../packages/core/src/agents/session-manager.js").SessionManager);

    const runPromise = executor.run();
    await waitFor(() => plan.steps[0].status === "in-progress");

    const sessionId = plan.steps[0].agentSessionId!;
    mockSM.simulateCompletion(sessionId);
    await waitFor(() => plan.steps[0].status === "done");

    // hasCommits should be called with integration branch as comparison base
    expect(mockHasCommits).toHaveBeenCalledWith("child-a", "work/parent");

    executor.stop();
    await runPromise;
  });

  it("auto-rebase targets integration branch for child steps", async () => {
    mockHasCommits.mockResolvedValue(true);
    // First merge attempt: conflict. Rebase succeeds, then second merge succeeds.
    mockMerge.mockResolvedValueOnce({ merged: false, conflict: true, error: "CONFLICT in file.ts" });
    mockAttemptRebase.mockResolvedValue({ rebased: true, conflict: false });
    mockMerge.mockResolvedValueOnce({ merged: true, conflict: false });

    const plan = makePlan([
      { ticketId: "child-a", projectId: "p", status: "ready", blockedBy: [], integrationBranch: "work/parent" },
    ], { worktree: true });

    const executor = new Executor(plan, mockSM as unknown as import("../../packages/core/src/agents/session-manager.js").SessionManager);

    const runPromise = executor.run();
    await waitFor(() => plan.steps[0].status === "in-progress");

    const sessionId = plan.steps[0].agentSessionId!;
    mockSM.simulateCompletion(sessionId);
    await waitFor(() => plan.steps[0].status === "done");

    // attemptRebase should target the integration branch
    expect(mockAttemptRebase).toHaveBeenCalledWith("child-a", "work/parent");

    executor.stop();
    await runPromise;
  });

  it("runs final gate when all children are done and merges integration branch to main", async () => {
    mockHasCommits.mockResolvedValue(true);
    mockMerge.mockResolvedValue({ merged: true, conflict: false });

    // For the integration gate worktree
    mockCreate.mockImplementation(async (_path: string, stepId: string, ticketId: string) => ({
      stepId,
      ticketId,
      projectPath: "/tmp/test-p",
      worktreePath: `/tmp/test-p/.opcom/worktrees/${stepId}`,
      branch: `work/${ticketId}`,
    }));

    const plan = makePlan([
      { ticketId: "child-a", projectId: "p", status: "ready", blockedBy: [], integrationBranch: "work/parent" },
      { ticketId: "child-b", projectId: "p", status: "ready", blockedBy: [], integrationBranch: "work/parent" },
    ], { worktree: true, maxConcurrentAgents: 2 });

    const executor = new Executor(plan, mockSM as unknown as import("../../packages/core/src/agents/session-manager.js").SessionManager);

    const runPromise = executor.run();
    await waitFor(() => plan.steps.every((s) => s.status === "in-progress"));

    // Complete both children
    const sessionA = plan.steps[0].agentSessionId!;
    const sessionB = plan.steps[1].agentSessionId!;
    mockSM.simulateCompletion(sessionA);
    mockSM.simulateCompletion(sessionB);

    // Wait for final gate to complete (plan should be done)
    await waitFor(() => executor.getPlan().status === "done", 5000);

    // Final smoke test should have run on the integration gate worktree
    expect(mockRunSmoke).toHaveBeenCalled();
    // Integration branch should be merged to main
    expect(mockMergeIntegrationBranch).toHaveBeenCalledWith("/tmp/test-p", "work/parent");
    // Integration branch should be cleaned up
    expect(mockDeleteBranch).toHaveBeenCalledWith("/tmp/test-p", "work/parent");

    executor.stop();
    await runPromise;
  });

  it("cleans up integration branch when all children are skipped", async () => {
    const plan = makePlan([
      { ticketId: "child-a", projectId: "p", status: "ready", blockedBy: [], integrationBranch: "work/parent" },
      { ticketId: "child-b", projectId: "p", status: "ready", blockedBy: [], integrationBranch: "work/parent" },
    ], { worktree: true, maxConcurrentAgents: 2 });

    const executor = new Executor(plan, mockSM as unknown as import("../../packages/core/src/agents/session-manager.js").SessionManager);

    const runPromise = executor.run();
    await waitFor(() => plan.steps.every((s) => s.status === "in-progress"));

    // Skip both children
    executor.skipStep("child-a");
    executor.skipStep("child-b");

    await waitFor(() => executor.getPlan().status === "done", 5000);

    // Integration branch should be cleaned up without running final gate
    expect(mockDeleteBranch).toHaveBeenCalledWith("/tmp/test-p", "work/parent");
    // No merge to main (nothing to merge)
    expect(mockMergeIntegrationBranch).not.toHaveBeenCalled();

    executor.stop();
    await runPromise;
  });

  it("does not create integration branch for non-integration steps", async () => {
    const plan = makePlan([
      { ticketId: "standalone", projectId: "p", status: "ready", blockedBy: [] },
    ], { worktree: true });

    const executor = new Executor(plan, mockSM as unknown as import("../../packages/core/src/agents/session-manager.js").SessionManager);

    const runPromise = executor.run();
    await waitFor(() => plan.steps[0].status === "in-progress");

    // No integration branch should be created
    expect(mockCreateBranch).not.toHaveBeenCalled();
    // Worktree should be created without baseBranch
    expect(mockCreate).toHaveBeenCalledWith(
      "/tmp/test-p",
      "standalone",
      "standalone",
      undefined,
    );

    executor.stop();
    await runPromise;
  });

  it("standalone steps still merge to main (no integration branch)", async () => {
    mockHasCommits.mockResolvedValue(true);
    mockMerge.mockResolvedValue({ merged: true, conflict: false });

    const plan = makePlan([
      { ticketId: "standalone", projectId: "p", status: "ready", blockedBy: [] },
    ], { worktree: true });

    const executor = new Executor(plan, mockSM as unknown as import("../../packages/core/src/agents/session-manager.js").SessionManager);

    const completed: string[] = [];
    executor.on("step_completed", ({ step }) => completed.push(step.ticketId));

    const runPromise = executor.run();
    await waitFor(() => plan.steps[0].status === "in-progress");

    const sessionId = plan.steps[0].agentSessionId!;
    mockSM.simulateCompletion(sessionId);
    await waitFor(() => completed.includes("standalone"));

    // merge() should be called without targetBranch (defaults to main)
    expect(mockMerge).toHaveBeenCalledWith("standalone", undefined);
    // hasCommits should be called without comparison base
    expect(mockHasCommits).toHaveBeenCalledWith("standalone", undefined);

    executor.stop();
    await runPromise;
  });

  it("marks children as failed when final gate test suite fails", async () => {
    mockHasCommits.mockResolvedValue(true);
    mockMerge.mockResolvedValue({ merged: true, conflict: false });

    // For the integration gate worktree
    mockCreate.mockImplementation(async (_path: string, stepId: string, ticketId: string) => ({
      stepId,
      ticketId,
      projectPath: "/tmp/test-p",
      worktreePath: `/tmp/test-p/.opcom/worktrees/${stepId}`,
      branch: `work/${ticketId}`,
    }));

    // Final gate smoke test fails
    mockRunSmoke.mockResolvedValue({
      passed: false,
      buildPassed: true,
      testsPassed: false,
      buildOutput: "",
      testOutput: "FAIL tests/integration.test.ts",
      durationMs: 200,
    });

    const plan = makePlan([
      { ticketId: "child-a", projectId: "p", status: "ready", blockedBy: [], integrationBranch: "work/parent" },
    ], { worktree: true, pauseOnFailure: false });

    const executor = new Executor(plan, mockSM as unknown as import("../../packages/core/src/agents/session-manager.js").SessionManager);

    const runPromise = executor.run();
    await waitFor(() => plan.steps[0].status === "in-progress");

    const sessionId = plan.steps[0].agentSessionId!;
    mockSM.simulateCompletion(sessionId);

    // Child merges to integration branch, then final gate fails → child marked failed
    await waitFor(() => plan.steps[0].status === "failed", 5000);

    expect(plan.steps[0].error).toContain("Integration gate failed");
    // Integration branch should NOT be merged to main
    expect(mockMergeIntegrationBranch).not.toHaveBeenCalled();

    executor.stop();
    await runPromise;
  });

  it("marks children as needs-rebase when integration branch merge to main fails", async () => {
    mockHasCommits.mockResolvedValue(true);
    mockMerge.mockResolvedValue({ merged: true, conflict: false });

    // For the integration gate worktree
    mockCreate.mockImplementation(async (_path: string, stepId: string, ticketId: string) => ({
      stepId,
      ticketId,
      projectPath: "/tmp/test-p",
      worktreePath: `/tmp/test-p/.opcom/worktrees/${stepId}`,
      branch: `work/${ticketId}`,
    }));

    // Gate passes, but merge to main fails
    mockRunSmoke.mockResolvedValue({
      passed: true,
      buildPassed: true,
      testsPassed: true,
      buildOutput: "",
      testOutput: "",
      durationMs: 100,
    });
    mockMergeIntegrationBranch.mockResolvedValue({
      merged: false,
      conflict: true,
      error: "CONFLICT in shared.ts",
    });

    const plan = makePlan([
      { ticketId: "child-a", projectId: "p", status: "ready", blockedBy: [], integrationBranch: "work/parent" },
    ], { worktree: true, pauseOnFailure: false });

    const executor = new Executor(plan, mockSM as unknown as import("../../packages/core/src/agents/session-manager.js").SessionManager);

    const runPromise = executor.run();
    await waitFor(() => plan.steps[0].status === "in-progress");

    const sessionId = plan.steps[0].agentSessionId!;
    mockSM.simulateCompletion(sessionId);

    await waitFor(() => plan.steps[0].status === "needs-rebase", 5000);

    expect(plan.steps[0].error).toContain("Integration branch merge to main failed");

    executor.stop();
    await runPromise;
  });

  it("handles integration branch already existing (idempotent creation)", async () => {
    // createBranch fails because branch exists, but rev-parse succeeds
    mockCreateBranch.mockRejectedValue(new Error("branch already exists"));
    mockExecFile.mockImplementation((cmd: string, args: string[], _opts: unknown, cb: (err: Error | null, result: { stdout: string; stderr: string }) => void) => {
      // git rev-parse --verify should succeed for the existing branch
      if (cmd === "git" && args?.[0] === "rev-parse" && args?.[1] === "--verify") {
        cb(null, { stdout: "abc123\n", stderr: "" });
      } else {
        cb(null, { stdout: "", stderr: "" });
      }
    });

    const plan = makePlan([
      { ticketId: "child-a", projectId: "p", status: "ready", blockedBy: [], integrationBranch: "work/parent" },
    ], { worktree: true });

    const executor = new Executor(plan, mockSM as unknown as import("../../packages/core/src/agents/session-manager.js").SessionManager);

    const runPromise = executor.run();
    await waitFor(() => plan.steps[0].status === "in-progress");

    // Step should start successfully despite branch creation error
    expect(plan.steps[0].status).toBe("in-progress");

    executor.stop();
    await runPromise;
  });
});
