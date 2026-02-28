import { describe, it, expect, vi, beforeEach } from "vitest";
import type { AgentSession, NormalizedEvent, AgentStartConfig, ContextPacket, AgentAdapter } from "@opcom/types";

// Mock the adapter module to return a controllable adapter
vi.mock("../../packages/core/src/agents/adapter.js", () => {
  return {
    createAdapter: vi.fn(),
  };
});

// Mock filesystem operations used by SessionManager
vi.mock("node:fs/promises", () => ({
  readFile: vi.fn().mockResolvedValue(""),
  writeFile: vi.fn().mockResolvedValue(undefined),
  mkdir: vi.fn().mockResolvedValue(undefined),
  readdir: vi.fn().mockResolvedValue([]),
  unlink: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("node:fs", () => ({
  existsSync: vi.fn().mockReturnValue(true),
}));

import { createAdapter } from "../../packages/core/src/agents/adapter.js";
import { SessionManager } from "@opcom/core";

const mockCreateAdapter = vi.mocked(createAdapter);

function makeContextPacket(): ContextPacket {
  return {
    project: {
      name: "test",
      path: "/tmp/test",
      stack: {
        languages: [],
        frameworks: [],
        packageManagers: [],
        infrastructure: [],
        versionManagers: [],
      },
      testing: null,
      linting: [],
      services: [],
    },
    git: { branch: "main", remote: null, clean: true },
  };
}

function createMockAdapter(events: NormalizedEvent[]): AgentAdapter {
  const session: AgentSession = {
    id: "test-session-1",
    backend: "claude-code",
    projectId: "proj1",
    state: "streaming",
    startedAt: new Date().toISOString(),
    pid: 999,
  };

  return {
    backend: "claude-code",
    start: vi.fn().mockResolvedValue(session),
    stop: vi.fn().mockResolvedValue(undefined),
    prompt: vi.fn().mockResolvedValue(undefined),
    subscribe: vi.fn().mockImplementation(async function* () {
      for (const event of events) {
        yield event;
      }
    }),
  };
}

describe("SessionManager event ordering", () => {
  let manager: SessionManager;

  beforeEach(async () => {
    manager = new SessionManager();
    await manager.init();
  });

  it("emits session_created before first agent_event", async () => {
    const ts = new Date().toISOString();
    const events: NormalizedEvent[] = [
      { type: "agent_start", sessionId: "test-session-1", timestamp: ts, data: { reason: "started" } },
      { type: "message_start", sessionId: "test-session-1", timestamp: ts, data: { role: "assistant" } },
    ];

    const adapter = createMockAdapter(events);
    mockCreateAdapter.mockReturnValue(adapter);

    const ordering: string[] = [];

    manager.on("session_created", () => ordering.push("session_created"));
    manager.on("agent_event", () => ordering.push("agent_event"));

    await manager.startSession("proj1", "claude-code", {
      projectPath: "/tmp/test",
      contextPacket: makeContextPacket(),
    });

    // Give async generator time to yield
    await new Promise((r) => setTimeout(r, 50));

    expect(ordering[0]).toBe("session_created");
    expect(ordering.filter((e) => e === "agent_event").length).toBeGreaterThan(0);
  });

  it("emits state_change events on state transitions", async () => {
    const ts = new Date().toISOString();
    const events: NormalizedEvent[] = [
      { type: "message_start", sessionId: "test-session-1", timestamp: ts, data: { role: "assistant" } },
      { type: "message_end", sessionId: "test-session-1", timestamp: ts, data: { role: "assistant" } },
      { type: "turn_end", sessionId: "test-session-1", timestamp: ts },
    ];

    const adapter = createMockAdapter(events);
    mockCreateAdapter.mockReturnValue(adapter);

    const stateChanges: Array<{ oldState: string; newState: string }> = [];
    manager.on("state_change", (change) => {
      stateChanges.push({ oldState: change.oldState, newState: change.newState });
    });

    await manager.startSession("proj1", "claude-code", {
      projectPath: "/tmp/test",
      contextPacket: makeContextPacket(),
    });

    // Give async generator time to yield
    await new Promise((r) => setTimeout(r, 50));

    // Session starts as "streaming", turn_end transitions to "idle"
    expect(stateChanges.some((c) => c.newState === "idle")).toBe(true);
  });
});
