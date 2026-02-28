import { describe, it, expect } from "vitest";
import { OpenCodeAdapter } from "@opcom/core";
import { parseSSEEvents, mapOpenCodeEvent } from "../../packages/core/src/agents/opencode.js";
import type { NormalizedEvent, ContextPacket } from "@opcom/types";

describe("OpenCodeAdapter", () => {
  it("creates an adapter with opencode backend", () => {
    const adapter = new OpenCodeAdapter();
    expect(adapter.backend).toBe("opencode");
  });

  it("lists no sessions initially", () => {
    const adapter = new OpenCodeAdapter();
    expect(adapter.listSessions()).toHaveLength(0);
  });

  it("getSession returns undefined for unknown sessions", () => {
    const adapter = new OpenCodeAdapter();
    expect(adapter.getSession("nonexistent")).toBeUndefined();
  });

  it("stop is safe for unknown sessions", async () => {
    const adapter = new OpenCodeAdapter();
    // Should not throw
    await adapter.stop("nonexistent");
  });
});

describe("parseSSEEvents", () => {
  it("parses a single SSE event", () => {
    const raw = `event: message.delta\ndata: {"text":"hello"}\n\n`;
    const events = parseSSEEvents(raw);
    expect(events).toHaveLength(1);
    expect(events[0].event).toBe("message.delta");
    expect(events[0].data).toBe('{"text":"hello"}');
  });

  it("parses multiple SSE events", () => {
    const raw =
      `event: message.start\ndata: {"role":"assistant"}\n\n` +
      `event: message.delta\ndata: {"text":"hello"}\n\n` +
      `event: message.end\ndata: {"role":"assistant"}\n\n`;
    const events = parseSSEEvents(raw);
    expect(events).toHaveLength(3);
    expect(events[0].event).toBe("message.start");
    expect(events[1].event).toBe("message.delta");
    expect(events[2].event).toBe("message.end");
  });

  it("parses SSE events with id field", () => {
    const raw = `id: 42\nevent: message.delta\ndata: {"text":"hi"}\n\n`;
    const events = parseSSEEvents(raw);
    expect(events).toHaveLength(1);
    expect(events[0].id).toBe("42");
    expect(events[0].event).toBe("message.delta");
  });

  it("handles multi-line data fields", () => {
    const raw = `event: test\ndata: line1\ndata: line2\n\n`;
    const events = parseSSEEvents(raw);
    expect(events).toHaveLength(1);
    expect(events[0].data).toBe("line1\nline2");
  });

  it("ignores empty blocks", () => {
    const raw = `\n\n\nevent: message.delta\ndata: {"text":"hi"}\n\n\n\n`;
    const events = parseSSEEvents(raw);
    expect(events).toHaveLength(1);
  });

  it("ignores blocks without data", () => {
    const raw = `event: heartbeat\n\n`;
    const events = parseSSEEvents(raw);
    expect(events).toHaveLength(0);
  });
});

