import { describe, it, expect, vi, beforeEach } from "vitest";
import type { AgentSession, NormalizedEvent, ProjectConfig, WorkItem } from "@opcom/types";

// Track SessionManager instances and their event handlers
const sessionManagerHandlers = new Map<string, Function>();
const mockStartSession = vi.fn();
const mockStopSession = vi.fn();
const mockPromptSession = vi.fn();
const mockExecutorPause = vi.fn();
const mockExecutorResume = vi.fn();
let resolveExecutorRun: () => void;
const mockExecutorRun = vi.fn().mockImplementation(() => new Promise<void>((resolve) => { resolveExecutorRun = resolve; }));
const mockExecutorOn = vi.fn();

vi.mock("@opcom/core", async () => {
  const actual = await vi.importActual<typeof import("@opcom/core")>("@opcom/core");
  return {
    ...actual,
    loadGlobalConfig: vi.fn().mockResolvedValue({ defaultWorkspace: "default" }),
    loadWorkspace: vi.fn().mockResolvedValue({ projectIds: ["proj1"] }),
    loadProject: vi.fn().mockImplementation((id: string) => {
      if (id === "proj1") {
        return Promise.resolve({
          id: "proj1",
          name: "Test Project",
          path: "/tmp/test",
          stack: {
            languages: [{ name: "typescript", version: "5.0", sourceFile: "package.json" }],
            frameworks: [],
            packageManagers: [],
            infrastructure: [],
            versionManagers: [],
          },
          testing: null,
          linting: [],
          services: [],
          docs: { agentConfig: null },
          git: { branch: "main", remote: null, clean: true },
          workSystem: null,
        } satisfies Partial<ProjectConfig> as any);
      }
      return Promise.resolve(null);
    }),
    refreshProjectStatus: vi.fn().mockResolvedValue({
      gitFresh: { branch: "main", remote: null, clean: true },
      workSummary: null,
    }),
    scanTickets: vi.fn().mockResolvedValue([]),
    Station: { isRunning: vi.fn().mockResolvedValue({ running: false }) },
    SessionManager: vi.fn().mockImplementation(() => ({
      init: vi.fn().mockResolvedValue(undefined),
      on: vi.fn().mockImplementation((event: string, handler: Function) => {
        sessionManagerHandlers.set(event, handler);
      }),
      off: vi.fn(),
      startSession: mockStartSession.mockImplementation(async () => {
        const session: AgentSession = {
          id: "new-session",
          backend: "claude-code",
          projectId: "proj1",
          state: "streaming",
          startedAt: new Date().toISOString(),
        };
        // Simulate session_created event
        const handler = sessionManagerHandlers.get("session_created");
        if (handler) handler(session);
        return session;
      }),
      stopSession: mockStopSession.mockResolvedValue(undefined),
      promptSession: mockPromptSession.mockResolvedValue(undefined),
      shutdown: vi.fn().mockResolvedValue(undefined),
    })),
    buildContextPacket: vi.fn().mockResolvedValue({
      project: {
        name: "Test Project",
        path: "/tmp/test",
        stack: { languages: [], frameworks: [], packageManagers: [], infrastructure: [], versionManagers: [] },
        testing: null,
        linting: [],
        services: [],
      },
      git: { branch: "main", remote: null, clean: true },
    }),
    createLogger: vi.fn().mockReturnValue({
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    }),
    Executor: vi.fn().mockImplementation(() => ({
      pause: mockExecutorPause,
      resume: mockExecutorResume,
      run: mockExecutorRun,
      on: mockExecutorOn,
    })),
    savePlan: vi.fn().mockResolvedValue(undefined),
  };
});

import { TuiClient } from "../../packages/cli/src/tui/client.js";

