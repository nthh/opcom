import { describe, it, expect, vi, beforeEach } from "vitest";
import { Executor } from "../../packages/core/src/orchestrator/executor.js";
import { defaultConfig } from "../../packages/core/src/orchestrator/persistence.js";
import type { Plan, PlanStep, AgentSession, AgentStartConfig } from "@opcom/types";
import { waitFor } from "./_helpers.js";

// Mock SessionManager with oracle event simulation
type EventHandler<T> = (data: T) => void;

const ORACLE_RESPONSE_ALL_MET = `## Criteria
- **Criterion**: Feature is implemented
  - **Met**: YES
  - **Reasoning**: The diff shows a complete implementation

- **Criterion**: Tests are included
  - **Met**: YES
  - **Reasoning**: Test file is present

## Concerns
None.
`;

const ORACLE_RESPONSE_UNMET = `## Criteria
- **Criterion**: Feature is implemented
  - **Met**: YES
  - **Reasoning**: Implementation looks correct

- **Criterion**: Tests are included
  - **Met**: NO
  - **Reasoning**: No test file found in the diff

## Concerns
- Missing test coverage for the new feature
`;

class MockSessionManager {
  private listeners = new Map<string, Set<EventHandler<unknown>>>();
  startCalls: Array<{ projectId: string; backend: string; config: AgentStartConfig; ticketId?: string }> = [];
  stopCalls: string[] = [];
  private sessionCounter = 0;
  /** Callback to auto-simulate oracle sessions. Set by individual tests. */
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

    // If this is an oracle session, auto-simulate its lifecycle
    if (workItemId?.startsWith("oracle:") && this.onOracleStart) {
      // Defer to next tick so the caller can set up event listeners first
      setImmediate(() => this.onOracleStart!(session));
    }

