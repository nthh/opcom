import type { IntegrationModule } from "@opcom/types";

function stub(
  id: string,
  category: IntegrationModule["category"],
  name: string,
  description: string,
): IntegrationModule {
  return {
    id,
    category,
    name,
    description,
    async init() {},
    async teardown() {},
  };
}

/** All built-in integration modules. */
export const builtinModules: IntegrationModule[] = [
  // Work sources
  stub("tickets", "work-sources", "Tickets Dir", "Read work items from .tickets/ directories"),
  stub("github-issues", "work-sources", "GitHub Issues", "Sync work items from GitHub Issues"),
  stub("jira", "work-sources", "Jira", "Sync work items from Jira"),

  // Notifications
  stub("desktop", "notifications", "Desktop Notifications", "macOS native notifications"),
  stub("slack-webhook", "notifications", "Slack Webhook", "Post notifications to a Slack webhook"),
  stub("discord-webhook", "notifications", "Discord Webhook", "Post notifications to a Discord webhook"),

  // CI/CD
  stub("github-actions", "cicd", "GitHub Actions", "Poll GitHub Actions for pipeline and deployment status"),

  // Agent backends
  stub("claude-code", "agent-backends", "Claude Code", "Spawn Claude Code agents via subprocess"),
  stub("opencode", "agent-backends", "OpenCode", "Spawn OpenCode agents"),

  // Features
  stub("context-graph", "features", "Context Graph", "Build and query codebase knowledge graphs"),
];

/** Default integrations config — enables everything that was previously always-on. */
export function defaultIntegrationsConfig(): Record<string, string[]> {
  const config: Record<string, string[]> = {};
  for (const mod of builtinModules) {
    if (!config[mod.category]) {
      config[mod.category] = [];
    }
    config[mod.category].push(mod.id);
  }
  return config;
}
