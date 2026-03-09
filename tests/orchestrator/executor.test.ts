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

  // Simulate an agent error — emits state_change then session_stopped
  simulateError(sessionId: string): void {
    this.emit("state_change", {
      sessionId,
      oldState: "streaming" as AgentState,
      newState: "error" as AgentState,
    });
    // Error state is non-fatal; the agent stops shortly after
    const session: AgentSession = {
      id: sessionId,
      backend: "claude-code",
      projectId: "test",
      state: "stopped",
      startedAt: new Date().toISOString(),
      stoppedAt: new Date().toISOString(),
    };
    this.emit("session_stopped", session);
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
    name: "Engineer",
    permissionMode: "acceptEdits",
    allowedTools: [],
    disallowedTools: ["EnterPlanMode", "ExitPlanMode", "EnterWorktree"],
    allowedBashPatterns: [...(stackPatterns ?? []), ...((planConfig?.allowedBashPatterns as string[]) ?? [])],
    instructions: "",
    doneCriteria: "",
    runTests: true,
    runOracle: false,
  })),
}));

vi.mock("../../packages/core/src/orchestrator/smoke-test.js", () => ({
  runSmoke: vi.fn(async () => ({ passed: true, buildPassed: true, testsPassed: true, buildOutput: "", testOutput: "", durationMs: 0 })),
}));

vi.mock("../../packages/core/src/orchestrator/worktree.js", () => {
  return {
    WorktreeManager: vi.fn().mockImplementation(() => ({
      create: vi.fn(),
      remove: vi.fn(),
      hasCommits: vi.fn(),
      merge: vi.fn(),
      attemptRebase: vi.fn(),
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

    // Wait for the async completion chain (loadProject, commitStepChanges, etc.)
    // rather than relying on a fixed timeout that can be too short under load.
    await vi.waitFor(() => {
      expect(completedSteps).toContain("t1");
    }, { timeout: 5000, interval: 10 });

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

  it("event loop stays alive while paused — resume works after pauseOnFailure", async () => {
    const plan = makePlan([
      { ticketId: "t1", projectId: "p", status: "ready", blockedBy: [] },
      { ticketId: "t2", projectId: "p", status: "ready", blockedBy: [] },
    ], { pauseOnFailure: true, maxConcurrentAgents: 1 });

    const executor = new Executor(plan, mockSM as unknown as import("../../packages/core/src/agents/session-manager.js").SessionManager);

    let paused = false;
    let resumed = false;
    executor.on("plan_paused", () => { paused = true; });
    executor.on("plan_updated", ({ plan: p }) => {
      if (p.status === "executing" && paused) resumed = true;
    });

    const runPromise = executor.run();
    await new Promise((r) => setTimeout(r, 50));

    // t1 started
    expect(mockSM.startCalls).toHaveLength(1);

    // Simulate t1 failure
    const sessionId = plan.steps.find((s) => s.ticketId === "t1")!.agentSessionId!;
    mockSM.simulateError(sessionId);
    await new Promise((r) => setTimeout(r, 50));

    expect(paused).toBe(true);
    expect(plan.status).toBe("paused");
    // t2 should still be ready (not started while paused)
    expect(plan.steps.find((s) => s.ticketId === "t2")!.status).toBe("ready");

    // Resume — event loop must still be alive for this to work
    executor.resume();
    await new Promise((r) => setTimeout(r, 200));

    expect(resumed).toBe(true);
    expect(executor.getPlan().status).not.toBe("paused");
    // t2 should have been started after resume
    expect(mockSM.startCalls.length).toBeGreaterThan(1);

    executor.stop();
    await runPromise;
  });

  it("event loop stays alive when all steps are terminal and plan is paused", async () => {
    // Single step — when it fails with pauseOnFailure, all steps are terminal.
    // The event loop must NOT exit, so resume can re-enter.
    const plan = makePlan([
      { ticketId: "t1", projectId: "p", status: "ready", blockedBy: [] },
    ], { pauseOnFailure: true });

    const executor = new Executor(plan, mockSM as unknown as import("../../packages/core/src/agents/session-manager.js").SessionManager);

    const runPromise = executor.run();
    await new Promise((r) => setTimeout(r, 50));

    // Simulate failure
    const sessionId = plan.steps.find((s) => s.ticketId === "t1")!.agentSessionId!;
    mockSM.simulateError(sessionId);
    await new Promise((r) => setTimeout(r, 50));

    expect(plan.status).toBe("paused");

    // Verify run() has NOT resolved — the event loop is still alive
    let runResolved = false;
    runPromise.then(() => { runResolved = true; });
    await new Promise((r) => setTimeout(r, 100));
    expect(runResolved).toBe(false);

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

    // Pause — should stop running agent and reset step to ready
    executor.pause();
    await new Promise((r) => setTimeout(r, 100));
    expect(executor.getPlan().status).toBe("paused");
    expect(executor.getPlan().steps.every((s) => s.status === "ready")).toBe(true);

    const startsBeforeResume = mockSM.startCalls.length;

    // Resume — should restart agents
    executor.resume();
    await new Promise((r) => setTimeout(r, 200));

    // After resume, plan should be executing and agents restarted
    expect(["executing", "done"]).toContain(executor.getPlan().status);
    expect(mockSM.startCalls.length).toBeGreaterThan(startsBeforeResume);

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

  it("preserves all other frontmatter fields", async () => {
    const filePath = join(tmpDir, "ticket.md");
    const content = `---
id: test-ticket
title: "My Important Ticket"
status: open
priority: 1
type: feature
deps:
  - dep-1
  - dep-2
links:
  - docs/spec/foo.md
---

# Content stays intact
`;
    await writeFile(filePath, content, "utf-8");
    await updateTicketStatus(filePath, "closed");

    const updated = await readFile(filePath, "utf-8");
    expect(updated).toContain("status: closed");
    expect(updated).toContain('title: "My Important Ticket"');
    expect(updated).toContain("priority: 1");
    expect(updated).toContain("type: feature");
    expect(updated).toContain("- dep-1");
    expect(updated).toContain("- dep-2");
    expect(updated).toContain("# Content stays intact");

    await rm(tmpDir, { recursive: true });
  });

  it("does not write file when status is already the target", async () => {
    const filePath = join(tmpDir, "ticket.md");
    const content = `---
id: test-ticket
status: closed
---
`;
    await writeFile(filePath, content, "utf-8");
    await updateTicketStatus(filePath, "closed");

    const updated = await readFile(filePath, "utf-8");
    expect(updated).toBe(content);

    await rm(tmpDir, { recursive: true });
  });

  it("handles status with extra whitespace", async () => {
    const filePath = join(tmpDir, "ticket.md");
    const content = `---
id: test-ticket
status:   open
---
`;
    await writeFile(filePath, content, "utf-8");
    await updateTicketStatus(filePath, "in-progress");

    const updated = await readFile(filePath, "utf-8");
    expect(updated).toContain("status:   in-progress");

    await rm(tmpDir, { recursive: true });
  });

  it("transitions from closed back to open", async () => {
    const filePath = join(tmpDir, "ticket.md");
    const content = `---
id: reopen-ticket
status: closed
priority: 2
---

# Reopened
`;
    await writeFile(filePath, content, "utf-8");
    await updateTicketStatus(filePath, "open");

    const updated = await readFile(filePath, "utf-8");
    expect(updated).toContain("status: open");
    expect(updated).not.toContain("status: closed");

    await rm(tmpDir, { recursive: true });
  });
});
