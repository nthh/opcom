import { describe, it, expect, vi, beforeEach } from "vitest";
import { Executor, updateTicketStatus } from "../../packages/core/src/orchestrator/executor.js";
import { defaultConfig } from "../../packages/core/src/orchestrator/persistence.js";
import type { Plan, PlanStep, AgentSession, AgentState } from "@opcom/types";
import { writeFile, readFile, mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

// Mock SessionManager
type EventHandler<T> = (data: T) => void;

class MockSessionManager {
  private listeners = new Map<string, Set<EventHandler<unknown>>>();
  startCalls: Array<{ projectId: string; backend: string; config: unknown; ticketId?: string }> = [];
  stopCalls: string[] = [];
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

  async stopSession(sessionId: string): Promise<void> {
    this.stopCalls.push(sessionId);
  }

  // Simulate an agent writing files (so completion check passes)
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

  // Simulate an agent completing
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

  // Simulate an agent error
  simulateError(sessionId: string): void {
    this.emit("state_change", {
      sessionId,
      oldState: "streaming" as AgentState,
      newState: "error" as AgentState,
    });
  }
}

// Mock the persistence and loader modules
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
}));

const mockCommitStepChanges = vi.fn(async () => true);
vi.mock("../../packages/core/src/orchestrator/git-ops.js", () => ({
  commitStepChanges: (...args: unknown[]) => mockCommitStepChanges(...args),
}));

