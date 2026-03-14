import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import type { WorkItem } from "@opcom/types";

const exec = promisify(execFile);

export interface OracleInput {
  ticket: WorkItem;
  spec?: string;
  gitDiff: string;
  testResults?: string;
  acceptanceCriteria: string[];
  fileListing?: string;
  screenshots?: string[];   // absolute paths to screenshots captured during E2E tests
}

export interface OracleResult {
  passed: boolean;
  criteria: Array<{
    criterion: string;
    met: boolean;
    reasoning: string;
  }>;
  concerns: string[];
}

export async function collectOracleInputs(
  projectPath: string,
  sessionId: string,
  ticket: WorkItem,
  opts?: {
    worktreePath?: string;
    worktreeBranch?: string;
  },
): Promise<OracleInput> {
  // Get git diff for the session's changes.
  // In worktree mode, diff the worktree branch against main.
  // Otherwise, diff HEAD~1 on the project path.
  const diffCwd = opts?.worktreePath ?? projectPath;
  let gitDiff = "";

  if (opts?.worktreeBranch) {
    // Worktree mode: diff base..branch to capture all agent changes
    try {
      const result = await exec("git", ["diff", `main...${opts.worktreeBranch}`], {
        cwd: diffCwd,
        maxBuffer: 10 * 1024 * 1024,
      });
      gitDiff = result.stdout;
    } catch {
      // Fallback: diff HEAD against main
      try {
        const result = await exec("git", ["diff", "main...HEAD"], {
          cwd: diffCwd,
          maxBuffer: 10 * 1024 * 1024,
        });
        gitDiff = result.stdout;
      } catch {
        // No diff available
      }
    }
  } else {
    try {
      const result = await exec("git", ["diff", "HEAD~1"], {
        cwd: diffCwd,
        maxBuffer: 10 * 1024 * 1024,
      });
      gitDiff = result.stdout;
    } catch {
      try {
        const result = await exec("git", ["diff", "main"], {
          cwd: diffCwd,
          maxBuffer: 10 * 1024 * 1024,
        });
        gitDiff = result.stdout;
      } catch {
        // No diff available
      }
    }
  }

  // Collect file listing so the oracle knows what exists in the worktree,
  // not just what changed. This prevents false negatives when criteria
  // reference files that pre-exist on main (unchanged by the branch).
  let fileListing = "";
  try {
    const result = await exec("git", ["ls-files"], {
      cwd: diffCwd,
      maxBuffer: 5 * 1024 * 1024,
    });
    fileListing = result.stdout;
  } catch {
    // No file listing available
  }

  // Read spec file if referenced in ticket.
  // Resolve relative links against the project path.
  let spec: string | undefined;
  if (ticket.links.length > 0) {
    for (const link of ticket.links) {
      if (!link.endsWith(".md")) continue;
      const absLink = link.startsWith("/") ? link : join(projectPath, link);
      if (existsSync(absLink)) {
        try {
          spec = await readFile(absLink, "utf-8");
          break;
        } catch {
          // Skip unreadable spec
        }
      }
    }
  }

  // Extract acceptance criteria from ticket file
  const acceptanceCriteria = await extractAcceptanceCriteria(ticket.filePath);

  return {
    ticket,
    spec,
    gitDiff,
    acceptanceCriteria,
    fileListing: fileListing || undefined,
  };
}

export async function extractAcceptanceCriteria(
  ticketFilePath: string,
): Promise<string[]> {
  if (!existsSync(ticketFilePath)) return [];

  try {
    const content = await readFile(ticketFilePath, "utf-8");
    return extractCriteriaFromMarkdown(content);
  } catch {
    return [];
  }
}

