import { describe, it, expect, vi, beforeEach } from "vitest";
import { Executor } from "../../packages/core/src/orchestrator/executor.js";
import { defaultConfig } from "../../packages/core/src/orchestrator/persistence.js";
import type { Plan, PlanStep, AgentSession } from "@opcom/types";

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

// --- Hoisted mocks ---
const { mockQueryGraphContext, mockScanTickets } = vi.hoisted(() => ({
  mockQueryGraphContext: vi.fn(),
  mockScanTickets: vi.fn(async () => []),
}));

// Mock persistence
vi.mock("../../packages/core/src/orchestrator/persistence.js", async (importOriginal) => {
  const mod = await importOriginal() as Record<string, unknown>;
  return {
    ...mod,
    savePlan: vi.fn(async () => {}),
    savePlanContext: vi.fn(async () => {}),
  };
});

// Mock config loader
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

// Mock ticket scanner — returns tickets with priority and links for graph queries
vi.mock("../../packages/core/src/detection/tickets.js", () => ({
  scanTickets: mockScanTickets,
}));

// Mock context builder
vi.mock("../../packages/core/src/agents/context-builder.js", () => ({
  buildContextPacket: vi.fn(async () => ({
    project: { name: "test", path: "/tmp", stack: {}, testing: null, linting: [], services: [] },
    git: { branch: "main", remote: null, clean: true },
  })),
  contextPacketToMarkdown: vi.fn(() => "# Test context"),
}));

// Mock git-ops
vi.mock("../../packages/core/src/orchestrator/git-ops.js", () => ({
  commitStepChanges: vi.fn(async () => true),
  captureChangeset: vi.fn(async () => null),
}));

// Mock roles
vi.mock("../../packages/core/src/config/roles.js", () => ({
  loadRole: vi.fn(async () => ({ id: "engineer", name: "Engineer" })),
  resolveRoleConfig: vi.fn(() => ({
    name: "Engineer",
    permissionMode: "acceptEdits",
    allowedTools: [],
    disallowedTools: [],
    allowedBashPatterns: [],
    instructions: "",
    doneCriteria: "",
    runTests: false,
    runOracle: false,
  })),
}));

// Mock worktree manager
vi.mock("../../packages/core/src/orchestrator/worktree.js", () => {
  return {
    WorktreeManager: vi.fn().mockImplementation(() => ({
      create: vi.fn(),
      remove: vi.fn(),
      hasCommits: vi.fn(),
      merge: vi.fn(),
      getInfo: vi.fn(),
      restore: vi.fn(),
      writeLock: vi.fn(),
    })),
  };
});

// Mock graph service — this is the critical mock for file-overlap tests
vi.mock("../../packages/core/src/graph/graph-service.js", () => ({
  queryGraphContext: mockQueryGraphContext,
  ingestTestResults: vi.fn(),
}));

