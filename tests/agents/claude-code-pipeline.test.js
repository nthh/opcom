"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const node_events_1 = require("node:events");
const node_stream_1 = require("node:stream");
const core_1 = require("@opcom/core");
// Mock child_process.spawn to return controllable streams (keep other exports like execFile)
vitest_1.vi.mock("node:child_process", async (importOriginal) => {
    const actual = await importOriginal();
    return {
        ...actual,
        spawn: vitest_1.vi.fn(),
    };
});
const node_child_process_1 = require("node:child_process");
const mockSpawn = vitest_1.vi.mocked(node_child_process_1.spawn);
function makeContextPacket(overrides = {}) {
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
function makeConfig(overrides = {}) {
    return {
        projectPath: "/tmp/test",
        contextPacket: makeContextPacket(),
        ...overrides,
    };
}
function createMockProcess() {
    const proc = new node_events_1.EventEmitter();
    const stdoutEmitter = new node_stream_1.Readable({ read() { } });
    const stderrEmitter = new node_stream_1.Readable({ read() { } });
    proc.stdout = stdoutEmitter;
    proc.stderr = stderrEmitter;
    proc.stdin = { write: vitest_1.vi.fn(), end: vitest_1.vi.fn(), writable: true };
    proc.pid = 12345;
    proc.kill = vitest_1.vi.fn();
    return proc;
}
(0, vitest_1.describe)("ClaudeCodeAdapter pipeline", () => {
    let adapter;
    let mockProc;
    (0, vitest_1.beforeEach)(() => {
        adapter = new core_1.ClaudeCodeAdapter();
        mockProc = createMockProcess();
        mockSpawn.mockReturnValue(mockProc);
    });
    async function collectEvents(sessionId, count) {
        const events = [];
        for await (const event of adapter.subscribe(sessionId)) {
            events.push(event);
            if (events.length >= count)
                break;
        }
        return events;
    }
    (0, vitest_1.it)("parses assistant message into message_start + message_delta + message_end", async () => {
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
        (0, vitest_1.expect)(events[0].type).toBe("agent_start");
        (0, vitest_1.expect)(events[1].type).toBe("message_start");
        (0, vitest_1.expect)(events[1].data?.role).toBe("assistant");
        (0, vitest_1.expect)(events[2].type).toBe("message_delta");
        (0, vitest_1.expect)(events[2].data?.text).toBe("Hello world");
        (0, vitest_1.expect)(events[3].type).toBe("message_end");
    });
    (0, vitest_1.it)("parses tool_use into tool_start event", async () => {
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
        (0, vitest_1.expect)(events[2].type).toBe("tool_start");
        (0, vitest_1.expect)(events[2].data?.toolName).toBe("Read");
    });
    (0, vitest_1.it)("parses result into tool_end event", async () => {
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
        (0, vitest_1.expect)(events[1].type).toBe("tool_end");
        (0, vitest_1.expect)(events[1].data?.toolOutput).toBe("file contents here");
        (0, vitest_1.expect)(events[1].data?.toolSuccess).toBe(true);
    });
    (0, vitest_1.it)("carries toolName from tool_start to tool_end", async () => {
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
        (0, vitest_1.expect)(events[2].type).toBe("tool_start");
        (0, vitest_1.expect)(events[2].data?.toolName).toBe("Write");
        (0, vitest_1.expect)(events[4].type).toBe("tool_end");
        (0, vitest_1.expect)(events[4].data?.toolName).toBe("Write");
        (0, vitest_1.expect)(events[4].data?.toolSuccess).toBe(true);
    });
    (0, vitest_1.it)("emits stderr lines as error events with 'stderr:' prefix", async () => {
        const session = await adapter.start(makeConfig());
        // agent_start + error = 2
        const eventsPromise = collectEvents(session.id, 2);
        mockProc.stderr.push("Warning: something went wrong\n");
        const events = await eventsPromise;
        (0, vitest_1.expect)(events[1].type).toBe("error");
        (0, vitest_1.expect)(events[1].data?.reason).toBe("stderr: Warning: something went wrong");
    });
    (0, vitest_1.it)("extracts text from content_block_delta streaming events", async () => {
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
        (0, vitest_1.expect)(events[1].type).toBe("message_delta");
        (0, vitest_1.expect)(events[1].data?.text).toBe("Hello streaming");
        // Should also preserve raw
        (0, vitest_1.expect)(events[1].data?.raw).toBeDefined();
    });
    (0, vitest_1.it)("suppresses assistant summary when same text was already streamed", async () => {
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
        (0, vitest_1.expect)(streamEvents[1].type).toBe("message_delta");
        (0, vitest_1.expect)(streamEvents[1].data?.text).toBe(longText);
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
        (0, vitest_1.expect)(allEvents[2].type).toBe("tool_end");
    });
    (0, vitest_1.it)("does not crash on malformed JSON lines", async () => {
        const session = await adapter.start(makeConfig());
        // agent_start + message from valid line = 4 (skip the bad one)
        const eventsPromise = collectEvents(session.id, 4);
        // Push malformed line first, then a valid one
        mockProc.stdout.push("this is not json\n");
        mockProc.stdout.push(JSON.stringify({
            type: "assistant",
            message: { content: [{ type: "text", text: "ok" }] },
        }) + "\n");
        const events = await eventsPromise;
        // Should still get the valid events
        (0, vitest_1.expect)(events[0].type).toBe("agent_start");
        (0, vitest_1.expect)(events[1].type).toBe("message_start");
    });
    (0, vitest_1.it)("emits agent_end on process close", async () => {
        const session = await adapter.start(makeConfig());
        // agent_start + agent_end = 2
        const eventsPromise = collectEvents(session.id, 2);
        mockProc.emit("close", 0);
        const events = await eventsPromise;
        (0, vitest_1.expect)(events[1].type).toBe("agent_end");
        (0, vitest_1.expect)(events[1].data?.reason).toBe("completed");
    });
    (0, vitest_1.it)("emits agent_end with exit code on non-zero close", async () => {
        const session = await adapter.start(makeConfig());
        const eventsPromise = collectEvents(session.id, 2);
        mockProc.emit("close", 1);
        const events = await eventsPromise;
        (0, vitest_1.expect)(events[1].type).toBe("agent_end");
        (0, vitest_1.expect)(events[1].data?.reason).toBe("exit code 1");
    });
    (0, vitest_1.it)("captures backendSessionId from system event", async () => {
        const session = await adapter.start(makeConfig());
        const eventsPromise = collectEvents(session.id, 2);
        const systemMsg = JSON.stringify({
            type: "system",
            session_id: "cc-abc-123",
        });
        mockProc.stdout.push(systemMsg + "\n");
        const events = await eventsPromise;
        (0, vitest_1.expect)(events[1].type).toBe("agent_start");
        // The session object should now have the backend session ID
        const updated = adapter.getSession(session.id);
        (0, vitest_1.expect)(updated?.backendSessionId).toBe("cc-abc-123");
    });
    (0, vitest_1.it)("passes --resume flag when resumeSessionId is set", async () => {
        await adapter.start(makeConfig({ resumeSessionId: "cc-prev-session" }));
        const lastCall = mockSpawn.mock.calls[mockSpawn.mock.calls.length - 1];
        const args = lastCall[1];
        (0, vitest_1.expect)(args).toContain("--resume");
        (0, vitest_1.expect)(args).toContain("cc-prev-session");
    });
    (0, vitest_1.it)("uses systemPrompt instead of context packet when provided", async () => {
        await adapter.start(makeConfig({ systemPrompt: "Custom prompt here" }));
        const lastCall = mockSpawn.mock.calls[mockSpawn.mock.calls.length - 1];
        const args = lastCall[1];
        const pIndex = args.indexOf("-p");
        (0, vitest_1.expect)(args[pIndex + 1]).toBe("Custom prompt here");
    });
});
//# sourceMappingURL=claude-code-pipeline.test.js.map