import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

// --- Types ---

export type NotificationTrigger =
  | "agent_completed"
  | "agent_error"
  | "merge_failed"
  | "all_agents_idle";

export type NotificationBackend =
  | { type: "desktop" }
  | { type: "slack_webhook"; url: string }
  | { type: "discord_webhook"; url: string };

export interface NotificationConfig {
  enabled: boolean;
  triggers: NotificationTrigger[];
  backends: NotificationBackend[];
}

export interface Notification {
  trigger: NotificationTrigger;
  title: string;
  body: string;
  timestamp: string;
}

// --- Helpers ---

function escapeAppleScript(text: string): string {
  // Escape backslashes and double quotes for osascript
  return text.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

async function httpPost(url: string, payload: string): Promise<void> {
  // Use curl since we want to avoid adding HTTP client dependencies
  await execFileAsync("curl", [
    "-s",
    "-X", "POST",
    "-H", "Content-Type: application/json",
    "-d", payload,
    url,
  ], { timeout: 15_000 });
}

// --- NotificationManager ---

export class NotificationManager {
  constructor(private config: NotificationConfig) {}

  async notify(notification: Notification): Promise<void> {
    if (!this.config.enabled) return;

    // Check if this trigger is in the configured triggers
    if (!this.config.triggers.includes(notification.trigger)) return;

    // Send to all backends, collecting errors (don't let one failure block others)
    const errors: Error[] = [];

    for (const backend of this.config.backends) {
      try {
        switch (backend.type) {
          case "desktop":
            await this.sendDesktop(notification);
            break;
          case "slack_webhook":
            await this.sendSlackWebhook(notification, backend.url);
            break;
          case "discord_webhook":
            await this.sendDiscordWebhook(notification, backend.url);
            break;
        }
      } catch (err: unknown) {
        const error = err instanceof Error ? err : new Error(String(err));
        errors.push(error);
      }
    }

    if (errors.length > 0) {
      console.error(
        `[notifications] ${errors.length} backend(s) failed:`,
        errors.map((e) => e.message).join(", "),
      );
    }
  }

  private async sendDesktop(notification: Notification): Promise<void> {
    const title = escapeAppleScript(notification.title);
    const body = escapeAppleScript(notification.body);

    await execFileAsync("osascript", [
      "-e",
      `display notification "${body}" with title "${title}"`,
    ], { timeout: 5_000 });
  }

  private async sendSlackWebhook(notification: Notification, url: string): Promise<void> {
    const payload = JSON.stringify({
      text: `${notification.title}\n${notification.body}`,
    });
    await httpPost(url, payload);
  }

  private async sendDiscordWebhook(notification: Notification, url: string): Promise<void> {
    const payload = JSON.stringify({
      content: `**${notification.title}**\n${notification.body}`,
    });
    await httpPost(url, payload);
  }
}
