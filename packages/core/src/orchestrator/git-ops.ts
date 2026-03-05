import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { Changeset, FileChange, FileChangeStatus } from "@opcom/types";
import { createLogger } from "../logger.js";

const execFileAsync = promisify(execFile);
const log = createLogger("git-ops");

/**
 * Commit all changes in a project directory after a step completes.
 * Non-fatal: logs a warning on failure, never throws.
 */
export async function commitStepChanges(
  projectPath: string,
  ticketId: string,
): Promise<boolean> {
  try {
    // Check if there are changes to commit
    const { stdout: status } = await execFileAsync("git", ["status", "--porcelain"], {
      cwd: projectPath,
    });

    if (!status.trim()) {
      log.debug("no changes to commit", { projectPath, ticketId });
      return false;
    }

    // Stage all changes
    await execFileAsync("git", ["add", "-A"], { cwd: projectPath });

    // Commit
    await execFileAsync("git", ["commit", "-m", `opcom: complete ${ticketId}`], {
      cwd: projectPath,
    });

    log.info("committed step changes", { projectPath, ticketId });
    return true;
  } catch (err) {
    log.warn("auto-commit failed", { projectPath, ticketId, error: String(err) });
    return false;
  }
}

/**
 * Capture changeset metadata for commits on a branch relative to a base.
 * Works for both worktree (branch-based) and legacy (last-commit) modes.
 */
export async function captureChangeset(
  projectPath: string,
  opts: {
    sessionId: string;
    ticketId: string;
    projectId: string;
    branch?: string;   // for worktree mode: compare base..branch
    baseBranch?: string;
    commitSha?: string; // for legacy mode: single commit
  },
): Promise<Changeset | null> {
  try {
    let commitShas: string[];
    let diffArgs: string[];

    if (opts.branch) {
      // Worktree mode: get all commits on the branch since it diverged
      const base = opts.baseBranch ?? "HEAD";
      const { stdout: logOut } = await execFileAsync(
        "git",
        ["log", `${base}..${opts.branch}`, "--format=%H"],
        { cwd: projectPath },
      );
      commitShas = logOut.trim().split("\n").filter(Boolean);
      if (commitShas.length === 0) return null;

      diffArgs = ["diff", "--numstat", `${base}...${opts.branch}`];
    } else if (opts.commitSha) {
      // Legacy mode: single commit
      commitShas = [opts.commitSha];
      diffArgs = ["diff", "--numstat", `${opts.commitSha}~1`, opts.commitSha];
    } else {
      // Fallback: last commit
      const { stdout: sha } = await execFileAsync(
        "git", ["rev-parse", "HEAD"], { cwd: projectPath },
      );
      commitShas = [sha.trim()];
      diffArgs = ["diff", "--numstat", "HEAD~1", "HEAD"];
    }

    const { stdout: numstat } = await execFileAsync(
      "git", diffArgs, { cwd: projectPath, maxBuffer: 10 * 1024 * 1024 },
    );

    const files = parseNumstat(numstat);
    const totalInsertions = files.reduce((s, f) => s + f.insertions, 0);
    const totalDeletions = files.reduce((s, f) => s + f.deletions, 0);

    const changeset: Changeset = {
      sessionId: opts.sessionId,
      ticketId: opts.ticketId,
      projectId: opts.projectId,
      commitShas,
      files,
      totalInsertions,
      totalDeletions,
      timestamp: new Date().toISOString(),
    };

    log.info("captured changeset", {
      ticketId: opts.ticketId,
      files: files.length,
      insertions: totalInsertions,
      deletions: totalDeletions,
    });

    return changeset;
  } catch (err) {
    log.warn("changeset capture failed", { ticketId: opts.ticketId, error: String(err) });
    return null;
  }
}

/**
 * Get the full unified diff for a ticket's changes.
 */
export async function getTicketDiff(
  projectPath: string,
  opts: {
    branch?: string;
    baseBranch?: string;
    commitSha?: string;
  },
): Promise<string> {
  try {
    let diffArgs: string[];

    if (opts.branch) {
      const base = opts.baseBranch ?? "HEAD";
      diffArgs = ["diff", `${base}...${opts.branch}`];
    } else if (opts.commitSha) {
      diffArgs = ["diff", `${opts.commitSha}~1`, opts.commitSha];
    } else {
      diffArgs = ["diff", "HEAD~1", "HEAD"];
    }

    const { stdout } = await execFileAsync(
      "git", diffArgs, { cwd: projectPath, maxBuffer: 10 * 1024 * 1024 },
    );
    return stdout;
  } catch (err) {
    log.warn("getTicketDiff failed", { error: String(err) });
    return "";
  }
}

/**
 * Parse `git diff --numstat` output into FileChange records.
 */
export function parseNumstat(numstat: string): FileChange[] {
  const files: FileChange[] = [];
  for (const line of numstat.trim().split("\n")) {
    if (!line) continue;
    // Format: insertions\tdeletions\tpath
    // Or for renames: insertions\tdeletions\told => new
    const parts = line.split("\t");
    if (parts.length < 3) continue;

    const ins = parts[0] === "-" ? 0 : parseInt(parts[0], 10);
    const del = parts[1] === "-" ? 0 : parseInt(parts[1], 10);
    const pathPart = parts.slice(2).join("\t");

    // Handle renames: "old path => new path" or "{old => new}/file"
    const renameMatch = pathPart.match(/^(.+)\s+=>\s+(.+)$/);
    if (renameMatch) {
      files.push({
        path: renameMatch[2].trim(),
        status: "renamed",
        insertions: ins,
        deletions: del,
        oldPath: renameMatch[1].trim(),
      });
    } else {
      const status: FileChangeStatus = del === 0 && ins > 0 ? "added"
        : ins === 0 && del > 0 ? "deleted"
        : "modified";
      files.push({ path: pathPart, status, insertions: ins, deletions: del });
    }
  }
  return files;
}
