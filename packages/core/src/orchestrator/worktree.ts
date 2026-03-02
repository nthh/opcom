import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { join } from "node:path";
import { existsSync, mkdirSync } from "node:fs";
import { readdir, rm } from "node:fs/promises";
import { createLogger } from "../logger.js";

const execFileAsync = promisify(execFile);
const log = createLogger("worktree");

export interface WorktreeInfo {
  stepId: string;
  ticketId: string;
  projectPath: string;
  worktreePath: string;
  branch: string;
}

export interface MergeResult {
  merged: boolean;
  conflict: boolean;
  error?: string;
}

export interface ExecResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

/**
 * Manages git worktrees for isolated agent execution.
 *
 * Each agent step gets its own worktree with a dedicated branch.
 * Worktrees are created under `.opcom/worktrees/<stepId>` relative
 * to the project root, with branch names `work/<ticketId>`.
 */
export class WorktreeManager {
  private worktrees = new Map<string, WorktreeInfo>();

  /** Directory name within project for worktrees */
  private static WORKTREE_DIR = ".opcom/worktrees";

  /**
   * Create a new worktree for a step.
   */
  async create(
    projectPath: string,
    stepId: string,
    ticketId: string,
    baseBranch?: string,
  ): Promise<WorktreeInfo> {
    const worktreeBase = join(projectPath, WorktreeManager.WORKTREE_DIR);
    const worktreePath = join(worktreeBase, stepId);
    const branch = `work/${ticketId}`;

    // Ensure the parent directory exists
    mkdirSync(worktreeBase, { recursive: true });

    // Remove existing worktree at this path if it exists (from a crash).
    // Must happen before branch deletion — git won't delete a checked-out branch.
    if (existsSync(worktreePath)) {
      try {
        await execFileAsync("git", ["worktree", "remove", worktreePath, "--force"], {
          cwd: projectPath,
        });
      } catch {
        await rm(worktreePath, { recursive: true, force: true });
        // Also prune worktree metadata after manual removal
        try {
          await execFileAsync("git", ["worktree", "prune"], { cwd: projectPath });
        } catch { /* ignore */ }
      }
    }

    // Delete the branch if it already exists from a previous run
    try {
      await execFileAsync("git", ["branch", "-D", branch], { cwd: projectPath });
      log.debug("deleted existing branch", { branch });
    } catch {
      // Branch doesn't exist, fine
    }

    // Create worktree with new branch
    const base = baseBranch ?? "HEAD";
    await execFileAsync(
      "git",
      ["worktree", "add", worktreePath, "-b", branch, base],
      { cwd: projectPath },
    );

    // Install dependencies in the worktree
    await this.installDeps(worktreePath);

    const info: WorktreeInfo = {
      stepId,
      ticketId,
      projectPath,
      worktreePath,
      branch,
    };

    this.worktrees.set(stepId, info);
    log.info("created worktree", { stepId, ticketId, worktreePath, branch });

    return info;
  }

  /**
   * Remove a worktree and its branch.
   */
  async remove(stepId: string): Promise<void> {
    const info = this.worktrees.get(stepId);
    if (!info) {
      log.warn("remove: worktree not tracked", { stepId });
      return;
    }

    try {
      await execFileAsync("git", ["worktree", "remove", info.worktreePath, "--force"], {
        cwd: info.projectPath,
      });
    } catch (err) {
      log.warn("worktree remove failed, cleaning up manually", {
        stepId,
        error: String(err),
      });
      await rm(info.worktreePath, { recursive: true, force: true });
      // Prune stale worktree references
      try {
        await execFileAsync("git", ["worktree", "prune"], { cwd: info.projectPath });
      } catch {
        // Best effort
      }
    }

    // Delete the working branch
    try {
      await execFileAsync("git", ["branch", "-D", info.branch], {
        cwd: info.projectPath,
      });
    } catch {
      // Branch may already be deleted or merged
    }

    this.worktrees.delete(stepId);
    log.info("removed worktree", { stepId });
  }

  /**
   * Merge the worktree's branch into a target branch (default: current branch).
   * Returns merge result — on conflict, the merge is aborted.
   */
  async merge(stepId: string, targetBranch?: string): Promise<MergeResult> {
    const info = this.worktrees.get(stepId);
    if (!info) {
      return { merged: false, conflict: false, error: "Worktree not tracked" };
    }

    const cwd = info.projectPath;

    // Determine target branch (default: current branch of main repo)
    let target = targetBranch;
    if (!target) {
      const { stdout } = await execFileAsync("git", ["rev-parse", "--abbrev-ref", "HEAD"], { cwd });
      target = stdout.trim();
    }

    try {
      await execFileAsync(
        "git",
        ["merge", info.branch, "--no-ff", "-m", `opcom: merge ${info.ticketId}`],
        { cwd },
      );
      log.info("merged worktree branch", { stepId, branch: info.branch, target });
      return { merged: true, conflict: false };
    } catch (err: unknown) {
      // execFile errors carry stdout/stderr from git
      const e = err as { message?: string; stdout?: string; stderr?: string };
      const combined = [e.message, e.stdout, e.stderr].filter(Boolean).join("\n");

      // Check if it's a merge conflict
      if (combined.includes("CONFLICT") || combined.includes("Automatic merge failed")) {
        // Abort the merge
        try {
          await execFileAsync("git", ["merge", "--abort"], { cwd });
        } catch {
          // Best effort abort
        }
        log.warn("merge conflict", { stepId, branch: info.branch, target });
        return { merged: false, conflict: true, error: combined };
      }

      log.error("merge failed", { stepId, error: combined });
      return { merged: false, conflict: false, error: combined };
    }
  }