    return session;
  }

  async stopSession(sessionId: string): Promise<void> {
    this.stopCalls.push(sessionId);
  }

  simulateOracleResponse(session: AgentSession, responseText: string): void {
    // Emit message_delta events with the response text
    this.emit("agent_event", {
      sessionId: session.id,
      event: {
        type: "message_delta",
        sessionId: session.id,
        timestamp: new Date().toISOString(),
        data: { text: responseText, role: "assistant" },
      },
    });

    // Then emit session_stopped
    this.emit("session_stopped", {
      ...session,
      state: "stopped",
      stoppedAt: new Date().toISOString(),
    });
  }

  simulateThinkingOnlyResponse(session: AgentSession, thinkingText: string): void {
    // Emit thinking-only message_delta (no structured text)
    this.emit("agent_event", {
      sessionId: session.id,
      event: {
        type: "message_delta",
        sessionId: session.id,
        timestamp: new Date().toISOString(),
        data: { text: thinkingText, thinking: true },
      },
    });
    // Emit message_end (thinking-only message completes)
    this.emit("agent_event", {
      sessionId: session.id,
      event: {
        type: "message_end",
        sessionId: session.id,
        timestamp: new Date().toISOString(),
        data: { role: "assistant" },
      },
    });
  }

  simulateThinkingThenText(session: AgentSession, thinkingText: string, responseText: string, delayMs = 10): void {
    // Emit thinking-only message first
    this.simulateThinkingOnlyResponse(session, thinkingText);
    // After a delay, emit the structured text response
    setTimeout(() => {
      this.emit("agent_event", {
        sessionId: session.id,
        event: {
          type: "message_delta",
          sessionId: session.id,
          timestamp: new Date().toISOString(),
          data: { text: responseText },
        },
      });
      this.emit("agent_event", {
        sessionId: session.id,
        event: {
          type: "message_end",
          sessionId: session.id,
          timestamp: new Date().toISOString(),
          data: { role: "assistant" },
        },
      });
    }, delayMs);
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

vi.mock("../../packages/core/src/config/roles.js", () => ({
  loadRole: vi.fn(async () => ({ id: "engineer", name: "Engineer" })),
  resolveRoleConfig: vi.fn(() => ({
    roleId: "engineer",
    name: "Engineer",
    permissionMode: "acceptEdits",
    allowedTools: [],
    disallowedTools: ["EnterPlanMode", "ExitPlanMode", "EnterWorktree"],
    allowedBashPatterns: [],
    instructions: "",
    doneCriteria: "",
    runTests: false,
    runOracle: true, // Oracle enabled for these tests
    denyPaths: [],
  })),
}));

const { mockCreate, mockRemove, mockHasCommits, mockMerge, mockWriteLock } = vi.hoisted(() => ({
  mockCreate: vi.fn(),
  mockRemove: vi.fn(),
  mockHasCommits: vi.fn(),
  mockMerge: vi.fn(),
  mockWriteLock: vi.fn(),
}));

vi.mock("../../packages/core/src/orchestrator/smoke-test.js", () => ({
  runSmoke: vi.fn(async () => ({ passed: true, buildPassed: true, testsPassed: true, buildOutput: "", testOutput: "", durationMs: 0 })),
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

// Oracle skill mocks — collectOracleInputs, formatOraclePrompt, parseOracleResponse
// parseOracleResponse is called by the executor on the oracle agent's text output
vi.mock("../../packages/core/src/skills/oracle.js", async (importOriginal) => {
  const mod = await importOriginal() as Record<string, unknown>;
  return {
    ...mod,
    collectOracleInputs: vi.fn(async () => ({
      ticket: { id: "t1", title: "Test ticket", status: "in-progress", deps: [], links: [], tags: {} },
      gitDiff: "diff --git a/file.ts b/file.ts\n+new code",
      acceptanceCriteria: ["Feature is implemented", "Tests are included"],
    })),
    // Keep real formatOraclePrompt and parseOracleResponse
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

describe("Executor oracle agent session", () => {
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
    mockHasCommits.mockResolvedValue(true);
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

  it("starts oracle agent via SessionManager with correct config", async () => {
    // Auto-respond when oracle starts
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
    await waitFor(() => plan.steps[0].status === "in-progress");

    // Complete the coding agent
    const codingSessionId = plan.steps[0].agentSessionId!;
    mockSM.simulateCompletion(codingSessionId);
    await waitFor(() => plan.steps[0].status === "done" || plan.steps[0].status === "failed");

    // Should have started 2 sessions: coding agent + oracle agent
    expect(mockSM.startCalls.length).toBe(2);

    // Verify oracle session config
    const oracleCall = mockSM.startCalls[1];
    expect(oracleCall.ticketId).toBe("oracle:t1");
    expect(oracleCall.backend).toBe("claude-code");
    expect(oracleCall.config.systemPrompt).toBeDefined();
    expect(oracleCall.config.systemPrompt).toContain("Acceptance Criteria");
    expect(oracleCall.config.permissionMode).toBe("default");
    expect(oracleCall.config.disableAllTools).toBe(true);

    executor.stop();
    await runPromise;
  });

  it("uses plan's configured backend for oracle session", async () => {
    mockSM.onOracleStart = (session) => {
      mockSM.simulateOracleResponse(session, ORACLE_RESPONSE_ALL_MET);
    };

    const plan = makePlan([
      { ticketId: "t1", projectId: "p", status: "ready", blockedBy: [] },
    ]);
    plan.config.backend = "opencode";

    const executor = new Executor(plan, mockSM as unknown as import("../../packages/core/src/agents/session-manager.js").SessionManager);

    const runPromise = executor.run();
    await waitFor(() => plan.steps[0].status === "in-progress");

    mockSM.simulateCompletion(plan.steps[0].agentSessionId!);
    await waitFor(() => plan.steps[0].status === "done" || plan.steps[0].status === "failed");

    const oracleCall = mockSM.startCalls.find((c) => c.ticketId?.startsWith("oracle:"));
    expect(oracleCall).toBeDefined();
    expect(oracleCall!.backend).toBe("opencode");

    executor.stop();
    await runPromise;
  });

  it("stores oracleSessionId on VerificationResult when oracle passes", async () => {
    mockSM.onOracleStart = (session) => {
      mockSM.simulateOracleResponse(session, ORACLE_RESPONSE_ALL_MET);
    };

    const plan = makePlan([
      { ticketId: "t1", projectId: "p", status: "ready", blockedBy: [] },
    ]);

    const executor = new Executor(plan, mockSM as unknown as import("../../packages/core/src/agents/session-manager.js").SessionManager);

    const runPromise = executor.run();
    await waitFor(() => plan.steps[0].status === "in-progress");

    mockSM.simulateCompletion(plan.steps[0].agentSessionId!);
    await waitFor(() => plan.steps[0].status === "done" || plan.steps[0].status === "failed");

    const step = plan.steps[0];
    expect(step.verification).toBeDefined();
    expect(step.verification!.oracleSessionId).toBeDefined();
    expect(step.verification!.oracleSessionId).toMatch(/^session-/);
    expect(step.verification!.passed).toBe(true);

    executor.stop();
    await runPromise;
  });

  it("step completes when oracle criteria are all met", async () => {
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
    await waitFor(() => plan.steps[0].status === "in-progress");

    mockSM.simulateCompletion(plan.steps[0].agentSessionId!);
    await waitFor(() => plan.steps[0].status === "done" || plan.steps[0].status === "failed");

    expect(completed).toContain("t1");
    expect(plan.steps[0].status).toBe("done");
    expect(plan.steps[0].verification!.oracle!.passed).toBe(true);
    expect(plan.steps[0].verification!.oracle!.criteria).toHaveLength(2);

    executor.stop();
    await runPromise;
  });

  it("step fails when oracle criteria are not met (maxRetries: 0)", async () => {
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
    await waitFor(() => plan.steps[0].status === "in-progress");

    mockSM.simulateCompletion(plan.steps[0].agentSessionId!);
    await waitFor(() => plan.steps[0].status === "done" || plan.steps[0].status === "failed");

    expect(failed).toContain("t1");
    expect(plan.steps[0].status).toBe("failed");
    expect(plan.steps[0].verification!.passed).toBe(false);
    expect(plan.steps[0].verification!.oracle!.passed).toBe(false);
    expect(plan.steps[0].verification!.failureReasons.some((r) => r.includes("Oracle"))).toBe(true);

    executor.stop();
    await runPromise;
  });

  it("handles empty oracle response as failure", async () => {
    mockSM.onOracleStart = (session) => {
      // Oracle produces empty response then stops
      mockSM.emit("session_stopped", {
        ...session,
        state: "stopped",
        stoppedAt: new Date().toISOString(),
      });
    };

    const plan = makePlan([
      { ticketId: "t1", projectId: "p", status: "ready", blockedBy: [] },
    ], { pauseOnFailure: false });

    const executor = new Executor(plan, mockSM as unknown as import("../../packages/core/src/agents/session-manager.js").SessionManager);

    const runPromise = executor.run();
    await waitFor(() => plan.steps[0].status === "in-progress");

    mockSM.simulateCompletion(plan.steps[0].agentSessionId!);
    await waitFor(() => plan.steps[0].status === "done" || plan.steps[0].status === "failed");

    const step = plan.steps[0];
    expect(step.status).toBe("failed");
    expect(step.verification!.oracleError).toContain("no response");

    executor.stop();
    await runPromise;
  });

  it("oracle prompt is delivered via systemPrompt (not CLI arg)", async () => {
    mockSM.onOracleStart = (session) => {
      mockSM.simulateOracleResponse(session, ORACLE_RESPONSE_ALL_MET);
    };

    const plan = makePlan([
      { ticketId: "t1", projectId: "p", status: "ready", blockedBy: [] },
    ]);

    const executor = new Executor(plan, mockSM as unknown as import("../../packages/core/src/agents/session-manager.js").SessionManager);

    const runPromise = executor.run();
    await waitFor(() => plan.steps[0].status === "in-progress");

    mockSM.simulateCompletion(plan.steps[0].agentSessionId!);
    await waitFor(() => plan.steps[0].status === "done" || plan.steps[0].status === "failed");

    const oracleCall = mockSM.startCalls.find((c) => c.ticketId?.startsWith("oracle:"));
    // Prompt is delivered via systemPrompt, not as a CLI argument
    expect(oracleCall!.config.systemPrompt).toBeTruthy();
    // systemPrompt should contain the formatted oracle evaluation prompt
    expect(oracleCall!.config.systemPrompt!.length).toBeGreaterThan(100);

    executor.stop();
    await runPromise;
  });

  it("passes oracleModel to session config when configured", async () => {
    mockSM.onOracleStart = (session) => {
      mockSM.simulateOracleResponse(session, ORACLE_RESPONSE_ALL_MET);
    };

    const plan = makePlan([
      { ticketId: "t1", projectId: "p", status: "ready", blockedBy: [] },
    ]);
    plan.config.verification.oracleModel = "claude-haiku-4-5-20251001";

    const executor = new Executor(plan, mockSM as unknown as import("../../packages/core/src/agents/session-manager.js").SessionManager);

    const runPromise = executor.run();
    await waitFor(() => plan.steps[0].status === "in-progress");

    mockSM.simulateCompletion(plan.steps[0].agentSessionId!);
    await waitFor(() => plan.steps[0].status === "done" || plan.steps[0].status === "failed");

    const oracleCall = mockSM.startCalls.find((c) => c.ticketId?.startsWith("oracle:"));
    expect(oracleCall!.config.model).toBe("claude-haiku-4-5-20251001");

    executor.stop();
    await runPromise;
  });

  it("oracle collects response text from message_delta events", async () => {
    // Simulate streaming: multiple message_delta events
    mockSM.onOracleStart = (session) => {
      // First chunk
      mockSM.emit("agent_event", {
        sessionId: session.id,
        event: {
          type: "message_delta",
          sessionId: session.id,
          timestamp: new Date().toISOString(),
          data: { text: "## Criteria\n- **Criterion**: Feature is implemented\n  - **Met**: YES\n  - **Reasoning**: Done\n\n" },
        },
      });
      // Second chunk
      mockSM.emit("agent_event", {
        sessionId: session.id,
        event: {
          type: "message_delta",
          sessionId: session.id,
          timestamp: new Date().toISOString(),
          data: { text: "## Concerns\nNone.\n" },
        },
      });
      // Session stops
      mockSM.emit("session_stopped", {
        ...session,
        state: "stopped",
        stoppedAt: new Date().toISOString(),
      });
    };

    const plan = makePlan([
      { ticketId: "t1", projectId: "p", status: "ready", blockedBy: [] },
    ]);

    const executor = new Executor(plan, mockSM as unknown as import("../../packages/core/src/agents/session-manager.js").SessionManager);

    const runPromise = executor.run();
    await waitFor(() => plan.steps[0].status === "in-progress");

    mockSM.simulateCompletion(plan.steps[0].agentSessionId!);
    await waitFor(() => plan.steps[0].status === "done" || plan.steps[0].status === "failed");

    // Response was assembled from two chunks and parsed correctly
    const step = plan.steps[0];
    expect(step.verification!.oracle).toBeDefined();
    expect(step.verification!.oracle!.criteria).toHaveLength(1);
    expect(step.verification!.oracle!.criteria[0].met).toBe(true);

    executor.stop();
    await runPromise;
  });

  it("step enters verifying status while oracle runs", async () => {
    let verifyingObserved = false;

    // Delay oracle response to observe verifying state
    mockSM.onOracleStart = (session) => {
      // Check step status synchronously before responding
      setTimeout(() => {
        const step = plan.steps[0];
        if (step.status === "verifying") {
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
    await waitFor(() => plan.steps[0].status === "in-progress");

    mockSM.simulateCompletion(plan.steps[0].agentSessionId!);
    await waitFor(() => plan.steps[0].status === "done");

    expect(verifyingObserved).toBe(true);
    expect(plan.steps[0].status).toBe("done");

    executor.stop();
    await runPromise;
  });

  it("oracle resolves with thinking text when structured text follows", async () => {
    // Simulate extended thinking flow: thinking-only message, then text message
    mockSM.onOracleStart = (session) => {
      mockSM.simulateThinkingThenText(
        session,
        "Let me analyze the code changes...",
        ORACLE_RESPONSE_ALL_MET,
        10,
      );
    };

    const plan = makePlan([
      { ticketId: "t1", projectId: "p", status: "ready", blockedBy: [] },
    ]);

    const executor = new Executor(plan, mockSM as unknown as import("../../packages/core/src/agents/session-manager.js").SessionManager);

    const runPromise = executor.run();
    await waitFor(() => plan.steps[0].status === "in-progress");

    mockSM.simulateCompletion(plan.steps[0].agentSessionId!);
    await waitFor(() => plan.steps[0].status === "done" || plan.steps[0].status === "failed");

    const step = plan.steps[0];
    expect(step.status).toBe("done");
    expect(step.verification!.oracle!.passed).toBe(true);
    expect(step.verification!.oracle!.criteria).toHaveLength(2);

    executor.stop();
    await runPromise;
  });

  it("oracle timeout resolves with accumulated thinking text instead of rejecting", async () => {
    vi.useFakeTimers();

    // Simulate thinking-only response with no follow-up text
    mockSM.onOracleStart = (session) => {
      mockSM.simulateThinkingOnlyResponse(
        session,
        "Let me analyze... this is thinking content without structured criteria format.",
      );
      // Never send structured text — simulates the timeout scenario
    };

    const plan = makePlan([
      { ticketId: "t1", projectId: "p", status: "ready", blockedBy: [] },
    ], { pauseOnFailure: false });

    const executor = new Executor(plan, mockSM as unknown as import("../../packages/core/src/agents/session-manager.js").SessionManager);

    const runPromise = executor.run();

    // Advance time to start the step
    await vi.advanceTimersByTimeAsync(100);

    // Complete the coding agent
    if (plan.steps[0].agentSessionId) {
      mockSM.simulateCompletion(plan.steps[0].agentSessionId);
    }

    // Advance past oracle grace timer (30s) × 2 attempts + buffer
    await vi.advanceTimersByTimeAsync(200_000);

    const step = plan.steps[0];
    // Should have resolved with thinking text (not thrown a timeout error)
    // The parser can't extract criteria from thinking text → 0 criteria → failed
    if (step.verification) {
      expect(step.verification.passed).toBe(false);
      // Should NOT have "timed out" error — should have parsed response (even if 0 criteria)
      const hasTimeoutError = step.verification.failureReasons.some((r) => r.includes("timed out"));
      expect(hasTimeoutError).toBe(false);
    }

    executor.stop();
    await runPromise;
    vi.useRealTimers();
  });

  it("reports 'could not parse structured response' after retry when oracle returns 0 criteria", async () => {
    // Oracle returns text that doesn't match the criteria format (both attempts)
    mockSM.onOracleStart = (session) => {
      mockSM.simulateOracleResponse(
        session,
        "I analyzed the code but cannot provide structured criteria output.",
      );
    };

    const plan = makePlan([
      { ticketId: "t1", projectId: "p", status: "ready", blockedBy: [] },
    ], { pauseOnFailure: false });

    const executor = new Executor(plan, mockSM as unknown as import("../../packages/core/src/agents/session-manager.js").SessionManager);

    const runPromise = executor.run();
    await waitFor(() => plan.steps[0].status === "in-progress");

    mockSM.simulateCompletion(plan.steps[0].agentSessionId!);
    await waitFor(() => plan.steps[0].status === "done" || plan.steps[0].status === "failed");

    const step = plan.steps[0];
    expect(step.status).toBe("failed");
    expect(step.verification!.passed).toBe(false);
    expect(step.verification!.failureReasons.some((r) => r.includes("could not parse"))).toBe(true);
    // Should have started 3 sessions: coding agent + 2 oracle attempts
    const oracleCalls = mockSM.startCalls.filter((c) => c.ticketId?.startsWith("oracle:"));
    expect(oracleCalls).toHaveLength(2);

    executor.stop();
    await runPromise;
  });

  it("oracle retry succeeds when first attempt returns only thinking", async () => {
    let oracleAttempt = 0;
    mockSM.onOracleStart = (session) => {
      oracleAttempt++;
      if (oracleAttempt === 1) {
        // First attempt: thinking-only response that can't be parsed
        mockSM.simulateOracleResponse(session, "Let me think about this... the code looks correct.");
      } else {
        // Second attempt: proper structured response
        mockSM.simulateOracleResponse(session, ORACLE_RESPONSE_ALL_MET);
      }
    };

    const plan = makePlan([
      { ticketId: "t1", projectId: "p", status: "ready", blockedBy: [] },
    ]);

    const executor = new Executor(plan, mockSM as unknown as import("../../packages/core/src/agents/session-manager.js").SessionManager);

    const runPromise = executor.run();
    await waitFor(() => plan.steps[0].status === "in-progress");

    mockSM.simulateCompletion(plan.steps[0].agentSessionId!);
    await waitFor(() => plan.steps[0].status === "done" || plan.steps[0].status === "failed");

    const step = plan.steps[0];
    expect(step.status).toBe("done");
    expect(step.verification!.oracle!.passed).toBe(true);
    expect(step.verification!.oracle!.criteria).toHaveLength(2);
    // Verify two oracle sessions were started
    const oracleCalls = mockSM.startCalls.filter((c) => c.ticketId?.startsWith("oracle:"));
    expect(oracleCalls).toHaveLength(2);

    executor.stop();
    await runPromise;
  });
});