describe("mapOpenCodeEvent", () => {
  const sessionId = "test-session-123";

  it("maps session.created to agent_start", () => {
    const events = mapOpenCodeEvent(sessionId, {
      event: "session.created",
      data: '{"id":"s1"}',
    });
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe("agent_start");
    expect(events[0].sessionId).toBe(sessionId);
    expect(events[0].data?.reason).toBe("session created");
  });

  it("maps session_created (underscore form) to agent_start", () => {
    const events = mapOpenCodeEvent(sessionId, {
      event: "session_created",
      data: '{"id":"s1"}',
    });
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe("agent_start");
  });

  it("maps session.ended to agent_end", () => {
    const events = mapOpenCodeEvent(sessionId, {
      event: "session.ended",
      data: "{}",
    });
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe("agent_end");
    expect(events[0].data?.reason).toBe("session ended");
  });

  it("maps message.start to message_start", () => {
    const events = mapOpenCodeEvent(sessionId, {
      event: "message.start",
      data: '{"role":"assistant"}',
    });
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe("message_start");
    expect(events[0].data?.role).toBe("assistant");
  });

  it("maps message.delta to message_delta with text field", () => {
    const events = mapOpenCodeEvent(sessionId, {
      event: "message.delta",
      data: '{"text":"Hello world"}',
    });
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe("message_delta");
    expect(events[0].data?.text).toBe("Hello world");
  });

  it("maps message.delta with delta field", () => {
    const events = mapOpenCodeEvent(sessionId, {
      event: "message.delta",
      data: '{"delta":"chunk"}',
    });
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe("message_delta");
    expect(events[0].data?.text).toBe("chunk");
  });

  it("maps content.delta to message_delta", () => {
    const events = mapOpenCodeEvent(sessionId, {
      event: "content.delta",
      data: '{"content":"some text"}',
    });
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe("message_delta");
    expect(events[0].data?.text).toBe("some text");
  });

  it("maps message.end to message_end", () => {
    const events = mapOpenCodeEvent(sessionId, {
      event: "message.end",
      data: '{"role":"assistant"}',
    });
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe("message_end");
    expect(events[0].data?.role).toBe("assistant");
  });

  it("maps message.complete to message_end", () => {
    const events = mapOpenCodeEvent(sessionId, {
      event: "message.complete",
      data: "{}",
    });
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe("message_end");
  });

  it("maps tool.start to tool_start", () => {
    const events = mapOpenCodeEvent(sessionId, {
      event: "tool.start",
      data: '{"name":"read_file","input":"/tmp/test.ts"}',
    });
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe("tool_start");
    expect(events[0].data?.toolName).toBe("read_file");
    expect(events[0].data?.toolInput).toBe("/tmp/test.ts");
  });

  it("maps tool.start with object input", () => {
    const events = mapOpenCodeEvent(sessionId, {
      event: "tool.start",
      data: '{"name":"edit","input":{"path":"/tmp/x","content":"y"}}',
    });
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe("tool_start");
    expect(events[0].data?.toolName).toBe("edit");
    expect(events[0].data?.toolInput).toContain("/tmp/x");
  });

  it("maps tool.end to tool_end", () => {
    const events = mapOpenCodeEvent(sessionId, {
      event: "tool.end",
      data: '{"output":"file contents here","success":true}',
    });
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe("tool_end");
    expect(events[0].data?.toolOutput).toBe("file contents here");
    expect(events[0].data?.toolSuccess).toBe(true);
  });

  it("maps tool.end with failure", () => {
    const events = mapOpenCodeEvent(sessionId, {
      event: "tool.end",
      data: '{"error":"file not found","success":false}',
    });
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe("tool_end");
    expect(events[0].data?.toolSuccess).toBe(false);
  });

  it("maps error to error event", () => {
    const events = mapOpenCodeEvent(sessionId, {
      event: "error",
      data: '{"message":"rate limit exceeded"}',
    });
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe("error");
    expect(events[0].data?.reason).toBe("rate limit exceeded");
  });

  it("maps turn.start to turn_start", () => {
    const events = mapOpenCodeEvent(sessionId, {
      event: "turn.start",
      data: "{}",
    });
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe("turn_start");
  });

  it("maps turn.end to turn_end", () => {
    const events = mapOpenCodeEvent(sessionId, {
      event: "turn.end",
      data: "{}",
    });
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe("turn_end");
  });

  it("handles non-JSON data as text delta", () => {
    const events = mapOpenCodeEvent(sessionId, {
      event: "unknown",
      data: "just plain text",
    });
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe("message_delta");
    expect(events[0].data?.text).toBe("just plain text");
  });

  it("handles unknown event types with text content", () => {
    const events = mapOpenCodeEvent(sessionId, {
      event: "custom.event",
      data: '{"text":"some output"}',
    });
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe("message_delta");
    expect(events[0].data?.text).toBe("some output");
  });

  it("returns empty array for unknown events without text", () => {
    const events = mapOpenCodeEvent(sessionId, {
      event: "heartbeat",
      data: '{"status":"ok"}',
    });
    expect(events).toHaveLength(0);
  });

  it("all events include sessionId and timestamp", () => {
    const events = mapOpenCodeEvent(sessionId, {
      event: "message.delta",
      data: '{"text":"test"}',
    });
    expect(events[0].sessionId).toBe(sessionId);
    expect(events[0].timestamp).toBeTruthy();
    // Timestamp should be ISO format
    expect(() => new Date(events[0].timestamp)).not.toThrow();
  });
});

describe("createAdapter factory for opencode", () => {
  it("creates an OpenCodeAdapter via factory", async () => {
    const { createAdapter } = await import("@opcom/core");
    const adapter = createAdapter("opencode");
    expect(adapter.backend).toBe("opencode");
  });
});

describe("context packet structure", () => {
  it("creates a valid context packet for opencode", () => {
    const packet: ContextPacket = {
      project: {
        name: "test-project",
        path: "/tmp/test",
        stack: {
          languages: [{ name: "typescript", version: "5.7", sourceFile: "package.json" }],
          frameworks: [{ name: "express", version: "4.18", sourceFile: "package.json" }],
          packageManagers: [],
          infrastructure: [],
          versionManagers: [],
        },
        testing: { framework: "vitest", command: "npm test" },
        linting: [{ name: "eslint", configFile: ".eslintrc.json" }],
        services: [],
      },
      git: { branch: "feature/opencode", remote: "origin", clean: true },
    };

    expect(packet.project.name).toBe("test-project");
    expect(packet.project.stack.frameworks[0].name).toBe("express");
    expect(packet.git.branch).toBe("feature/opencode");
  });
});