function makePlan(steps: PlanStep[], configOverrides?: Partial<ReturnType<typeof defaultConfig>>): Plan {
  return {
    id: "test-plan",
    name: "Test Plan",
    status: "planning",
    scope: {},
    steps,
    config: { ...defaultConfig(), worktree: false, ...configOverrides },
    context: "",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

describe("Executor file-overlap scheduling", () => {
  let mockSM: MockSessionManager;

  beforeEach(() => {
    mockSM = new MockSessionManager();
    vi.clearAllMocks();
    // Default: graph returns null (no graph available)
    mockQueryGraphContext.mockReturnValue(null);
    // Default: scanTickets returns empty (no priority/links)
    mockScanTickets.mockResolvedValue([]);
  });

  // -----------------------------------------------------------------------
  // 1. Steps with overlapping files are serialized
  // -----------------------------------------------------------------------
  it("serializes steps that share overlapping files", async () => {
    // Both t1 and t2 relate to src/foo.ts — only one should start
    mockScanTickets.mockResolvedValue([
      { id: "t1", title: "T1", status: "open", priority: 2, type: "feature", filePath: "/tmp/t1.md", deps: [], links: ["spec/a.md"], tags: {} },
      { id: "t2", title: "T2", status: "open", priority: 2, type: "feature", filePath: "/tmp/t2.md", deps: [], links: ["spec/b.md"], tags: {} },
    ]);

    mockQueryGraphContext.mockImplementation((_proj: string, ticketId: string) => {
      if (ticketId === "t1") return { relatedFiles: ["src/foo.ts", "src/bar.ts"], testFiles: [], driftSignals: [] };
      if (ticketId === "t2") return { relatedFiles: ["src/foo.ts", "src/baz.ts"], testFiles: [], driftSignals: [] };
      return null;
    });

    const plan = makePlan([
      { ticketId: "t1", projectId: "p", status: "ready", blockedBy: [] },
      { ticketId: "t2", projectId: "p", status: "ready", blockedBy: [] },
    ], { maxConcurrentAgents: 5 });

    const executor = new Executor(plan, mockSM as unknown as import("../../packages/core/src/agents/session-manager.js").SessionManager);

    const runPromise = executor.run();
    await new Promise((r) => setTimeout(r, 50));

    // Only 1 of the 2 should have started — they overlap on src/foo.ts
    expect(mockSM.startCalls).toHaveLength(1);
    expect(plan.steps.filter((s) => s.status === "in-progress")).toHaveLength(1);
    expect(plan.steps.filter((s) => s.status === "ready")).toHaveLength(1);

    executor.stop();
    await runPromise;
  });

  // -----------------------------------------------------------------------
  // 2. Steps with no file overlap run in parallel
  // -----------------------------------------------------------------------
  it("starts steps with disjoint file sets in parallel", async () => {
    mockScanTickets.mockResolvedValue([
      { id: "t1", title: "T1", status: "open", priority: 2, type: "feature", filePath: "/tmp/t1.md", deps: [], links: [], tags: {} },
      { id: "t2", title: "T2", status: "open", priority: 2, type: "feature", filePath: "/tmp/t2.md", deps: [], links: [], tags: {} },
    ]);

    mockQueryGraphContext.mockImplementation((_proj: string, ticketId: string) => {
      if (ticketId === "t1") return { relatedFiles: ["src/alpha.ts"], testFiles: [], driftSignals: [] };
      if (ticketId === "t2") return { relatedFiles: ["src/beta.ts"], testFiles: [], driftSignals: [] };
      return null;
    });

    const plan = makePlan([
      { ticketId: "t1", projectId: "p", status: "ready", blockedBy: [] },
      { ticketId: "t2", projectId: "p", status: "ready", blockedBy: [] },
    ], { maxConcurrentAgents: 5 });

    const executor = new Executor(plan, mockSM as unknown as import("../../packages/core/src/agents/session-manager.js").SessionManager);

    const runPromise = executor.run();
    await new Promise((r) => setTimeout(r, 50));

    // Both should start — no file overlap
    expect(mockSM.startCalls).toHaveLength(2);
    expect(plan.steps.filter((s) => s.status === "in-progress")).toHaveLength(2);

    executor.stop();
    await runPromise;
  });

  // -----------------------------------------------------------------------
  // 3. Priority sorting — P1 step starts before P2 step when they overlap
  // -----------------------------------------------------------------------
  it("starts higher-priority step first when files overlap", async () => {
    mockScanTickets.mockResolvedValue([
      { id: "t-low", title: "Low priority", status: "open", priority: 3, type: "feature", filePath: "/tmp/tl.md", deps: [], links: [], tags: {} },
      { id: "t-high", title: "High priority", status: "open", priority: 1, type: "feature", filePath: "/tmp/th.md", deps: [], links: [], tags: {} },
    ]);

    mockQueryGraphContext.mockImplementation((_proj: string, ticketId: string) => {
      if (ticketId === "t-low") return { relatedFiles: ["src/shared.ts"], testFiles: [], driftSignals: [] };
      if (ticketId === "t-high") return { relatedFiles: ["src/shared.ts"], testFiles: [], driftSignals: [] };
      return null;
    });

    const plan = makePlan([
      // Note: t-low appears first in the array, but t-high has lower priority number
      { ticketId: "t-low", projectId: "p", status: "ready", blockedBy: [] },
      { ticketId: "t-high", projectId: "p", status: "ready", blockedBy: [] },
    ], { maxConcurrentAgents: 5 });

    const executor = new Executor(plan, mockSM as unknown as import("../../packages/core/src/agents/session-manager.js").SessionManager);

    const runPromise = executor.run();
    await new Promise((r) => setTimeout(r, 50));

    // Only 1 should start (they overlap), and it should be the higher-priority one
    expect(mockSM.startCalls).toHaveLength(1);
    expect(mockSM.startCalls[0].ticketId).toBe("t-high");

    executor.stop();
    await runPromise;
  });

  // -----------------------------------------------------------------------
  // 4. Equal priority tie-breaking — fewer blockedBy deps wins
  // -----------------------------------------------------------------------
  it("breaks priority ties by fewer blockedBy dependencies", async () => {
    mockScanTickets.mockResolvedValue([
      { id: "t-many-deps", title: "Many deps", status: "open", priority: 2, type: "feature", filePath: "/tmp/t1.md", deps: [], links: [], tags: {} },
      { id: "t-few-deps", title: "Few deps", status: "open", priority: 2, type: "feature", filePath: "/tmp/t2.md", deps: [], links: [], tags: {} },
    ]);

    mockQueryGraphContext.mockImplementation((_proj: string, ticketId: string) => {
      if (ticketId === "t-many-deps") return { relatedFiles: ["src/overlap.ts"], testFiles: [], driftSignals: [] };
      if (ticketId === "t-few-deps") return { relatedFiles: ["src/overlap.ts"], testFiles: [], driftSignals: [] };
      return null;
    });

    const plan = makePlan([
      // t-many-deps is first in array but has more resolved deps in blockedBy
      { ticketId: "t-many-deps", projectId: "p", status: "ready", blockedBy: ["done-1", "done-2", "done-3"] },
      { ticketId: "t-few-deps", projectId: "p", status: "ready", blockedBy: [] },
    ], { maxConcurrentAgents: 5 });

    const executor = new Executor(plan, mockSM as unknown as import("../../packages/core/src/agents/session-manager.js").SessionManager);

    const runPromise = executor.run();
    await new Promise((r) => setTimeout(r, 50));

    // Only 1 should start; the one with fewer blockedBy should win the tie
    expect(mockSM.startCalls).toHaveLength(1);
    expect(mockSM.startCalls[0].ticketId).toBe("t-few-deps");

    executor.stop();
    await runPromise;
  });

  // -----------------------------------------------------------------------
  // 5. Graph unavailable fallback — all ready steps start if queryGraphContext returns null
  // -----------------------------------------------------------------------
  it("starts all ready steps when graph is unavailable (queryGraphContext returns null)", async () => {
    // queryGraphContext returns null for every step (default in beforeEach)
    mockQueryGraphContext.mockReturnValue(null);

    const plan = makePlan([
      { ticketId: "t1", projectId: "p", status: "ready", blockedBy: [] },
      { ticketId: "t2", projectId: "p", status: "ready", blockedBy: [] },
      { ticketId: "t3", projectId: "p", status: "ready", blockedBy: [] },
    ], { maxConcurrentAgents: 5 });

    const executor = new Executor(plan, mockSM as unknown as import("../../packages/core/src/agents/session-manager.js").SessionManager);

    const runPromise = executor.run();
    await new Promise((r) => setTimeout(r, 50));

    // All 3 should start — no file data means no overlap can be detected
    expect(mockSM.startCalls).toHaveLength(3);
    expect(plan.steps.filter((s) => s.status === "in-progress")).toHaveLength(3);

    executor.stop();
    await runPromise;
  });

  // -----------------------------------------------------------------------
  // 5b. Graph throws — same fallback behavior
  // -----------------------------------------------------------------------
  it("starts all ready steps when queryGraphContext throws", async () => {
    mockQueryGraphContext.mockImplementation(() => {
      throw new Error("DB corrupt");
    });

    const plan = makePlan([
      { ticketId: "t1", projectId: "p", status: "ready", blockedBy: [] },
      { ticketId: "t2", projectId: "p", status: "ready", blockedBy: [] },
    ], { maxConcurrentAgents: 5 });

    const executor = new Executor(plan, mockSM as unknown as import("../../packages/core/src/agents/session-manager.js").SessionManager);

    const runPromise = executor.run();
    await new Promise((r) => setTimeout(r, 50));

    // Both should start — exception is caught, files default to []
    expect(mockSM.startCalls).toHaveLength(2);

    executor.stop();
    await runPromise;
  });

  // -----------------------------------------------------------------------
  // 6. In-progress step files block ready steps
  // -----------------------------------------------------------------------
  it("holds back a ready step that overlaps with an in-progress step", async () => {
    mockScanTickets.mockResolvedValue([
      { id: "t-active", title: "Active", status: "open", priority: 2, type: "feature", filePath: "/tmp/ta.md", deps: [], links: [], tags: {} },
      { id: "t-waiting", title: "Waiting", status: "open", priority: 2, type: "feature", filePath: "/tmp/tw.md", deps: [], links: [], tags: {} },
      { id: "t-free", title: "Free", status: "open", priority: 2, type: "feature", filePath: "/tmp/tf.md", deps: [], links: [], tags: {} },
    ]);

    mockQueryGraphContext.mockImplementation((_proj: string, ticketId: string) => {
      if (ticketId === "t-active") return { relatedFiles: ["src/model.ts"], testFiles: [], driftSignals: [] };
      if (ticketId === "t-waiting") return { relatedFiles: ["src/model.ts", "src/controller.ts"], testFiles: [], driftSignals: [] };
      if (ticketId === "t-free") return { relatedFiles: ["src/utils.ts"], testFiles: [], driftSignals: [] };
      return null;
    });

    const plan = makePlan([
      // t-active is already running
      { ticketId: "t-active", projectId: "p", status: "in-progress", blockedBy: [], agentSessionId: "existing-1", startedAt: new Date().toISOString() },
      { ticketId: "t-waiting", projectId: "p", status: "ready", blockedBy: [] },
      { ticketId: "t-free", projectId: "p", status: "ready", blockedBy: [] },
    ], { maxConcurrentAgents: 5 });

    const executor = new Executor(plan, mockSM as unknown as import("../../packages/core/src/agents/session-manager.js").SessionManager);

    const runPromise = executor.run();
    await new Promise((r) => setTimeout(r, 50));

    // t-active is already in-progress (not re-started by executor)
    // t-waiting overlaps with t-active on src/model.ts → held back
    // t-free has no overlap → should start
    const startedTickets = mockSM.startCalls.map((c) => c.ticketId);
    expect(startedTickets).toContain("t-free");
    expect(startedTickets).not.toContain("t-waiting");
    // t-active was already in-progress, so it should NOT appear in startCalls
    expect(startedTickets).not.toContain("t-active");

    executor.stop();
    await runPromise;
  });

  // -----------------------------------------------------------------------
  // 7. File overlap between two ready steps — only one starts
  // -----------------------------------------------------------------------
  it("only starts one of two ready steps that overlap with each other (no active overlap)", async () => {
    mockScanTickets.mockResolvedValue([
      { id: "t1", title: "T1", status: "open", priority: 2, type: "feature", filePath: "/tmp/t1.md", deps: [], links: [], tags: {} },
      { id: "t2", title: "T2", status: "open", priority: 2, type: "feature", filePath: "/tmp/t2.md", deps: [], links: [], tags: {} },
    ]);

    mockQueryGraphContext.mockImplementation((_proj: string, ticketId: string) => {
      if (ticketId === "t1") return { relatedFiles: ["src/shared.ts", "src/a.ts"], testFiles: [], driftSignals: [] };
      if (ticketId === "t2") return { relatedFiles: ["src/shared.ts", "src/b.ts"], testFiles: [], driftSignals: [] };
      return null;
    });

    const plan = makePlan([
      { ticketId: "t1", projectId: "p", status: "ready", blockedBy: [] },
      { ticketId: "t2", projectId: "p", status: "ready", blockedBy: [] },
    ], { maxConcurrentAgents: 5 });

    const executor = new Executor(plan, mockSM as unknown as import("../../packages/core/src/agents/session-manager.js").SessionManager);

    const runPromise = executor.run();
    await new Promise((r) => setTimeout(r, 50));

    // Only 1 of 2 should have started
    expect(mockSM.startCalls).toHaveLength(1);
    expect(plan.steps.filter((s) => s.status === "in-progress")).toHaveLength(1);
    expect(plan.steps.filter((s) => s.status === "ready")).toHaveLength(1);

    executor.stop();
    await runPromise;
  });

  // -----------------------------------------------------------------------
  // Held-back step starts after blocking step completes
  // -----------------------------------------------------------------------
  it("starts held-back step after the blocking step completes", async () => {
    mockScanTickets.mockResolvedValue([
      { id: "t1", title: "T1", status: "open", priority: 1, type: "feature", filePath: "/tmp/t1.md", deps: [], links: [], tags: {} },
      { id: "t2", title: "T2", status: "open", priority: 2, type: "feature", filePath: "/tmp/t2.md", deps: [], links: [], tags: {} },
    ]);

    mockQueryGraphContext.mockImplementation((_proj: string, ticketId: string) => {
      if (ticketId === "t1") return { relatedFiles: ["src/shared.ts"], testFiles: [], driftSignals: [] };
      if (ticketId === "t2") return { relatedFiles: ["src/shared.ts"], testFiles: [], driftSignals: [] };
      return null;
    });

    const plan = makePlan([
      { ticketId: "t1", projectId: "p", status: "ready", blockedBy: [] },
      { ticketId: "t2", projectId: "p", status: "ready", blockedBy: [] },
    ], { maxConcurrentAgents: 5 });

    const executor = new Executor(plan, mockSM as unknown as import("../../packages/core/src/agents/session-manager.js").SessionManager);

    const runPromise = executor.run();
    await new Promise((r) => setTimeout(r, 50));

    // Only t1 should start (higher priority, overlapping files)
    expect(mockSM.startCalls).toHaveLength(1);
    expect(mockSM.startCalls[0].ticketId).toBe("t1");

    // Complete t1 with a write
    const sessionId = plan.steps.find((s) => s.ticketId === "t1")!.agentSessionId!;
    mockSM.simulateWrite(sessionId);
    mockSM.simulateCompletion(sessionId);
    await new Promise((r) => setTimeout(r, 100));

    // After t1 completes, t2 should now start (no longer blocked by file overlap)
    expect(mockSM.startCalls).toHaveLength(2);
    expect(mockSM.startCalls[1].ticketId).toBe("t2");

    executor.stop();
    await runPromise;
  });

  // -----------------------------------------------------------------------
  // Steps with empty file lists are treated as non-overlapping
  // -----------------------------------------------------------------------
  it("treats steps with empty relatedFiles as non-overlapping", async () => {
    mockScanTickets.mockResolvedValue([
      { id: "t1", title: "T1", status: "open", priority: 2, type: "feature", filePath: "/tmp/t1.md", deps: [], links: [], tags: {} },
      { id: "t2", title: "T2", status: "open", priority: 2, type: "feature", filePath: "/tmp/t2.md", deps: [], links: [], tags: {} },
    ]);

    mockQueryGraphContext.mockImplementation((_proj: string, ticketId: string) => {
      // Both return empty relatedFiles — should not block each other
      if (ticketId === "t1") return { relatedFiles: [], testFiles: [], driftSignals: [] };
      if (ticketId === "t2") return { relatedFiles: [], testFiles: [], driftSignals: [] };
      return null;
    });

    const plan = makePlan([
      { ticketId: "t1", projectId: "p", status: "ready", blockedBy: [] },
      { ticketId: "t2", projectId: "p", status: "ready", blockedBy: [] },
    ], { maxConcurrentAgents: 5 });

    const executor = new Executor(plan, mockSM as unknown as import("../../packages/core/src/agents/session-manager.js").SessionManager);

    const runPromise = executor.run();
    await new Promise((r) => setTimeout(r, 50));

    // Both should start — empty file lists mean no overlap
    expect(mockSM.startCalls).toHaveLength(2);

    executor.stop();
    await runPromise;
  });

  // -----------------------------------------------------------------------
  // Mixed: some steps overlap, some don't — correct subset starts
  // -----------------------------------------------------------------------
  it("starts the correct subset when some steps overlap and others do not", async () => {
    mockScanTickets.mockResolvedValue([
      { id: "t1", title: "T1", status: "open", priority: 1, type: "feature", filePath: "/tmp/t1.md", deps: [], links: [], tags: {} },
      { id: "t2", title: "T2", status: "open", priority: 2, type: "feature", filePath: "/tmp/t2.md", deps: [], links: [], tags: {} },
      { id: "t3", title: "T3", status: "open", priority: 1, type: "feature", filePath: "/tmp/t3.md", deps: [], links: [], tags: {} },
    ]);

    mockQueryGraphContext.mockImplementation((_proj: string, ticketId: string) => {
      if (ticketId === "t1") return { relatedFiles: ["src/a.ts", "src/shared.ts"], testFiles: [], driftSignals: [] };
      if (ticketId === "t2") return { relatedFiles: ["src/shared.ts", "src/b.ts"], testFiles: [], driftSignals: [] };
      if (ticketId === "t3") return { relatedFiles: ["src/c.ts", "src/d.ts"], testFiles: [], driftSignals: [] };
      return null;
    });

    const plan = makePlan([
      { ticketId: "t1", projectId: "p", status: "ready", blockedBy: [] },
      { ticketId: "t2", projectId: "p", status: "ready", blockedBy: [] },
      { ticketId: "t3", projectId: "p", status: "ready", blockedBy: [] },
    ], { maxConcurrentAgents: 5 });

    const executor = new Executor(plan, mockSM as unknown as import("../../packages/core/src/agents/session-manager.js").SessionManager);

    const runPromise = executor.run();
    await new Promise((r) => setTimeout(r, 50));

    // t1 and t2 overlap on src/shared.ts — t1 wins (priority 1 vs 2)
    // t3 has no overlap with anyone — should also start
    const startedTickets = mockSM.startCalls.map((c) => c.ticketId);
    expect(startedTickets).toHaveLength(2);
    expect(startedTickets).toContain("t1");
    expect(startedTickets).toContain("t3");
    expect(startedTickets).not.toContain("t2");

    executor.stop();
    await runPromise;
  });

  // -----------------------------------------------------------------------
  // Verifying-status step files block ready steps
  // -----------------------------------------------------------------------
  it("holds back a ready step that overlaps with a verifying step", async () => {
    mockScanTickets.mockResolvedValue([
      { id: "t-verifying", title: "Verifying", status: "open", priority: 2, type: "feature", filePath: "/tmp/tv.md", deps: [], links: [], tags: {} },
      { id: "t-ready", title: "Ready", status: "open", priority: 2, type: "feature", filePath: "/tmp/tr.md", deps: [], links: [], tags: {} },
      { id: "t-nonoverlap", title: "No overlap", status: "open", priority: 2, type: "feature", filePath: "/tmp/tn.md", deps: [], links: [], tags: {} },
    ]);

    mockQueryGraphContext.mockImplementation((_proj: string, ticketId: string) => {
      if (ticketId === "t-verifying") return { relatedFiles: ["src/api.ts"], testFiles: [], driftSignals: [] };
      if (ticketId === "t-ready") return { relatedFiles: ["src/api.ts", "src/handler.ts"], testFiles: [], driftSignals: [] };
      if (ticketId === "t-nonoverlap") return { relatedFiles: ["src/utils.ts"], testFiles: [], driftSignals: [] };
      return null;
    });

    const plan = makePlan([
      // t-verifying is in verification phase (agent exited, tests running)
      { ticketId: "t-verifying", projectId: "p", status: "verifying", blockedBy: [], agentSessionId: "sess-v1", startedAt: new Date().toISOString() },
      { ticketId: "t-ready", projectId: "p", status: "ready", blockedBy: [] },
      { ticketId: "t-nonoverlap", projectId: "p", status: "ready", blockedBy: [] },
    ], { maxConcurrentAgents: 5 });

    const executor = new Executor(plan, mockSM as unknown as import("../../packages/core/src/agents/session-manager.js").SessionManager);

    const runPromise = executor.run();
    await new Promise((r) => setTimeout(r, 50));

    // t-ready overlaps with t-verifying on src/api.ts → held back
    // t-nonoverlap has no overlap → should start
    const startedTickets = mockSM.startCalls.map((c) => c.ticketId);
    expect(startedTickets).toContain("t-nonoverlap");
    expect(startedTickets).not.toContain("t-ready");
    expect(startedTickets).not.toContain("t-verifying");

    executor.stop();
    await runPromise;
  });

  // -----------------------------------------------------------------------
  // Concurrency limit respected alongside file-overlap filtering
  // -----------------------------------------------------------------------
  it("respects maxConcurrentAgents even when no file overlaps exist", async () => {
    mockScanTickets.mockResolvedValue([
      { id: "t1", title: "T1", status: "open", priority: 2, type: "feature", filePath: "/tmp/t1.md", deps: [], links: [], tags: {} },
      { id: "t2", title: "T2", status: "open", priority: 2, type: "feature", filePath: "/tmp/t2.md", deps: [], links: [], tags: {} },
      { id: "t3", title: "T3", status: "open", priority: 2, type: "feature", filePath: "/tmp/t3.md", deps: [], links: [], tags: {} },
    ]);

    mockQueryGraphContext.mockImplementation((_proj: string, ticketId: string) => {
      // All disjoint — no overlap
      if (ticketId === "t1") return { relatedFiles: ["src/a.ts"], testFiles: [], driftSignals: [] };
      if (ticketId === "t2") return { relatedFiles: ["src/b.ts"], testFiles: [], driftSignals: [] };
      if (ticketId === "t3") return { relatedFiles: ["src/c.ts"], testFiles: [], driftSignals: [] };
      return null;
    });

    const plan = makePlan([
      { ticketId: "t1", projectId: "p", status: "ready", blockedBy: [] },
      { ticketId: "t2", projectId: "p", status: "ready", blockedBy: [] },
      { ticketId: "t3", projectId: "p", status: "ready", blockedBy: [] },
    ], { maxConcurrentAgents: 2 }); // Only 2 slots

    const executor = new Executor(plan, mockSM as unknown as import("../../packages/core/src/agents/session-manager.js").SessionManager);

    const runPromise = executor.run();
    await new Promise((r) => setTimeout(r, 50));

    // Only 2 should start despite 3 being ready with no overlaps
    expect(mockSM.startCalls).toHaveLength(2);
    expect(plan.steps.filter((s) => s.status === "in-progress")).toHaveLength(2);
    expect(plan.steps.filter((s) => s.status === "ready")).toHaveLength(1);

    executor.stop();
    await runPromise;
  });

  // -----------------------------------------------------------------------
  // Caching: getStepFiles caches results per ticketId
  // -----------------------------------------------------------------------
  it("caches file lists per ticketId (queryGraphContext called once per step)", async () => {
    mockScanTickets.mockResolvedValue([
      { id: "t1", title: "T1", status: "open", priority: 2, type: "feature", filePath: "/tmp/t1.md", deps: [], links: [], tags: {} },
    ]);

    mockQueryGraphContext.mockReturnValue({
      relatedFiles: ["src/x.ts"],
      testFiles: [],
      driftSignals: [],
    });

    const plan = makePlan([
      { ticketId: "t1", projectId: "p", status: "ready", blockedBy: [] },
    ], { maxConcurrentAgents: 5 });

    const executor = new Executor(plan, mockSM as unknown as import("../../packages/core/src/agents/session-manager.js").SessionManager);

    const runPromise = executor.run();
    await new Promise((r) => setTimeout(r, 50));

    // t1 started
    expect(mockSM.startCalls).toHaveLength(1);

    // Complete t1 to trigger recomputeAndContinue, which calls startReadySteps again
    const sessionId = plan.steps[0].agentSessionId!;
    mockSM.simulateWrite(sessionId);
    mockSM.simulateCompletion(sessionId);
    await new Promise((r) => setTimeout(r, 100));

    // queryGraphContext should have been called only once for t1 (cached)
    const t1Calls = mockQueryGraphContext.mock.calls.filter(
      (c: unknown[]) => c[1] === "t1"
    );
    expect(t1Calls).toHaveLength(1);

    executor.stop();
    await runPromise;
  });
});
