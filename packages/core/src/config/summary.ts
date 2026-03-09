import { readFile, writeFile, rename, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname } from "node:path";
import { summaryPath, summariesDir } from "./paths.js";

/**
 * Read the project summary markdown file.
 * Returns null if no summary exists.
 */
export async function readProjectSummary(projectId: string): Promise<string | null> {
  const path = summaryPath(projectId);
  if (!existsSync(path)) return null;
  try {
    return await readFile(path, "utf-8");
  } catch {
    return null;
  }
}

/**
 * Write a project summary using atomic write (tmp + rename).
 * Prevents corruption if the process crashes mid-write.
 */
export async function writeProjectSummary(projectId: string, content: string): Promise<void> {
  const path = summaryPath(projectId);
  const tmpPath = path + ".tmp";
  await mkdir(dirname(path), { recursive: true });
  await writeFile(tmpPath, content, "utf-8");
  await rename(tmpPath, path);
}

export interface SummaryUpdate {
  completedTicketId: string;
  completedTicketTitle: string;
  /** Brief description of what was done */
  detail?: string;
}

/**
 * Update a project summary after a step completes.
 * Appends the completed ticket to "Recent Completions" and updates timestamps.
 * Creates a new summary if none exists.
 */
export async function updateProjectSummary(
  projectId: string,
  projectName: string,
  update: SummaryUpdate,
): Promise<void> {
  const existing = await readProjectSummary(projectId);
  const now = new Date().toISOString();
  const completionLine = `- ${update.completedTicketId}: ${update.completedTicketTitle}${update.detail ? ` — ${update.detail}` : ""} (${now})`;

  let content: string;

  if (existing) {
    content = appendCompletion(existing, completionLine, now);
  } else {
    content = createInitialSummary(projectName, completionLine, now);
  }

  await writeProjectSummary(projectId, content);
}

/**
 * Create an initial summary from a project description.
 * Used during `opcom init`.
 */
export function createInitialSummaryFromDescription(
  projectName: string,
  description?: string,
): string {
  const lines: string[] = [];
  lines.push(`# ${projectName} — Project Summary`);
  lines.push("");
  lines.push("## Current State");
  lines.push(`- Last activity: ${new Date().toISOString()}`);
  if (description) {
    lines.push("");
    lines.push(`## About`);
    lines.push(description);
  }
  lines.push("");
  lines.push("## Recent Completions");
  lines.push("(none yet)");
  lines.push("");
  lines.push("## Key Decisions");
  lines.push("(none yet)");
  lines.push("");
  lines.push("## Open Questions");
  lines.push("(none yet)");
  lines.push("");
  return lines.join("\n");
}

function createInitialSummary(projectName: string, completionLine: string, timestamp: string): string {
  const lines: string[] = [];
  lines.push(`# ${projectName} — Project Summary`);
  lines.push("");
  lines.push("## Current State");
  lines.push(`- Last activity: ${timestamp}`);
  lines.push("");
  lines.push("## Recent Completions");
  lines.push(completionLine);
  lines.push("");
  lines.push("## Key Decisions");
  lines.push("(none yet)");
  lines.push("");
  lines.push("## Open Questions");
  lines.push("(none yet)");
  lines.push("");
  return lines.join("\n");
}

/**
 * Append a completion line to an existing summary.
 * Updates "Last activity" timestamp and adds to "Recent Completions".
 * Keeps at most 20 recent completions (trims oldest).
 */
function appendCompletion(existing: string, completionLine: string, timestamp: string): string {
  // Update last activity timestamp
  let content = existing.replace(
    /- Last activity: .+/,
    `- Last activity: ${timestamp}`,
  );

  // If the replacement didn't match (no "Last activity" line), inject it after "## Current State"
  if (content === existing && !existing.includes("Last activity")) {
    content = content.replace(
      /## Current State\n/,
      `## Current State\n- Last activity: ${timestamp}\n`,
    );
  }

  // Insert new completion at the top of "Recent Completions" section
  const recentHeader = "## Recent Completions";
  const recentIdx = content.indexOf(recentHeader);
  if (recentIdx === -1) {
    // No section — append one at the end
    content = content.trimEnd() + "\n\n## Recent Completions\n" + completionLine + "\n";
  } else {
    const afterHeader = recentIdx + recentHeader.length;
    const nextLine = content.indexOf("\n", afterHeader);
    if (nextLine === -1) {
      content += "\n" + completionLine + "\n";
    } else {
      // Check if the existing content is "(none yet)" and replace it
      const restOfSection = content.slice(nextLine + 1);
      if (restOfSection.trimStart().startsWith("(none yet)")) {
        const noneIdx = content.indexOf("(none yet)", nextLine);
        content = content.slice(0, noneIdx) + completionLine + content.slice(noneIdx + "(none yet)".length);
      } else {
        // Insert after the header line
        content = content.slice(0, nextLine + 1) + completionLine + "\n" + content.slice(nextLine + 1);
      }
    }

    // Trim to 20 most recent completions
    content = trimCompletions(content, 20);
  }

  return content;
}

/**
 * Keep only the N most recent completion lines in the "Recent Completions" section.
 */
function trimCompletions(content: string, max: number): string {
  const recentHeader = "## Recent Completions";
  const recentIdx = content.indexOf(recentHeader);
  if (recentIdx === -1) return content;

  const afterHeader = content.indexOf("\n", recentIdx);
  if (afterHeader === -1) return content;

  // Find the end of the section (next ## header or end of file)
  const nextSection = content.indexOf("\n## ", afterHeader + 1);
  const sectionEnd = nextSection === -1 ? content.length : nextSection;

  const sectionContent = content.slice(afterHeader + 1, sectionEnd);
  const lines = sectionContent.split("\n").filter((l) => l.startsWith("- "));

  if (lines.length <= max) return content;

  const trimmed = lines.slice(0, max).join("\n") + "\n";
  return content.slice(0, afterHeader + 1) + trimmed + content.slice(sectionEnd);
}
