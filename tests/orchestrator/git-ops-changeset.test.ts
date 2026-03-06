import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { captureChangeset, getTicketDiff } from "@opcom/core";

const exec = promisify(execFile);

async function git(cwd: string, ...args: string[]): Promise<string> {
  const { stdout } = await exec("git", args, { cwd });
  return stdout.trim();
}

describe("captureChangeset — real git repo", () => {
  let repoDir: string;

  beforeEach(async () => {
    repoDir = await mkdtemp(join(tmpdir(), "opcom-changeset-test-"));
    await git(repoDir, "init", "-b", "main");
    await git(repoDir, "config", "user.email", "test@test.com");
    await git(repoDir, "config", "user.name", "Test");

    // Create initial commit
    await writeFile(join(repoDir, "README.md"), "# Test\n");
    await git(repoDir, "add", "-A");
    await git(repoDir, "commit", "-m", "initial commit");
  });

  afterEach(async () => {
    await rm(repoDir, { recursive: true, force: true });
  });

  it("captures changeset for a single commit (legacy mode)", async () => {
    await writeFile(join(repoDir, "src.ts"), "export const x = 1;\n");
    await git(repoDir, "add", "-A");
    await git(repoDir, "commit", "-m", "add src");

    const sha = await git(repoDir, "rev-parse", "HEAD");

    const cs = await captureChangeset(repoDir, {
      sessionId: "sess-1",
      ticketId: "ticket-1",
      projectId: "proj-1",
      commitSha: sha,
    });

    expect(cs).not.toBeNull();
    expect(cs!.sessionId).toBe("sess-1");
    expect(cs!.ticketId).toBe("ticket-1");
    expect(cs!.commitShas).toEqual([sha]);
    expect(cs!.files).toHaveLength(1);
    expect(cs!.files[0].path).toBe("src.ts");
    expect(cs!.files[0].status).toBe("added");
    expect(cs!.files[0].insertions).toBe(1);
    expect(cs!.totalInsertions).toBe(1);
    expect(cs!.totalDeletions).toBe(0);
  });

  it("captures changeset for branch-based (worktree) mode", async () => {
    // Create a feature branch with commits
    await git(repoDir, "checkout", "-b", "feature/test");
    await writeFile(join(repoDir, "a.ts"), "const a = 1;\n");
    await git(repoDir, "add", "-A");
    await git(repoDir, "commit", "-m", "add a");

    await writeFile(join(repoDir, "b.ts"), "const b = 2;\n");
    await git(repoDir, "add", "-A");
    await git(repoDir, "commit", "-m", "add b");

    const cs = await captureChangeset(repoDir, {
      sessionId: "sess-2",
      ticketId: "ticket-2",
      projectId: "proj-1",
      branch: "feature/test",
      baseBranch: "main",
    });

    expect(cs).not.toBeNull();
    expect(cs!.commitShas).toHaveLength(2);
    expect(cs!.files).toHaveLength(2);
    const paths = cs!.files.map((f) => f.path).sort();
    expect(paths).toEqual(["a.ts", "b.ts"]);
    expect(cs!.totalInsertions).toBe(2);
  });

  it("returns null when branch has no commits beyond base", async () => {
    await git(repoDir, "checkout", "-b", "empty-branch");

    const cs = await captureChangeset(repoDir, {
      sessionId: "sess-3",
      ticketId: "ticket-3",
      projectId: "proj-1",
      branch: "empty-branch",
      baseBranch: "main",
    });

    expect(cs).toBeNull();
  });

  it("captures deletions and modifications", async () => {
    await writeFile(join(repoDir, "to-delete.ts"), "remove me\n");
    await git(repoDir, "add", "-A");
    await git(repoDir, "commit", "-m", "add file to delete");

    await git(repoDir, "checkout", "-b", "feature/modify");

    // Modify README
    await writeFile(join(repoDir, "README.md"), "# Updated\nNew line\n");
    // Delete file
    const { unlink } = await import("node:fs/promises");
    await unlink(join(repoDir, "to-delete.ts"));
    await git(repoDir, "add", "-A");
    await git(repoDir, "commit", "-m", "modify and delete");

    // Base is the commit before branching (HEAD of main before checkout)
    const cs = await captureChangeset(repoDir, {
      sessionId: "sess-4",
      ticketId: "ticket-4",
      projectId: "proj-1",
      branch: "feature/modify",
      baseBranch: "main",
    });

    expect(cs).not.toBeNull();
    expect(cs!.files).toHaveLength(2);

    const readme = cs!.files.find((f) => f.path === "README.md");
    expect(readme).toBeDefined();
    expect(readme!.status).toBe("modified");

    const deleted = cs!.files.find((f) => f.path === "to-delete.ts");
    expect(deleted).toBeDefined();
    expect(deleted!.status).toBe("deleted");
  });

  it("captures changeset with fallback (no commitSha or branch)", async () => {
    await writeFile(join(repoDir, "fallback.ts"), "fallback\n");
    await git(repoDir, "add", "-A");
    await git(repoDir, "commit", "-m", "fallback commit");

    const cs = await captureChangeset(repoDir, {
      sessionId: "sess-5",
      ticketId: "ticket-5",
      projectId: "proj-1",
    });

    expect(cs).not.toBeNull();
    expect(cs!.files).toHaveLength(1);
    expect(cs!.files[0].path).toBe("fallback.ts");
  });
});

