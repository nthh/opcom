import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { WorkItem } from "@opcom/types";

const execFileAsync = promisify(execFile);

// --- Types ---

export interface GitHubConfig {
  owner: string;
  repo: string;
}

export interface CreatePROptions {
  branch: string;
  title: string;
  body: string;
  base?: string;
}

export interface CreatePRResult {
  url: string;
  number: number;
}

interface GitHubIssue {
  number: number;
  title: string;
  state: string;
  labels: Array<{ name: string }>;
  body?: string;
  html_url: string;
}

// --- Label Mapping ---

function mapLabelToPriority(labels: string[]): number {
  for (const label of labels) {
    const lower = label.toLowerCase();
    if (lower === "p0" || lower === "critical") return 0;
    if (lower === "p1" || lower === "urgent") return 1;
    if (lower === "p2") return 2;
    if (lower === "p3") return 3;
  }
  return 2; // default priority
}

function mapLabelToType(labels: string[]): string {
  for (const label of labels) {
    const lower = label.toLowerCase();
    if (lower === "bug") return "bug";
    if (lower === "enhancement" || lower === "feature") return "feature";
    if (lower === "documentation" || lower === "docs") return "docs";
    if (lower === "chore" || lower === "maintenance") return "chore";
    if (lower === "question") return "question";
  }
  return "task"; // default type
}

function issueToWorkItem(issue: GitHubIssue, owner: string, repo: string): WorkItem {
  const labelNames = issue.labels.map((l) => l.name);
  return {
    id: `github-${owner}-${repo}-${issue.number}`,
    title: issue.title,
    status: issue.state === "open" ? "open" : "closed",
    priority: mapLabelToPriority(labelNames),
    type: mapLabelToType(labelNames),
    filePath: issue.html_url,
    deps: [],
    links: [issue.html_url],
    tags: {
      labels: labelNames,
      source: ["github"],
    },
  };
}

// --- GitHubIntegration ---

export class GitHubIntegration {
  constructor(private config: GitHubConfig) {}

  async listIssues(): Promise<WorkItem[]> {
    const { owner, repo } = this.config;

    const { stdout } = await execFileAsync("gh", [
      "api",
      `repos/${owner}/${repo}/issues`,
      "--paginate",
      "-q", ".",
    ], { timeout: 30_000 });

    const issues = JSON.parse(stdout) as GitHubIssue[];

    // Filter out pull requests (GitHub API returns PRs as issues too)
    const realIssues = issues.filter(
      (issue) => !(issue as unknown as Record<string, unknown>)["pull_request"],
    );

    return realIssues.map((issue) => issueToWorkItem(issue, owner, repo));
  }

  async createPR(opts: CreatePROptions): Promise<CreatePRResult> {
    const { owner, repo } = this.config;
    const base = opts.base ?? "main";

    const args = [
      "pr", "create",
      "--repo", `${owner}/${repo}`,
      "--title", opts.title,
      "--body", opts.body,
      "--base", base,
      "--head", opts.branch,
    ];

    const { stdout } = await execFileAsync("gh", args, { timeout: 30_000 });

    // gh pr create outputs the PR URL
    const url = stdout.trim();

    // Extract PR number from URL (e.g., https://github.com/owner/repo/pull/123)
    const match = url.match(/\/pull\/(\d+)/);
    const number = match ? parseInt(match[1], 10) : 0;

    return { url, number };
  }

  async syncIssues(): Promise<{ added: number; updated: number }> {
    const issues = await this.listIssues();

    // In a full implementation, this would compare against existing
    // WorkItems in the local ticket store and update/add as needed.
    // For now, we return counts based on what was fetched.
    return {
      added: issues.length,
      updated: 0,
    };
  }
}

// Exported for testing
export { issueToWorkItem, mapLabelToPriority, mapLabelToType };
export type { GitHubIssue };
