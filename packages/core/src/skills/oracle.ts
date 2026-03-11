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

  // Look for "## Acceptance Criteria" section
  const acMatch = content.match(
    /## Acceptance Criteria\s*\n([\s\S]*?)(?=\n## |\n#[^#]|$)/,
  );
  if (acMatch) {
    const lines = acMatch[1].split("\n");
    for (const line of lines) {
      // Match "- [ ] criterion" or "- [x] criterion" or "- criterion"
      const checkboxMatch = line.match(/^\s*-\s+\[[ x]\]\s+(.+)/);
      const bulletMatch = line.match(/^\s*-\s+(.+)/);
      const match = checkboxMatch ?? bulletMatch;
      if (match) {
        criteria.push(match[1].trim());
      }
    }
  }

  // Also look for standalone checkbox items if no AC section found
  if (criteria.length === 0) {
    const lines = content.split("\n");
    for (const line of lines) {
      const checkboxMatch = line.match(/^\s*-\s+\[[ x]\]\s+(.+)/);
      if (checkboxMatch) {
        criteria.push(checkboxMatch[1].trim());
      }
    }
  }

  return criteria;
}

export function formatOraclePrompt(input: OracleInput): string {
  const sections: string[] = [];

  sections.push("Evaluate whether the following code changes satisfy the acceptance criteria for this ticket.");
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

  sections.push("");
  sections.push("# Instructions");
  sections.push("");
  sections.push("For each acceptance criterion, determine if it is met by the code changes.");
  sections.push("Respond with:");
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

  return sections.join("\n");
}

export function parseOracleResponse(response: string): OracleResult {
  const criteria: OracleResult["criteria"] = [];
  const concerns: string[] = [];

  // Parse criteria section
  const criteriaSection = response.match(
    /## Criteria\s*\n([\s\S]*?)(?=\n## |\n#[^#]|$)/,
  );
  if (criteriaSection) {
    const blocks = criteriaSection[1].split(/(?=- \*?\*?Criterion\*?\*?:)/);
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
