import type { ProjectStatusSnapshot, AgentSession, WorkItem } from "@opcom/types";
import { parseCommand, formatStatusResponse, formatProjectResponse, formatAgentsResponse } from "./router.js";
import type { ChannelResponse } from "./router.js";

export interface DiscordConfig {
  botToken: string;
  guildId?: string;
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

const DISCORD_API = "https://discord.com/api/v10";

export class DiscordChannel {
  constructor(
    private config: DiscordConfig,
    private api: OpcomAPI,
  ) {}

  /**
   * Format a ChannelResponse as a Discord embed object.
   */
  formatEmbed(response: ChannelResponse): unknown {
    // Split text into title (first line) and description (rest)
    const text = response.richText ?? response.text;
    const lines = text.split("\n");
    const title = lines[0] ?? "opcom";
    const description = lines.length > 1 ? lines.slice(1).join("\n") : undefined;

    const embed: Record<string, unknown> = {
      title,
      color: 0x5865F2,  // Discord blurple
    };

    if (description) {
      embed.description = description;
    }

    embed.footer = { text: "opcom" };
    embed.timestamp = new Date().toISOString();

    return embed;
  }

  /**
   * Send a message to a Discord channel with an embed.
   */
  async sendMessage(channelId: string, response: ChannelResponse): Promise<void> {
    const embed = this.formatEmbed(response);

    const body: Record<string, unknown> = {
      embeds: [embed],
    };

    // Add action buttons as component rows if present
    if (response.actions && response.actions.length > 0) {
      const buttons = response.actions.map((action, i) => ({
        type: 2, // Button
        style: action.style === "danger" ? 4 : 1,  // 4=Danger, 1=Primary
        label: action.label,
        custom_id: `opcom_${action.action.replace(/\s+/g, "_")}_${i}`,
      }));

      body.components = [{
        type: 1, // ActionRow
        components: buttons,
      }];
    }

    await fetch(`${DISCORD_API}/channels/${channelId}/messages`, {
      method: "POST",
      headers: {
        "Authorization": `Bot ${this.config.botToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });
  }

  /**
   * Handle an incoming Discord message (from Gateway or webhook).
   * Returns a ChannelResponse if we should reply, or null to ignore.
   */
  async handleMessage(message: Record<string, unknown>): Promise<ChannelResponse | null> {
    // Ignore bot messages
    const author = message.author as Record<string, unknown> | undefined;
    if (author?.bot) return null;

    const content = message.content as string | undefined;
    if (!content) return null;

    const command = parseCommand(content);

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
            richText: `Starting \`${session.backend}\` on **${command.projectId}${task}**...`,
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
          text: "Merge approval noted.",
          richText: "Merge approval noted.",
        };
      }

      case "unknown":
      default:
        return null;
    }
  }
}
