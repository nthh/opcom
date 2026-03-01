import { describe, it, expect, vi, beforeEach } from "vitest";
import { SessionManager } from "../../packages/core/src/agents/session-manager.js";
import type { AgentSession, NormalizedEvent } from "@opcom/types";

// Mock the adapter to produce a controllable event stream
vi.mock("../../packages/core/src/agents/adapter.js", () => ({
  createAdapter: vi.fn(() => ({
    start: vi.fn(async (config: unknown) => ({
      id: "test-session-1",
      backend: "claude-code",
      projectId: "",
      state: "streaming",
      startedAt: new Date().toISOString(),
      pid: process.pid,
    })),
    stop: vi.fn(async () => {}),
    subscribe: vi.fn((sessionId: string) => {
      // Return an async iterable that emits agent_end then closes
      return {
        [Symbol.asyncIterator]() {
          let done = false;
          return {
            async next() {
              if (done) return { value: undefined, done: true };
              done = true;
              const event: NormalizedEvent = {
                type: "agent_end",
                sessionId,
                timestamp: new Date().toISOString(),
              };
              return { value: event, done: false };
            },
          };
        },
      };
    }),
    prompt: vi.fn(async () => {}),
  })),
}));

// Mock persistence
vi.mock("../../packages/core/src/config/paths.js", () => ({
  opcomRoot: () => "/tmp/opcom-test-natural-exit",
}));

vi.mock("node:fs/promises", async (importOriginal) => {
  const mod = await importOriginal() as Record<string, unknown>;
  return {
    ...mod,
    mkdir: vi.fn(async () => {}),
    writeFile: vi.fn(async () => {}),
    readdir: vi.fn(async () => []),
    readFile: vi.fn(async () => ""),
  };
});

vi.mock("node:fs", () => ({
  existsSync: vi.fn(() => true),
}));

describe("SessionManager natural exit", () => {
  let sm: SessionManager;

  beforeEach(() => {
    vi.clearAllMocks();
    sm = new SessionManager();
  });

  it("emits session_stopped when agent exits naturally via agent_end", async () => {
    await sm.init();

    const stoppedSessions: AgentSession[] = [];
    sm.on("session_stopped", (session) => {
      stoppedSessions.push(session);
    });

    const stateChanges: Array<{ sessionId: string; newState: string }> = [];
    sm.on("state_change", (data) => {
      stateChanges.push({ sessionId: data.sessionId, newState: data.newState });
    });

    const session = await sm.startSession("proj1", "claude-code", {
      projectPath: "/tmp/test",
    });

    // Give consumeEvents time to process the agent_end event
    await new Promise((r) => setTimeout(r, 100));

    // Should have emitted state_change to stopped
    expect(stateChanges.some((c) => c.newState === "stopped")).toBe(true);

    // Should have emitted session_stopped (the fix!)
    expect(stoppedSessions).toHaveLength(1);
    expect(stoppedSessions[0].id).toBe(session.id);
    expect(stoppedSessions[0].state).toBe("stopped");
  });
});
