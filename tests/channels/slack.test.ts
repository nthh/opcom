import { describe, it, expect, vi, beforeEach } from "vitest";
import { SlackChannel } from "@opcom/core";
import type { SlackConfig } from "@opcom/core";
import type { ChannelResponse } from "@opcom/core";
import type { ProjectStatusSnapshot, AgentSession, WorkItem } from "@opcom/types";

function makeProject(overrides: Partial<ProjectStatusSnapshot> = {}): ProjectStatusSnapshot {
  return {
    id: "folia",
    name: "folia",
    path: "/home/user/projects/folia",
    git: { branch: "main", clean: true, remote: "origin" },
    workSummary: { total: 10, open: 5, inProgress: 2, closed: 3, deferred: 0 },
    ...overrides,
  };
}

function makeAgent(overrides: Partial<AgentSession> = {}): AgentSession {
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

function makeWorkItem(overrides: Partial<WorkItem> = {}): WorkItem {
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
    getProjects: vi.fn<() => Promise<ProjectStatusSnapshot[]>>().mockResolvedValue([makeProject()]),
    getAgents: vi.fn<() => Promise<AgentSession[]>>().mockResolvedValue([makeAgent()]),
    startAgent: vi.fn<(projectId: string, workItemId?: string) => Promise<AgentSession>>().mockResolvedValue(makeAgent()),
    stopAgent: vi.fn<(sessionId: string) => Promise<void>>().mockResolvedValue(undefined),
    getTickets: vi.fn<(projectId: string) => Promise<WorkItem[]>>().mockResolvedValue([makeWorkItem()]),
  };
}

const config: SlackConfig = {
  botToken: "xoxb-test-token",
  signingSecret: "test-secret",
  channels: ["C12345"],
};