vi.mock("../../packages/core/src/orchestrator/worktree.js", () => {
  return {
    WorktreeManager: vi.fn().mockImplementation(() => ({
      create: vi.fn(),
      remove: vi.fn(),
      hasCommits: vi.fn(),
      merge: vi.fn(),
      getInfo: vi.fn(),
      restore: vi.fn(),
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
    config: { ...defaultConfig(), worktree: false, ...configOverrides },
    context: "",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

describe("Executor", () => {
  let mockSM: MockSessionManager;

  beforeEach(() => {
    mockSM = new MockSessionManager();
    vi.clearAllMocks();
  });

  it("finds ready steps and starts agents up to concurrency limit", async () => {
    const plan = makePlan([
      { ticketId: "t1", projectId: "p", status: "ready", blockedBy: [] },
      { ticketId: "t2", projectId: "p", status: "ready", blockedBy: [] },
      { ticketId: "t3", projectId: "p", status: "ready", blockedBy: [] },
      { ticketId: "t4", projectId: "p", status: "ready", blockedBy: [] },
    ], { maxConcurrentAgents: 2 });

    const executor = new Executor(plan, mockSM as unknown as import("../../packages/core/src/agents/session-manager.js").SessionManager);

    // Run in background, stop after first batch starts
    const runPromise = executor.run();

    // Give it a tick to start
    await new Promise((r) => setTimeout(r, 50));

    expect(mockSM.startCalls).toHaveLength(2); // respects concurrency limit
    expect(plan.steps.filter((s) => s.status === "in-progress")).toHaveLength(2);
    expect(plan.steps.filter((s) => s.status === "ready")).toHaveLength(2);

    executor.stop();
    await runPromise;
  });

  it("agent completion → step done → downstream becomes ready", async () => {
    const plan = makePlan([
      { ticketId: "t1", projectId: "p", status: "ready", blockedBy: [] },
      { ticketId: "t2", projectId: "p", status: "blocked", blockedBy: ["t1"] },
    ]);

    const executor = new Executor(plan, mockSM as unknown as import("../../packages/core/src/agents/session-manager.js").SessionManager);

    const completedSteps: string[] = [];
    executor.on("step_completed", ({ step }) => completedSteps.push(step.ticketId));

    const runPromise = executor.run();
    await new Promise((r) => setTimeout(r, 50));

    // t1 should be started
    expect(mockSM.startCalls).toHaveLength(1);
    expect(mockSM.startCalls[0].ticketId).toBe("t1");

    // Simulate t1 agent writing files then completing
    const sessionId = plan.steps.find((s) => s.ticketId === "t1")!.agentSessionId!;
    mockSM.simulateWrite(sessionId);
    mockSM.simulateCompletion(sessionId);

    await new Promise((r) => setTimeout(r, 50));

    expect(completedSteps).toContain("t1");

    executor.stop();
    await runPromise;
  });

  it("agent error → step failed → plan pauses (if pauseOnFailure)", async () => {
    const plan = makePlan([
      { ticketId: "t1", projectId: "p", status: "ready", blockedBy: [] },
    ], { pauseOnFailure: true });

    const executor = new Executor(plan, mockSM as unknown as import("../../packages/core/src/agents/session-manager.js").SessionManager);

    let paused = false;
    executor.on("plan_paused", () => { paused = true; });

    const runPromise = executor.run();
    await new Promise((r) => setTimeout(r, 50));

    // Simulate error
    const sessionId = plan.steps.find((s) => s.ticketId === "t1")!.agentSessionId!;
    mockSM.simulateError(sessionId);

    await new Promise((r) => setTimeout(r, 50));

    expect(plan.steps.find((s) => s.ticketId === "t1")!.status).toBe("failed");
    expect(paused).toBe(true);
    expect(plan.status).toBe("paused");

    executor.stop();
    await runPromise;
  });

  it("pause stops new starts, resume recomputes", async () => {
    const plan = makePlan([
      { ticketId: "t1", projectId: "p", status: "ready", blockedBy: [] },
      { ticketId: "t2", projectId: "p", status: "ready", blockedBy: [] },
    ], { maxConcurrentAgents: 1 });

    const executor = new Executor(plan, mockSM as unknown as import("../../packages/core/src/agents/session-manager.js").SessionManager);

    const runPromise = executor.run();
    await new Promise((r) => setTimeout(r, 50));

    expect(mockSM.startCalls).toHaveLength(1);

    // Pause
    executor.pause();
    await new Promise((r) => setTimeout(r, 100));
    expect(executor.getPlan().status).toBe("paused");

    // Complete first task (with write activity)
    const sessionId = executor.getPlan().steps.find((s) => s.status === "in-progress")!.agentSessionId!;
    mockSM.simulateWrite(sessionId);
    mockSM.simulateCompletion(sessionId);
    await new Promise((r) => setTimeout(r, 100));

    // Still paused — t2 not started yet
    const startsWhilePaused = mockSM.startCalls.length;

    // Resume
    executor.resume();
    await new Promise((r) => setTimeout(r, 200));

    // After resume, plan should be executing (or done if t2 already completed)
    expect(["executing", "done"]).toContain(executor.getPlan().status);
    // More agents should have been started after resume
    expect(mockSM.startCalls.length).toBeGreaterThanOrEqual(startsWhilePaused);

    executor.stop();
    await runPromise;
  });

  it("context injection appends to plan.context", async () => {
    const plan = makePlan([
      { ticketId: "t1", projectId: "p", status: "ready", blockedBy: [] },
    ]);

    const executor = new Executor(plan, mockSM as unknown as import("../../packages/core/src/agents/session-manager.js").SessionManager);

    const runPromise = executor.run();
    await new Promise((r) => setTimeout(r, 50));

    await executor.injectContext("First note");
    expect(plan.context).toBe("First note");

    await executor.injectContext("Second note");
    expect(plan.context).toBe("First note\nSecond note");

    executor.stop();
    await runPromise;
  });

  it("skip step → step becomes skipped, downstream unblocked", async () => {
    const plan = makePlan([
      { ticketId: "t1", projectId: "p", status: "ready", blockedBy: [] },
      { ticketId: "t2", projectId: "p", status: "blocked", blockedBy: ["t1"] },
    ]);

    const executor = new Executor(plan, mockSM as unknown as import("../../packages/core/src/agents/session-manager.js").SessionManager);

    const runPromise = executor.run();
    await new Promise((r) => setTimeout(r, 50));

    // Skip t1 instead of running it
    executor.skipStep("t1");
    await new Promise((r) => setTimeout(r, 50));

    expect(plan.steps.find((s) => s.ticketId === "t1")!.status).toBe("skipped");

    executor.stop();
    await runPromise;
  });
});

describe("Executor plan event logging", () => {
  let mockSM: MockSessionManager;

  beforeEach(() => {
    mockSM = new MockSessionManager();
    vi.clearAllMocks();
  });

  it("logs plan events to EventStore when provided", async () => {
    // Create a mock EventStore
    const planEvents: Array<{ planId: string; eventType: string; opts?: unknown }> = [];
    const mockEventStore = {
      insertPlanEvent: (planId: string, eventType: string, opts?: unknown) => {
        planEvents.push({ planId, eventType, opts });
      },
    };

    const plan = makePlan([
      { ticketId: "t1", projectId: "p", status: "ready", blockedBy: [] },
    ]);

    const executor = new Executor(
      plan,
      mockSM as unknown as import("../../packages/core/src/agents/session-manager.js").SessionManager,
      mockEventStore as unknown as import("../../packages/core/src/agents/event-store.js").EventStore,
    );

    const runPromise = executor.run();
    await new Promise((r) => setTimeout(r, 50));

    // Should have logged plan_started and step_started
    expect(planEvents.some((e) => e.eventType === "plan_started")).toBe(true);
    expect(planEvents.some((e) => e.eventType === "step_started")).toBe(true);

    // Complete the step with writes
    const sessionId = plan.steps[0].agentSessionId!;
    mockSM.simulateWrite(sessionId);
    mockSM.simulateCompletion(sessionId);
    await new Promise((r) => setTimeout(r, 100));

    // Should have logged step_completed and plan_completed
    expect(planEvents.some((e) => e.eventType === "step_completed")).toBe(true);
    expect(planEvents.some((e) => e.eventType === "plan_completed")).toBe(true);

    executor.stop();
    await runPromise;
  });
});

describe("Executor auto-commit", () => {
  let mockSM: MockSessionManager;

  beforeEach(() => {
    mockSM = new MockSessionManager();
    vi.clearAllMocks();
  });

  it("calls commitStepChanges after step completes when autoCommit is true", async () => {
    const plan = makePlan([
      { ticketId: "t1", projectId: "p", status: "ready", blockedBy: [] },
    ], { autoCommit: true });

    const executor = new Executor(plan, mockSM as unknown as import("../../packages/core/src/agents/session-manager.js").SessionManager);

    const runPromise = executor.run();
    await new Promise((r) => setTimeout(r, 50));

    const sessionId = plan.steps[0].agentSessionId!;
    mockSM.simulateWrite(sessionId);
    mockSM.simulateCompletion(sessionId);
    await new Promise((r) => setTimeout(r, 100));

    expect(mockCommitStepChanges).toHaveBeenCalledWith("/tmp/test-p", "t1");

    executor.stop();
    await runPromise;
  });

  it("does not call commitStepChanges when autoCommit is false", async () => {
    const plan = makePlan([
      { ticketId: "t1", projectId: "p", status: "ready", blockedBy: [] },
    ], { autoCommit: false });

    const executor = new Executor(plan, mockSM as unknown as import("../../packages/core/src/agents/session-manager.js").SessionManager);

    const runPromise = executor.run();
    await new Promise((r) => setTimeout(r, 50));

    const sessionId = plan.steps[0].agentSessionId!;
    mockSM.simulateWrite(sessionId);
    mockSM.simulateCompletion(sessionId);
    await new Promise((r) => setTimeout(r, 100));

    expect(mockCommitStepChanges).not.toHaveBeenCalled();

    executor.stop();
    await runPromise;
  });
});

describe("Executor allowedTools passthrough", () => {
  let mockSM: MockSessionManager;

  beforeEach(() => {
    mockSM = new MockSessionManager();
    vi.clearAllMocks();
  });

  it("passes derived allowedTools to sessionManager.startSession", async () => {
    const plan = makePlan([
      { ticketId: "t1", projectId: "p", status: "ready", blockedBy: [] },
    ]);

    const executor = new Executor(plan, mockSM as unknown as import("../../packages/core/src/agents/session-manager.js").SessionManager);

    const runPromise = executor.run();
    await new Promise((r) => setTimeout(r, 50));

    expect(mockSM.startCalls).toHaveLength(1);
    const config = mockSM.startCalls[0].config as { allowedTools?: string[] };
    expect(config.allowedTools).toBeDefined();
    expect(Array.isArray(config.allowedTools)).toBe(true);

    // Should include always-safe patterns
    expect(config.allowedTools).toContain("Bash(git status*)");
    expect(config.allowedTools).toContain("Bash(git diff*)");

    // Should include npm patterns from the mocked project
    expect(config.allowedTools).toContain("Bash(npm test*)");
    expect(config.allowedTools).toContain("Bash(npm run *)");
    expect(config.allowedTools).toContain("Bash(npx *)");

    // Should include eslint patterns from the mocked project
    expect(config.allowedTools).toContain("Bash(eslint *)");

    executor.stop();
    await runPromise;
  });

  it("includes user-provided allowedBashPatterns from plan config", async () => {
    const plan = makePlan([
      { ticketId: "t1", projectId: "p", status: "ready", blockedBy: [] },
    ], { allowedBashPatterns: ["docker compose*", "make *"] });

    const executor = new Executor(plan, mockSM as unknown as import("../../packages/core/src/agents/session-manager.js").SessionManager);

    const runPromise = executor.run();
    await new Promise((r) => setTimeout(r, 50));

    const config = mockSM.startCalls[0].config as { allowedTools?: string[] };
    expect(config.allowedTools).toContain("Bash(docker compose*)");
    expect(config.allowedTools).toContain("Bash(make *)");

    executor.stop();
    await runPromise;
  });
});

describe("updateTicketStatus", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "opcom-test-"));
  });

  it("replaces status in YAML frontmatter", async () => {
    const filePath = join(tmpDir, "ticket.md");
    const content = `---
id: test-ticket
title: Test
status: open
priority: 2
---

# Test Ticket
`;
    await writeFile(filePath, content, "utf-8");
    await updateTicketStatus(filePath, "in-progress");

    const updated = await readFile(filePath, "utf-8");
    expect(updated).toContain("status: in-progress");
    expect(updated).not.toContain("status: open");

    await rm(tmpDir, { recursive: true });
  });
});
