import { existsSync } from "node:fs";
import { join } from "node:path";
import type { WorkItem, WorkSummary } from "@opcom/types";
import { buildAuthHeader } from "./jira-auth.js";

export interface JiraConfig {
  baseUrl: string;
  projectKey: string;
  email: string;
  apiToken: string;
  customFieldMapping?: Record<string, string>;
}

interface JiraSearchResponse {
  startAt: number;
  maxResults: number;
  total: number;
  issues: JiraIssue[];
}

interface JiraIssue {
  key: string;
  fields: {
    summary: string;
    status: { name: string };
    priority: { name: string } | null;
    issuetype: { name: string };
    labels: string[];
    issuelinks: JiraIssueLink[];
    parent?: { key: string };
    [key: string]: unknown;
  };
}

interface JiraIssueLink {
  type: { name: string; inward: string; outward: string };
  inwardIssue?: { key: string };
  outwardIssue?: { key: string };
}

interface CacheEntry {
  items: WorkItem[];
  fetchedAt: number;
}

const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

// --- Mapping helpers (exported for testing) ---

const STATUS_MAP: Record<string, WorkItem["status"]> = {
  "to do": "open",
  "backlog": "open",
  "open": "open",
  "new": "open",
  "in progress": "in-progress",
  "in review": "in-progress",
  "in development": "in-progress",
  "done": "closed",
  "closed": "closed",
  "resolved": "closed",
  "deferred": "deferred",
  "won't do": "deferred",
  "won't fix": "deferred",
};

const PRIORITY_MAP: Record<string, number> = {
  "highest": 0,
  "critical": 0,
  "blocker": 0,
  "high": 1,
  "medium": 2,
  "normal": 2,
  "low": 3,
  "lowest": 4,
  "trivial": 4,
};

const TYPE_MAP: Record<string, string> = {
  "story": "feature",
  "user story": "feature",
  "new feature": "feature",
  "bug": "bug",
  "defect": "bug",
  "task": "task",
  "sub-task": "task",
  "subtask": "task",
  "epic": "epic",
  "improvement": "feature",
  "spike": "task",
};

export function mapJiraStatus(jiraStatus: string): WorkItem["status"] {
  return STATUS_MAP[jiraStatus.toLowerCase()] ?? "open";
}

export function mapJiraPriority(jiraPriority: string | null): number {
  if (!jiraPriority) return 2; // default to medium
  return PRIORITY_MAP[jiraPriority.toLowerCase()] ?? 2;
}

export function mapJiraType(jiraType: string): string {
  return TYPE_MAP[jiraType.toLowerCase()] ?? "task";
}

/**
 * Extract dependency issue keys from Jira issue links.
 * Looks for "Blocks" / "is blocked by" relationships.
 */
export function extractDeps(issuelinks: JiraIssueLink[]): string[] {
  const deps: string[] = [];
  for (const link of issuelinks) {
    const typeName = link.type.name.toLowerCase();
    // "Blocks" relationship: if this issue is blocked by another, that's a dep
    if (typeName === "blocks" && link.inwardIssue) {
      deps.push(link.inwardIssue.key);
    }
    // Also capture "is blocked by" from outward perspective
    if (typeName === "blocks" && link.outwardIssue) {
      // outwardIssue in a "Blocks" link means this issue blocks the other,
      // which is the reverse. We want issues that block us (inward).
    }
    // Some Jira instances use "Dependency" link type
    if (typeName === "dependency" && link.inwardIssue) {
      deps.push(link.inwardIssue.key);
    }
  }
  return deps;
}

/**
 * Convert a Jira API issue to an opcom WorkItem.
 */
export function jiraIssueToWorkItem(issue: JiraIssue): WorkItem {
  const tags: Record<string, string[]> = {};
  if (issue.fields.labels && issue.fields.labels.length > 0) {
    tags.labels = issue.fields.labels;
  }

  return {
    id: issue.key,
    title: issue.fields.summary,
    status: mapJiraStatus(issue.fields.status.name),
    priority: mapJiraPriority(issue.fields.priority?.name ?? null),
    type: mapJiraType(issue.fields.issuetype.name),
    filePath: "", // Jira issues don't have a local file path
    parent: issue.fields.parent?.key,
    deps: extractDeps(issue.fields.issuelinks ?? []),
    links: [],
    tags,
  };
}

