import { readFileSync, existsSync } from "node:fs";
import { writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { homedir } from "node:os";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";

export interface JiraAuthConfig {
  baseUrl: string;
  email: string;
  apiToken: string;
}

/**
 * Load Jira auth from environment variables or ~/.opcom/auth/jira.yaml.
 * Env vars take precedence over the YAML file.
 */
export function loadJiraAuth(projectPath: string): JiraAuthConfig | null {
  // Check env vars first
  const baseUrl = process.env.JIRA_BASE_URL;
  const email = process.env.JIRA_EMAIL;
  const apiToken = process.env.JIRA_API_TOKEN;

  if (baseUrl && email && apiToken) {
    return { baseUrl, email, apiToken };
  }

  // Check project-local .opcom/jira.yaml
  const localPath = join(projectPath, ".opcom", "jira.yaml");
  if (existsSync(localPath)) {
    try {
      const raw = readFileSync(localPath, "utf-8");
      const data = parseYaml(raw) as Record<string, unknown>;
      if (data.baseUrl && data.email && data.apiToken) {
        return {
          baseUrl: data.baseUrl as string,
          email: data.email as string,
          apiToken: data.apiToken as string,
        };
      }
    } catch {
      // fall through to global config
    }
  }

  // Check global ~/.opcom/auth/jira.yaml
  const globalPath = join(homedir(), ".opcom", "auth", "jira.yaml");
  if (existsSync(globalPath)) {
    try {
      const raw = readFileSync(globalPath, "utf-8");
      const data = parseYaml(raw) as Record<string, unknown>;
      if (data.baseUrl && data.email && data.apiToken) {
        return {
          baseUrl: data.baseUrl as string,
          email: data.email as string,
          apiToken: data.apiToken as string,
        };
      }
    } catch {
      // fall through
    }
  }

  return null;
}

/**
 * Save Jira auth credentials to ~/.opcom/auth/jira.yaml.
 */
export async function saveJiraAuth(_projectPath: string, config: JiraAuthConfig): Promise<void> {
  const authDir = join(homedir(), ".opcom", "auth");
  await mkdir(authDir, { recursive: true });
  const filePath = join(authDir, "jira.yaml");
  const content = stringifyYaml({
    baseUrl: config.baseUrl,
    email: config.email,
    apiToken: config.apiToken,
  });
  await writeFile(filePath, content, "utf-8");
}

/**
 * Build the Basic auth header value for Jira API calls.
 * Returns `Basic base64(email:apiToken)`.
 */
export function buildAuthHeader(config: JiraAuthConfig): string {
  const credentials = `${config.email}:${config.apiToken}`;
  const encoded = Buffer.from(credentials).toString("base64");
  return `Basic ${encoded}`;
}
