"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const agent_focus_js_1 = require("../../packages/cli/src/tui/views/agent-focus.js");
function makeEvent(type, data) {
    return { type, sessionId: "test", timestamp: new Date().toISOString(), data };
}
const longText = "This is a detailed analysis of the ticket. ".repeat(5); // >100 chars
(0, vitest_1.describe)("deduplicateAssistantMessages", () => {
    (0, vitest_1.it)("passes through events with no duplicates", () => {
        const events = [
            makeEvent("agent_start", { reason: "started" }),
            makeEvent("message_start", { role: "assistant" }),
            makeEvent("message_delta", { text: longText }),
            makeEvent("message_end"),
            makeEvent("agent_end", { reason: "completed" }),
        ];
        const result = (0, agent_focus_js_1.deduplicateAssistantMessages)(events);
        (0, vitest_1.expect)(result).toHaveLength(events.length);
    });
    (0, vitest_1.it)("removes duplicate assistant message with same role", () => {
        const events = [
            makeEvent("agent_start"),
            // First assistant message
            makeEvent("message_start", { role: "assistant" }),
            makeEvent("message_delta", { text: longText }),
            makeEvent("message_end"),
            // Duplicate assistant message (same text)
            makeEvent("message_start", { role: "assistant" }),
            makeEvent("message_delta", { text: longText }),
            makeEvent("message_end"),
            makeEvent("agent_end"),
        ];
        const result = (0, agent_focus_js_1.deduplicateAssistantMessages)(events);
        // Should have: agent_start + first message (3 events) + agent_end = 5
        (0, vitest_1.expect)(result).toHaveLength(5);
        const deltaTexts = result.filter((e) => e.type === "message_delta");
        (0, vitest_1.expect)(deltaTexts).toHaveLength(1);
    });
    (0, vitest_1.it)("removes duplicate when first has no role (streaming) and second has role (final)", () => {
        const events = [
            makeEvent("agent_start"),
            // Streaming message — no role (comes from native Claude Code events)
            makeEvent("message_start"),
            makeEvent("message_delta", { text: longText }),
            makeEvent("message_end"),
            // Final message — has role (comes from assistant NDJSON event)
            makeEvent("message_start", { role: "assistant" }),
            makeEvent("message_delta", { text: longText }),
            makeEvent("message_end"),
            makeEvent("agent_end"),
        ];
        const result = (0, agent_focus_js_1.deduplicateAssistantMessages)(events);
        (0, vitest_1.expect)(result).toHaveLength(5);
        const deltaTexts = result.filter((e) => e.type === "message_delta");
        (0, vitest_1.expect)(deltaTexts).toHaveLength(1);
    });
    (0, vitest_1.it)("removes duplicate even with different whitespace", () => {
        const events = [
            makeEvent("agent_start"),
            makeEvent("message_start"),
            makeEvent("message_delta", { text: longText }),
            makeEvent("message_end"),
            // Same text but with extra indentation/whitespace
            makeEvent("message_start", { role: "assistant" }),
            makeEvent("message_delta", { text: "  " + longText.replace(/ /g, "  ") }),
            makeEvent("message_end"),
            makeEvent("agent_end"),
        ];
        const result = (0, agent_focus_js_1.deduplicateAssistantMessages)(events);
        (0, vitest_1.expect)(result).toHaveLength(5);
    });
    (0, vitest_1.it)("preserves user messages", () => {
        const events = [
            makeEvent("agent_start"),
            makeEvent("message_start", { role: "user" }),
            makeEvent("message_delta", { text: longText }),
            makeEvent("message_end"),
            makeEvent("message_start", { role: "assistant" }),
            makeEvent("message_delta", { text: "Response here. " + longText }),
            makeEvent("message_end"),
            makeEvent("agent_end"),
        ];
        const result = (0, agent_focus_js_1.deduplicateAssistantMessages)(events);
        (0, vitest_1.expect)(result).toHaveLength(events.length);
    });
    (0, vitest_1.it)("preserves different assistant messages (not duplicates)", () => {
        const events = [
            makeEvent("agent_start"),
            makeEvent("message_start", { role: "assistant" }),
            makeEvent("message_delta", { text: longText }),
            makeEvent("message_end"),
            // Tool use between messages
            makeEvent("tool_start", { toolName: "Read" }),
            makeEvent("tool_end", { toolOutput: "file contents" }),
            // Different assistant message
            makeEvent("message_start", { role: "assistant" }),
            makeEvent("message_delta", { text: "A completely different response. " + longText }),
            makeEvent("message_end"),
            makeEvent("agent_end"),
        ];
        const result = (0, agent_focus_js_1.deduplicateAssistantMessages)(events);
        (0, vitest_1.expect)(result).toHaveLength(events.length);
    });
    (0, vitest_1.it)("skips dedup for short messages (under 100 chars)", () => {
        const shortText = "Short reply.";
        const events = [
            makeEvent("agent_start"),
            makeEvent("message_start", { role: "assistant" }),
            makeEvent("message_delta", { text: shortText }),
            makeEvent("message_end"),
            makeEvent("message_start", { role: "assistant" }),
            makeEvent("message_delta", { text: shortText }),
            makeEvent("message_end"),
            makeEvent("agent_end"),
        ];
        const result = (0, agent_focus_js_1.deduplicateAssistantMessages)(events);
        // Both kept because text is too short to be a meaningful duplicate
        (0, vitest_1.expect)(result).toHaveLength(events.length);
    });
    (0, vitest_1.it)("passes through bare streaming deltas (adapter dedup handles the real case)", () => {
        // After the adapter fix, the adapter suppresses assistant summaries when
        // streaming already delivered the same text. So the display layer only
        // sees bare streaming deltas (no spans) OR assistant spans (not both).
        // This test verifies bare deltas pass through the display-layer dedup
        // untouched (they're not in spans so dedup doesn't apply).
        const events = [
            makeEvent("agent_start"),
            makeEvent("message_delta", { text: longText, raw: { type: "content_block_delta" } }),
            makeEvent("agent_end"),
        ];
        const result = (0, agent_focus_js_1.deduplicateAssistantMessages)(events);
        (0, vitest_1.expect)(result).toHaveLength(events.length);
        const deltas = result.filter((e) => e.type === "message_delta");
        (0, vitest_1.expect)(deltas).toHaveLength(1);
    });
    (0, vitest_1.it)("handles multiple deltas within one message span", () => {
        const part1 = "First part of a very long message. ".repeat(3);
        const part2 = "Second part of the same message. ".repeat(3);
        const events = [
            makeEvent("agent_start"),
            // First occurrence — two deltas
            makeEvent("message_start"),
            makeEvent("message_delta", { text: part1 }),
            makeEvent("message_delta", { text: part2 }),
            makeEvent("message_end"),
            // Second occurrence — same text in one delta
            makeEvent("message_start", { role: "assistant" }),
            makeEvent("message_delta", { text: part1 + part2 }),
            makeEvent("message_end"),
            makeEvent("agent_end"),
        ];
        const result = (0, agent_focus_js_1.deduplicateAssistantMessages)(events);
        (0, vitest_1.expect)(result).toHaveLength(6); // agent_start + first span (4) + agent_end
        const deltas = result.filter((e) => e.type === "message_delta");
        (0, vitest_1.expect)(deltas).toHaveLength(2); // the two deltas from the first span
    });
});
//# sourceMappingURL=agent-focus-dedup.test.js.map