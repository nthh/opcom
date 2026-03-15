import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { join } from "node:path";
import { existsSync, mkdirSync } from "node:fs";
import { readdir, rm, writeFile, readFile, appendFile, mkdir } from "node:fs/promises";
import type { RebaseResult } from "@opcom/types";
import { createLogger } from "../logger.js";

const execFileAsync = promisify(execFile);
const log = createLogger("worktree");

/** Lock file placed inside worktrees to signal an active agent process. */
const LOCK_FILE = ".opcom-lock";

/**
 * Ensure `.opcom-lock` is listed in the project's `.git/info/exclude` so agents
 * never accidentally commit it.  This is idempotent — safe to call multiple times.
 */
async function ensureGitExclude(projectPath: string): Promise<void> {
  const infoDir = join(projectPath, ".git", "info");
  const excludePath = join(infoDir, "exclude");
  try {
    await mkdir(infoDir, { recursive: true });
    let content = "";
    try { content = await readFile(excludePath, "utf-8"); } catch { /* file may not exist */ }
    if (!content.includes(LOCK_FILE)) {
      const line = content.endsWith("\n") || content.length === 0 ? LOCK_FILE + "\n" : "\n" + LOCK_FILE + "\n";
      await appendFile(excludePath, line);
    }
  } catch {
    // Best-effort — non-fatal
  }
}

