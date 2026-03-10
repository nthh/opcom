"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const worktree_js_1 = require("../../packages/core/src/orchestrator/worktree.js");
const node_child_process_1 = require("node:child_process");
const node_util_1 = require("node:util");
const promises_1 = require("node:fs/promises");
const node_fs_1 = require("node:fs");
const node_path_1 = require("node:path");
const node_os_1 = require("node:os");
const exec = (0, node_util_1.promisify)(node_child_process_1.execFile);
async function initGitRepo(dir) {
    await exec("git", ["init", "-b", "main"], { cwd: dir });
    await exec("git", ["config", "user.email", "test@test.com"], { cwd: dir });
    await exec("git", ["config", "user.name", "Test"], { cwd: dir });
    await (0, promises_1.writeFile)((0, node_path_1.join)(dir, "README.md"), "# Test", "utf-8");
    await exec("git", ["add", "-A"], { cwd: dir });
    await exec("git", ["commit", "-m", "initial commit"], { cwd: dir });
}
(0, vitest_1.describe)("WorktreeManager", () => {
    let tmpDir;
    let wm;
    (0, vitest_1.beforeEach)(async () => {
        tmpDir = await (0, promises_1.mkdtemp)((0, node_path_1.join)((0, node_os_1.tmpdir)(), "opcom-wt-test-"));
        await initGitRepo(tmpDir);
        wm = new worktree_js_1.WorktreeManager();
    });
    (0, vitest_1.afterEach)(async () => {
        await (0, promises_1.rm)(tmpDir, { recursive: true, force: true });
    });
    (0, vitest_1.describe)("create", () => {
        (0, vitest_1.it)("creates a worktree with a new branch", async () => {
            const info = await wm.create(tmpDir, "step-1", "ticket-1");
            (0, vitest_1.expect)(info.stepId).toBe("step-1");
            (0, vitest_1.expect)(info.ticketId).toBe("ticket-1");
            (0, vitest_1.expect)(info.branch).toBe("work/ticket-1");
            (0, vitest_1.expect)(info.worktreePath).toContain(".opcom/worktrees/step-1");
            (0, vitest_1.expect)((0, node_fs_1.existsSync)(info.worktreePath)).toBe(true);
            // Worktree should have the repo files
            (0, vitest_1.expect)((0, node_fs_1.existsSync)((0, node_path_1.join)(info.worktreePath, "README.md"))).toBe(true);
            // Branch should exist
            const { stdout } = await exec("git", ["branch"], { cwd: tmpDir });
            (0, vitest_1.expect)(stdout).toContain("work/ticket-1");
        });
        (0, vitest_1.it)("creates multiple worktrees for concurrent steps", async () => {
            const info1 = await wm.create(tmpDir, "step-1", "ticket-1");
            const info2 = await wm.create(tmpDir, "step-2", "ticket-2");
            (0, vitest_1.expect)(info1.worktreePath).not.toBe(info2.worktreePath);
            (0, vitest_1.expect)((0, node_fs_1.existsSync)(info1.worktreePath)).toBe(true);
            (0, vitest_1.expect)((0, node_fs_1.existsSync)(info2.worktreePath)).toBe(true);
        });
        (0, vitest_1.it)("cleans up existing worktree at same path from a crash", async () => {
            // Create first worktree
            const info1 = await wm.create(tmpDir, "step-1", "ticket-1");
            // Overwrite the initial lock with a dead PID to simulate a crashed agent
            await (0, promises_1.writeFile)((0, node_path_1.join)(info1.worktreePath, ".opcom-lock"), "999999", "utf-8");
            // Create another manager simulating restart
            const wm2 = new worktree_js_1.WorktreeManager();
            const info = await wm2.create(tmpDir, "step-1", "ticket-1");
            // Should succeed — old worktree was cleaned up
            (0, vitest_1.expect)((0, node_fs_1.existsSync)(info.worktreePath)).toBe(true);
        });
    });
    (0, vitest_1.describe)("remove", () => {
        (0, vitest_1.it)("removes worktree and branch", async () => {
            const info = await wm.create(tmpDir, "step-1", "ticket-1");
            (0, vitest_1.expect)((0, node_fs_1.existsSync)(info.worktreePath)).toBe(true);
            await wm.remove("step-1");
            (0, vitest_1.expect)((0, node_fs_1.existsSync)(info.worktreePath)).toBe(false);
            const { stdout } = await exec("git", ["branch"], { cwd: tmpDir });
            (0, vitest_1.expect)(stdout).not.toContain("work/ticket-1");
        });
        (0, vitest_1.it)("handles remove of untracked worktree gracefully", async () => {
            // Should not throw
            await wm.remove("nonexistent");
        });
    });
    (0, vitest_1.describe)("hasCommits", () => {
        (0, vitest_1.it)("returns false when no commits were made", async () => {
            await wm.create(tmpDir, "step-1", "ticket-1");
            const result = await wm.hasCommits("step-1");
            (0, vitest_1.expect)(result).toBe(false);
        });
        (0, vitest_1.it)("returns true when agent made commits", async () => {
            const info = await wm.create(tmpDir, "step-1", "ticket-1");
            // Simulate agent making a commit in the worktree
            await (0, promises_1.writeFile)((0, node_path_1.join)(info.worktreePath, "new-file.ts"), "export const x = 1;", "utf-8");
            await exec("git", ["add", "-A"], { cwd: info.worktreePath });
            await exec("git", ["commit", "-m", "agent work"], { cwd: info.worktreePath });
            const result = await wm.hasCommits("step-1");
            (0, vitest_1.expect)(result).toBe(true);
        });
        (0, vitest_1.it)("returns false for untracked worktree", async () => {
            const result = await wm.hasCommits("nonexistent");
            (0, vitest_1.expect)(result).toBe(false);
        });
    });
    (0, vitest_1.describe)("merge", () => {
        (0, vitest_1.it)("merges branch into main on success", async () => {
            const info = await wm.create(tmpDir, "step-1", "ticket-1");
            // Agent makes changes in worktree
            await (0, promises_1.writeFile)((0, node_path_1.join)(info.worktreePath, "feature.ts"), "export const feature = true;", "utf-8");
            await exec("git", ["add", "-A"], { cwd: info.worktreePath });
            await exec("git", ["commit", "-m", "add feature"], { cwd: info.worktreePath });
            const result = await wm.merge("step-1", "main");
            (0, vitest_1.expect)(result.merged).toBe(true);
            (0, vitest_1.expect)(result.conflict).toBe(false);
            // Feature file should now be on main
            const { stdout } = await exec("git", ["log", "--oneline", "main"], { cwd: tmpDir });
            (0, vitest_1.expect)(stdout).toContain("opcom: merge ticket-1");
        });
        (0, vitest_1.it)("detects merge conflicts", async () => {
            const info = await wm.create(tmpDir, "step-1", "ticket-1");
            // Agent changes README in worktree
            await (0, promises_1.writeFile)((0, node_path_1.join)(info.worktreePath, "README.md"), "# Changed by agent", "utf-8");
            await exec("git", ["add", "-A"], { cwd: info.worktreePath });
            await exec("git", ["commit", "-m", "agent change"], { cwd: info.worktreePath });
            // Meanwhile, main also changes README
            await (0, promises_1.writeFile)((0, node_path_1.join)(tmpDir, "README.md"), "# Changed on main", "utf-8");
            await exec("git", ["add", "-A"], { cwd: tmpDir });
            await exec("git", ["commit", "-m", "main change"], { cwd: tmpDir });
            const result = await wm.merge("step-1", "main");
            (0, vitest_1.expect)(result.merged).toBe(false);
            (0, vitest_1.expect)(result.conflict).toBe(true);
            // Main should not be in a dirty merge state (abort was called)
            const { stdout } = await exec("git", ["status", "--porcelain"], { cwd: tmpDir });
            (0, vitest_1.expect)(stdout.trim()).toBe("");
        });
        (0, vitest_1.it)("returns error for untracked worktree", async () => {
            const result = await wm.merge("nonexistent");
            (0, vitest_1.expect)(result.merged).toBe(false);
            (0, vitest_1.expect)(result.error).toBeDefined();
        });
    });
    (0, vitest_1.describe)("runInWorktree", () => {
        (0, vitest_1.it)("runs commands in the worktree directory", async () => {
            await wm.create(tmpDir, "step-1", "ticket-1");
            const result = await wm.runInWorktree("step-1", "git", ["status", "--porcelain"]);
            (0, vitest_1.expect)(result.exitCode).toBe(0);
        });
        (0, vitest_1.it)("returns non-zero exit code on command failure", async () => {
            await wm.create(tmpDir, "step-1", "ticket-1");
            const result = await wm.runInWorktree("step-1", "git", ["log", "--invalid-flag"]);
            (0, vitest_1.expect)(result.exitCode).not.toBe(0);
        });
        (0, vitest_1.it)("returns error for untracked worktree", async () => {
            const result = await wm.runInWorktree("nonexistent", "echo", ["hello"]);
            (0, vitest_1.expect)(result.exitCode).toBe(1);
        });
    });
    (0, vitest_1.describe)("restore", () => {
        (0, vitest_1.it)("re-registers worktree info for reconciliation", async () => {
            const info = await wm.create(tmpDir, "step-1", "ticket-1");
            // Simulate restart with new manager
            const wm2 = new worktree_js_1.WorktreeManager();
            (0, vitest_1.expect)(wm2.getInfo("step-1")).toBeUndefined();
            wm2.restore(info);
            (0, vitest_1.expect)(wm2.getInfo("step-1")).toEqual(info);
        });
    });
    (0, vitest_1.describe)("cleanupOrphaned", () => {
        (0, vitest_1.it)("removes worktrees not tracked by any manager", async () => {
            // Create a worktree directly (simulating orphan from crash)
            const wtPath = (0, node_path_1.join)(tmpDir, ".opcom/worktrees/orphan-step");
            await exec("git", ["worktree", "add", wtPath, "-b", "work/orphan"], { cwd: tmpDir });
            (0, vitest_1.expect)((0, node_fs_1.existsSync)(wtPath)).toBe(true);
            const cleaned = await worktree_js_1.WorktreeManager.cleanupOrphaned(tmpDir);
            (0, vitest_1.expect)(cleaned).toContain("orphan-step");
            (0, vitest_1.expect)((0, node_fs_1.existsSync)(wtPath)).toBe(false);
        });
        (0, vitest_1.it)("returns empty array when no worktrees exist", async () => {
            const cleaned = await worktree_js_1.WorktreeManager.cleanupOrphaned(tmpDir);
            (0, vitest_1.expect)(cleaned).toHaveLength(0);
        });
        (0, vitest_1.it)("preserves worktrees with unmerged commits", async () => {
            // Create a worktree and make a commit on its branch
            const wtPath = (0, node_path_1.join)(tmpDir, ".opcom/worktrees/has-work");
            await exec("git", ["worktree", "add", wtPath, "-b", "work/has-work"], { cwd: tmpDir });
            await (0, promises_1.writeFile)((0, node_path_1.join)(wtPath, "agent-output.ts"), "export const x = 1;", "utf-8");
            await exec("git", ["add", "-A"], { cwd: wtPath });
            await exec("git", ["commit", "-m", "agent work"], { cwd: wtPath });
            const cleaned = await worktree_js_1.WorktreeManager.cleanupOrphaned(tmpDir);
            (0, vitest_1.expect)(cleaned).not.toContain("has-work");
            (0, vitest_1.expect)((0, node_fs_1.existsSync)(wtPath)).toBe(true);
            // Clean up
            await exec("git", ["worktree", "remove", wtPath, "--force"], { cwd: tmpDir });
            await exec("git", ["branch", "-D", "work/has-work"], { cwd: tmpDir });
        });
        (0, vitest_1.it)("preserves worktrees with uncommitted changes", async () => {
            // Create a worktree and write files without committing (simulating agent that edited but didn't commit)
            const wtPath = (0, node_path_1.join)(tmpDir, ".opcom/worktrees/uncommitted-work");
            await exec("git", ["worktree", "add", wtPath, "-b", "work/uncommitted-work"], { cwd: tmpDir });
            await (0, promises_1.writeFile)((0, node_path_1.join)(wtPath, "agent-output.ts"), "export const x = 1;", "utf-8");
            const cleaned = await worktree_js_1.WorktreeManager.cleanupOrphaned(tmpDir);
            (0, vitest_1.expect)(cleaned).not.toContain("uncommitted-work");
            (0, vitest_1.expect)((0, node_fs_1.existsSync)(wtPath)).toBe(true);
            // Clean up
            await exec("git", ["worktree", "remove", wtPath, "--force"], { cwd: tmpDir });
            await exec("git", ["branch", "-D", "work/uncommitted-work"], { cwd: tmpDir });
        });
    });
    (0, vitest_1.describe)("lock file", () => {
        (0, vitest_1.it)("writeLock creates .opcom-lock with PID", async () => {
            const info = await wm.create(tmpDir, "step-1", "ticket-1");
            await wm.writeLock("step-1", 12345);
            const lockPath = (0, node_path_1.join)(info.worktreePath, ".opcom-lock");
            (0, vitest_1.expect)((0, node_fs_1.existsSync)(lockPath)).toBe(true);
            const content = await (0, promises_1.readFile)(lockPath, "utf-8");
            (0, vitest_1.expect)(content).toBe("12345");
        });
        (0, vitest_1.it)("remove deletes lock file along with worktree", async () => {
            const info = await wm.create(tmpDir, "step-1", "ticket-1");
            await wm.writeLock("step-1", 12345);
            const lockPath = (0, node_path_1.join)(info.worktreePath, ".opcom-lock");
            (0, vitest_1.expect)((0, node_fs_1.existsSync)(lockPath)).toBe(true);
            await wm.remove("step-1");
            (0, vitest_1.expect)((0, node_fs_1.existsSync)(info.worktreePath)).toBe(false);
        });
        (0, vitest_1.it)("cleanupOrphaned skips worktree with live PID", async () => {
            // Create an orphan worktree with a lock file containing current process PID
            const wtPath = (0, node_path_1.join)(tmpDir, ".opcom/worktrees/locked-step");
            await exec("git", ["worktree", "add", wtPath, "-b", "work/locked-step"], { cwd: tmpDir });
            await (0, promises_1.writeFile)((0, node_path_1.join)(wtPath, ".opcom-lock"), String(process.pid), "utf-8");
            const cleaned = await worktree_js_1.WorktreeManager.cleanupOrphaned(tmpDir);
            (0, vitest_1.expect)(cleaned).not.toContain("locked-step");
            (0, vitest_1.expect)((0, node_fs_1.existsSync)(wtPath)).toBe(true);
            // Clean up
            await exec("git", ["worktree", "remove", wtPath, "--force"], { cwd: tmpDir });
            await exec("git", ["branch", "-D", "work/locked-step"], { cwd: tmpDir });
        });
        (0, vitest_1.it)("cleanupOrphaned removes worktree with dead PID", async () => {
            const wtPath = (0, node_path_1.join)(tmpDir, ".opcom/worktrees/dead-step");
            await exec("git", ["worktree", "add", wtPath, "-b", "work/dead-step"], { cwd: tmpDir });
            // Use PID 999999 which almost certainly doesn't exist
            await (0, promises_1.writeFile)((0, node_path_1.join)(wtPath, ".opcom-lock"), "999999", "utf-8");
            const cleaned = await worktree_js_1.WorktreeManager.cleanupOrphaned(tmpDir);
            (0, vitest_1.expect)(cleaned).toContain("dead-step");
            (0, vitest_1.expect)((0, node_fs_1.existsSync)(wtPath)).toBe(false);
        });
        (0, vitest_1.it)("create refuses to destroy worktree with live agent lock", async () => {
            const info = await wm.create(tmpDir, "step-1", "ticket-1");
            // Write a lock with the current PID (simulates a live agent)
            await (0, promises_1.writeFile)((0, node_path_1.join)(info.worktreePath, ".opcom-lock"), String(process.pid), "utf-8");
            // A second manager tries to create the same worktree
            const wm2 = new worktree_js_1.WorktreeManager();
            await (0, vitest_1.expect)(wm2.create(tmpDir, "step-1", "ticket-1")).rejects.toThrow(/in use by process/);
            // Original worktree should still exist
            (0, vitest_1.expect)((0, node_fs_1.existsSync)(info.worktreePath)).toBe(true);
        });
        (0, vitest_1.it)("create removes worktree with dead agent lock", async () => {
            const info = await wm.create(tmpDir, "step-1", "ticket-1");
            // Write a lock with a dead PID
            await (0, promises_1.writeFile)((0, node_path_1.join)(info.worktreePath, ".opcom-lock"), "999999", "utf-8");
            // A second manager should be able to recreate it
            const wm2 = new worktree_js_1.WorktreeManager();
            const info2 = await wm2.create(tmpDir, "step-1", "ticket-1");
            (0, vitest_1.expect)((0, node_fs_1.existsSync)(info2.worktreePath)).toBe(true);
        });
        (0, vitest_1.it)("create writes initial lock file with executor PID", async () => {
            const info = await wm.create(tmpDir, "step-1", "ticket-1");
            const lockPath = (0, node_path_1.join)(info.worktreePath, ".opcom-lock");
            (0, vitest_1.expect)((0, node_fs_1.existsSync)(lockPath)).toBe(true);
            const content = await (0, promises_1.readFile)(lockPath, "utf-8");
            (0, vitest_1.expect)(content).toBe(String(process.pid));
        });
        (0, vitest_1.it)("cleanupOrphaned removes worktree with no lock file", async () => {
            const wtPath = (0, node_path_1.join)(tmpDir, ".opcom/worktrees/no-lock-step");
            await exec("git", ["worktree", "add", wtPath, "-b", "work/no-lock-step"], { cwd: tmpDir });
            const cleaned = await worktree_js_1.WorktreeManager.cleanupOrphaned(tmpDir);
            (0, vitest_1.expect)(cleaned).toContain("no-lock-step");
            (0, vitest_1.expect)((0, node_fs_1.existsSync)(wtPath)).toBe(false);
        });
    });
    (0, vitest_1.describe)("full lifecycle", () => {
        (0, vitest_1.it)("create → agent work → hasCommits → merge → remove", async () => {
            // 1. Create worktree
            const info = await wm.create(tmpDir, "step-1", "ticket-1");
            (0, vitest_1.expect)((0, node_fs_1.existsSync)(info.worktreePath)).toBe(true);
            // 2. Agent makes changes
            await (0, promises_1.writeFile)((0, node_path_1.join)(info.worktreePath, "feature.ts"), "const x = 1;", "utf-8");
            await exec("git", ["add", "-A"], { cwd: info.worktreePath });
            await exec("git", ["commit", "-m", "implement feature"], { cwd: info.worktreePath });
            // 3. Verify commits
            (0, vitest_1.expect)(await wm.hasCommits("step-1")).toBe(true);
            // 4. Merge
            const mergeResult = await wm.merge("step-1", "main");
            (0, vitest_1.expect)(mergeResult.merged).toBe(true);
            // 5. Verify feature is on main
            (0, vitest_1.expect)((0, node_fs_1.existsSync)((0, node_path_1.join)(tmpDir, "feature.ts"))).toBe(true);
            // 6. Remove worktree
            await wm.remove("step-1");
            (0, vitest_1.expect)((0, node_fs_1.existsSync)(info.worktreePath)).toBe(false);
        });
        (0, vitest_1.it)("two concurrent agents in separate worktrees don't interfere", async () => {
            const info1 = await wm.create(tmpDir, "step-1", "ticket-1");
            const info2 = await wm.create(tmpDir, "step-2", "ticket-2");
            // Agent 1 creates file-a.ts
            await (0, promises_1.writeFile)((0, node_path_1.join)(info1.worktreePath, "file-a.ts"), "export const a = 1;", "utf-8");
            await exec("git", ["add", "-A"], { cwd: info1.worktreePath });
            await exec("git", ["commit", "-m", "agent 1 work"], { cwd: info1.worktreePath });
            // Agent 2 creates file-b.ts
            await (0, promises_1.writeFile)((0, node_path_1.join)(info2.worktreePath, "file-b.ts"), "export const b = 2;", "utf-8");
            await exec("git", ["add", "-A"], { cwd: info2.worktreePath });
            await exec("git", ["commit", "-m", "agent 2 work"], { cwd: info2.worktreePath });
            // Agent 1 should not see Agent 2's file
            (0, vitest_1.expect)((0, node_fs_1.existsSync)((0, node_path_1.join)(info1.worktreePath, "file-b.ts"))).toBe(false);
            // Agent 2 should not see Agent 1's file
            (0, vitest_1.expect)((0, node_fs_1.existsSync)((0, node_path_1.join)(info2.worktreePath, "file-a.ts"))).toBe(false);
            // Merge agent 1 first
            const result1 = await wm.merge("step-1", "main");
            (0, vitest_1.expect)(result1.merged).toBe(true);
            // Merge agent 2 — no conflict since they touched different files
            const result2 = await wm.merge("step-2", "main");
            (0, vitest_1.expect)(result2.merged).toBe(true);
            // Both files should be on main
            (0, vitest_1.expect)((0, node_fs_1.existsSync)((0, node_path_1.join)(tmpDir, "file-a.ts"))).toBe(true);
            (0, vitest_1.expect)((0, node_fs_1.existsSync)((0, node_path_1.join)(tmpDir, "file-b.ts"))).toBe(true);
            // Cleanup
            await wm.remove("step-1");
            await wm.remove("step-2");
        });
        (0, vitest_1.it)("reuses branch with unmerged commits on create", async () => {
            // 1. Create worktree, agent makes a commit
            const info = await wm.create(tmpDir, "ticket-1", "ticket-1");
            await (0, promises_1.writeFile)((0, node_path_1.join)(info.worktreePath, "feature.ts"), "const x = 1;", "utf-8");
            await exec("git", ["add", "-A"], { cwd: info.worktreePath });
            await exec("git", ["commit", "-m", "agent work"], { cwd: info.worktreePath });
            // 2. Remove worktree (simulating failure cleanup that preserves branch)
            await exec("git", ["worktree", "remove", info.worktreePath, "--force"], { cwd: tmpDir });
            wm = new worktree_js_1.WorktreeManager(); // fresh manager (simulating new plan)
            // 3. Create again for same ticket — should reuse the branch
            const info2 = await wm.create(tmpDir, "ticket-1", "ticket-1");
            (0, vitest_1.expect)((0, node_fs_1.existsSync)(info2.worktreePath)).toBe(true);
            // 4. The previous agent's commit should be present
            (0, vitest_1.expect)(await wm.hasCommits("ticket-1")).toBe(true);
            (0, vitest_1.expect)((0, node_fs_1.existsSync)((0, node_path_1.join)(info2.worktreePath, "feature.ts"))).toBe(true);
            // Cleanup
            await wm.remove("ticket-1");
        });
    });
    (0, vitest_1.describe)("attemptRebase", () => {
        (0, vitest_1.it)("succeeds with clean rebase (no conflicts)", async () => {
            const info = await wm.create(tmpDir, "step-1", "ticket-1");
            // Agent makes changes in worktree (different file from what main will change)
            await (0, promises_1.writeFile)((0, node_path_1.join)(info.worktreePath, "feature.ts"), "export const feature = true;", "utf-8");
            await exec("git", ["add", "-A"], { cwd: info.worktreePath });
            await exec("git", ["commit", "-m", "agent work"], { cwd: info.worktreePath });
            // Meanwhile, main adds a different file
            await (0, promises_1.writeFile)((0, node_path_1.join)(tmpDir, "other.ts"), "export const other = 1;", "utf-8");
            await exec("git", ["add", "-A"], { cwd: tmpDir });
            await exec("git", ["commit", "-m", "main change"], { cwd: tmpDir });
            const result = await wm.attemptRebase("step-1", "main");
            (0, vitest_1.expect)(result.rebased).toBe(true);
            (0, vitest_1.expect)(result.conflict).toBe(false);
            // Worktree should now have both files
            (0, vitest_1.expect)((0, node_fs_1.existsSync)((0, node_path_1.join)(info.worktreePath, "feature.ts"))).toBe(true);
            (0, vitest_1.expect)((0, node_fs_1.existsSync)((0, node_path_1.join)(info.worktreePath, "other.ts"))).toBe(true);
            // Cleanup
            await wm.remove("step-1");
        });
        (0, vitest_1.it)("detects conflicts and aborts rebase", async () => {
            const info = await wm.create(tmpDir, "step-1", "ticket-1");
            // Agent changes README in worktree
            await (0, promises_1.writeFile)((0, node_path_1.join)(info.worktreePath, "README.md"), "# Changed by agent", "utf-8");
            await exec("git", ["add", "-A"], { cwd: info.worktreePath });
            await exec("git", ["commit", "-m", "agent change"], { cwd: info.worktreePath });
            // Meanwhile, main also changes README (conflict!)
            await (0, promises_1.writeFile)((0, node_path_1.join)(tmpDir, "README.md"), "# Changed on main", "utf-8");
            await exec("git", ["add", "-A"], { cwd: tmpDir });
            await exec("git", ["commit", "-m", "main change"], { cwd: tmpDir });
            const result = await wm.attemptRebase("step-1", "main");
            (0, vitest_1.expect)(result.rebased).toBe(false);
            (0, vitest_1.expect)(result.conflict).toBe(true);
            (0, vitest_1.expect)(result.conflictFiles).toBeDefined();
            // Worktree should be in a clean state (rebase was aborted)
            const { stdout } = await exec("git", ["status", "--porcelain"], { cwd: info.worktreePath });
            (0, vitest_1.expect)(stdout.trim()).toBe("");
            // Cleanup
            await wm.remove("step-1");
        });
        (0, vitest_1.it)("returns error for untracked worktree", async () => {
            const result = await wm.attemptRebase("nonexistent");
            (0, vitest_1.expect)(result.rebased).toBe(false);
            (0, vitest_1.expect)(result.error).toBeDefined();
        });
    });
});
//# sourceMappingURL=worktree.test.js.map