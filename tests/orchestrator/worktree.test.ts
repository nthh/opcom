import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { WorktreeManager } from "../../packages/core/src/orchestrator/worktree.js";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, rm, writeFile, readFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const exec = promisify(execFile);

async function initGitRepo(dir: string): Promise<void> {
  await exec("git", ["init", "-b", "main"], { cwd: dir });
  await exec("git", ["config", "user.email", "test@test.com"], { cwd: dir });
  await exec("git", ["config", "user.name", "Test"], { cwd: dir });
  await writeFile(join(dir, "README.md"), "# Test", "utf-8");
  await exec("git", ["add", "-A"], { cwd: dir });
  await exec("git", ["commit", "-m", "initial commit"], { cwd: dir });
}

describe("WorktreeManager", () => {
  let tmpDir: string;
  let wm: WorktreeManager;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "opcom-wt-test-"));
    await initGitRepo(tmpDir);
    wm = new WorktreeManager();
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  describe("create", () => {
    it("creates a worktree with a new branch", async () => {
      const info = await wm.create(tmpDir, "step-1", "ticket-1");

      expect(info.stepId).toBe("step-1");
      expect(info.ticketId).toBe("ticket-1");
      expect(info.branch).toBe("work/ticket-1");
      expect(info.worktreePath).toContain(".opcom/worktrees/step-1");
      expect(existsSync(info.worktreePath)).toBe(true);

      // Worktree should have the repo files
      expect(existsSync(join(info.worktreePath, "README.md"))).toBe(true);

      // Branch should exist
      const { stdout } = await exec("git", ["branch"], { cwd: tmpDir });
      expect(stdout).toContain("work/ticket-1");
    });

    it("creates multiple worktrees for concurrent steps", async () => {
      const info1 = await wm.create(tmpDir, "step-1", "ticket-1");
      const info2 = await wm.create(tmpDir, "step-2", "ticket-2");

      expect(info1.worktreePath).not.toBe(info2.worktreePath);
      expect(existsSync(info1.worktreePath)).toBe(true);
      expect(existsSync(info2.worktreePath)).toBe(true);
    });

    it("cleans up existing worktree at same path from a crash", async () => {
      // Create first worktree
      const info1 = await wm.create(tmpDir, "step-1", "ticket-1");

      // Overwrite the initial lock with a dead PID to simulate a crashed agent
      await writeFile(join(info1.worktreePath, ".opcom-lock"), "999999", "utf-8");

      // Create another manager simulating restart
      const wm2 = new WorktreeManager();
      const info = await wm2.create(tmpDir, "step-1", "ticket-1");

      // Should succeed — old worktree was cleaned up
      expect(existsSync(info.worktreePath)).toBe(true);
    });

  });

  describe("remove", () => {
    it("removes worktree and branch", async () => {
      const info = await wm.create(tmpDir, "step-1", "ticket-1");
      expect(existsSync(info.worktreePath)).toBe(true);

      await wm.remove("step-1");

      expect(existsSync(info.worktreePath)).toBe(false);

      const { stdout } = await exec("git", ["branch"], { cwd: tmpDir });
      expect(stdout).not.toContain("work/ticket-1");
    });

    it("handles remove of untracked worktree gracefully", async () => {
      // Should not throw
      await wm.remove("nonexistent");
    });
  });

  describe("hasCommits", () => {
    it("returns false when no commits were made", async () => {
      await wm.create(tmpDir, "step-1", "ticket-1");

      const result = await wm.hasCommits("step-1");
      expect(result).toBe(false);
    });

    it("returns true when agent made commits", async () => {
      const info = await wm.create(tmpDir, "step-1", "ticket-1");

      // Simulate agent making a commit in the worktree
      await writeFile(join(info.worktreePath, "new-file.ts"), "export const x = 1;", "utf-8");
      await exec("git", ["add", "-A"], { cwd: info.worktreePath });
      await exec("git", ["commit", "-m", "agent work"], { cwd: info.worktreePath });

      const result = await wm.hasCommits("step-1");
      expect(result).toBe(true);
    });

    it("returns false for untracked worktree", async () => {
      const result = await wm.hasCommits("nonexistent");
      expect(result).toBe(false);
    });
  });

  describe("merge", () => {
    it("merges branch into main on success", async () => {
      const info = await wm.create(tmpDir, "step-1", "ticket-1");

      // Agent makes changes in worktree
      await writeFile(join(info.worktreePath, "feature.ts"), "export const feature = true;", "utf-8");
      await exec("git", ["add", "-A"], { cwd: info.worktreePath });
      await exec("git", ["commit", "-m", "add feature"], { cwd: info.worktreePath });

      const result = await wm.merge("step-1", "main");

      expect(result.merged).toBe(true);
      expect(result.conflict).toBe(false);

      // Feature file should now be on main
      const { stdout } = await exec("git", ["log", "--oneline", "main"], { cwd: tmpDir });
      expect(stdout).toContain("opcom: merge ticket-1");
    });

    it("detects merge conflicts", async () => {
      const info = await wm.create(tmpDir, "step-1", "ticket-1");

      // Agent changes README in worktree
      await writeFile(join(info.worktreePath, "README.md"), "# Changed by agent", "utf-8");
      await exec("git", ["add", "-A"], { cwd: info.worktreePath });
      await exec("git", ["commit", "-m", "agent change"], { cwd: info.worktreePath });

      // Meanwhile, main also changes README
      await writeFile(join(tmpDir, "README.md"), "# Changed on main", "utf-8");
      await exec("git", ["add", "-A"], { cwd: tmpDir });
      await exec("git", ["commit", "-m", "main change"], { cwd: tmpDir });

      const result = await wm.merge("step-1", "main");

      expect(result.merged).toBe(false);
      expect(result.conflict).toBe(true);

      // Main should not be in a dirty merge state (abort was called)
      const { stdout } = await exec("git", ["status", "--porcelain"], { cwd: tmpDir });
      expect(stdout.trim()).toBe("");
    });

    it("returns error for untracked worktree", async () => {
      const result = await wm.merge("nonexistent");
      expect(result.merged).toBe(false);
      expect(result.error).toBeDefined();
    });
  });

  describe("runInWorktree", () => {
    it("runs commands in the worktree directory", async () => {
      await wm.create(tmpDir, "step-1", "ticket-1");

      const result = await wm.runInWorktree("step-1", "git", ["status", "--porcelain"]);
      expect(result.exitCode).toBe(0);
    });

    it("returns non-zero exit code on command failure", async () => {
      await wm.create(tmpDir, "step-1", "ticket-1");

      const result = await wm.runInWorktree("step-1", "git", ["log", "--invalid-flag"]);
      expect(result.exitCode).not.toBe(0);
    });

    it("returns error for untracked worktree", async () => {
      const result = await wm.runInWorktree("nonexistent", "echo", ["hello"]);
      expect(result.exitCode).toBe(1);
    });
  });

  describe("restore", () => {
    it("re-registers worktree info for reconciliation", async () => {
      const info = await wm.create(tmpDir, "step-1", "ticket-1");

      // Simulate restart with new manager
      const wm2 = new WorktreeManager();
      expect(wm2.getInfo("step-1")).toBeUndefined();

      wm2.restore(info);
      expect(wm2.getInfo("step-1")).toEqual(info);
    });
  });

  describe("cleanupOrphaned", () => {
    it("removes worktrees not tracked by any manager", async () => {
      // Create a worktree directly (simulating orphan from crash)
      const wtPath = join(tmpDir, ".opcom/worktrees/orphan-step");
      await exec("git", ["worktree", "add", wtPath, "-b", "work/orphan"], { cwd: tmpDir });

      expect(existsSync(wtPath)).toBe(true);

      const cleaned = await WorktreeManager.cleanupOrphaned(tmpDir);
      expect(cleaned).toContain("orphan-step");
      expect(existsSync(wtPath)).toBe(false);
    });

    it("returns empty array when no worktrees exist", async () => {
      const cleaned = await WorktreeManager.cleanupOrphaned(tmpDir);
      expect(cleaned).toHaveLength(0);
    });

    it("preserves worktrees with unmerged commits", async () => {
      // Create a worktree and make a commit on its branch
      const wtPath = join(tmpDir, ".opcom/worktrees/has-work");
      await exec("git", ["worktree", "add", wtPath, "-b", "work/has-work"], { cwd: tmpDir });
      await writeFile(join(wtPath, "agent-output.ts"), "export const x = 1;", "utf-8");
      await exec("git", ["add", "-A"], { cwd: wtPath });
      await exec("git", ["commit", "-m", "agent work"], { cwd: wtPath });

      const cleaned = await WorktreeManager.cleanupOrphaned(tmpDir);
      expect(cleaned).not.toContain("has-work");
      expect(existsSync(wtPath)).toBe(true);

      // Clean up
      await exec("git", ["worktree", "remove", wtPath, "--force"], { cwd: tmpDir });
      await exec("git", ["branch", "-D", "work/has-work"], { cwd: tmpDir });
    });

    it("preserves worktrees with uncommitted changes", async () => {
      // Create a worktree and write files without committing (simulating agent that edited but didn't commit)
      const wtPath = join(tmpDir, ".opcom/worktrees/uncommitted-work");
      await exec("git", ["worktree", "add", wtPath, "-b", "work/uncommitted-work"], { cwd: tmpDir });
      await writeFile(join(wtPath, "agent-output.ts"), "export const x = 1;", "utf-8");

      const cleaned = await WorktreeManager.cleanupOrphaned(tmpDir);
      expect(cleaned).not.toContain("uncommitted-work");
      expect(existsSync(wtPath)).toBe(true);

      // Clean up
      await exec("git", ["worktree", "remove", wtPath, "--force"], { cwd: tmpDir });
      await exec("git", ["branch", "-D", "work/uncommitted-work"], { cwd: tmpDir });
    });
  });

  describe("lock file", () => {
    it("writeLock creates .opcom-lock with PID", async () => {
      const info = await wm.create(tmpDir, "step-1", "ticket-1");
      await wm.writeLock("step-1", 12345);

      const lockPath = join(info.worktreePath, ".opcom-lock");
      expect(existsSync(lockPath)).toBe(true);
      const content = await readFile(lockPath, "utf-8");
      expect(content).toBe("12345");
    });

    it("remove deletes lock file along with worktree", async () => {
      const info = await wm.create(tmpDir, "step-1", "ticket-1");
      await wm.writeLock("step-1", 12345);

      const lockPath = join(info.worktreePath, ".opcom-lock");
      expect(existsSync(lockPath)).toBe(true);

      await wm.remove("step-1");
      expect(existsSync(info.worktreePath)).toBe(false);
    });

    it("cleanupOrphaned skips worktree with live PID", async () => {
      // Create an orphan worktree with a lock file containing current process PID
      const wtPath = join(tmpDir, ".opcom/worktrees/locked-step");
      await exec("git", ["worktree", "add", wtPath, "-b", "work/locked-step"], { cwd: tmpDir });
      await writeFile(join(wtPath, ".opcom-lock"), String(process.pid), "utf-8");

      const cleaned = await WorktreeManager.cleanupOrphaned(tmpDir);
      expect(cleaned).not.toContain("locked-step");
      expect(existsSync(wtPath)).toBe(true);

      // Clean up
      await exec("git", ["worktree", "remove", wtPath, "--force"], { cwd: tmpDir });
      await exec("git", ["branch", "-D", "work/locked-step"], { cwd: tmpDir });
    });

    it("cleanupOrphaned removes worktree with dead PID", async () => {
      const wtPath = join(tmpDir, ".opcom/worktrees/dead-step");
      await exec("git", ["worktree", "add", wtPath, "-b", "work/dead-step"], { cwd: tmpDir });
      // Use PID 999999 which almost certainly doesn't exist
      await writeFile(join(wtPath, ".opcom-lock"), "999999", "utf-8");

      const cleaned = await WorktreeManager.cleanupOrphaned(tmpDir);
      expect(cleaned).toContain("dead-step");
      expect(existsSync(wtPath)).toBe(false);
    });

    it("create refuses to destroy worktree with live agent lock", async () => {
      const info = await wm.create(tmpDir, "step-1", "ticket-1");

      // Write a lock with the current PID (simulates a live agent)
      await writeFile(join(info.worktreePath, ".opcom-lock"), String(process.pid), "utf-8");

      // A second manager tries to create the same worktree
      const wm2 = new WorktreeManager();
      await expect(wm2.create(tmpDir, "step-1", "ticket-1")).rejects.toThrow(
        /in use by process/,
      );

      // Original worktree should still exist
      expect(existsSync(info.worktreePath)).toBe(true);
    });

    it("create removes worktree with dead agent lock", async () => {
      const info = await wm.create(tmpDir, "step-1", "ticket-1");

      // Write a lock with a dead PID
      await writeFile(join(info.worktreePath, ".opcom-lock"), "999999", "utf-8");

      // A second manager should be able to recreate it
      const wm2 = new WorktreeManager();
      const info2 = await wm2.create(tmpDir, "step-1", "ticket-1");
      expect(existsSync(info2.worktreePath)).toBe(true);
    });

    it("create writes initial lock file with executor PID", async () => {
      const info = await wm.create(tmpDir, "step-1", "ticket-1");

      const lockPath = join(info.worktreePath, ".opcom-lock");
      expect(existsSync(lockPath)).toBe(true);
      const content = await readFile(lockPath, "utf-8");
      expect(content).toBe(String(process.pid));
    });

    it("cleanupOrphaned removes worktree with no lock file", async () => {
      const wtPath = join(tmpDir, ".opcom/worktrees/no-lock-step");
      await exec("git", ["worktree", "add", wtPath, "-b", "work/no-lock-step"], { cwd: tmpDir });

      const cleaned = await WorktreeManager.cleanupOrphaned(tmpDir);
      expect(cleaned).toContain("no-lock-step");
      expect(existsSync(wtPath)).toBe(false);
    });
  });

  describe("full lifecycle", () => {
    it("create → agent work → hasCommits → merge → remove", async () => {
      // 1. Create worktree
      const info = await wm.create(tmpDir, "step-1", "ticket-1");
      expect(existsSync(info.worktreePath)).toBe(true);

      // 2. Agent makes changes
      await writeFile(join(info.worktreePath, "feature.ts"), "const x = 1;", "utf-8");
      await exec("git", ["add", "-A"], { cwd: info.worktreePath });
      await exec("git", ["commit", "-m", "implement feature"], { cwd: info.worktreePath });

      // 3. Verify commits
      expect(await wm.hasCommits("step-1")).toBe(true);

      // 4. Merge
      const mergeResult = await wm.merge("step-1", "main");
      expect(mergeResult.merged).toBe(true);

      // 5. Verify feature is on main
      expect(existsSync(join(tmpDir, "feature.ts"))).toBe(true);

      // 6. Remove worktree
      await wm.remove("step-1");
      expect(existsSync(info.worktreePath)).toBe(false);
    });

    it("two concurrent agents in separate worktrees don't interfere", async () => {
      const info1 = await wm.create(tmpDir, "step-1", "ticket-1");
      const info2 = await wm.create(tmpDir, "step-2", "ticket-2");

      // Agent 1 creates file-a.ts
      await writeFile(join(info1.worktreePath, "file-a.ts"), "export const a = 1;", "utf-8");
      await exec("git", ["add", "-A"], { cwd: info1.worktreePath });
      await exec("git", ["commit", "-m", "agent 1 work"], { cwd: info1.worktreePath });

      // Agent 2 creates file-b.ts
      await writeFile(join(info2.worktreePath, "file-b.ts"), "export const b = 2;", "utf-8");
      await exec("git", ["add", "-A"], { cwd: info2.worktreePath });
      await exec("git", ["commit", "-m", "agent 2 work"], { cwd: info2.worktreePath });

      // Agent 1 should not see Agent 2's file
      expect(existsSync(join(info1.worktreePath, "file-b.ts"))).toBe(false);
      // Agent 2 should not see Agent 1's file
      expect(existsSync(join(info2.worktreePath, "file-a.ts"))).toBe(false);

      // Merge agent 1 first
      const result1 = await wm.merge("step-1", "main");
      expect(result1.merged).toBe(true);

      // Merge agent 2 — no conflict since they touched different files
      const result2 = await wm.merge("step-2", "main");
      expect(result2.merged).toBe(true);

      // Both files should be on main
      expect(existsSync(join(tmpDir, "file-a.ts"))).toBe(true);
      expect(existsSync(join(tmpDir, "file-b.ts"))).toBe(true);

      // Cleanup
      await wm.remove("step-1");
      await wm.remove("step-2");
    });

    it("reuses branch with unmerged commits on create", async () => {
      // 1. Create worktree, agent makes a commit
      const info = await wm.create(tmpDir, "ticket-1", "ticket-1");
      await writeFile(join(info.worktreePath, "feature.ts"), "const x = 1;", "utf-8");
      await exec("git", ["add", "-A"], { cwd: info.worktreePath });
      await exec("git", ["commit", "-m", "agent work"], { cwd: info.worktreePath });

      // 2. Remove worktree (simulating failure cleanup that preserves branch)
      await exec("git", ["worktree", "remove", info.worktreePath, "--force"], { cwd: tmpDir });
      wm = new WorktreeManager(); // fresh manager (simulating new plan)

      // 3. Create again for same ticket — should reuse the branch
      const info2 = await wm.create(tmpDir, "ticket-1", "ticket-1");
      expect(existsSync(info2.worktreePath)).toBe(true);

      // 4. The previous agent's commit should be present
      expect(await wm.hasCommits("ticket-1")).toBe(true);
      expect(existsSync(join(info2.worktreePath, "feature.ts"))).toBe(true);

      // Cleanup
      await wm.remove("ticket-1");
    });
  });
});
