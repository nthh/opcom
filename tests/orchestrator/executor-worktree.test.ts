import { describe, it, expect, vi, beforeEach } from "vitest";
import { Executor } from "../../packages/core/src/orchestrator/executor.js";
import { defaultConfig } from "../../packages/core/src/orchestrator/persistence.js";
import type { Plan, PlanStep, AgentSession, AgentState } from "@opcom/types";

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
    };
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
}));

const { mockCommitStepChanges, mockScanTickets, mockWriteFile, mockReadFile } = vi.hoisted(() => ({
  mockCommitStepChanges: vi.fn(async () => true),
  mockScanTickets: vi.fn(async () => []),
  mockWriteFile: vi.fn(async () => {}),
  mockReadFile: vi.fn(async () => "---\nstatus: in-progress\n---\n"),
}));

vi.mock("../../packages/core/src/orchestrator/git-ops.js", () => ({
  commitStepChanges: mockCommitStepChanges,
}));

// Mock WorktreeManager — use vi.hoisted() so these are available when vi.mock is hoisted
const { mockCreate, mockRemove, mockHasCommits, mockMerge, mockCleanupOrphaned } = vi.hoisted(() => ({
  mockCreate: vi.fn(),
  mockRemove: vi.fn(),
  mockHasCommits: vi.fn(),
  mockMerge: vi.fn(),
  mockCleanupOrphaned: vi.fn(),
}));