  /**
   * Check if the agent made any commits on the worktree's branch.
   */
  async hasCommits(stepId: string): Promise<boolean> {
    const info = this.worktrees.get(stepId);
    if (!info) return false;

    try {
      // Compare the branch against the main repo HEAD to see if the agent added commits.
      // The branch was created from HEAD, so any new commits will be ahead of it.
      const { stdout: mainHead } = await execFileAsync(
        "git",
        ["rev-parse", "HEAD"],
        { cwd: info.projectPath },
      );
      const { stdout } = await execFileAsync(
        "git",
        ["log", `${mainHead.trim()}..${info.branch}`, "--oneline"],
        { cwd: info.worktreePath },
      );
      return stdout.trim().length > 0;
    } catch (err) {
      log.warn("hasCommits check failed", { stepId, error: String(err) });
      return false;
    }
  }

  /**
   * Run a command inside the worktree directory.
   */
  async runInWorktree(
    stepId: string,
    command: string,
    args: string[] = [],
    timeoutMs = 300_000,
  ): Promise<ExecResult> {
    const info = this.worktrees.get(stepId);
    if (!info) {
      return { stdout: "", stderr: "Worktree not tracked", exitCode: 1 };
    }

    try {
      const { stdout, stderr } = await execFileAsync(command, args, {
        cwd: info.worktreePath,
        timeout: timeoutMs,
      });
      return { stdout, stderr, exitCode: 0 };
    } catch (err: unknown) {
      const e = err as { stdout?: string; stderr?: string; code?: number };
      return {
        stdout: e.stdout ?? "",
        stderr: e.stderr ?? String(err),
        exitCode: e.code ?? 1,
      };
    }
  }

  /**
   * Get info for a tracked worktree.
   */
  getInfo(stepId: string): WorktreeInfo | undefined {
    return this.worktrees.get(stepId);
  }

  /**
   * Restore tracking for a worktree from persisted plan data.
   * Used during reconciliation when the executor restarts.
   */
  restore(info: WorktreeInfo): void {
    this.worktrees.set(info.stepId, info);
  }

  /**
   * Clean up orphaned worktrees from previous crashed runs.
   * Scans .opcom/worktrees/ and removes any that aren't tracked.
   */
  static async cleanupOrphaned(projectPath: string): Promise<string[]> {
    const worktreeBase = join(projectPath, WorktreeManager.WORKTREE_DIR);
    if (!existsSync(worktreeBase)) return [];

    const cleaned: string[] = [];

    try {
      const entries = await readdir(worktreeBase);
      for (const entry of entries) {
        const worktreePath = join(worktreeBase, entry);
        try {
          await execFileAsync("git", ["worktree", "remove", worktreePath, "--force"], {
            cwd: projectPath,
          });
          log.info("cleaned up orphaned worktree", { worktreePath });
        } catch {
          await rm(worktreePath, { recursive: true, force: true });
          log.info("force-removed orphaned worktree", { worktreePath });
        }
        cleaned.push(entry);
      }

      // Prune git worktree references
      if (cleaned.length > 0) {
        try {
          await execFileAsync("git", ["worktree", "prune"], { cwd: projectPath });
        } catch {
          // Best effort
        }
      }
    } catch (err) {
      log.warn("cleanupOrphaned failed", { projectPath, error: String(err) });
    }

    return cleaned;
  }

  /**
   * Install dependencies in the worktree.
   * Runs `npm install` instead of symlinking node_modules to avoid
   * ELOOP errors from circular symlinks in monorepo workspaces.
   */
  private async installDeps(worktreePath: string): Promise<void> {
    const pkgJson = join(worktreePath, "package.json");
    if (!existsSync(pkgJson)) return;

    try {
      await execFileAsync("npm", ["install", "--ignore-scripts"], {
        cwd: worktreePath,
        timeout: 60000,
      });
      log.debug("installed deps in worktree", { worktreePath });
    } catch (err) {
      log.warn("failed to install deps in worktree", { worktreePath, error: String(err) });
    }
  }
}