describe("TuiClient offline mode", () => {
  let client: TuiClient;

  beforeEach(async () => {
    sessionManagerHandlers.clear();
    mockStartSession.mockClear();
    mockStopSession.mockClear();
    mockPromptSession.mockClear();
    mockExecutorPause.mockClear();
    mockExecutorResume.mockClear();
    mockExecutorRun.mockClear();
    mockExecutorOn.mockClear();

    client = new TuiClient();
    await client.connect();
  });

  it("is not in daemon mode when no server is running", () => {
    expect(client.daemonMode).toBe(false);
  });

  it("send start_agent in offline mode triggers local session manager", async () => {
    client.send({ type: "start_agent", projectId: "proj1" });

    // Wait for async handleLocalCommand
    await new Promise((r) => setTimeout(r, 50));

    expect(mockStartSession).toHaveBeenCalledTimes(1);
    expect(mockStartSession).toHaveBeenCalledWith(
      "proj1",
      "claude-code",
      expect.objectContaining({ projectPath: "/tmp/test" }),
      undefined,
    );
  });

  it("agent events from local session manager flow through to agentEvents map", async () => {
    client.send({ type: "start_agent", projectId: "proj1" });

    await new Promise((r) => setTimeout(r, 50));

    // session_created handler should have pushed to agents
    expect(client.agents.some((a) => a.id === "new-session")).toBe(true);

    // Simulate an agent_event from the session manager
    const eventHandler = sessionManagerHandlers.get("agent_event");
    if (eventHandler) {
      const event: NormalizedEvent = {
        type: "message_delta",
        sessionId: "new-session",
        timestamp: new Date().toISOString(),
        data: { text: "working..." },
      };
      eventHandler({ sessionId: "new-session", event });
    }

    const events = client.agentEvents.get("new-session");
    expect(events).toBeDefined();
    expect(events!.length).toBeGreaterThan(0);
    expect(events![events!.length - 1].data?.text).toBe("working...");
  });

  it("send stop_agent in offline mode calls session manager", async () => {
    client.send({ type: "stop_agent", agentId: "session-1" });
    await new Promise((r) => setTimeout(r, 50));
    expect(mockStopSession).toHaveBeenCalledWith("session-1");
  });

  it("send prompt in offline mode calls session manager", async () => {
    client.send({ type: "prompt", agentId: "session-1", text: "hello" });
    await new Promise((r) => setTimeout(r, 50));
    expect(mockPromptSession).toHaveBeenCalledWith("session-1", "hello");
  });

  it("destroy shuts down local session manager", () => {
    client.destroy();
    // Should not throw
    expect(client.connected).toBe(false);
  });

  describe("plan pause/resume in offline mode", () => {
    const fakePlan = {
      id: "plan-1",
      name: "test plan",
      status: "planning" as const,
      scope: { projectIds: ["proj1"], query: "" },
      steps: [{ ticketId: "t1", projectId: "proj1", status: "ready" as const }],
      config: { worktree: false, pauseOnFailure: false, ticketTransitions: true, verification: { enabled: false, testCommand: "", autoRebase: false } },
      createdAt: new Date().toISOString(),
      context: "",
    };

    async function startExecutor() {
      client.activePlan = { ...fakePlan, status: "planning" } as any;
      await client.executePlan("plan-1");
      await new Promise((r) => setTimeout(r, 50));
    }

    it("executePlan creates an executor in offline mode", async () => {
      await startExecutor();
      const { Executor } = await import("@opcom/core");
      expect(Executor).toHaveBeenCalledTimes(1);
      expect(mockExecutorRun).toHaveBeenCalledTimes(1);
    });

    it("pause_plan calls executor.pause() in offline mode", async () => {
      await startExecutor();

      client.send({ type: "pause_plan", planId: "plan-1" } as any);
      await new Promise((r) => setTimeout(r, 50));

      expect(mockExecutorPause).toHaveBeenCalledTimes(1);
    });

    it("resume_plan calls executor.resume() in offline mode", async () => {
      await startExecutor();

      client.send({ type: "resume_plan", planId: "plan-1" } as any);
      await new Promise((r) => setTimeout(r, 50));

      expect(mockExecutorResume).toHaveBeenCalledTimes(1);
    });

    it("pause_plan is a no-op when no executor is active", async () => {
      client.send({ type: "pause_plan", planId: "plan-1" } as any);
      await new Promise((r) => setTimeout(r, 50));

      expect(mockExecutorPause).not.toHaveBeenCalled();
    });

    it("resume_plan is a no-op when no executor is active", async () => {
      client.send({ type: "resume_plan", planId: "plan-1" } as any);
      await new Promise((r) => setTimeout(r, 50));

      expect(mockExecutorResume).not.toHaveBeenCalled();
    });
  });
});
