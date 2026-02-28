import type { ProjectStatusSnapshot, AgentSession, WorkItem } from "@opcom/types";
import { parseCommand, formatStatusResponse, formatProjectResponse, formatAgentsResponse } from "./router.js";
import type { ChannelResponse } from "./router.js";

export interface SlackConfig {
  botToken: string;
  signingSecret?: string;
  channels: string[];     // Channel IDs to listen in
}

/**
 * Minimal interface for calling opcom operations from a channel adapter.
 * Decoupled from Station to avoid circular dependency.
 */
export interface OpcomAPI {
  getProjects(): Promise<ProjectStatusSnapshot[]>;
  getAgents(): Promise<AgentSession[]>;
  startAgent(projectId: string, workItemId?: string): Promise<AgentSession>;
  stopAgent(sessionId: string): Promise<void>;
  getTickets(projectId: string): Promise<WorkItem[]>;
}

const SLACK_API = "https://slack.com/api";

export class SlackChannel {
  constructor(
    private config: SlackConfig,
    private api: OpcomAPI,
  ) {}

  /**
   * Convert a ChannelResponse into Slack Block Kit blocks.
   */
  formatBlocks(response: ChannelResponse): unknown[] {
    const blocks: unknown[] = [];

    // Main text as a section block
    const text = response.richText ?? response.text;
    blocks.push({
      type: "section",
      text: {
        type: "mrkdwn",
        text,
      },
    });

    // Action buttons
    if (response.actions && response.actions.length > 0) {
      const elements = response.actions.map((action) => ({
        type: "button",
        text: {
          type: "plain_text",
          text: action.label,
        },
        action_id: action.action.replace(/\s+/g, "_"),
        value: action.action,
        ...(action.style === "danger" ? { style: "danger" } : {}),
        ...(action.style === "primary" ? { style: "primary" } : {}),
      }));

      blocks.push({
        type: "actions",
        elements,
      });
    }

    return blocks;
  }

  /**
   * Send a message to a Slack channel.
   */
  async sendMessage(channel: string, response: ChannelResponse): Promise<void> {
    const blocks = this.formatBlocks(response);

    await fetch(`${SLACK_API}/chat.postMessage`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${this.config.botToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        channel,
        text: response.text,  // Fallback for notifications
        blocks,
      }),
    });
  }

  /**
   * Send a reply in a thread.
   */
  async sendThreadReply(channel: string, threadTs: string, response: ChannelResponse): Promise<void> {
    const blocks = this.formatBlocks(response);

    await fetch(`${SLACK_API}/chat.postMessage`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${this.config.botToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        channel,
        thread_ts: threadTs,
        text: response.text,
        blocks,
      }),
    });
  }

  /**
   * Handle an incoming Slack Events API event.
   * Returns a ChannelResponse if we should reply, or null to ignore.
   */
  async handleEvent(event: Record<string, unknown>): Promise<ChannelResponse | null> {
    // Only handle message events
    if (event.type !== "message") return null;

    // Ignore bot messages to prevent loops
    if (event.bot_id || event.subtype === "bot_message") return null;

    const text = event.text as string | undefined;
    if (!text) return null;

    const command = parseCommand(text);

    switch (command.type) {
      case "status": {
        const [projects, agents] = await Promise.all([
          this.api.getProjects(),
          this.api.getAgents(),
        ]);
        return formatStatusResponse(projects, agents);
      }

      case "status_project": {
        const projects = await this.api.getProjects();
        const project = projects.find((p) => p.id === command.projectId || p.name === command.projectId);
        if (!project) {
          return { text: `Project "${command.projectId}" not found.` };
        }
        const [agents, tickets] = await Promise.all([
          this.api.getAgents(),
          this.api.getTickets(project.id),
        ]);
        return formatProjectResponse(project, agents, tickets);
      }

      case "work": {
        if (!command.projectId) {
          return { text: "Please specify a project. Example: work on myproject/task-id" };
        }
        try {
          const session = await this.api.startAgent(command.projectId, command.workItemId);
          const task = command.workItemId ? `/${command.workItemId}` : "";
          return {
            text: `Starting ${session.backend} on ${command.projectId}${task}...`,
            richText: `Starting \`${session.backend}\` on **${command.projectId}${task}**...\nI'll update this thread with progress.`,
            actions: [
              { label: "Stop Agent", action: `stop ${command.projectId}`, style: "danger" },
            ],
          };
        } catch (err) {
          const msg = err instanceof Error ? err.message : "Unknown error";
          return { text: `Failed to start agent: ${msg}` };
        }
      }

      case "agents": {
        const agents = await this.api.getAgents();
        return formatAgentsResponse(agents);
      }

      case "stop": {
        if (!command.projectId) {
          return { text: "Please specify which project to stop. Example: stop folia" };
        }
        const agents = await this.api.getAgents();
        const agent = agents.find(
          (a) => a.projectId === command.projectId && a.state !== "stopped",
        );
        if (!agent) {
          return { text: `No active agent found for project "${command.projectId}".` };
        }
        await this.api.stopAgent(agent.id);
        return { text: `Stopped agent on ${command.projectId}.` };
      }

      case "approve_merge": {
        return {
          text: "Merge approval noted. (Merge coordination requires an active agent with pending merge.)",
          richText: "Merge approval noted. _(Merge coordination requires an active agent with pending merge.)_",
        };
      }

      case "unknown":
      default:
        return null;  // Don't respond to unrecognized messages
    }
  }
}
