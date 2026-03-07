import { describe, it, expect, vi, beforeEach } from "vitest";
import { EventEmitter } from "node:events";
import { Readable } from "node:stream";
import { ClaudeCodeAdapter } from "@opcom/core";
import type { NormalizedEvent, AgentStartConfig, ContextPacket } from "@opcom/types";

// Mock child_process.spawn to return controllable streams (keep other exports like execFile)
vi.mock("node:child_process", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:child_process")>();
  return {
    ...actual,
    spawn: vi.fn(),
  };
});

import { spawn } from "node:child_process";
const mockSpawn = vi.mocked(spawn);

function makeContextPacket(overrides: Partial<ContextPacket> = {}): ContextPacket {
  return {
    project: {
      name: "test-proj",
      path: "/tmp/test",
      stack: {
        languages: [{ name: "typescript", version: "5.7", sourceFile: "package.json" }],
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
    ...overrides,
  };
}

function makeConfig(overrides: Partial<AgentStartConfig> = {}): AgentStartConfig {
  return {
    projectPath: "/tmp/test",
    contextPacket: makeContextPacket(),
    ...overrides,
  };
}

function createMockProcess() {
  const proc = new EventEmitter() as any;
  const stdoutEmitter = new Readable({ read() {} });
  const stderrEmitter = new Readable({ read() {} });
  proc.stdout = stdoutEmitter;
  proc.stderr = stderrEmitter;
  proc.stdin = { write: vi.fn(), end: vi.fn(), writable: true };
  proc.pid = 12345;
  proc.kill = vi.fn();
  return proc;
}

describe("ClaudeCodeAdapter pipeline", () => {
  let adapter: ClaudeCodeAdapter;
  let mockProc: ReturnType<typeof createMockProcess>;

  beforeEach(() => {
    adapter = new ClaudeCodeAdapter();
    mockProc = createMockProcess();
    mockSpawn.mockReturnValue(mockProc as any);
  });

  async function collectEvents(sessionId: string, count: number): Promise<NormalizedEvent[]> {
    const events: NormalizedEvent[] = [];
    for await (const event of adapter.subscribe(sessionId)) {
      events.push(event);
      if (events.length >= count) break;
    }
    return events;
  }

  it("parses assistant message into message_start + message_delta + message_end", async () => {
    const session = await adapter.start(makeConfig());

    // Collect events: agent_start + message_start + message_delta + message_end = 4
    const eventsPromise = collectEvents(session.id, 4);

    // Feed an assistant NDJSON line to stdout
    const assistantMsg = JSON.stringify({
      type: "assistant",
      message: {
        content: [{ type: "text", text: "Hello world" }],
      },
    });
    mockProc.stdout.push(assistantMsg + "\n");

    const events = await eventsPromise;

    expect(events[0].type).toBe("agent_start");
    expect(events[1].type).toBe("message_start");
    expect(events[1].data?.role).toBe("assistant");
    expect(events[2].type).toBe("message_delta");
    expect(events[2].data?.text).toBe("Hello world");
    expect(events[3].type).toBe("message_end");
  });

  it("parses tool_use into tool_start event", async () => {
    const session = await adapter.start(makeConfig());

    // agent_start + message_start + tool_start + message_end = 4
    const eventsPromise = collectEvents(session.id, 4);

    const toolMsg = JSON.stringify({
      type: "assistant",
      message: {
        content: [{ type: "tool_use", name: "Read", input: { path: "/foo" } }],
      },
    });
    mockProc.stdout.push(toolMsg + "\n");

    const events = await eventsPromise;

    expect(events[2].type).toBe("tool_start");
    expect(events[2].data?.toolName).toBe("Read");
  });

  it("parses result into tool_end event", async () => {
    const session = await adapter.start(makeConfig());

    // agent_start + tool_end = 2
    const eventsPromise = collectEvents(session.id, 2);

    const resultMsg = JSON.stringify({
      type: "result",
      result: "file contents here",
      is_error: false,
    });
    mockProc.stdout.push(resultMsg + "\n");

    const events = await eventsPromise;

    expect(events[1].type).toBe("tool_end");
    expect(events[1].data?.toolOutput).toBe("file contents here");
    expect(events[1].data?.toolSuccess).toBe(true);
  });

  it("carries toolName from tool_start to tool_end", async () => {
    const session = await adapter.start(makeConfig());

    // agent_start + message_start + tool_start + message_end + tool_end = 5
    const eventsPromise = collectEvents(session.id, 5);

    // Send assistant with tool_use, then the result
    mockProc.stdout.push(JSON.stringify({
      type: "assistant",
      message: {
        content: [{ type: "tool_use", name: "Write", input: { path: "/foo", content: "bar" } }],
      },
    }) + "\n");

    mockProc.stdout.push(JSON.stringify({
      type: "result",
      result: "File written",
      is_error: false,
    }) + "\n");

    const events = await eventsPromise;

    expect(events[2].type).toBe("tool_start");
    expect(events[2].data?.toolName).toBe("Write");
    expect(events[4].type).toBe("tool_end");
    expect(events[4].data?.toolName).toBe("Write");
    expect(events[4].data?.toolSuccess).toBe(true);
  });

  it("emits stderr lines as error events with 'stderr:' prefix", async () => {
    const session = await adapter.start(makeConfig());

    // agent_start + error = 2
    const eventsPromise = collectEvents(session.id, 2);

    mockProc.stderr.push("Warning: something went wrong\n");

    const events = await eventsPromise;

    expect(events[1].type).toBe("error");
    expect(events[1].data?.reason).toBe("stderr: Warning: something went wrong");
  });

  it("extracts text from content_block_delta streaming events", async () => {
    const session = await adapter.start(makeConfig());

    // agent_start + message_delta (from content_block_delta) = 2
    const eventsPromise = collectEvents(session.id, 2);

    const deltaEvent = JSON.stringify({
      type: "content_block_delta",
      index: 0,
      delta: { type: "text_delta", text: "Hello streaming" },
    });
    mockProc.stdout.push(deltaEvent + "\n");

    const events = await eventsPromise;

    expect(events[1].type).toBe("message_delta");
    expect(events[1].data?.text).toBe("Hello streaming");
    // Should also preserve raw
    expect(events[1].data?.raw).toBeDefined();
  });

  it("suppresses assistant summary when same text was already streamed", async () => {
    const session = await adapter.start(makeConfig());

    const longText = "This is a detailed analysis of the ticket. ".repeat(5);

    // agent_start + streaming delta = 2
    const eventsPromise = collectEvents(session.id, 2);

    // First: streaming delta
    mockProc.stdout.push(JSON.stringify({
      type: "content_block_delta",
      index: 0,
      delta: { type: "text_delta", text: longText },
    }) + "\n");

    const streamEvents = await eventsPromise;
    expect(streamEvents[1].type).toBe("message_delta");
    expect(streamEvents[1].data?.text).toBe(longText);

    // Now send the assistant summary with the same text.
    // It should be suppressed (no new events emitted).
    // We'll collect what comes next — push a result event after
    // the assistant to verify the assistant was skipped.
    const nextPromise = collectEvents(session.id, 3); // 2 already + 1 new (tool_end)

    mockProc.stdout.push(JSON.stringify({
      type: "assistant",
      message: { content: [{ type: "text", text: longText }] },
    }) + "\n");

    mockProc.stdout.push(JSON.stringify({
      type: "result",
      result: "ok",
      is_error: false,
    }) + "\n");

    const allEvents = await nextPromise;
    // Should be: agent_start, message_delta (streaming), tool_end
    // The assistant summary (message_start + message_delta + message_end) was skipped
    expect(allEvents[2].type).toBe("tool_end");
  });

  it("does not crash on malformed JSON lines", async () => {
    const session = await adapter.start(makeConfig());

    // agent_start + message from valid line = 4 (skip the bad one)
    const eventsPromise = collectEvents(session.id, 4);

    // Push malformed line first, then a valid one
    mockProc.stdout.push("this is not json\n");
    mockProc.stdout.push(
      JSON.stringify({
        type: "assistant",
        message: { content: [{ type: "text", text: "ok" }] },
      }) + "\n",
    );

    const events = await eventsPromise;

    // Should still get the valid events
    expect(events[0].type).toBe("agent_start");
    expect(events[1].type).toBe("message_start");
  });

  it("emits agent_end on process close", async () => {
    const session = await adapter.start(makeConfig());

    // agent_start + agent_end = 2
    const eventsPromise = collectEvents(session.id, 2);

    mockProc.emit("close", 0);

    const events = await eventsPromise;

    expect(events[1].type).toBe("agent_end");
    expect(events[1].data?.reason).toBe("completed");
  });

  it("emits agent_end with exit code on non-zero close", async () => {
    const session = await adapter.start(makeConfig());

    const eventsPromise = collectEvents(session.id, 2);
    mockProc.emit("close", 1);

    const events = await eventsPromise;

    expect(events[1].type).toBe("agent_end");
    expect(events[1].data?.reason).toBe("exit code 1");
  });

  it("captures backendSessionId from system event", async () => {
    const session = await adapter.start(makeConfig());

    const eventsPromise = collectEvents(session.id, 2);

    const systemMsg = JSON.stringify({
      type: "system",
      session_id: "cc-abc-123",
    });
    mockProc.stdout.push(systemMsg + "\n");

    const events = await eventsPromise;

    expect(events[1].type).toBe("agent_start");
    // The session object should now have the backend session ID
    const updated = adapter.getSession(session.id);
    expect(updated?.backendSessionId).toBe("cc-abc-123");
  });

  it("passes --resume flag when resumeSessionId is set", async () => {
    await adapter.start(makeConfig({ resumeSessionId: "cc-prev-session" }));

    const lastCall = mockSpawn.mock.calls[mockSpawn.mock.calls.length - 1];
    const args = lastCall[1] as string[];
    expect(args).toContain("--resume");
    expect(args).toContain("cc-prev-session");
  });

  it("uses systemPrompt instead of context packet when provided", async () => {
    await adapter.start(makeConfig({ systemPrompt: "Custom prompt here" }));

    // Prompt is piped via stdin, not passed as -p argument value
    const lastCall = mockSpawn.mock.calls[mockSpawn.mock.calls.length - 1];
    const args = lastCall[1] as string[];
    expect(args).toContain("-p");
    expect(mockProc.stdin.write).toHaveBeenCalledWith("Custom prompt here");
    expect(mockProc.stdin.end).toHaveBeenCalled();
  });
});
