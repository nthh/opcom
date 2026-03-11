import { describe, it, expect, vi, beforeEach } from "vitest";
import { Executor } from "../../packages/core/src/orchestrator/executor.js";
import { defaultConfig } from "../../packages/core/src/orchestrator/persistence.js";
import type { Plan, PlanStep, AgentSession } from "@opcom/types";
import { waitFor } from "./_helpers.js";

// Mock SessionManager with promptSession support
type EventHandler<T> = (data: T) => void;

class MockSessionManager {
  private listeners = new Map<string, Set<EventHandler<unknown>>>();
  startCalls: Array<{ projectId: string; backend: string; config: unknown; ticketId?: string }> = [];
  promptCalls: Array<{ sessionId: string; message: string }> = [];
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

  async stopSession(_sessionId: string): Promise<void> {}

  async promptSession(sessionId: string, message: string): Promise<void> {
    this.promptCalls.push({ sessionId, message });
  }

  simulateToolStart(sessionId: string, toolName: string, toolInput: string): void {
    this.emit("agent_event", {
      sessionId,
      event: {
        type: "tool_start",
        sessionId,
        timestamp: new Date().toISOString(),
        data: { toolName, toolInput },
      },
    });
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

vi.mock("../../packages/core/src/orchestrator/git-ops.js", () => ({
  commitStepChanges: vi.fn(async () => true),
  captureChangeset: vi.fn(async () => null),
}));

vi.mock("../../packages/core/src/config/roles.js", () => ({
  loadRole: vi.fn(async () => ({ id: "engineer", name: "Engineer", denyPaths: [".tickets/**"] })),
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
    denyPaths: [".tickets/**"],
  })),
}));

vi.mock("../../packages/core/src/orchestrator/smoke-test.js", () => ({
  runSmoke: vi.fn(async () => ({ passed: true, buildPassed: true, testsPassed: true, buildOutput: "", testOutput: "", durationMs: 0 })),
}));

