"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const node_child_process_1 = require("node:child_process");
const node_util_1 = require("node:util");
const promises_1 = require("node:fs/promises");
const node_path_1 = require("node:path");
const node_os_1 = require("node:os");
const core_1 = require("@opcom/core");
const exec = (0, node_util_1.promisify)(node_child_process_1.execFile);
async function git(cwd, ...args) {
    const { stdout } = await exec("git", args, { cwd });
    return stdout.trim();
}
(0, vitest_1.describe)("captureChangeset — real git repo", () => {
    let repoDir;
    (0, vitest_1.beforeEach)(async () => {
        repoDir = await (0, promises_1.mkdtemp)((0, node_path_1.join)((0, node_os_1.tmpdir)(), "opcom-changeset-test-"));
        await git(repoDir, "init", "-b", "main");
        await git(repoDir, "config", "user.email", "test@test.com");
        await git(repoDir, "config", "user.name", "Test");
        // Create initial commit
        await (0, promises_1.writeFile)((0, node_path_1.join)(repoDir, "README.md"), "# Test\n");
        await git(repoDir, "add", "-A");
        await git(repoDir, "commit", "-m", "initial commit");
    });
    (0, vitest_1.afterEach)(async () => {
        await (0, promises_1.rm)(repoDir, { recursive: true, force: true });
    });
    (0, vitest_1.it)("captures changeset for a single commit (legacy mode)", async () => {
        await (0, promises_1.writeFile)((0, node_path_1.join)(repoDir, "src.ts"), "export const x = 1;\n");
        await git(repoDir, "add", "-A");
        await git(repoDir, "commit", "-m", "add src");
        const sha = await git(repoDir, "rev-parse", "HEAD");
        const cs = await (0, core_1.captureChangeset)(repoDir, {
            sessionId: "sess-1",
            ticketId: "ticket-1",
            projectId: "proj-1",
            commitSha: sha,
        });
        (0, vitest_1.expect)(cs).not.toBeNull();
        (0, vitest_1.expect)(cs.sessionId).toBe("sess-1");
        (0, vitest_1.expect)(cs.ticketId).toBe("ticket-1");
        (0, vitest_1.expect)(cs.commitShas).toEqual([sha]);
        (0, vitest_1.expect)(cs.files).toHaveLength(1);
        (0, vitest_1.expect)(cs.files[0].path).toBe("src.ts");
        (0, vitest_1.expect)(cs.files[0].status).toBe("added");
        (0, vitest_1.expect)(cs.files[0].insertions).toBe(1);
        (0, vitest_1.expect)(cs.totalInsertions).toBe(1);
        (0, vitest_1.expect)(cs.totalDeletions).toBe(0);
    });
    (0, vitest_1.it)("captures changeset for branch-based (worktree) mode", async () => {
        // Create a feature branch with commits
        await git(repoDir, "checkout", "-b", "feature/test");
        await (0, promises_1.writeFile)((0, node_path_1.join)(repoDir, "a.ts"), "const a = 1;\n");
        await git(repoDir, "add", "-A");
        await git(repoDir, "commit", "-m", "add a");
        await (0, promises_1.writeFile)((0, node_path_1.join)(repoDir, "b.ts"), "const b = 2;\n");
        await git(repoDir, "add", "-A");
        await git(repoDir, "commit", "-m", "add b");
        const cs = await (0, core_1.captureChangeset)(repoDir, {
            sessionId: "sess-2",
            ticketId: "ticket-2",
            projectId: "proj-1",
            branch: "feature/test",
            baseBranch: "main",
        });
        (0, vitest_1.expect)(cs).not.toBeNull();
        (0, vitest_1.expect)(cs.commitShas).toHaveLength(2);
        (0, vitest_1.expect)(cs.files).toHaveLength(2);
        const paths = cs.files.map((f) => f.path).sort();
        (0, vitest_1.expect)(paths).toEqual(["a.ts", "b.ts"]);
        (0, vitest_1.expect)(cs.totalInsertions).toBe(2);
    });
    (0, vitest_1.it)("returns null when branch has no commits beyond base", async () => {
        await git(repoDir, "checkout", "-b", "empty-branch");
        const cs = await (0, core_1.captureChangeset)(repoDir, {
            sessionId: "sess-3",
            ticketId: "ticket-3",
            projectId: "proj-1",
            branch: "empty-branch",
            baseBranch: "main",
        });
        (0, vitest_1.expect)(cs).toBeNull();
    });
    (0, vitest_1.it)("captures deletions and modifications", async () => {
        await (0, promises_1.writeFile)((0, node_path_1.join)(repoDir, "to-delete.ts"), "remove me\n");
        await git(repoDir, "add", "-A");
        await git(repoDir, "commit", "-m", "add file to delete");
        await git(repoDir, "checkout", "-b", "feature/modify");
        // Modify README
        await (0, promises_1.writeFile)((0, node_path_1.join)(repoDir, "README.md"), "# Updated\nNew line\n");
        // Delete file
        const { unlink } = await import("node:fs/promises");
        await unlink((0, node_path_1.join)(repoDir, "to-delete.ts"));
        await git(repoDir, "add", "-A");
        await git(repoDir, "commit", "-m", "modify and delete");
        // Base is the commit before branching (HEAD of main before checkout)
        const cs = await (0, core_1.captureChangeset)(repoDir, {
            sessionId: "sess-4",
            ticketId: "ticket-4",
            projectId: "proj-1",
            branch: "feature/modify",
            baseBranch: "main",
        });
        (0, vitest_1.expect)(cs).not.toBeNull();
        (0, vitest_1.expect)(cs.files).toHaveLength(2);
        const readme = cs.files.find((f) => f.path === "README.md");
        (0, vitest_1.expect)(readme).toBeDefined();
        (0, vitest_1.expect)(readme.status).toBe("modified");
        const deleted = cs.files.find((f) => f.path === "to-delete.ts");
        (0, vitest_1.expect)(deleted).toBeDefined();
        (0, vitest_1.expect)(deleted.status).toBe("deleted");
    });
    (0, vitest_1.it)("captures changeset with fallback (no commitSha or branch)", async () => {
        await (0, promises_1.writeFile)((0, node_path_1.join)(repoDir, "fallback.ts"), "fallback\n");
        await git(repoDir, "add", "-A");
        await git(repoDir, "commit", "-m", "fallback commit");
        const cs = await (0, core_1.captureChangeset)(repoDir, {
            sessionId: "sess-5",
            ticketId: "ticket-5",
            projectId: "proj-1",
        });
        (0, vitest_1.expect)(cs).not.toBeNull();
        (0, vitest_1.expect)(cs.files).toHaveLength(1);
        (0, vitest_1.expect)(cs.files[0].path).toBe("fallback.ts");
    });
});
(0, vitest_1.describe)("getTicketDiff — real git repo", () => {
    let repoDir;
    (0, vitest_1.beforeEach)(async () => {
        repoDir = await (0, promises_1.mkdtemp)((0, node_path_1.join)((0, node_os_1.tmpdir)(), "opcom-diff-test-"));
        await git(repoDir, "init", "-b", "main");
        await git(repoDir, "config", "user.email", "test@test.com");
        await git(repoDir, "config", "user.name", "Test");
        await (0, promises_1.writeFile)((0, node_path_1.join)(repoDir, "README.md"), "# Test\n");
        await git(repoDir, "add", "-A");
        await git(repoDir, "commit", "-m", "initial commit");
    });
    (0, vitest_1.afterEach)(async () => {
        await (0, promises_1.rm)(repoDir, { recursive: true, force: true });
    });
    (0, vitest_1.it)("returns unified diff for single commit", async () => {
        await (0, promises_1.writeFile)((0, node_path_1.join)(repoDir, "file.ts"), "export const x = 42;\n");
        await git(repoDir, "add", "-A");
        await git(repoDir, "commit", "-m", "add file");
        const sha = await git(repoDir, "rev-parse", "HEAD");
        const diff = await (0, core_1.getTicketDiff)(repoDir, { commitSha: sha });
        (0, vitest_1.expect)(diff).toContain("file.ts");
        (0, vitest_1.expect)(diff).toContain("+export const x = 42;");
    });
    (0, vitest_1.it)("returns unified diff for branch", async () => {
        await git(repoDir, "checkout", "-b", "feature/diff-test");
        await (0, promises_1.writeFile)((0, node_path_1.join)(repoDir, "new.ts"), "new file\n");
        await git(repoDir, "add", "-A");
        await git(repoDir, "commit", "-m", "add new");
        const diff = await (0, core_1.getTicketDiff)(repoDir, {
            branch: "feature/diff-test",
            baseBranch: "main",
        });
        (0, vitest_1.expect)(diff).toContain("new.ts");
        (0, vitest_1.expect)(diff).toContain("+new file");
    });
    (0, vitest_1.it)("returns combined diff for multi-commit range", async () => {
        // First commit
        await (0, promises_1.writeFile)((0, node_path_1.join)(repoDir, "a.ts"), "const a = 1;\n");
        await git(repoDir, "add", "-A");
        await git(repoDir, "commit", "-m", "add a");
        // Second commit
        await (0, promises_1.writeFile)((0, node_path_1.join)(repoDir, "b.ts"), "const b = 2;\n");
        await git(repoDir, "add", "-A");
        await git(repoDir, "commit", "-m", "add b");
        const newestSha = await git(repoDir, "rev-parse", "HEAD");
        const oldestSha = await git(repoDir, "rev-parse", "HEAD~1");
        // commitShas in reverse chronological order (newest first)
        const diff = await (0, core_1.getTicketDiff)(repoDir, {
            commitShas: [newestSha, oldestSha],
        });
        (0, vitest_1.expect)(diff).toContain("a.ts");
        (0, vitest_1.expect)(diff).toContain("b.ts");
        (0, vitest_1.expect)(diff).toContain("+const a = 1;");
        (0, vitest_1.expect)(diff).toContain("+const b = 2;");
    });
    (0, vitest_1.it)("returns empty string on failure", async () => {
        const diff = await (0, core_1.getTicketDiff)(repoDir, {
            commitSha: "0000000000000000000000000000000000000000",
        });
        (0, vitest_1.expect)(diff).toBe("");
    });
});
//# sourceMappingURL=git-ops-changeset.test.js.map