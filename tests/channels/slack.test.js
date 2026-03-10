"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const core_1 = require("@opcom/core");
function makeProject(overrides = {}) {
    return {
        id: "folia",
        name: "folia",
        path: "/home/user/projects/folia",
        git: { branch: "main", clean: true, remote: "origin" },
        workSummary: { total: 10, open: 5, inProgress: 2, closed: 3, deferred: 0 },
        ...overrides,
    };
}
function makeAgent(overrides = {}) {
    return {
        id: "agent-1",
        backend: "claude-code",
        projectId: "folia",
        state: "streaming",
        startedAt: new Date(Date.now() - 10 * 60_000).toISOString(),
        workItemId: "tile-server-perf",
        ...overrides,
    };
}
function makeWorkItem(overrides = {}) {
    return {
        id: "tile-server-perf",
        title: "Improve tile server performance",
        status: "open",
        priority: 1,
        type: "feature",
        filePath: "/tickets/tile-server-perf.md",
        deps: [],
        links: [],
        tags: {},
        ...overrides,
    };
}
function makeMockAPI() {
    return {
        getProjects: vitest_1.vi.fn().mockResolvedValue([makeProject()]),
        getAgents: vitest_1.vi.fn().mockResolvedValue([makeAgent()]),
        startAgent: vitest_1.vi.fn().mockResolvedValue(makeAgent()),
        stopAgent: vitest_1.vi.fn().mockResolvedValue(undefined),
        getTickets: vitest_1.vi.fn().mockResolvedValue([makeWorkItem()]),
    };
}
const config = {
    botToken: "xoxb-test-token",
    signingSecret: "test-secret",
    channels: ["C12345"],
};
(0, vitest_1.describe)("SlackChannel", () => {
    (0, vitest_1.describe)("formatBlocks", () => {
        (0, vitest_1.it)("produces a section block with mrkdwn text", () => {
            const api = makeMockAPI();
            const slack = new core_1.SlackChannel(config, api);
            const response = {
                text: "Hello world",
                richText: "*Hello world*",
            };
            const blocks = slack.formatBlocks(response);
            (0, vitest_1.expect)(blocks.length).toBeGreaterThanOrEqual(1);
            const section = blocks[0];
            (0, vitest_1.expect)(section.type).toBe("section");
            const textBlock = section.text;
            (0, vitest_1.expect)(textBlock.type).toBe("mrkdwn");
            (0, vitest_1.expect)(textBlock.text).toBe("*Hello world*");
        });
        (0, vitest_1.it)("uses plain text when richText is not provided", () => {
            const api = makeMockAPI();
            const slack = new core_1.SlackChannel(config, api);
            const response = { text: "Plain text" };
            const blocks = slack.formatBlocks(response);
            const section = blocks[0];
            const textBlock = section.text;
            (0, vitest_1.expect)(textBlock.text).toBe("Plain text");
        });
        (0, vitest_1.it)("includes action buttons when actions are present", () => {
            const api = makeMockAPI();
            const slack = new core_1.SlackChannel(config, api);
            const response = {
                text: "Test",
                actions: [
                    { label: "Stop Agent", action: "stop folia", style: "danger" },
                    { label: "View Status", action: "status folia", style: "primary" },
                ],
            };
            const blocks = slack.formatBlocks(response);
            (0, vitest_1.expect)(blocks.length).toBe(2);
            const actionsBlock = blocks[1];
            (0, vitest_1.expect)(actionsBlock.type).toBe("actions");
            const elements = actionsBlock.elements;
            (0, vitest_1.expect)(elements.length).toBe(2);
            (0, vitest_1.expect)(elements[0].type).toBe("button");
            (0, vitest_1.expect)(elements[0].text.text).toBe("Stop Agent");
            (0, vitest_1.expect)(elements[0].style).toBe("danger");
            (0, vitest_1.expect)(elements[0].action_id).toBe("stop_folia");
            (0, vitest_1.expect)(elements[0].value).toBe("stop folia");
        });
        (0, vitest_1.it)("does not include actions block when no actions", () => {
            const api = makeMockAPI();
            const slack = new core_1.SlackChannel(config, api);
            const response = { text: "No actions" };
            const blocks = slack.formatBlocks(response);
            (0, vitest_1.expect)(blocks.length).toBe(1);
        });
    });
    (0, vitest_1.describe)("handleEvent", () => {
        (0, vitest_1.it)("handles a status message event", async () => {
            const api = makeMockAPI();
            const slack = new core_1.SlackChannel(config, api);
            const result = await slack.handleEvent({
                type: "message",
                text: "status",
                user: "U12345",
                channel: "C12345",
            });
            (0, vitest_1.expect)(result).not.toBeNull();
            (0, vitest_1.expect)(result.text).toContain("folia");
            (0, vitest_1.expect)(api.getProjects).toHaveBeenCalled();
            (0, vitest_1.expect)(api.getAgents).toHaveBeenCalled();
        });
        (0, vitest_1.it)("handles a status_project message event", async () => {
            const api = makeMockAPI();
            const slack = new core_1.SlackChannel(config, api);
            const result = await slack.handleEvent({
                type: "message",
                text: "status folia",
                user: "U12345",
                channel: "C12345",
            });
            (0, vitest_1.expect)(result).not.toBeNull();
            (0, vitest_1.expect)(result.text).toContain("folia");
            (0, vitest_1.expect)(api.getTickets).toHaveBeenCalledWith("folia");
        });
        (0, vitest_1.it)("handles a work command", async () => {
            const api = makeMockAPI();
            const slack = new core_1.SlackChannel(config, api);
            const result = await slack.handleEvent({
                type: "message",
                text: "work on folia/tile-server-perf",
                user: "U12345",
                channel: "C12345",
            });
            (0, vitest_1.expect)(result).not.toBeNull();
            (0, vitest_1.expect)(result.text).toContain("Starting");
            (0, vitest_1.expect)(api.startAgent).toHaveBeenCalledWith("folia", "tile-server-perf");
        });
        (0, vitest_1.it)("handles an agents command", async () => {
            const api = makeMockAPI();
            const slack = new core_1.SlackChannel(config, api);
            const result = await slack.handleEvent({
                type: "message",
                text: "agents",
                user: "U12345",
                channel: "C12345",
            });
            (0, vitest_1.expect)(result).not.toBeNull();
            (0, vitest_1.expect)(result.text).toContain("1 agent active");
        });
        (0, vitest_1.it)("handles a stop command", async () => {
            const api = makeMockAPI();
            const slack = new core_1.SlackChannel(config, api);
            const result = await slack.handleEvent({
                type: "message",
                text: "stop folia",
                user: "U12345",
                channel: "C12345",
            });
            (0, vitest_1.expect)(result).not.toBeNull();
            (0, vitest_1.expect)(result.text).toContain("Stopped agent on folia");
            (0, vitest_1.expect)(api.stopAgent).toHaveBeenCalledWith("agent-1");
        });
        (0, vitest_1.it)("returns null for non-message events", async () => {
            const api = makeMockAPI();
            const slack = new core_1.SlackChannel(config, api);
            const result = await slack.handleEvent({
                type: "reaction_added",
                user: "U12345",
            });
            (0, vitest_1.expect)(result).toBeNull();
        });
        (0, vitest_1.it)("ignores bot messages", async () => {
            const api = makeMockAPI();
            const slack = new core_1.SlackChannel(config, api);
            const result = await slack.handleEvent({
                type: "message",
                text: "status",
                bot_id: "B12345",
            });
            (0, vitest_1.expect)(result).toBeNull();
        });
        (0, vitest_1.it)("ignores bot_message subtype", async () => {
            const api = makeMockAPI();
            const slack = new core_1.SlackChannel(config, api);
            const result = await slack.handleEvent({
                type: "message",
                subtype: "bot_message",
                text: "status",
            });
            (0, vitest_1.expect)(result).toBeNull();
        });
        (0, vitest_1.it)("returns null for unknown commands", async () => {
            const api = makeMockAPI();
            const slack = new core_1.SlackChannel(config, api);
            const result = await slack.handleEvent({
                type: "message",
                text: "what is the meaning of life",
                user: "U12345",
            });
            (0, vitest_1.expect)(result).toBeNull();
        });
        (0, vitest_1.it)("returns error for not-found project", async () => {
            const api = makeMockAPI();
            api.getProjects.mockResolvedValue([]);
            const slack = new core_1.SlackChannel(config, api);
            const result = await slack.handleEvent({
                type: "message",
                text: "status nonexistent",
                user: "U12345",
            });
            (0, vitest_1.expect)(result).not.toBeNull();
            (0, vitest_1.expect)(result.text).toContain("not found");
        });
        (0, vitest_1.it)("handles stop when no active agent exists", async () => {
            const api = makeMockAPI();
            api.getAgents.mockResolvedValue([]);
            const slack = new core_1.SlackChannel(config, api);
            const result = await slack.handleEvent({
                type: "message",
                text: "stop folia",
                user: "U12345",
            });
            (0, vitest_1.expect)(result).not.toBeNull();
            (0, vitest_1.expect)(result.text).toContain("No active agent");
        });
        (0, vitest_1.it)("handles approve merge command", async () => {
            const api = makeMockAPI();
            const slack = new core_1.SlackChannel(config, api);
            const result = await slack.handleEvent({
                type: "message",
                text: "approve merge",
                user: "U12345",
            });
            (0, vitest_1.expect)(result).not.toBeNull();
            (0, vitest_1.expect)(result.text).toContain("Merge approval noted");
        });
    });
    (0, vitest_1.describe)("thread reply format", () => {
        (0, vitest_1.it)("formatBlocks output is valid for thread replies (same structure)", () => {
            const api = makeMockAPI();
            const slack = new core_1.SlackChannel(config, api);
            const response = {
                text: "Agent update",
                richText: "*Agent update*: working on task",
                actions: [
                    { label: "Stop", action: "stop folia", style: "danger" },
                ],
            };
            const blocks = slack.formatBlocks(response);
            // Thread replies use the same block format, just with thread_ts added
            // Verify the block structure is valid
            (0, vitest_1.expect)(blocks.length).toBe(2);
            const section = blocks[0];
            (0, vitest_1.expect)(section.type).toBe("section");
            const actions = blocks[1];
            (0, vitest_1.expect)(actions.type).toBe("actions");
        });
    });
});
//# sourceMappingURL=slack.test.js.map