export function extractCriteriaFromMarkdown(content: string): string[] {
  const criteria: string[] = [];

  // Look for dedicated criteria section:
  //   ## Acceptance Criteria, ## Oracle (...), or bold **Oracle (...):** marker
  const acMatch = content.match(
    /(?:## (?:Acceptance Criteria|Oracle(?:\s*\([^)]*\))?)|\*\*Oracle(?:\s*\([^)]*\))?\s*:\s*\*\*)\s*\n([\s\S]*?)(?=\n## |\n#[^#]|\n---|\n\*\*[A-Z]|$)/,
  );
  if (acMatch) {
    const lines = acMatch[1].split("\n");
    for (const line of lines) {
      const checkboxMatch = line.match(/^\s*-\s+\[[ x]\]\s+(.+)/);
      const bulletMatch = line.match(/^\s*-\s+(.+)/);
      const match = checkboxMatch ?? bulletMatch;
      if (match) {
        criteria.push(match[1].trim());
      }
    }
  }

  // Also collect task-level checkboxes from the rest of the document.
  // These provide granular coverage beyond the oracle section.
  // Skip non-criteria items (gaps, questions, notes).
  const lines = content.split("\n");
  const oracleSet = new Set(criteria);
  for (const line of lines) {
    const checkboxMatch = line.match(/^\s*-\s+\[[ x]\]\s+(.+)/);
    if (checkboxMatch) {
      const text = checkboxMatch[1].trim();
      // Skip items already captured from oracle section
      if (oracleSet.has(text)) continue;
      // Skip non-criteria items (gaps, open questions, notes)
      if (/^\*\*(?:Gap|Question|Note|TODO)\b/i.test(text)) continue;
      criteria.push(text);
    }
  }

  return criteria;
}

export function formatOraclePrompt(input: OracleInput): string {
  const sections: string[] = [];

  sections.push("Evaluate whether the following code changes satisfy the acceptance criteria for this ticket.");
  sections.push("Criteria describe intended outcomes. Evaluate whether the code **addresses** each criterion — i.e., implements the logic, pipeline, configuration, or tests needed to achieve it.");
  sections.push("If a criterion requires an external action (downloading data, uploading to cloud storage, registering with a service) that cannot happen inside a code diff, mark it MET when the code provides a working implementation that handles that action (scripts, pipeline functions, CLI commands, config).");
  sections.push("Do NOT mark a criterion unmet solely because an external operation was not literally executed in the diff.");
  sections.push("");
  sections.push("# Ticket");
  sections.push(`- ID: ${input.ticket.id}`);
  sections.push(`- Title: ${input.ticket.title}`);
  sections.push(`- Status: ${input.ticket.status}`);

  if (input.acceptanceCriteria.length > 0) {
    sections.push("");
    sections.push("# Acceptance Criteria");
    for (const criterion of input.acceptanceCriteria) {
      sections.push(`- ${criterion}`);
    }
  }

  if (input.spec) {
    sections.push("");
    sections.push("# Specification");
    sections.push(input.spec);
  }

  if (input.fileListing) {
    sections.push("");
    sections.push("# Repository File Listing");
    sections.push("These files exist in the worktree (not just changed files — the full tracked tree).");
    sections.push("Use this to verify file-existence criteria even when a file is unchanged from main.");
    // Truncate very long listings — keep paths matching common criteria patterns
    const maxListingLength = 10000;
    if (input.fileListing.length > maxListingLength) {
      sections.push(input.fileListing.slice(0, maxListingLength));
      sections.push(`... (truncated, ${input.fileListing.length - maxListingLength} chars omitted)`);
    } else {
      sections.push(input.fileListing);
    }
  }

  sections.push("");
  sections.push("# Code Changes (Git Diff)");
  if (input.gitDiff.length > 0) {
    // Truncate very long diffs
    const maxDiffLength = 50000;
    if (input.gitDiff.length > maxDiffLength) {
      sections.push(input.gitDiff.slice(0, maxDiffLength));
      sections.push(`... (truncated, ${input.gitDiff.length - maxDiffLength} chars omitted)`);
    } else {
      sections.push(input.gitDiff);
    }
  } else {
    sections.push("No changes detected.");
  }

  if (input.testResults) {
    sections.push("");
    sections.push("# Test Results");
    sections.push(input.testResults);
  }

  if (input.screenshots && input.screenshots.length > 0) {
    sections.push("");
    sections.push("# Screenshots");
    sections.push("The following screenshots were captured during E2E browser testing.");
    sections.push("Use the Read tool to view each screenshot, then evaluate visual/UI acceptance criteria (layout, rendering, appearance).");
    sections.push("");
    for (const path of input.screenshots) {
      sections.push(`- ${path}`);
    }
  }

  sections.push("");
  sections.push("# Instructions");
  sections.push("");
  sections.push("You MUST respond with ONLY the structured evaluation below. Do NOT write analysis, reasoning, or discussion before the structured output. Start your response immediately with '## Criteria' — nothing else before it.");
  sections.push("");
  sections.push("## Criteria");
  sections.push("For each criterion, use this EXACT format:");
  sections.push("- **Criterion**: <the criterion text>");
  sections.push("  - **Met**: YES or NO");
  sections.push("  - **Reasoning**: <brief explanation>");
  sections.push("");
  sections.push("## Concerns");
  sections.push("List any concerns about the changes (out-of-scope modifications, missing tests, code quality issues).");
  sections.push("If there are no concerns, write 'None.'");
  sections.push("");
  sections.push("Remember: Start your response with '## Criteria' immediately. No preamble.");

  return sections.join("\n");
}

export function parseOracleResponse(response: string): OracleResult {
  const criteria: OracleResult["criteria"] = [];
  const concerns: string[] = [];

  // Parse criteria section — try ## Criteria header first, then fall back
  // to scanning the entire response for Criterion/Met/Reasoning blocks.
  const criteriaSection = response.match(
    /## Criteria\s*\n([\s\S]*?)(?=\n## |\n#[^#]|$)/,
  );
  const criteriaText = criteriaSection ? criteriaSection[1] : response;
  const blocks = criteriaText.split(/(?=- \*?\*?Criterion\*?\*?:)/);
  for (const block of blocks) {
    const criterionMatch = block.match(/\*?\*?Criterion\*?\*?:\s*(.+)/);
    const metMatch = block.match(/\*?\*?Met\*?\*?:\s*(YES|NO|yes|no|Yes|No)/);
    const reasoningMatch = block.match(/\*?\*?Reasoning\*?\*?:\s*(.+)/);

    if (criterionMatch) {
      criteria.push({
        criterion: criterionMatch[1].trim(),
        met: metMatch ? metMatch[1].toUpperCase() === "YES" : false,
        reasoning: reasoningMatch?.[1]?.trim() ?? "",
      });
    }
  }

  // Parse concerns section
  const concernsSection = response.match(
    /## Concerns\s*\n([\s\S]*?)(?=\n## |\n#[^#]|$)/,
  );
  if (concernsSection) {
    const lines = concernsSection[1].split("\n");
    for (const line of lines) {
      const bulletMatch = line.match(/^\s*[-*]\s+(.+)/);
      if (bulletMatch) {
        const text = bulletMatch[1].trim();
        if (text.toLowerCase() !== "none." && text.toLowerCase() !== "none") {
          concerns.push(text);
        }
      }
    }
  }

  // Overall pass: all criteria must be met
  const passed = criteria.length > 0 && criteria.every((c) => c.met);

  return {
    passed,
    criteria,
    concerns,
  };
}

export async function runOracle(
  input: OracleInput,
  llmCall: (prompt: string) => Promise<string>,
): Promise<OracleResult> {
  const prompt = formatOraclePrompt(input);
  const response = await llmCall(prompt);
  return parseOracleResponse(response);
}