describe("getTicketDiff — real git repo", () => {
  let repoDir: string;

  beforeEach(async () => {
    repoDir = await mkdtemp(join(tmpdir(), "opcom-diff-test-"));
    await git(repoDir, "init", "-b", "main");
    await git(repoDir, "config", "user.email", "test@test.com");
    await git(repoDir, "config", "user.name", "Test");

    await writeFile(join(repoDir, "README.md"), "# Test\n");
    await git(repoDir, "add", "-A");
    await git(repoDir, "commit", "-m", "initial commit");
  });

  afterEach(async () => {
    await rm(repoDir, { recursive: true, force: true });
  });

  it("returns unified diff for single commit", async () => {
    await writeFile(join(repoDir, "file.ts"), "export const x = 42;\n");
    await git(repoDir, "add", "-A");
    await git(repoDir, "commit", "-m", "add file");

    const sha = await git(repoDir, "rev-parse", "HEAD");
    const diff = await getTicketDiff(repoDir, { commitSha: sha });

    expect(diff).toContain("file.ts");
    expect(diff).toContain("+export const x = 42;");
  });

  it("returns unified diff for branch", async () => {
    await git(repoDir, "checkout", "-b", "feature/diff-test");
    await writeFile(join(repoDir, "new.ts"), "new file\n");
    await git(repoDir, "add", "-A");
    await git(repoDir, "commit", "-m", "add new");

    const diff = await getTicketDiff(repoDir, {
      branch: "feature/diff-test",
      baseBranch: "main",
    });

    expect(diff).toContain("new.ts");
    expect(diff).toContain("+new file");
  });

  it("returns combined diff for multi-commit range", async () => {
    // First commit
    await writeFile(join(repoDir, "a.ts"), "const a = 1;\n");
    await git(repoDir, "add", "-A");
    await git(repoDir, "commit", "-m", "add a");

    // Second commit
    await writeFile(join(repoDir, "b.ts"), "const b = 2;\n");
    await git(repoDir, "add", "-A");
    await git(repoDir, "commit", "-m", "add b");

    const newestSha = await git(repoDir, "rev-parse", "HEAD");
    const oldestSha = await git(repoDir, "rev-parse", "HEAD~1");

    // commitShas in reverse chronological order (newest first)
    const diff = await getTicketDiff(repoDir, {
      commitShas: [newestSha, oldestSha],
    });

    expect(diff).toContain("a.ts");
    expect(diff).toContain("b.ts");
    expect(diff).toContain("+const a = 1;");
    expect(diff).toContain("+const b = 2;");
  });

  it("returns empty string on failure", async () => {
    const diff = await getTicketDiff(repoDir, {
      commitSha: "0000000000000000000000000000000000000000",
    });
    expect(diff).toBe("");
  });
});
