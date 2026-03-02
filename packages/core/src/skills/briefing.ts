import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { scanTickets } from "../detection/tickets.js";
import type { HygieneIssue } from "@opcom/types";

const exec = promisify(execFile);

export interface BriefingInput {
  projects: Array<{
    name: string;
    gitLog: string[];
    ticketChanges: Array<{
      id: string;
      title: string;
      oldStatus: string;
      newStatus: string;
    }>;
    agentSessions: Array<{
      workItemId?: string;
      duration: string;
      outcome: string;
    }>;
  }>;
  since: string;
  hygieneIssues?: HygieneIssue[];
}

export interface Briefing {
  summary: string;
  highlights: string[];
  concerns: string[];
  generatedAt: string;
}

export async function collectBriefingSignals(
  projectPath: string,
  since: Date,
): Promise<BriefingInput["projects"][0]> {
  const name = projectPath.split("/").pop() ?? projectPath;
  const sinceISO = since.toISOString().slice(0, 10);

  // Collect git log
  let gitLog: string[] = [];
  if (existsSync(join(projectPath, ".git"))) {
    try {
      const result = await exec(
        "git",
        ["log", `--since=${sinceISO}`, "--oneline", "--no-decorate"],
        { cwd: projectPath },
      );
      gitLog = result.stdout
        .trim()
        .split("\n")
        .filter((line) => line.length > 0);
    } catch {
      // Git not available or no commits
    }
  }

  // Scan current tickets (we don't have cached state for diff, so report all non-closed)
  let ticketChanges: BriefingInput["projects"][0]["ticketChanges"] = [];
  try {
    const tickets = await scanTickets(projectPath);
    ticketChanges = tickets
      .filter((t) => t.status !== "open")
      .map((t) => ({
        id: t.id,
        title: t.title,
        oldStatus: "open",
        newStatus: t.status,
      }));
  } catch {
    // No ticket system
  }

  // Load completed agent sessions from sessions dir
  const agentSessions: BriefingInput["projects"][0]["agentSessions"] = [];
  // Session loading is best-effort; sessions are stored globally, not per-project
  // The caller can augment this data if they have access to the SessionManager

  return {
    name,
    gitLog,
    ticketChanges,
    agentSessions,
  };
}

export function formatBriefingPrompt(input: BriefingInput): string {
  const sections: string[] = [];

  sections.push(`Generate a concise developer briefing for activity since ${input.since}.`);
  sections.push("");
  sections.push("# Activity Data");

  for (const project of input.projects) {
    sections.push("");
    sections.push(`## Project: ${project.name}`);

    if (project.gitLog.length > 0) {
      sections.push("");
      sections.push("### Recent Commits");
      for (const line of project.gitLog) {
        sections.push(`- ${line}`);
      }
    } else {
      sections.push("");
      sections.push("### Recent Commits");
      sections.push("No commits in this period.");
    }

    if (project.ticketChanges.length > 0) {
      sections.push("");
      sections.push("### Ticket Changes");
      for (const tc of project.ticketChanges) {
        sections.push(`- ${tc.id}: "${tc.title}" changed from ${tc.oldStatus} to ${tc.newStatus}`);
      }
    }

    if (project.agentSessions.length > 0) {
      sections.push("");
      sections.push("### Agent Sessions");
      for (const session of project.agentSessions) {
        const item = session.workItemId ? ` on ${session.workItemId}` : "";
        sections.push(`- ${session.outcome}${item} (${session.duration})`);
      }
    }
  }

  if (input.hygieneIssues && input.hygieneIssues.length > 0) {
    sections.push("");
    sections.push("# Ticket Hygiene");
    sections.push("");
    const errors = input.hygieneIssues.filter((i) => i.severity === "error");
    const warnings = input.hygieneIssues.filter((i) => i.severity === "warning");
    const infos = input.hygieneIssues.filter((i) => i.severity === "info");
    for (const group of [errors, warnings, infos]) {
      for (const issue of group) {
        sections.push(`- [${issue.severity}] ${issue.ticketId}: ${issue.message}`);
      }
    }
  }

  sections.push("");
  sections.push("# Instructions");
  sections.push("");
  sections.push("Respond with the following sections:");
  sections.push("");
  sections.push("## Summary");
  sections.push("A single paragraph overview of what happened.");
  sections.push("");
  sections.push("## Highlights");
  sections.push("Bullet list of key accomplishments or notable changes.");
  sections.push("");
  sections.push("## Concerns");
  sections.push("Bullet list of things that need attention (stale projects, failing tests, blocked tickets, etc.).");
  sections.push("If there are no concerns, write 'None.'");

  return sections.join("\n");
}

export function parseBriefingResponse(response: string): Briefing {
  const summaryMatch = response.match(/## Summary[ \t]*\n([\s\S]*?)(?=\n## |\n#[^#]|$)/);
  const highlightsMatch = response.match(/## Highlights[ \t]*\n([\s\S]*?)(?=\n## |\n#[^#]|$)/);
  const concernsMatch = response.match(/## Concerns[ \t]*\n([\s\S]*?)(?=\n## |\n#[^#]|$)/);

  const summary = summaryMatch
    ? summaryMatch[1].trim()
    : response.trim();

  const highlights = highlightsMatch
    ? extractBulletItems(highlightsMatch[1])
    : [];

  const concerns = concernsMatch
    ? extractBulletItems(concernsMatch[1]).filter(
        (c) => c.toLowerCase() !== "none." && c.toLowerCase() !== "none",
      )
    : [];

  return {
    summary,
    highlights,
    concerns,
    generatedAt: new Date().toISOString(),
  };
}

function extractBulletItems(text: string): string[] {
  return text
    .split("\n")
    .map((line) => line.replace(/^\s*[-*]\s+/, "").trim())
    .filter((line) => line.length > 0);
}

export async function generateBriefing(
  input: BriefingInput,
  llmCall: (prompt: string) => Promise<string>,
): Promise<Briefing> {
  const prompt = formatBriefingPrompt(input);
  const response = await llmCall(prompt);
  return parseBriefingResponse(response);
}