vi.mock("../../packages/core/src/config/summary.js", () => ({
  readProjectSummary: vi.fn(async () => null),
  writeProjectSummary: vi.fn(async () => {}),
  updateProjectSummary: vi.fn(async () => {}),
  createInitialSummaryFromDescription: vi.fn(() => ""),
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

vi.mock("../../packages/core/src/agents/allowed-bash.js", () => ({
  deriveAllowedBashTools: vi.fn(() => []),
  checkForbiddenCommand: vi.fn(() => ({ forbidden: false })),
}));

vi.mock("../../packages/core/src/graph/graph-service.js", () => ({
  ingestTestResults: vi.fn(),
  queryGraphContext: vi.fn(() => null),
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

describe("Executor denyPaths enforcement", () => {
  let sm: MockSessionManager;

  beforeEach(() => {
    sm = new MockSessionManager();
    vi.clearAllMocks();
  });

  it("emits denied_write when agent writes to a denied path", async () => {
    const plan = makePlan([
      { ticketId: "t1", projectId: "p", status: "ready", blockedBy: [] },
    ]);

    const executor = new Executor(plan, sm as never);
    const denied: Array<{ stepTicketId: string; filePath: string; roleId: string; pattern: string }> = [];
    executor.on("denied_write", (ev) => denied.push(ev));

    const runPromise = executor.run();
    await waitFor(() => sm.startCalls.length === 1);

    const sessionId = sm.startCalls[0].ticketId ? `session-1` : "";

    // Simulate agent attempting to write to a ticket file
    sm.simulateToolStart(sessionId, "Write", JSON.stringify({
      file_path: ".tickets/impl/foo/README.md",
      content: "modified ticket",
    }));

    expect(denied).toHaveLength(1);
    expect(denied[0].stepTicketId).toBe("t1");
    expect(denied[0].filePath).toBe(".tickets/impl/foo/README.md");
    expect(denied[0].roleId).toBe("engineer");
    expect(denied[0].pattern).toBe(".tickets/**");

    // Clean up
    sm.simulateWrite(sessionId);
    sm.simulateCompletion(sessionId);
    executor.stop();
    await runPromise;
  });

  it("sends rejection message to agent via promptSession", async () => {
    const plan = makePlan([
      { ticketId: "t1", projectId: "p", status: "ready", blockedBy: [] },
    ]);

    const executor = new Executor(plan, sm as never);
    const runPromise = executor.run();
    await waitFor(() => sm.startCalls.length === 1);

    const sessionId = "session-1";

    sm.simulateToolStart(sessionId, "Edit", JSON.stringify({
      file_path: "/project/.tickets/impl/bar.md",
      old_string: "old",
      new_string: "new",
    }));

    // promptSession should be called with the rejection message
    await waitFor(() => sm.promptCalls.length === 1);
    expect(sm.promptCalls[0].sessionId).toBe(sessionId);
    expect(sm.promptCalls[0].message).toContain("Cannot modify");
    expect(sm.promptCalls[0].message).toContain(".tickets/**");
    expect(sm.promptCalls[0].message).toContain("read-only during execution");

    sm.simulateWrite(sessionId);
    sm.simulateCompletion(sessionId);
    executor.stop();
    await runPromise;
  });

  it("does not emit denied_write for non-ticket paths", async () => {
    const plan = makePlan([
      { ticketId: "t1", projectId: "p", status: "ready", blockedBy: [] },
    ]);

    const executor = new Executor(plan, sm as never);
    const denied: unknown[] = [];
    executor.on("denied_write", (ev) => denied.push(ev));

    const runPromise = executor.run();
    await waitFor(() => sm.startCalls.length === 1);

    const sessionId = "session-1";

    // Write to a normal source file — should be allowed
    sm.simulateToolStart(sessionId, "Write", JSON.stringify({
      file_path: "src/index.ts",
      content: "console.log('hello')",
    }));

    expect(denied).toHaveLength(0);
    expect(sm.promptCalls).toHaveLength(0);

    sm.simulateWrite(sessionId);
    sm.simulateCompletion(sessionId);
    executor.stop();
    await runPromise;
  });

  it("does not emit denied_write for non-write tools", async () => {
    const plan = makePlan([
      { ticketId: "t1", projectId: "p", status: "ready", blockedBy: [] },
    ]);

    const executor = new Executor(plan, sm as never);
    const denied: unknown[] = [];
    executor.on("denied_write", (ev) => denied.push(ev));

    const runPromise = executor.run();
    await waitFor(() => sm.startCalls.length === 1);

    const sessionId = "session-1";

    // Read tool targeting a ticket file — should NOT trigger deny
    sm.simulateToolStart(sessionId, "Read", JSON.stringify({
      file_path: ".tickets/impl/foo/README.md",
    }));

    expect(denied).toHaveLength(0);

    sm.simulateWrite(sessionId);
    sm.simulateCompletion(sessionId);
    executor.stop();
    await runPromise;
  });

  it("detects denied writes via Edit tool", async () => {
    const plan = makePlan([
      { ticketId: "t1", projectId: "p", status: "ready", blockedBy: [] },
    ]);

    const executor = new Executor(plan, sm as never);
    const denied: Array<{ filePath: string }> = [];
    executor.on("denied_write", (ev) => denied.push(ev));

    const runPromise = executor.run();
    await waitFor(() => sm.startCalls.length === 1);

    sm.simulateToolStart("session-1", "Edit", JSON.stringify({
      file_path: ".tickets/impl/my-ticket/README.md",
      old_string: "a",
      new_string: "b",
    }));

    expect(denied).toHaveLength(1);
    expect(denied[0].filePath).toBe(".tickets/impl/my-ticket/README.md");

    sm.simulateWrite("session-1");
    sm.simulateCompletion("session-1");
    executor.stop();
    await runPromise;
  });

  it("detects denied writes via NotebookEdit tool", async () => {
    const plan = makePlan([
      { ticketId: "t1", projectId: "p", status: "ready", blockedBy: [] },
    ]);

    const executor = new Executor(plan, sm as never);
    const denied: Array<{ filePath: string }> = [];
    executor.on("denied_write", (ev) => denied.push(ev));

    const runPromise = executor.run();
    await waitFor(() => sm.startCalls.length === 1);

    sm.simulateToolStart("session-1", "NotebookEdit", JSON.stringify({
      file_path: ".tickets/impl/nb.md",
    }));

    expect(denied).toHaveLength(1);
    expect(denied[0].filePath).toBe(".tickets/impl/nb.md");

    sm.simulateWrite("session-1");
    sm.simulateCompletion("session-1");
    executor.stop();
    await runPromise;
  });

  it("handles promptSession failure gracefully (one-shot mode)", async () => {
    // Override promptSession to throw (simulating closed stdin)
    sm.promptSession = async () => {
      throw new Error("Cannot send follow-up prompt: stdin is closed (one-shot -p mode)");
    };

    const plan = makePlan([
      { ticketId: "t1", projectId: "p", status: "ready", blockedBy: [] },
    ]);

    const executor = new Executor(plan, sm as never);
    const denied: unknown[] = [];
    executor.on("denied_write", (ev) => denied.push(ev));

    const runPromise = executor.run();
    await waitFor(() => sm.startCalls.length === 1);

    // Should not throw even when promptSession fails
    sm.simulateToolStart("session-1", "Write", JSON.stringify({
      file_path: ".tickets/impl/foo.md",
      content: "test",
    }));

    // Event is still emitted despite promptSession failure
    expect(denied).toHaveLength(1);

    sm.simulateWrite("session-1");
    sm.simulateCompletion("session-1");
    executor.stop();
    await runPromise;
  });

  it("does not deny writes when role has no denyPaths", async () => {
    // Override resolveRoleConfig to return empty denyPaths (e.g., planner role)
    const { resolveRoleConfig } = await import("../../packages/core/src/config/roles.js");
    (resolveRoleConfig as ReturnType<typeof vi.fn>).mockReturnValueOnce({
      roleId: "planner",
      name: "Planner",
      permissionMode: "acceptEdits",
      allowedTools: [],
      disallowedTools: [],
      allowedBashPatterns: [],
      instructions: "",
      doneCriteria: "",
      runTests: false,
      runOracle: false,
      denyPaths: [],
    });

    const plan = makePlan([
      { ticketId: "t1", projectId: "p", status: "ready", blockedBy: [] },
    ]);

    const executor = new Executor(plan, sm as never);
    const denied: unknown[] = [];
    executor.on("denied_write", (ev) => denied.push(ev));

    const runPromise = executor.run();
    await waitFor(() => sm.startCalls.length === 1);

    // Planner writes to .tickets/ — should be allowed
    sm.simulateToolStart("session-1", "Write", JSON.stringify({
      file_path: ".tickets/impl/foo/README.md",
      content: "updated plan",
    }));

    expect(denied).toHaveLength(0);
    expect(sm.promptCalls).toHaveLength(0);

    sm.simulateWrite("session-1");
    sm.simulateCompletion("session-1");
    executor.stop();
    await runPromise;
  });

  it("executor updateTicketStatusSafe writes to .tickets/ despite denyPaths (not agent-initiated)", async () => {
    // Setup: make scanTickets return a ticket so updateTicketStatusSafe can find it.
    // The executor writes ticket status directly via fs, bypassing the agent event pipeline.
    const { mkdtemp, writeFile: fsWriteFile, readFile: fsReadFile, rm } = await import("node:fs/promises");
    const { join } = await import("node:path");
    const { tmpdir } = await import("node:os");
    const tmpDir = await mkdtemp(join(tmpdir(), "opcom-executor-bypass-"));

    const ticketsDir = join(tmpDir, ".tickets", "impl");
    const { mkdir } = await import("node:fs/promises");
    await mkdir(ticketsDir, { recursive: true });
    const ticketFilePath = join(ticketsDir, "t1.md");
    await fsWriteFile(ticketFilePath, `---
id: t1
title: "Test ticket"
status: open
type: feature
priority: 1
---

# Test ticket
`);

    // Override scanTickets to always return a ticket with a real file path.
    // It's called multiple times: loadCurrentTickets(), recomputeAndContinue(), updateTicketStatusSafe().
    const { scanTickets } = await import("../../packages/core/src/detection/tickets.js");
    const ticketData = [{
      id: "t1",
      title: "Test ticket",
      status: "open",
      type: "feature",
      priority: 1,
      source: "tickets",
      filePath: ticketFilePath,
    }];
    (scanTickets as ReturnType<typeof vi.fn>).mockResolvedValue(ticketData);

    // Override loadProject to return the temp dir as the project path (called multiple times).
    const { loadProject } = await import("../../packages/core/src/config/loader.js");
    const projectData = {
      id: "p",
      name: "p",
      path: tmpDir,
      stack: { languages: [], frameworks: [], packageManagers: [{ name: "npm", sourceFile: "package-lock.json" }], infrastructure: [], versionManagers: [] },
      testing: { framework: "vitest", command: "npm test" },
      linting: [],
    };
    (loadProject as ReturnType<typeof vi.fn>).mockResolvedValue(projectData);

    const plan = makePlan([
      { ticketId: "t1", projectId: "p", status: "ready", blockedBy: [] },
    ], { worktree: false, ticketTransitions: true });

    const executor = new Executor(plan, sm as never);
    const completed: unknown[] = [];
    executor.on("step_completed", (ev) => completed.push(ev));

    const runPromise = executor.run();
    await waitFor(() => sm.startCalls.length === 1);

    // Agent writes to a source file (not denied) and then completes
    sm.simulateWrite("session-1");
    sm.simulateCompletion("session-1");

    await waitFor(() => completed.length === 1);

    // Verify that the ticket file in .tickets/ was updated to "closed"
    // even though denyPaths includes ".tickets/**"
    const content = await fsReadFile(ticketFilePath, "utf-8");
    expect(content).toContain("status: closed");
    expect(content).not.toContain("status: open");

    executor.stop();
    await runPromise;
    await rm(tmpDir, { recursive: true });
  });
});