describe("SlackChannel", () => {
  describe("formatBlocks", () => {
    it("produces a section block with mrkdwn text", () => {
      const api = makeMockAPI();
      const slack = new SlackChannel(config, api);

      const response: ChannelResponse = {
        text: "Hello world",
        richText: "*Hello world*",
      };

      const blocks = slack.formatBlocks(response);
      expect(blocks.length).toBeGreaterThanOrEqual(1);

      const section = blocks[0] as Record<string, unknown>;
      expect(section.type).toBe("section");

      const textBlock = section.text as Record<string, unknown>;
      expect(textBlock.type).toBe("mrkdwn");
      expect(textBlock.text).toBe("*Hello world*");
    });

    it("uses plain text when richText is not provided", () => {
      const api = makeMockAPI();
      const slack = new SlackChannel(config, api);

      const response: ChannelResponse = { text: "Plain text" };
      const blocks = slack.formatBlocks(response);

      const section = blocks[0] as Record<string, unknown>;
      const textBlock = section.text as Record<string, unknown>;
      expect(textBlock.text).toBe("Plain text");
    });

    it("includes action buttons when actions are present", () => {
      const api = makeMockAPI();
      const slack = new SlackChannel(config, api);

      const response: ChannelResponse = {
        text: "Test",
        actions: [
          { label: "Stop Agent", action: "stop folia", style: "danger" },
          { label: "View Status", action: "status folia", style: "primary" },
        ],
      };

      const blocks = slack.formatBlocks(response);
      expect(blocks.length).toBe(2);

      const actionsBlock = blocks[1] as Record<string, unknown>;
      expect(actionsBlock.type).toBe("actions");

      const elements = actionsBlock.elements as Array<Record<string, unknown>>;
      expect(elements.length).toBe(2);
      expect(elements[0].type).toBe("button");
      expect((elements[0].text as Record<string, unknown>).text).toBe("Stop Agent");
      expect(elements[0].style).toBe("danger");
      expect(elements[0].action_id).toBe("stop_folia");
      expect(elements[0].value).toBe("stop folia");
    });

    it("does not include actions block when no actions", () => {
      const api = makeMockAPI();
      const slack = new SlackChannel(config, api);

      const response: ChannelResponse = { text: "No actions" };
      const blocks = slack.formatBlocks(response);
      expect(blocks.length).toBe(1);
    });
  });

  describe("handleEvent", () => {
    it("handles a status message event", async () => {
      const api = makeMockAPI();
      const slack = new SlackChannel(config, api);

      const result = await slack.handleEvent({
        type: "message",
        text: "status",
        user: "U12345",
        channel: "C12345",
      });

      expect(result).not.toBeNull();
      expect(result!.text).toContain("folia");
      expect(api.getProjects).toHaveBeenCalled();
      expect(api.getAgents).toHaveBeenCalled();
    });

    it("handles a status_project message event", async () => {
      const api = makeMockAPI();
      const slack = new SlackChannel(config, api);

      const result = await slack.handleEvent({
        type: "message",
        text: "status folia",
        user: "U12345",
        channel: "C12345",
      });

      expect(result).not.toBeNull();
      expect(result!.text).toContain("folia");
      expect(api.getTickets).toHaveBeenCalledWith("folia");
    });

    it("handles a work command", async () => {
      const api = makeMockAPI();
      const slack = new SlackChannel(config, api);

      const result = await slack.handleEvent({
        type: "message",
        text: "work on folia/tile-server-perf",
        user: "U12345",
        channel: "C12345",
      });

      expect(result).not.toBeNull();
      expect(result!.text).toContain("Starting");
      expect(api.startAgent).toHaveBeenCalledWith("folia", "tile-server-perf");
    });

    it("handles an agents command", async () => {
      const api = makeMockAPI();
      const slack = new SlackChannel(config, api);

      const result = await slack.handleEvent({
        type: "message",
        text: "agents",
        user: "U12345",
        channel: "C12345",
      });

      expect(result).not.toBeNull();
      expect(result!.text).toContain("1 agent active");
    });

    it("handles a stop command", async () => {
      const api = makeMockAPI();
      const slack = new SlackChannel(config, api);

      const result = await slack.handleEvent({
        type: "message",
        text: "stop folia",
        user: "U12345",
        channel: "C12345",
      });

      expect(result).not.toBeNull();
      expect(result!.text).toContain("Stopped agent on folia");
      expect(api.stopAgent).toHaveBeenCalledWith("agent-1");
    });

    it("returns null for non-message events", async () => {
      const api = makeMockAPI();
      const slack = new SlackChannel(config, api);

      const result = await slack.handleEvent({
        type: "reaction_added",
        user: "U12345",
      });

      expect(result).toBeNull();
    });

    it("ignores bot messages", async () => {
      const api = makeMockAPI();
      const slack = new SlackChannel(config, api);

      const result = await slack.handleEvent({
        type: "message",
        text: "status",
        bot_id: "B12345",
      });

      expect(result).toBeNull();
    });

    it("ignores bot_message subtype", async () => {
      const api = makeMockAPI();
      const slack = new SlackChannel(config, api);

      const result = await slack.handleEvent({
        type: "message",
        subtype: "bot_message",
        text: "status",
      });

      expect(result).toBeNull();
    });

    it("returns null for unknown commands", async () => {
      const api = makeMockAPI();
      const slack = new SlackChannel(config, api);

      const result = await slack.handleEvent({
        type: "message",
        text: "what is the meaning of life",
        user: "U12345",
      });

      expect(result).toBeNull();
    });

    it("returns error for not-found project", async () => {
      const api = makeMockAPI();
      api.getProjects.mockResolvedValue([]);
      const slack = new SlackChannel(config, api);

      const result = await slack.handleEvent({
        type: "message",
        text: "status nonexistent",
        user: "U12345",
      });

      expect(result).not.toBeNull();
      expect(result!.text).toContain("not found");
    });

    it("handles stop when no active agent exists", async () => {
      const api = makeMockAPI();
      api.getAgents.mockResolvedValue([]);
      const slack = new SlackChannel(config, api);

      const result = await slack.handleEvent({
        type: "message",
        text: "stop folia",
        user: "U12345",
      });

      expect(result).not.toBeNull();
      expect(result!.text).toContain("No active agent");
    });

    it("handles approve merge command", async () => {
      const api = makeMockAPI();
      const slack = new SlackChannel(config, api);

      const result = await slack.handleEvent({
        type: "message",
        text: "approve merge",
        user: "U12345",
      });

      expect(result).not.toBeNull();
      expect(result!.text).toContain("Merge approval noted");
    });
  });

  describe("thread reply format", () => {
    it("formatBlocks output is valid for thread replies (same structure)", () => {
      const api = makeMockAPI();
      const slack = new SlackChannel(config, api);

      const response: ChannelResponse = {
        text: "Agent update",
        richText: "*Agent update*: working on task",
        actions: [
          { label: "Stop", action: "stop folia", style: "danger" },
        ],
      };

      const blocks = slack.formatBlocks(response);

      // Thread replies use the same block format, just with thread_ts added
      // Verify the block structure is valid
      expect(blocks.length).toBe(2);

      const section = blocks[0] as Record<string, unknown>;
      expect(section.type).toBe("section");

      const actions = blocks[1] as Record<string, unknown>;
      expect(actions.type).toBe("actions");
    });
  });
});