export class JiraAdapter {
  private cache: CacheEntry | null = null;

  constructor(private config: JiraConfig) {}

  /**
   * Detect whether this project is configured for Jira.
   * Checks for JIRA_BASE_URL env var or .opcom/jira.yaml in the project.
   */
  async detect(projectPath: string): Promise<boolean> {
    if (process.env.JIRA_BASE_URL) {
      return true;
    }
    const configPath = join(projectPath, ".opcom", "jira.yaml");
    return existsSync(configPath);
  }

  /**
   * List Jira issues as WorkItems. Handles pagination automatically.
   * Results are cached for 5 minutes.
   */
  async listItems(options?: { maxResults?: number; jql?: string }): Promise<WorkItem[]> {
    // Check cache
    if (this.cache && Date.now() - this.cache.fetchedAt < CACHE_TTL_MS) {
      return this.cache.items;
    }

    const jql = options?.jql ?? `project = ${this.config.projectKey} ORDER BY priority ASC, updated DESC`;
    const pageSize = options?.maxResults ?? 50;
    const allIssues: JiraIssue[] = [];
    let startAt = 0;
    let total = Infinity;

    while (startAt < total) {
      const response = await this.fetchSearchResults(jql, startAt, pageSize);
      total = response.total;
      allIssues.push(...response.issues);
      startAt += response.maxResults;

      // Safety: if we got fewer issues than maxResults, we've reached the end
      if (response.issues.length < response.maxResults) {
        break;
      }
    }

    const items = allIssues.map(jiraIssueToWorkItem);

    // Update cache
    this.cache = { items, fetchedAt: Date.now() };

    return items;
  }

  /**
   * Fetch a single Jira issue by key (e.g., "PROJ-123").
   */
  async getItem(id: string): Promise<WorkItem | null> {
    const url = `${this.config.baseUrl}/rest/api/3/issue/${id}`;
    const authHeader = buildAuthHeader({
      baseUrl: this.config.baseUrl,
      email: this.config.email,
      apiToken: this.config.apiToken,
    });

    const response = await fetch(url, {
      headers: {
        Authorization: authHeader,
        Accept: "application/json",
      },
    });

    if (response.status === 404) {
      return null;
    }

    if (!response.ok) {
      throw new Error(`Jira API error: ${response.status} ${response.statusText}`);
    }

    const issue = (await response.json()) as JiraIssue;
    return jiraIssueToWorkItem(issue);
  }

  /**
   * Summarize work items by status.
   */
  async summarize(): Promise<WorkSummary> {
    const items = await this.listItems();
    return {
      total: items.length,
      open: items.filter((i) => i.status === "open").length,
      inProgress: items.filter((i) => i.status === "in-progress").length,
      closed: items.filter((i) => i.status === "closed").length,
      deferred: items.filter((i) => i.status === "deferred").length,
    };
  }

  /**
   * Clear the in-memory cache, forcing the next listItems() call to re-fetch.
   */
  clearCache(): void {
    this.cache = null;
  }

  /** @internal Exposed for testing */
  _getCacheEntry(): CacheEntry | null {
    return this.cache;
  }

  private async fetchSearchResults(
    jql: string,
    startAt: number,
    maxResults: number,
  ): Promise<JiraSearchResponse> {
    const params = new URLSearchParams({
      jql,
      startAt: String(startAt),
      maxResults: String(maxResults),
    });
    const url = `${this.config.baseUrl}/rest/api/3/search?${params.toString()}`;
    const authHeader = buildAuthHeader({
      baseUrl: this.config.baseUrl,
      email: this.config.email,
      apiToken: this.config.apiToken,
    });

    const response = await fetch(url, {
      headers: {
        Authorization: authHeader,
        Accept: "application/json",
      },
    });

    if (!response.ok) {
      throw new Error(`Jira API error: ${response.status} ${response.statusText}`);
    }

    return (await response.json()) as JiraSearchResponse;
  }
}