vi.mock("../../packages/core/src/orchestrator/worktree.js", () => {
  const MockManager = vi.fn().mockImplementation(() => ({
    create: mockCreate,
    remove: mockRemove,
    hasCommits: mockHasCommits,
    merge: mockMerge,
    getInfo: vi.fn(),
    restore: vi.fn(),
  }));
  // Static method
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

describe("Executor with worktree isolation", () => {
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
    mockCleanupOrphaned.mockResolvedValue([]);
    mockScanTickets.mockResolvedValue([]);
    mockReadFile.mockResolvedValue("---\nstatus: in-progress\n---\n");
  });

  it("creates worktree before starting agent when worktree=true", async () => {
    const plan = makePlan([
      { ticketId: "t1", projectId: "p", status: "ready", blockedBy: [] },
    ], { worktree: true });

    const executor = new Executor(plan, mockSM as unknown as import("../../packages/core/src/agents/session-manager.js").SessionManager);

    const runPromise = executor.run();
    await new Promise((r) => setTimeout(r, 50));

    // Worktree should have been created
    expect(mockCreate).toHaveBeenCalledWith(
      "/tmp/test-p",
      "t1",
      "t1",
    );

    // Step should have worktree info
    const step = plan.steps[0];
    expect(step.worktreePath).toBe("/tmp/test-p/.opcom/worktrees/t1");
    expect(step.worktreeBranch).toBe("work/t1");

    // Agent should be started with worktree cwd
    expect(mockSM.startCalls).toHaveLength(1);
    const config = mockSM.startCalls[0].config as Record<string, unknown>;
    expect(config.cwd).toBe("/tmp/test-p/.opcom/worktrees/t1");

    executor.stop();
    await runPromise;
  });

  it("does NOT create worktree when worktree=false", async () => {
    const plan = makePlan([
      { ticketId: "t1", projectId: "p", status: "ready", blockedBy: [] },
    ], { worktree: false });

    const executor = new Executor(plan, mockSM as unknown as import("../../packages/core/src/agents/session-manager.js").SessionManager);

    const runPromise = executor.run();
    await new Promise((r) => setTimeout(r, 50));

    expect(mockCreate).not.toHaveBeenCalled();

    executor.stop();
    await runPromise;
  });

  it("uses hasCommits instead of sessionWrites when worktree=true", async () => {
    mockHasCommits.mockResolvedValue(true);
    mockMerge.mockResolvedValue({ merged: true, conflict: false });

    const plan = makePlan([
      { ticketId: "t1", projectId: "p", status: "ready", blockedBy: [] },
    ], { worktree: true });

    const executor = new Executor(plan, mockSM as unknown as import("../../packages/core/src/agents/session-manager.js").SessionManager);

    const completed: string[] = [];
    executor.on("step_completed", ({ step }) => completed.push(step.ticketId));

    const runPromise = executor.run();
    await new Promise((r) => setTimeout(r, 50));

    // Agent completes WITHOUT any write events (worktree mode doesn't need them)
    const sessionId = plan.steps[0].agentSessionId!;
    mockSM.simulateCompletion(sessionId);
    await new Promise((r) => setTimeout(r, 100));

    // hasCommits should have been called
    expect(mockHasCommits).toHaveBeenCalledWith("t1");
    // Step should be completed via worktree merge
    expect(completed).toContain("t1");

    executor.stop();
    await runPromise;
  });

  it("marks step as failed when worktree has no commits", async () => {
    mockHasCommits.mockResolvedValue(false);

    const plan = makePlan([
      { ticketId: "t1", projectId: "p", status: "ready", blockedBy: [] },
    ], { worktree: true, pauseOnFailure: false });

    const executor = new Executor(plan, mockSM as unknown as import("../../packages/core/src/agents/session-manager.js").SessionManager);

    const failed: string[] = [];
    executor.on("step_failed", ({ step }) => failed.push(step.ticketId));

    const runPromise = executor.run();
    await new Promise((r) => setTimeout(r, 50));

    const sessionId = plan.steps[0].agentSessionId!;
    mockSM.simulateCompletion(sessionId);
    await new Promise((r) => setTimeout(r, 100));

    expect(failed).toContain("t1");
    expect(plan.steps[0].error).toContain("without making any commits");
    // Worktree should have been cleaned up
    expect(mockRemove).toHaveBeenCalledWith("t1");

    executor.stop();
    await runPromise;
  });

  it("auto-commits uncommitted changes before checking hasCommits", async () => {
    // Simulate: agent wrote files but didn't commit. Auto-commit creates
    // a commit, so hasCommits returns true on the second call.
    let commitCalled = false;
    mockCommitStepChanges.mockImplementation(async () => {
      commitCalled = true;
      return true;
    });
    mockHasCommits.mockImplementation(async () => commitCalled);
    mockMerge.mockResolvedValue({ merged: true, conflict: false });

    const plan = makePlan([
      { ticketId: "t1", projectId: "p", status: "ready", blockedBy: [] },
    ], { worktree: true, autoCommit: true, pauseOnFailure: false });

    const executor = new Executor(plan, mockSM as unknown as import("../../packages/core/src/agents/session-manager.js").SessionManager);

    const completed: string[] = [];
    executor.on("step_completed", ({ step }) => completed.push(step.ticketId));

    const runPromise = executor.run();
    await new Promise((r) => setTimeout(r, 50));

    const sessionId = plan.steps[0].agentSessionId!;
    mockSM.simulateCompletion(sessionId);
    await new Promise((r) => setTimeout(r, 100));

    // commitStepChanges should have been called with the worktree path
    expect(mockCommitStepChanges).toHaveBeenCalled();
    // Step should succeed because auto-commit created a commit
    expect(completed).toContain("t1");

    executor.stop();
    await runPromise;
  });

  it("merges worktree branch after successful completion", async () => {
    mockHasCommits.mockResolvedValue(true);
    mockMerge.mockResolvedValue({ merged: true, conflict: false });

    const plan = makePlan([
      { ticketId: "t1", projectId: "p", status: "ready", blockedBy: [] },
    ], { worktree: true });

    const executor = new Executor(plan, mockSM as unknown as import("../../packages/core/src/agents/session-manager.js").SessionManager);

    const runPromise = executor.run();
    await new Promise((r) => setTimeout(r, 50));

    const sessionId = plan.steps[0].agentSessionId!;
    mockSM.simulateCompletion(sessionId);
    await new Promise((r) => setTimeout(r, 100));

    expect(mockMerge).toHaveBeenCalledWith("t1");
    expect(mockRemove).toHaveBeenCalledWith("t1");
    expect(plan.steps[0].status).toBe("done");
    // Worktree fields should be cleared after cleanup
    expect(plan.steps[0].worktreePath).toBeUndefined();
    expect(plan.steps[0].worktreeBranch).toBeUndefined();

    executor.stop();
    await runPromise;
  });

  it("marks step as needs-rebase on merge conflict", async () => {
    mockHasCommits.mockResolvedValue(true);
    mockMerge.mockResolvedValue({ merged: false, conflict: true, error: "CONFLICT in file.ts" });

    const plan = makePlan([
      { ticketId: "t1", projectId: "p", status: "ready", blockedBy: [] },
    ], { worktree: true, pauseOnFailure: true });

    const executor = new Executor(plan, mockSM as unknown as import("../../packages/core/src/agents/session-manager.js").SessionManager);

    const needsRebase: string[] = [];
    executor.on("step_needs_rebase", ({ step }) => needsRebase.push(step.ticketId));

    let paused = false;
    executor.on("plan_paused", () => { paused = true; });

    const runPromise = executor.run();
    await new Promise((r) => setTimeout(r, 50));

    const sessionId = plan.steps[0].agentSessionId!;
    mockSM.simulateCompletion(sessionId);
    await new Promise((r) => setTimeout(r, 100));

    expect(needsRebase).toContain("t1");
    expect(plan.steps[0].status).toBe("needs-rebase");
    expect(plan.steps[0].error).toContain("Merge conflict");
    expect(paused).toBe(true);
    // Worktree should NOT be removed — kept for manual rebase
    expect(mockRemove).not.toHaveBeenCalled();

    executor.stop();
    await runPromise;
  });

  it("marks step as failed on non-conflict merge failure", async () => {
    mockHasCommits.mockResolvedValue(true);
    mockMerge.mockResolvedValue({ merged: false, conflict: false, error: "git error" });

    const plan = makePlan([
      { ticketId: "t1", projectId: "p", status: "ready", blockedBy: [] },
    ], { worktree: true, pauseOnFailure: false });

    const executor = new Executor(plan, mockSM as unknown as import("../../packages/core/src/agents/session-manager.js").SessionManager);

    const runPromise = executor.run();
    await new Promise((r) => setTimeout(r, 50));

    const sessionId = plan.steps[0].agentSessionId!;
    mockSM.simulateCompletion(sessionId);
    await new Promise((r) => setTimeout(r, 100));

    expect(plan.steps[0].status).toBe("failed");
    expect(plan.steps[0].error).toContain("Merge failed");
    expect(mockRemove).toHaveBeenCalledWith("t1");

    executor.stop();
    await runPromise;
  });

  it("cleans up orphaned worktrees on startup", async () => {
    mockCleanupOrphaned.mockResolvedValue(["old-step"]);

    const plan = makePlan([
      { ticketId: "t1", projectId: "p", status: "ready", blockedBy: [] },
    ], { worktree: true });

    const executor = new Executor(plan, mockSM as unknown as import("../../packages/core/src/agents/session-manager.js").SessionManager);

    const runPromise = executor.run();
    await new Promise((r) => setTimeout(r, 50));

    expect(mockCleanupOrphaned).toHaveBeenCalledWith("/tmp/test-p", expect.any(Set));

    executor.stop();
    await runPromise;
  });

  it("needs-rebase is terminal — plan completes when all steps are terminal", async () => {
    mockHasCommits.mockResolvedValue(true);
    mockMerge.mockResolvedValue({ merged: false, conflict: true, error: "CONFLICT" });

    const plan = makePlan([
      { ticketId: "t1", projectId: "p", status: "ready", blockedBy: [] },
    ], { worktree: true, pauseOnFailure: false });

    const executor = new Executor(plan, mockSM as unknown as import("../../packages/core/src/agents/session-manager.js").SessionManager);

    let planDone = false;
    executor.on("plan_completed", () => { planDone = true; });

    const runPromise = executor.run();
    await new Promise((r) => setTimeout(r, 50));

    const sessionId = plan.steps[0].agentSessionId!;
    mockSM.simulateCompletion(sessionId);
    await new Promise((r) => setTimeout(r, 200));

    expect(plan.steps[0].status).toBe("needs-rebase");
    expect(planDone).toBe(true);

    executor.stop();
    await runPromise;
  });

  it("keeps worktree on agent_failed event for inspection", async () => {
    const plan = makePlan([
      { ticketId: "t1", projectId: "p", status: "ready", blockedBy: [] },
    ], { worktree: true, pauseOnFailure: false });

    const executor = new Executor(plan, mockSM as unknown as import("../../packages/core/src/agents/session-manager.js").SessionManager);

    const runPromise = executor.run();
    await new Promise((r) => setTimeout(r, 50));

    // Step should have worktree info from creation
    expect(plan.steps[0].worktreePath).toBe("/tmp/test-p/.opcom/worktrees/t1");

    // Simulate error
    const sessionId = plan.steps[0].agentSessionId!;
    mockSM.emit("state_change", {
      sessionId,
      oldState: "streaming" as AgentState,
      newState: "error" as AgentState,
    });
    await new Promise((r) => setTimeout(r, 100));

    expect(plan.steps[0].status).toBe("failed");
    // Worktree should be kept for inspection/retry
    expect(mockRemove).not.toHaveBeenCalled();
    expect(plan.steps[0].worktreePath).toBe("/tmp/test-p/.opcom/worktrees/t1");

    executor.stop();
    await runPromise;
  });

  it("resets ticket to open when step fails with ticketTransitions enabled", async () => {
    mockHasCommits.mockResolvedValue(false);
    mockScanTickets.mockResolvedValue([
      { id: "t1", title: "Test", status: "in-progress", filePath: "/tmp/test-p/.tickets/impl/t1/README.md" },
    ]);

    const plan = makePlan([
      { ticketId: "t1", projectId: "p", status: "ready", blockedBy: [] },
    ], { worktree: true, ticketTransitions: true, pauseOnFailure: false });

    const executor = new Executor(plan, mockSM as unknown as import("../../packages/core/src/agents/session-manager.js").SessionManager);

    const runPromise = executor.run();
    await new Promise((r) => setTimeout(r, 50));

    const sessionId = plan.steps[0].agentSessionId!;
    mockSM.simulateCompletion(sessionId);
    await new Promise((r) => setTimeout(r, 100));

    expect(plan.steps[0].status).toBe("failed");
    // updateTicketStatus should have written "open" back to the ticket file
    expect(mockWriteFile).toHaveBeenCalledWith(
      "/tmp/test-p/.tickets/impl/t1/README.md",
      expect.stringContaining("status: open"),
      "utf-8",
    );

    executor.stop();
    await runPromise;
  });

  it("resets ticket to open on agent_failed event with ticketTransitions", async () => {
    mockScanTickets.mockResolvedValue([
      { id: "t1", title: "Test", status: "in-progress", filePath: "/tmp/test-p/.tickets/impl/t1/README.md" },
    ]);

    const plan = makePlan([
      { ticketId: "t1", projectId: "p", status: "ready", blockedBy: [] },
    ], { worktree: true, ticketTransitions: true, pauseOnFailure: false });

    const executor = new Executor(plan, mockSM as unknown as import("../../packages/core/src/agents/session-manager.js").SessionManager);

    const runPromise = executor.run();
    await new Promise((r) => setTimeout(r, 50));

    // Simulate agent error
    const sessionId = plan.steps[0].agentSessionId!;
    mockSM.emit("state_change", {
      sessionId,
      oldState: "streaming" as AgentState,
      newState: "error" as AgentState,
    });
    await new Promise((r) => setTimeout(r, 100));

    expect(plan.steps[0].status).toBe("failed");
    expect(mockWriteFile).toHaveBeenCalledWith(
      "/tmp/test-p/.tickets/impl/t1/README.md",
      expect.stringContaining("status: open"),
      "utf-8",
    );

    executor.stop();
    await runPromise;
  });

  it("does NOT reset ticket when ticketTransitions is disabled", async () => {
    mockHasCommits.mockResolvedValue(false);
    mockScanTickets.mockResolvedValue([
      { id: "t1", title: "Test", status: "in-progress", filePath: "/tmp/test-p/.tickets/impl/t1/README.md" },
    ]);

    const plan = makePlan([
      { ticketId: "t1", projectId: "p", status: "ready", blockedBy: [] },
    ], { worktree: true, ticketTransitions: false, pauseOnFailure: false });

    const executor = new Executor(plan, mockSM as unknown as import("../../packages/core/src/agents/session-manager.js").SessionManager);

    const runPromise = executor.run();
    await new Promise((r) => setTimeout(r, 50));

    const sessionId = plan.steps[0].agentSessionId!;
    mockSM.simulateCompletion(sessionId);
    await new Promise((r) => setTimeout(r, 100));

    expect(plan.steps[0].status).toBe("failed");
    // writeFile should NOT have been called since ticketTransitions is off
    expect(mockWriteFile).not.toHaveBeenCalled();

    executor.stop();
    await runPromise;
  });
});
