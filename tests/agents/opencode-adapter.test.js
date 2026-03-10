"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const core_1 = require("@opcom/core");
const opencode_js_1 = require("../../packages/core/src/agents/opencode.js");
(0, vitest_1.describe)("OpenCodeAdapter", () => {
    (0, vitest_1.it)("creates an adapter with opencode backend", () => {
        const adapter = new core_1.OpenCodeAdapter();
        (0, vitest_1.expect)(adapter.backend).toBe("opencode");
    });
    (0, vitest_1.it)("lists no sessions initially", () => {
        const adapter = new core_1.OpenCodeAdapter();
        (0, vitest_1.expect)(adapter.listSessions()).toHaveLength(0);
    });
    (0, vitest_1.it)("getSession returns undefined for unknown sessions", () => {
        const adapter = new core_1.OpenCodeAdapter();
        (0, vitest_1.expect)(adapter.getSession("nonexistent")).toBeUndefined();
    });
    (0, vitest_1.it)("stop is safe for unknown sessions", async () => {
        const adapter = new core_1.OpenCodeAdapter();
        // Should not throw
        await adapter.stop("nonexistent");
    });
});
(0, vitest_1.describe)("parseSSEEvents", () => {
    (0, vitest_1.it)("parses a single SSE event", () => {
        const raw = `event: message.delta\ndata: {"text":"hello"}\n\n`;
        const events = (0, opencode_js_1.parseSSEEvents)(raw);
        (0, vitest_1.expect)(events).toHaveLength(1);
        (0, vitest_1.expect)(events[0].event).toBe("message.delta");
        (0, vitest_1.expect)(events[0].data).toBe('{"text":"hello"}');
    });
    (0, vitest_1.it)("parses multiple SSE events", () => {
        const raw = `event: message.start\ndata: {"role":"assistant"}\n\n` +
            `event: message.delta\ndata: {"text":"hello"}\n\n` +
            `event: message.end\ndata: {"role":"assistant"}\n\n`;
        const events = (0, opencode_js_1.parseSSEEvents)(raw);
        (0, vitest_1.expect)(events).toHaveLength(3);
        (0, vitest_1.expect)(events[0].event).toBe("message.start");
        (0, vitest_1.expect)(events[1].event).toBe("message.delta");
        (0, vitest_1.expect)(events[2].event).toBe("message.end");
    });
    (0, vitest_1.it)("parses SSE events with id field", () => {
        const raw = `id: 42\nevent: message.delta\ndata: {"text":"hi"}\n\n`;
        const events = (0, opencode_js_1.parseSSEEvents)(raw);
        (0, vitest_1.expect)(events).toHaveLength(1);
        (0, vitest_1.expect)(events[0].id).toBe("42");
        (0, vitest_1.expect)(events[0].event).toBe("message.delta");
    });
    (0, vitest_1.it)("handles multi-line data fields", () => {
        const raw = `event: test\ndata: line1\ndata: line2\n\n`;
        const events = (0, opencode_js_1.parseSSEEvents)(raw);
        (0, vitest_1.expect)(events).toHaveLength(1);
        (0, vitest_1.expect)(events[0].data).toBe("line1\nline2");
    });
    (0, vitest_1.it)("ignores empty blocks", () => {
        const raw = `\n\n\nevent: message.delta\ndata: {"text":"hi"}\n\n\n\n`;
        const events = (0, opencode_js_1.parseSSEEvents)(raw);
        (0, vitest_1.expect)(events).toHaveLength(1);
    });
    (0, vitest_1.it)("ignores blocks without data", () => {
        const raw = `event: heartbeat\n\n`;
        const events = (0, opencode_js_1.parseSSEEvents)(raw);
        (0, vitest_1.expect)(events).toHaveLength(0);
    });
});
(0, vitest_1.describe)("mapOpenCodeEvent", () => {
    const sessionId = "test-session-123";
    (0, vitest_1.it)("maps session.created to agent_start", () => {
        const events = (0, opencode_js_1.mapOpenCodeEvent)(sessionId, {
            event: "session.created",
            data: '{"id":"s1"}',
        });
        (0, vitest_1.expect)(events).toHaveLength(1);
        (0, vitest_1.expect)(events[0].type).toBe("agent_start");
        (0, vitest_1.expect)(events[0].sessionId).toBe(sessionId);
        (0, vitest_1.expect)(events[0].data?.reason).toBe("session created");
    });
    (0, vitest_1.it)("maps session_created (underscore form) to agent_start", () => {
        const events = (0, opencode_js_1.mapOpenCodeEvent)(sessionId, {
            event: "session_created",
            data: '{"id":"s1"}',
        });
        (0, vitest_1.expect)(events).toHaveLength(1);
        (0, vitest_1.expect)(events[0].type).toBe("agent_start");
    });
    (0, vitest_1.it)("maps session.ended to agent_end", () => {
        const events = (0, opencode_js_1.mapOpenCodeEvent)(sessionId, {
            event: "session.ended",
            data: "{}",
        });
        (0, vitest_1.expect)(events).toHaveLength(1);
        (0, vitest_1.expect)(events[0].type).toBe("agent_end");
        (0, vitest_1.expect)(events[0].data?.reason).toBe("session ended");
    });
    (0, vitest_1.it)("maps message.start to message_start", () => {
        const events = (0, opencode_js_1.mapOpenCodeEvent)(sessionId, {
            event: "message.start",
            data: '{"role":"assistant"}',
        });
        (0, vitest_1.expect)(events).toHaveLength(1);
        (0, vitest_1.expect)(events[0].type).toBe("message_start");
        (0, vitest_1.expect)(events[0].data?.role).toBe("assistant");
    });
    (0, vitest_1.it)("maps message.delta to message_delta with text field", () => {
        const events = (0, opencode_js_1.mapOpenCodeEvent)(sessionId, {
            event: "message.delta",
            data: '{"text":"Hello world"}',
        });
        (0, vitest_1.expect)(events).toHaveLength(1);
        (0, vitest_1.expect)(events[0].type).toBe("message_delta");
        (0, vitest_1.expect)(events[0].data?.text).toBe("Hello world");
    });
    (0, vitest_1.it)("maps message.delta with delta field", () => {
        const events = (0, opencode_js_1.mapOpenCodeEvent)(sessionId, {
            event: "message.delta",
            data: '{"delta":"chunk"}',
        });
        (0, vitest_1.expect)(events).toHaveLength(1);
        (0, vitest_1.expect)(events[0].type).toBe("message_delta");
        (0, vitest_1.expect)(events[0].data?.text).toBe("chunk");
    });
    (0, vitest_1.it)("maps content.delta to message_delta", () => {
        const events = (0, opencode_js_1.mapOpenCodeEvent)(sessionId, {
            event: "content.delta",
            data: '{"content":"some text"}',
        });
        (0, vitest_1.expect)(events).toHaveLength(1);
        (0, vitest_1.expect)(events[0].type).toBe("message_delta");
        (0, vitest_1.expect)(events[0].data?.text).toBe("some text");
    });
    (0, vitest_1.it)("maps message.end to message_end", () => {
        const events = (0, opencode_js_1.mapOpenCodeEvent)(sessionId, {
            event: "message.end",
            data: '{"role":"assistant"}',
        });
        (0, vitest_1.expect)(events).toHaveLength(1);
        (0, vitest_1.expect)(events[0].type).toBe("message_end");
        (0, vitest_1.expect)(events[0].data?.role).toBe("assistant");
    });
    (0, vitest_1.it)("maps message.complete to message_end", () => {
        const events = (0, opencode_js_1.mapOpenCodeEvent)(sessionId, {
            event: "message.complete",
            data: "{}",
        });
        (0, vitest_1.expect)(events).toHaveLength(1);
        (0, vitest_1.expect)(events[0].type).toBe("message_end");
    });
    (0, vitest_1.it)("maps tool.start to tool_start", () => {
        const events = (0, opencode_js_1.mapOpenCodeEvent)(sessionId, {
            event: "tool.start",
            data: '{"name":"read_file","input":"/tmp/test.ts"}',
        });
        (0, vitest_1.expect)(events).toHaveLength(1);
        (0, vitest_1.expect)(events[0].type).toBe("tool_start");
        (0, vitest_1.expect)(events[0].data?.toolName).toBe("read_file");
        (0, vitest_1.expect)(events[0].data?.toolInput).toBe("/tmp/test.ts");
    });
    (0, vitest_1.it)("maps tool.start with object input", () => {
        const events = (0, opencode_js_1.mapOpenCodeEvent)(sessionId, {
            event: "tool.start",
            data: '{"name":"edit","input":{"path":"/tmp/x","content":"y"}}',
        });
        (0, vitest_1.expect)(events).toHaveLength(1);
        (0, vitest_1.expect)(events[0].type).toBe("tool_start");
        (0, vitest_1.expect)(events[0].data?.toolName).toBe("edit");
        (0, vitest_1.expect)(events[0].data?.toolInput).toContain("/tmp/x");
    });
    (0, vitest_1.it)("maps tool.end to tool_end", () => {
        const events = (0, opencode_js_1.mapOpenCodeEvent)(sessionId, {
            event: "tool.end",
            data: '{"output":"file contents here","success":true}',
        });
        (0, vitest_1.expect)(events).toHaveLength(1);
        (0, vitest_1.expect)(events[0].type).toBe("tool_end");
        (0, vitest_1.expect)(events[0].data?.toolOutput).toBe("file contents here");
        (0, vitest_1.expect)(events[0].data?.toolSuccess).toBe(true);
    });
    (0, vitest_1.it)("maps tool.end with failure", () => {
        const events = (0, opencode_js_1.mapOpenCodeEvent)(sessionId, {
            event: "tool.end",
            data: '{"error":"file not found","success":false}',
        });
        (0, vitest_1.expect)(events).toHaveLength(1);
        (0, vitest_1.expect)(events[0].type).toBe("tool_end");
        (0, vitest_1.expect)(events[0].data?.toolSuccess).toBe(false);
    });
    (0, vitest_1.it)("maps error to error event", () => {
        const events = (0, opencode_js_1.mapOpenCodeEvent)(sessionId, {
            event: "error",
            data: '{"message":"rate limit exceeded"}',
        });
        (0, vitest_1.expect)(events).toHaveLength(1);
        (0, vitest_1.expect)(events[0].type).toBe("error");
        (0, vitest_1.expect)(events[0].data?.reason).toBe("rate limit exceeded");
    });
    (0, vitest_1.it)("maps turn.start to turn_start", () => {
        const events = (0, opencode_js_1.mapOpenCodeEvent)(sessionId, {
            event: "turn.start",
            data: "{}",
        });
        (0, vitest_1.expect)(events).toHaveLength(1);
        (0, vitest_1.expect)(events[0].type).toBe("turn_start");
    });
    (0, vitest_1.it)("maps turn.end to turn_end", () => {
        const events = (0, opencode_js_1.mapOpenCodeEvent)(sessionId, {
            event: "turn.end",
            data: "{}",
        });
        (0, vitest_1.expect)(events).toHaveLength(1);
        (0, vitest_1.expect)(events[0].type).toBe("turn_end");
    });
    (0, vitest_1.it)("handles non-JSON data as text delta", () => {
        const events = (0, opencode_js_1.mapOpenCodeEvent)(sessionId, {
            event: "unknown",
            data: "just plain text",
        });
        (0, vitest_1.expect)(events).toHaveLength(1);
        (0, vitest_1.expect)(events[0].type).toBe("message_delta");
        (0, vitest_1.expect)(events[0].data?.text).toBe("just plain text");
    });
    (0, vitest_1.it)("handles unknown event types with text content", () => {
        const events = (0, opencode_js_1.mapOpenCodeEvent)(sessionId, {
            event: "custom.event",
            data: '{"text":"some output"}',
        });
        (0, vitest_1.expect)(events).toHaveLength(1);
        (0, vitest_1.expect)(events[0].type).toBe("message_delta");
        (0, vitest_1.expect)(events[0].data?.text).toBe("some output");
    });
    (0, vitest_1.it)("returns empty array for unknown events without text", () => {
        const events = (0, opencode_js_1.mapOpenCodeEvent)(sessionId, {
            event: "heartbeat",
            data: '{"status":"ok"}',
        });
        (0, vitest_1.expect)(events).toHaveLength(0);
    });
    (0, vitest_1.it)("all events include sessionId and timestamp", () => {
        const events = (0, opencode_js_1.mapOpenCodeEvent)(sessionId, {
            event: "message.delta",
            data: '{"text":"test"}',
        });
        (0, vitest_1.expect)(events[0].sessionId).toBe(sessionId);
        (0, vitest_1.expect)(events[0].timestamp).toBeTruthy();
        // Timestamp should be ISO format
        (0, vitest_1.expect)(() => new Date(events[0].timestamp)).not.toThrow();
    });
});
(0, vitest_1.describe)("createAdapter factory for opencode", () => {
    (0, vitest_1.it)("creates an OpenCodeAdapter via factory", async () => {
        const { createAdapter } = await import("@opcom/core");
        const adapter = createAdapter("opencode");
        (0, vitest_1.expect)(adapter.backend).toBe("opencode");
    });
});
(0, vitest_1.describe)("context packet structure", () => {
    (0, vitest_1.it)("creates a valid context packet for opencode", () => {
        const packet = {
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
        (0, vitest_1.expect)(packet.project.name).toBe("test-project");
        (0, vitest_1.expect)(packet.project.stack.frameworks[0].name).toBe("express");
        (0, vitest_1.expect)(packet.git.branch).toBe("feature/opencode");
    });
});
//# sourceMappingURL=opencode-adapter.test.js.map