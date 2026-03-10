import { describe, it, expect, vi, beforeEach } from "vitest";
import { Executor } from "../../packages/core/src/orchestrator/executor.js";
import { defaultConfig } from "../../packages/core/src/orchestrator/persistence.js";
import { checkForbiddenCommand } from "../../packages/core/src/agents/allowed-bash.js";
import type { Plan, PlanStep, AgentSession, AgentState, AgentConstraint } from "@opcom/types";
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
    };
  }
  async stopSession(): Promise<void> {}
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

const mockLoadProject = vi.fn();
vi.mock("../../packages/core/src/config/loader.js", () => ({
  loadProject: (...args: unknown[]) => mockLoadProject(...args),
}));

vi.mock("../../packages/core/src/detection/tickets.js", () => ({
  scanTickets: vi.fn(async () => []),
}));

vi.mock("../../packages/core/src/agents/context-builder.js", () => ({
  buildContextPacket: vi.fn(async (project: Record<string, unknown>) => {
    const profile = (project?.profile ?? {}) as { agentConstraints?: Array<{ name: string; rule: string }> };
    return {
      project: {
        name: "test", path: "/tmp", stack: {}, testing: null, linting: [], services: [],
        ...(profile.agentConstraints?.length ? { agentConstraints: profile.agentConstraints } : {}),
      },
      git: { branch: "main", remote: null, clean: true },
    };
  }),
  contextPacketToMarkdown: vi.fn((packet: { project?: { agentConstraints?: Array<{ name: string; rule: string }> } }) => {
    if (packet.project?.agentConstraints?.length) {
      const lines = ["# Test context", "", "## Agent Constraints"];
      for (const c of packet.project.agentConstraints) {
        lines.push(`- **${c.name}**: ${c.rule}`);
      }
      return lines.join("\n");
    }
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
    name: "Engineer",
    permissionMode: "acceptEdits",
    allowedTools: [],
    disallowedTools: [],
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

vi.mock("../../packages/core/src/config/summary.js", () => ({
  readProjectSummary: vi.fn(async () => null),
  writeProjectSummary: vi.fn(async () => {}),
  updateProjectSummary: vi.fn(async () => {}),
  createInitialSummaryFromDescription: vi.fn(() => ""),
}));

vi.mock("../../packages/core/src/orchestrator/worktree.js", () => ({
  WorktreeManager: vi.fn().mockImplementation(() => ({
    create: vi.fn(),
    remove: vi.fn(),
    hasCommits: vi.fn(),
    merge: vi.fn(),
    attemptRebase: vi.fn(),
    getInfo: vi.fn(),
    restore: vi.fn(),
  })),
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

function makeStep(overrides?: Partial<PlanStep>): PlanStep {
  return {
    ticketId: "test-ticket",
    projectId: "test-project",
    status: "ready",
    blockedBy: [],
    ...overrides,
  };
}

// --- resolveTestCommandFromProject ---

describe("resolveTestCommandFromProject", () => {
  let mockSM: MockSessionManager;

  beforeEach(() => {
    vi.clearAllMocks();
    mockSM = new MockSessionManager();
    mockLoadProject.mockResolvedValue({
      id: "test-project",
      name: "test-project",
      path: "/tmp/test-project",
      stack: { languages: [], frameworks: [], packageManagers: [], infrastructure: [], versionManagers: [] },
      testing: { framework: "vitest", command: "npm test" },
      linting: [],
    });
  });

  it("returns fallback when no profile or testing config", () => {
    const plan = makePlan([makeStep()]);
    const executor = new Executor(plan, mockSM as never);

    const result = executor.resolveTestCommandFromProject({ testing: null });
    expect(result).toBe("npm test");
  });

  it("uses detected testing.command when no profile", () => {
    const plan = makePlan([makeStep()]);
    const executor = new Executor(plan, mockSM as never);

    const result = executor.resolveTestCommandFromProject({
      testing: { command: "npx vitest run" },
    });
    expect(result).toBe("npx vitest run");
  });

  it("prefers profile test command over detected", () => {
    const plan = makePlan([makeStep()]);
    const executor = new Executor(plan, mockSM as never);

    const result = executor.resolveTestCommandFromProject({
      testing: { command: "npm test" },
      profile: {
        commands: [{ name: "test", command: "npx vitest run tests/smoke/" }],
      },
    });
    expect(result).toBe("npx vitest run tests/smoke/");
  });

  it("prefers plan-level testCommand over everything", () => {
    const plan = makePlan([makeStep()], { testCommand: "make test-fast" });
    const executor = new Executor(plan, mockSM as never);

    const result = executor.resolveTestCommandFromProject({
      testing: { command: "npm test" },
      profile: {
        commands: [{ name: "test", command: "npx vitest run" }],
      },
    });
    expect(result).toBe("make test-fast");
  });

  it("skips non-test profile commands", () => {
    const plan = makePlan([makeStep()]);
    const executor = new Executor(plan, mockSM as never);

    const result = executor.resolveTestCommandFromProject({
      testing: { command: "npm test" },
      profile: {
        commands: [
          { name: "build", command: "npm run build" },
          { name: "dev", command: "npm run dev" },
        ],
      },
    });
    expect(result).toBe("npm test");
  });
});

// --- resolveSmokeTestCommandFromProject ---

describe("resolveSmokeTestCommandFromProject", () => {
  let mockSM: MockSessionManager;

  beforeEach(() => {
    vi.clearAllMocks();
    mockSM = new MockSessionManager();
  });

  it("uses testFull profile command for smoke tests", () => {
    const plan = makePlan([makeStep()]);
    const executor = new Executor(plan, mockSM as never);

    const result = executor.resolveSmokeTestCommandFromProject({
      testing: { command: "npm test" },
      profile: {
        commands: [
          { name: "test", command: "npx vitest run tests/smoke/" },
          { name: "testFull", command: "npx vitest run" },
        ],
      },
    });
    expect(result).toBe("npx vitest run");
  });

  it("falls back to profile test command when no testFull", () => {
    const plan = makePlan([makeStep()]);
    const executor = new Executor(plan, mockSM as never);

    const result = executor.resolveSmokeTestCommandFromProject({
      testing: { command: "npm test" },
      profile: {
        commands: [{ name: "test", command: "npx vitest run tests/smoke/" }],
      },
    });
    expect(result).toBe("npx vitest run tests/smoke/");
  });

  it("falls back to detected testing command", () => {
    const plan = makePlan([makeStep()]);
    const executor = new Executor(plan, mockSM as never);

    const result = executor.resolveSmokeTestCommandFromProject({
      testing: { command: "npm test" },
    });
    expect(result).toBe("npm test");
  });

  it("plan-level override takes precedence over testFull", () => {
    const plan = makePlan([makeStep()], { testCommand: "make ci-test" });
    const executor = new Executor(plan, mockSM as never);

    const result = executor.resolveSmokeTestCommandFromProject({
      testing: { command: "npm test" },
      profile: {
        commands: [{ name: "testFull", command: "npx vitest run" }],
      },
    });
    expect(result).toBe("make ci-test");
  });
});

// --- checkForbiddenCommand ---

describe("checkForbiddenCommand", () => {
  it("returns not forbidden when no constraints", () => {
    const result = checkForbiddenCommand("git push --force", undefined);
    expect(result.forbidden).toBe(false);
  });

  it("returns not forbidden when constraints array is empty", () => {
    const result = checkForbiddenCommand("git push --force", []);
    expect(result.forbidden).toBe(false);
  });

  it("detects forbidden command matching no- prefix constraint", () => {
    const constraints: AgentConstraint[] = [
      { name: "no-force-push", rule: "git push --force" },
    ];
    const result = checkForbiddenCommand("git push --force origin main", constraints);
    expect(result.forbidden).toBe(true);
    expect(result.constraint?.name).toBe("no-force-push");
    expect(result.constraint?.rule).toBe("git push --force");
  });

  it("detects forbidden command matching forbidden- prefix constraint", () => {
    const constraints: AgentConstraint[] = [
      { name: "forbidden-rm", rule: "rm -rf" },
    ];
    const result = checkForbiddenCommand("rm -rf /tmp/data", constraints);
    expect(result.forbidden).toBe(true);
    expect(result.constraint?.name).toBe("forbidden-rm");
  });

  it("ignores constraints without no- or forbidden- prefix", () => {
    const constraints: AgentConstraint[] = [
      { name: "test-required", rule: "All changes must include tests" },
    ];
    const result = checkForbiddenCommand("rm -rf /", constraints);
    expect(result.forbidden).toBe(false);
  });

  it("allows commands that don't match any forbidden rule", () => {
    const constraints: AgentConstraint[] = [
      { name: "no-force-push", rule: "git push --force" },
      { name: "no-drop-tables", rule: "DROP TABLE" },
    ];
    const result = checkForbiddenCommand("git push origin main", constraints);
    expect(result.forbidden).toBe(false);
  });

  it("matches first matching constraint", () => {
    const constraints: AgentConstraint[] = [
      { name: "no-force-push", rule: "git push --force" },
      { name: "no-push-delete", rule: "git push --delete" },
    ];
    const result = checkForbiddenCommand("git push --force --delete origin main", constraints);
    expect(result.forbidden).toBe(true);
    expect(result.constraint?.name).toBe("no-force-push");
  });
});

// --- forbidden_command_warning event emission ---

describe("forbidden_command_warning events", () => {
  let mockSM: MockSessionManager;

  beforeEach(() => {
    vi.clearAllMocks();
    mockSM = new MockSessionManager();
    mockLoadProject.mockResolvedValue({
      id: "test-project",
      name: "test-project",
      path: "/tmp/test-project",
      stack: { languages: [], frameworks: [], packageManagers: [{ name: "npm", sourceFile: "package-lock.json" }], infrastructure: [], versionManagers: [] },
      testing: { framework: "vitest", command: "npm test" },
      linting: [],
      docs: {},
      profile: {
        agentConstraints: [
          { name: "no-force-push", rule: "git push --force" },
        ],
      },
    });
  });

  it("emits forbidden_command_warning when agent uses forbidden command", async () => {
    const step = makeStep({ status: "ready" });
    const plan = makePlan([step]);
    const executor = new Executor(plan, mockSM as unknown as import("../../packages/core/src/agents/session-manager.js").SessionManager);

    const warnings: Array<{ stepTicketId: string; command: string; constraintName: string }> = [];
    executor.on("forbidden_command_warning", (data) => {
      warnings.push(data as { stepTicketId: string; command: string; constraintName: string });
    });

    const runPromise = executor.run();
    await waitFor(() => step.status === "in-progress");

    // Simulate agent using a forbidden command
    mockSM.emit("agent_event", {
      sessionId: step.agentSessionId!,
      event: {
        type: "tool_start",
        sessionId: step.agentSessionId!,
        timestamp: new Date().toISOString(),
        data: { toolName: "Bash", toolInput: "git push --force origin main" },
      },
    });

    await new Promise((r) => setTimeout(r, 10));

    expect(warnings).toHaveLength(1);
    expect(warnings[0].stepTicketId).toBe("test-ticket");
    expect(warnings[0].command).toBe("git push --force origin main");
    expect(warnings[0].constraintName).toBe("no-force-push");

    // Clean up
    mockSM.simulateCompletion(step.agentSessionId!);
    executor.stop();
    await runPromise;
  });

  it("does not warn when command is not forbidden", async () => {
    const step = makeStep({ status: "ready" });
    const plan = makePlan([step]);
    const executor = new Executor(plan, mockSM as unknown as import("../../packages/core/src/agents/session-manager.js").SessionManager);

    const warnings: unknown[] = [];
    executor.on("forbidden_command_warning", (data) => warnings.push(data));

    const runPromise = executor.run();
    await waitFor(() => step.status === "in-progress");

    // Simulate a safe command
    mockSM.emit("agent_event", {
      sessionId: step.agentSessionId!,
      event: {
        type: "tool_start",
        sessionId: step.agentSessionId!,
        timestamp: new Date().toISOString(),
        data: { toolName: "Bash", toolInput: "git push origin main" },
      },
    });

    await new Promise((r) => setTimeout(r, 10));

    expect(warnings).toHaveLength(0);

    // Clean up
    mockSM.simulateCompletion(step.agentSessionId!);
    executor.stop();
    await runPromise;
  });
});

// --- Agent context includes profile constraints ---

describe("agent context includes profile constraints", () => {
  let mockSM: MockSessionManager;

  beforeEach(() => {
    vi.clearAllMocks();
    mockSM = new MockSessionManager();
    mockLoadProject.mockResolvedValue({
      id: "test-project",
      name: "test-project",
      path: "/tmp/test-project",
      stack: { languages: [], frameworks: [], packageManagers: [{ name: "npm", sourceFile: "package-lock.json" }], infrastructure: [], versionManagers: [] },
      testing: { framework: "vitest", command: "npm test" },
      linting: [],
      docs: {},
      profile: {
        agentConstraints: [
          { name: "no-force-push", rule: "Never force push to main" },
          { name: "test-required", rule: "All changes must include tests" },
        ],
      },
    });
  });

  it("system prompt includes structured constraints from project profile", async () => {
    const step = makeStep({ status: "ready" });
    const plan = makePlan([step]);
    const executor = new Executor(plan, mockSM as unknown as import("../../packages/core/src/agents/session-manager.js").SessionManager);

    const runPromise = executor.run();
    await waitFor(() => step.status === "in-progress");

    // Verify the session was started with a system prompt containing constraints
    const startCall = mockSM.startCalls[0];
    const config = startCall.config as { systemPrompt?: string };
    expect(config.systemPrompt).toContain("## Agent Constraints");
    expect(config.systemPrompt).toContain("**no-force-push**");
    expect(config.systemPrompt).toContain("Never force push to main");
    expect(config.systemPrompt).toContain("**test-required**");
    expect(config.systemPrompt).toContain("All changes must include tests");

    // Clean up
    mockSM.simulateCompletion(step.agentSessionId!);
    executor.stop();
    await runPromise;
  });

  it("omits constraints section when project has no profile", async () => {
    mockLoadProject.mockResolvedValue({
      id: "test-project",
      name: "test-project",
      path: "/tmp/test-project",
      stack: { languages: [], frameworks: [], packageManagers: [], infrastructure: [], versionManagers: [] },
      testing: null,
      linting: [],
      docs: {},
    });

    const step = makeStep({ status: "ready" });
    const plan = makePlan([step]);
    const executor = new Executor(plan, mockSM as unknown as import("../../packages/core/src/agents/session-manager.js").SessionManager);

    const runPromise = executor.run();
    await waitFor(() => step.status === "in-progress");

    const startCall = mockSM.startCalls[0];
    const config = startCall.config as { systemPrompt?: string };
    expect(config.systemPrompt).not.toContain("## Agent Constraints");

    // Clean up
    mockSM.simulateCompletion(step.agentSessionId!);
    executor.stop();
    await runPromise;
  });
});

// --- OrchestratorConfig testCommand ---

describe("OrchestratorConfig.testCommand", () => {
  it("testCommand is included in plan config", () => {
    const plan = makePlan([makeStep()], { testCommand: "make test" });
    expect(plan.config.testCommand).toBe("make test");
  });

  it("testCommand is undefined by default", () => {
    const plan = makePlan([makeStep()]);
    expect(plan.config.testCommand).toBeUndefined();
  });
});
