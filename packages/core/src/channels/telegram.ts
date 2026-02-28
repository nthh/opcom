import type { ProjectStatusSnapshot, AgentSession, WorkItem } from "@opcom/types";
import { parseCommand, formatStatusResponse, formatProjectResponse, formatAgentsResponse } from "./router.js";
import type { ChannelResponse } from "./router.js";

export interface TelegramConfig {
  botToken: string;
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

const TELEGRAM_API = "https://api.telegram.org";

export class TelegramChannel {
  constructor(
    private config: TelegramConfig,
    private api: OpcomAPI,
  ) {}

  /**
   * Format a ChannelResponse for Telegram using MarkdownV2.
   * Telegram uses its own flavour of markdown:
   *   *bold*, _italic_, `code`, ```pre```
   */
  formatMessage(response: ChannelResponse): string {
    // Use richText if available (already markdown-formatted),
    // otherwise fall back to plain text.
    return response.richText ?? response.text;
  }

  /**
   * Send a message to a Telegram chat.
   */
  async sendMessage(chatId: string | number, response: ChannelResponse): Promise<void> {
    const text = this.formatMessage(response);

    await fetch(`${TELEGRAM_API}/bot${this.config.botToken}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        text,
        parse_mode: "Markdown",
      }),
    });
  }

  /**
   * Handle an incoming Telegram update (webhook or polling).
   * Returns a ChannelResponse if we should reply, or null to ignore.
   */
  async handleUpdate(update: Record<string, unknown>): Promise<ChannelResponse | null> {
    const message = update.message as Record<string, unknown> | undefined;
    if (!message) return null;

    const text = message.text as string | undefined;
    if (!text) return null;

    // Strip leading slash for bot commands (e.g. /status -> status)
    const cleaned = text.startsWith("/") ? text.slice(1) : text;
    const command = parseCommand(cleaned);

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
            richText: `Starting \`${session.backend}\` on *${command.projectId}${task}*...`,
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