/** Check whether a PID is alive (without sending a signal). */
function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

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

    // Check if the branch already exists with unmerged commits from a previous run.
    // If so, reuse it so the next agent picks up where the last one left off.
    let reusing = false;
    try {
      const { stdout: mainHead } = await execFileAsync(
        "git", ["rev-parse", "HEAD"], { cwd: projectPath },
      );
      const { stdout: branchLog } = await execFileAsync(
        "git", ["log", `${mainHead.trim()}..${branch}`, "--oneline"], { cwd: projectPath },
      );
      if (branchLog.trim().length > 0) {
        reusing = true;
        log.info("reusing branch with unmerged commits", { branch, commits: branchLog.trim().split("\n").length });
      }
    } catch {
      // Branch doesn't exist — will create fresh
    }

    // Remove existing worktree directory if it exists (from a crash).
    // Must happen before branch deletion — git won't delete a checked-out branch.
    if (existsSync(worktreePath)) {
      // Check lock file — refuse to destroy a worktree with a live agent
      const lockPath = join(worktreePath, LOCK_FILE);
      if (existsSync(lockPath)) {
        try {
          const pidStr = await readFile(lockPath, "utf-8");
          const pid = parseInt(pidStr.trim(), 10);
          if (!isNaN(pid) && isProcessAlive(pid)) {
            throw new Error(`Worktree ${stepId} is in use by process ${pid}`);
          }
        } catch (err) {
          if (err instanceof Error && err.message.startsWith("Worktree ")) throw err;
          // Can't read lock — treat as stale
        }
      }

      try {
        await execFileAsync("git", ["worktree", "remove", worktreePath, "--force"], {
          cwd: projectPath,
        });
      } catch {
        await rm(worktreePath, { recursive: true, force: true });
        try {
          await execFileAsync("git", ["worktree", "prune"], { cwd: projectPath });
        } catch { /* ignore */ }
      }
    }

    if (reusing) {
      // Re-attach worktree to the existing branch (preserves commits)
      await execFileAsync(
        "git",
        ["worktree", "add", worktreePath, branch],
        { cwd: projectPath },
      );
    } else {
      // Delete the branch if it exists but has no unmerged commits
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
    }

    // Ensure .opcom-lock is git-excluded so agents never commit it
    await ensureGitExclude(projectPath);

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

    // Write an initial lock with the executor PID so cleanupOrphaned() won't
    // remove this worktree before the agent's PID is known.  The executor
    // updates the lock with the real agent PID via writeLock() after spawn.
    try {
      await writeFile(join(worktreePath, LOCK_FILE), String(process.pid), "utf-8");
    } catch {
      // Best effort — writeLock() will retry with the agent PID later
    }

    log.info("created worktree", { stepId, ticketId, worktreePath, branch });

    return info;
  }

  /**
   * Write a lock file into the worktree so cleanupOrphaned() knows an agent
   * is still using it.  The file contains the agent's PID.
   */
  async writeLock(stepId: string, pid: number): Promise<void> {
    const info = this.worktrees.get(stepId);
    if (!info) {
      log.warn("writeLock: worktree not tracked", { stepId });
      return;
    }
    const lockPath = join(info.worktreePath, LOCK_FILE);
    await writeFile(lockPath, String(pid), "utf-8");
    log.debug("wrote lock file", { stepId, pid, lockPath });
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

    // Remove lock file before tearing down the worktree (best-effort)
    try {
      const lockPath = join(info.worktreePath, LOCK_FILE);
      if (existsSync(lockPath)) {
        await rm(lockPath, { force: true });
      }
    } catch {
      // best effort
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

    // Remove .opcom-lock from the branch if an agent accidentally committed it
    await this.removeInternalFiles(info);

    const cwd = info.projectPath;

    // Determine target branch (default: current branch of main repo)
    let target = targetBranch;
    if (!target) {
      const { stdout } = await execFileAsync("git", ["rev-parse", "--abbrev-ref", "HEAD"], { cwd });
      target = stdout.trim();
    }

    // Check out target branch if it differs from current HEAD
    let previousBranch: string | undefined;
    {
      const { stdout } = await execFileAsync("git", ["rev-parse", "--abbrev-ref", "HEAD"], { cwd });
      const current = stdout.trim();
      if (current !== target) {
        previousBranch = current;
        await execFileAsync("git", ["checkout", target], { cwd });
      }
    }

    try {
      await execFileAsync(
        "git",
        ["merge", info.branch, "--no-ff", "-m", `opcom: merge ${info.ticketId}`],
        { cwd },
      );
      log.info("merged worktree branch", { stepId, branch: info.branch, target });
      if (previousBranch) {
        await execFileAsync("git", ["checkout", previousBranch], { cwd });
      }
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
        if (previousBranch) {
          try { await execFileAsync("git", ["checkout", previousBranch], { cwd }); } catch { /* best effort */ }
        }
        log.warn("merge conflict", { stepId, branch: info.branch, target });
        return { merged: false, conflict: true, error: combined };
      }

      if (previousBranch) {
        try { await execFileAsync("git", ["checkout", previousBranch], { cwd }); } catch { /* best effort */ }
      }
      log.error("merge failed", { stepId, error: combined });
      return { merged: false, conflict: false, error: combined };
    }
  }

  /**
   * Attempt to rebase the worktree branch onto the target branch.
   * On conflict, aborts the rebase and returns the conflicting files.
   */
  async attemptRebase(stepId: string, targetBranch?: string): Promise<RebaseResult> {
    const info = this.worktrees.get(stepId);
    if (!info) {
      return { rebased: false, conflict: false, error: "Worktree not tracked" };
    }

    // Remove .opcom-lock from the branch if an agent accidentally committed it
    await this.removeInternalFiles(info);

    const cwd = info.worktreePath;

    // Determine target branch (default: current branch of main repo)
    let target = targetBranch;
    if (!target) {
      const { stdout } = await execFileAsync("git", ["rev-parse", "--abbrev-ref", "HEAD"], { cwd: info.projectPath });
      target = stdout.trim();
    }

    try {
      await execFileAsync("git", ["rebase", target], { cwd });
      log.info("clean rebase succeeded", { stepId, branch: info.branch, target });
      return { rebased: true, conflict: false };
    } catch (err: unknown) {
      const e = err as { message?: string; stdout?: string; stderr?: string };
      const combined = [e.message, e.stdout, e.stderr].filter(Boolean).join("\n");

      if (combined.includes("CONFLICT") || combined.includes("could not apply") || combined.includes("Merge conflict")) {
        // Abort the rebase to restore clean state
        try {
          await execFileAsync("git", ["rebase", "--abort"], { cwd });
        } catch {
          // Best effort abort
        }
        const conflictFiles = parseConflictFiles(combined);
        log.warn("rebase conflict", { stepId, branch: info.branch, target, conflictFiles });
        return { rebased: false, conflict: true, conflictFiles, error: combined };
      }

      log.error("rebase failed", { stepId, error: combined });
      return { rebased: false, conflict: false, error: combined };
    }
  }

  /**
   * Check if the agent made any commits on the worktree's branch.
   * @param comparisonBase - branch or ref to compare against (default: main repo HEAD).
   *   For integration branch children, pass the integration branch name so the
   *   comparison is against the integration branch HEAD, not main HEAD.
   */
  async hasCommits(stepId: string, comparisonBase?: string): Promise<boolean> {
    const info = this.worktrees.get(stepId);
    if (!info) return false;

    try {
      // Compare the branch against the base to see if the agent added commits.
      let base: string;
      if (comparisonBase) {
        const { stdout } = await execFileAsync(
          "git",
          ["rev-parse", comparisonBase],
          { cwd: info.projectPath },
        );
        base = stdout.trim();
      } else {
        const { stdout } = await execFileAsync(
          "git",
          ["rev-parse", "HEAD"],
          { cwd: info.projectPath },
        );
        base = stdout.trim();
      }
      const { stdout } = await execFileAsync(
        "git",
        ["log", `${base}..${info.branch}`, "--oneline"],
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
   * Remove internal files (.opcom-lock) from the worktree's git index.
   * Agents sometimes commit these despite .gitignore; removing them before
   * merge/rebase prevents trivial conflicts on internal files.
   */
  private async removeInternalFiles(info: WorktreeInfo): Promise<void> {
    try {
      await execFileAsync("git", ["rm", "--cached", "--ignore-unmatch", LOCK_FILE], {
        cwd: info.worktreePath,
      });
      // Check if the rm created a staged change — if so, amend the last commit
      const { stdout } = await execFileAsync("git", ["diff", "--cached", "--name-only"], {
        cwd: info.worktreePath,
      });
      if (stdout.trim().length > 0) {
        await execFileAsync("git", ["commit", "--amend", "--no-edit"], {
          cwd: info.worktreePath,
        });
        log.info("removed .opcom-lock from branch", { stepId: info.stepId });
      }
    } catch {
      // Best effort — non-fatal
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
   * Scans .opcom/worktrees/ and removes any not in the `keep` set.
   * Worktrees with unmerged commits are never removed — they contain
   * agent work that would be lost.
   */
  static async cleanupOrphaned(projectPath: string, keep?: Set<string>): Promise<string[]> {
    const worktreeBase = join(projectPath, WorktreeManager.WORKTREE_DIR);
    if (!existsSync(worktreeBase)) return [];

    const cleaned: string[] = [];

    // Get main HEAD for commit comparison
    let mainHead: string;
    try {
      const { stdout } = await execFileAsync("git", ["rev-parse", "HEAD"], { cwd: projectPath });
      mainHead = stdout.trim();
    } catch {
      log.warn("cleanupOrphaned: cannot determine HEAD", { projectPath });
      return [];
    }

    // Collect actual worktree entries, handling nested paths (e.g. materialization/format-raster).
    // readdir returns top-level entries; subdirectories that are NOT git worktrees
    // (no .git file) are parent directories containing nested worktrees — recurse into them.
    const worktreeEntries: { id: string; path: string }[] = [];
    try {
      const topEntries = await readdir(worktreeBase, { withFileTypes: true });
      for (const entry of topEntries) {
        if (!entry.isDirectory()) continue;
        const entryPath = join(worktreeBase, entry.name);
        // A git worktree has a .git file (not directory) at its root
        if (existsSync(join(entryPath, ".git"))) {
          worktreeEntries.push({ id: entry.name, path: entryPath });
        } else {
          // Not a worktree itself — check for nested worktrees (integration branch grouping)
          try {
            const subEntries = await readdir(entryPath, { withFileTypes: true });
            for (const sub of subEntries) {
              if (!sub.isDirectory()) continue;
              const subPath = join(entryPath, sub.name);
              const nestedId = `${entry.name}/${sub.name}`;
              worktreeEntries.push({ id: nestedId, path: subPath });
            }
          } catch {
            // Can't read subdirectory — skip
          }
        }
      }
    } catch (err) {
      log.warn("cleanupOrphaned: readdir failed", { worktreeBase, error: String(err) });
      return [];
    }

    for (const { id: entry, path: worktreePath } of worktreeEntries) {
      if (keep?.has(entry)) {
        log.debug("skipping active worktree", { entry });
        continue;
      }

      // Check if the worktree branch has unmerged commits
      const branch = `work/${entry}`;
      try {
        const { stdout } = await execFileAsync(
          "git",
          ["log", `${mainHead}..${branch}`, "--oneline"],
          { cwd: projectPath },
        );
        if (stdout.trim().length > 0) {
          log.info("skipping worktree with unmerged commits", { entry, branch });
          continue;
        }
      } catch {
        // Branch doesn't exist or other error — safe to clean up
      }

      // Check for uncommitted changes (edits the agent wrote but never committed)
      try {
        const { stdout } = await execFileAsync(
          "git", ["status", "--porcelain"], { cwd: worktreePath },
        );
        // Filter out the opcom lock file — it's internal, not agent work
        const realChanges = stdout.trim().split("\n")
          .filter((l) => l.length > 0 && !l.endsWith(LOCK_FILE));
        if (realChanges.length > 0) {
          log.info("skipping worktree with uncommitted changes", { entry });
          continue;
        }
      } catch {
        // Can't check status — fall through to other checks
      }

      // Check for lock file — if the agent process is still alive, skip
      const lockPath = join(worktreePath, LOCK_FILE);
      if (existsSync(lockPath)) {
        try {
          const pidStr = await readFile(lockPath, "utf-8");
          const pid = parseInt(pidStr.trim(), 10);
          if (!isNaN(pid) && isProcessAlive(pid)) {
            log.info("skipping worktree with live agent process", { entry, pid });
            continue;
          }
          log.info("lock file found but process is dead, removing", { entry, pid });
        } catch {
          // Can't read lock — treat as stale
        }
      }

      try {
        await execFileAsync("git", ["worktree", "remove", worktreePath, "--force"], {
          cwd: projectPath,
        });
        log.info("cleaned up orphaned worktree", { worktreePath });
      } catch {
        await rm(worktreePath, { recursive: true, force: true });
        log.info("force-removed orphaned worktree", { worktreePath });
      }

      // Delete the branch (only reached if no unmerged commits)
      try {
        await execFileAsync("git", ["branch", "-D", branch], { cwd: projectPath });
      } catch {
        // Branch may already be gone
      }

      cleaned.push(entry);
    }

    // Clean up empty parent directories left after nested worktree removal
    try {
      const topEntries = await readdir(worktreeBase, { withFileTypes: true });
      for (const entry of topEntries) {
        if (!entry.isDirectory()) continue;
        const entryPath = join(worktreeBase, entry.name);
        // Skip if it's an actual worktree
        if (existsSync(join(entryPath, ".git"))) continue;
        try {
          const remaining = await readdir(entryPath);
          if (remaining.length === 0) {
            await rm(entryPath, { recursive: true, force: true });
          }
        } catch { /* ignore */ }
      }
    } catch { /* ignore */ }

    // Prune git worktree references
    if (cleaned.length > 0) {
      try {
        await execFileAsync("git", ["worktree", "prune"], { cwd: projectPath });
      } catch {
        // Best effort
      }
    }

    return cleaned;
  }

  /**
   * Create a git branch without a worktree directory.
   * Useful for integration branches that collect multiple step merges.
   */
  static async createBranch(
    projectPath: string,
    branchName: string,
    base?: string,
  ): Promise<void> {
    const startPoint = base ?? "HEAD";
    await execFileAsync("git", ["branch", branchName, startPoint], {
      cwd: projectPath,
    });
    log.info("created branch", { branchName, base: startPoint });
  }

  /**
   * Delete a git branch.
   */
  static async deleteBranch(
    projectPath: string,
    branchName: string,
  ): Promise<void> {
    await execFileAsync("git", ["branch", "-D", branchName], {
      cwd: projectPath,
    });
    log.info("deleted branch", { branchName });
  }

  /**
   * Merge an integration branch into a target branch (default: current branch)
   * using --no-ff.  Returns a MergeResult.
   */
  static async mergeIntegrationBranch(
    projectPath: string,
    branchName: string,
    targetBranch?: string,
  ): Promise<MergeResult> {
    const cwd = projectPath;

    // If a target is specified, check it out first
    if (targetBranch) {
      await execFileAsync("git", ["checkout", targetBranch], { cwd });
    }

    try {
      await execFileAsync(
        "git",
        ["merge", branchName, "--no-ff", "-m", `opcom: merge integration branch ${branchName}`],
        { cwd },
      );
      log.info("merged integration branch", { branchName, targetBranch });
      return { merged: true, conflict: false };
    } catch (err: unknown) {
      const e = err as { message?: string; stdout?: string; stderr?: string };
      const combined = [e.message, e.stdout, e.stderr].filter(Boolean).join("\n");

      if (combined.includes("CONFLICT") || combined.includes("Automatic merge failed")) {
        try {
          await execFileAsync("git", ["merge", "--abort"], { cwd });
        } catch {
          // Best effort abort
        }
        log.warn("integration branch merge conflict", { branchName, targetBranch });
        return { merged: false, conflict: true, error: combined };
      }

      log.error("integration branch merge failed", { branchName, error: combined });
      return { merged: false, conflict: false, error: combined };
    }
  }

  /**
   * Install dependencies in the worktree.
   * Runs `npm install` instead of symlinking node_modules to avoid
   * ELOOP errors from circular symlinks in monorepo workspaces.
   *
   * If no root package.json exists (e.g. multi-project repos like Folia
   * with app/, workers/, schema/ each having their own), scans immediate
   * subdirectories and installs in each one that has a package.json.
   */
  private async installDeps(worktreePath: string): Promise<void> {
    const pkgJson = join(worktreePath, "package.json");
    if (existsSync(pkgJson)) {
      // Root-level install (monorepo workspaces, single-package projects)
      await this.npmInstallAt(worktreePath);
      return;
    }

    // No root package.json — scan immediate subdirectories
    let entries: import("node:fs").Dirent[];
    try {
      entries = await readdir(worktreePath, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      if (!entry.isDirectory() || entry.name.startsWith(".")) continue;
      const subDir = join(worktreePath, entry.name);
      if (existsSync(join(subDir, "package.json"))) {
        await this.npmInstallAt(subDir);
      }
    }
  }

  /** Run npm install + npm run build in a directory. */
  private async npmInstallAt(dir: string): Promise<void> {
    try {
      await execFileAsync("npm", ["install"], {
        cwd: dir,
        timeout: 60000,
      });
      log.debug("installed deps", { dir });
    } catch (err) {
      log.warn("failed to install deps", { dir, error: String(err) });
      return;
    }

    // Build TypeScript packages so dist/ directories exist.
    // Without this, monorepo project references (e.g. @opcom/types) can't resolve.
    try {
      await execFileAsync("npm", ["run", "build"], {
        cwd: dir,
        timeout: 120_000,
      });
      log.debug("built packages", { dir });
    } catch (err) {
      log.warn("failed to build", { dir, error: String(err) });
    }
  }
}

/**
 * Parse conflicting file paths from git rebase error output.
 * Matches patterns like "CONFLICT (content): Merge conflict in <file>"
 * and "CONFLICT (add/add): Merge conflict in <file>".
 */
export function parseConflictFiles(output: string): string[] {
  const files: string[] = [];
  const regex = /CONFLICT\s*\([^)]*\):\s*Merge conflict in\s+(.+)/g;
  let match;
  while ((match = regex.exec(output)) !== null) {
    files.push(match[1].trim());
  }
  return files;
}
