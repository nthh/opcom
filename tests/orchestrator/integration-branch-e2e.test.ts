import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { WorktreeManager } from "../../packages/core/src/orchestrator/worktree.js";
import { computePlan } from "../../packages/core/src/orchestrator/planner.js";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { WorkItem } from "@opcom/types";

const exec = promisify(execFile);

async function initGitRepo(dir: string): Promise<void> {
  await exec("git", ["init", "-b", "main"], { cwd: dir });
  await exec("git", ["config", "user.email", "test@test.com"], { cwd: dir });
  await exec("git", ["config", "user.name", "Test"], { cwd: dir });
  await writeFile(join(dir, "README.md"), "# Test Project", "utf-8");
  await writeFile(join(dir, "shared.ts"), "export const VERSION = 1;", "utf-8");
  await exec("git", ["add", "-A"], { cwd: dir });
  await exec("git", ["commit", "-m", "initial commit"], { cwd: dir });
}

/** Get the current branch name in a repo */
async function currentBranch(cwd: string): Promise<string> {
  const { stdout } = await exec("git", ["rev-parse", "--abbrev-ref", "HEAD"], { cwd });
  return stdout.trim();
}

/** Get the list of commits on a branch (oneline format) */
async function logOneline(cwd: string, branch?: string): Promise<string> {
  const args = ["log", "--oneline"];
  if (branch) args.push(branch);
  const { stdout } = await exec("git", args, { cwd });
  return stdout.trim();
}

/** Check if a file exists on a given branch */
async function fileExistsOnBranch(cwd: string, branch: string, filePath: string): Promise<boolean> {
  try {
    await exec("git", ["show", `${branch}:${filePath}`], { cwd });
    return true;
  } catch {
    return false;
  }
}

/** Get file content on a given branch */
async function fileContentOnBranch(cwd: string, branch: string, filePath: string): Promise<string> {
  const { stdout } = await exec("git", ["show", `${branch}:${filePath}`], { cwd });
  return stdout;
}

/** Count first-parent merge commits on a branch (direct merges only, not inherited) */
async function countFirstParentMerges(cwd: string, branch: string): Promise<number> {
  const { stdout } = await exec("git", ["log", "--first-parent", "--merges", "--oneline", branch], { cwd });
  if (!stdout.trim()) return 0;
  return stdout.trim().split("\n").length;
}

/** Helper to create a WorkItem for planner tests */
function makeTicket(opts: {
  id: string;
  parent?: string;
  deps?: string[];
}): WorkItem {
  return {
    id: opts.id,
    title: opts.id,
    status: "open",
    source: ".tickets",
    path: `/tmp/test/.tickets/${opts.id}.md`,
    parent: opts.parent,
    deps: opts.deps ?? [],
  };
}

interface TicketSet {
  projectId: string;
  tickets: WorkItem[];
}

describe("Integration branch end-to-end", () => {
  let tmpDir: string;
  let wm: WorktreeManager;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "opcom-ib-e2e-"));
    await initGitRepo(tmpDir);
    wm = new WorktreeManager();
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  // --- Planner: 3-child detection ---

  describe("planner: parent with 3 child tickets", () => {
    it("sets integrationBranch on all 3 child steps", () => {
      const tickets: TicketSet[] = [
        {
          projectId: "proj",
          tickets: [
            makeTicket({ id: "data-export" }),
            makeTicket({ id: "export-framework", parent: "data-export" }),
            makeTicket({ id: "export-vector", parent: "data-export", deps: ["export-framework"] }),
            makeTicket({ id: "export-raster", parent: "data-export", deps: ["export-framework"] }),
          ],
        },
      ];

      const plan = computePlan(tickets, {}, "e2e-plan", undefined, { worktree: true });

      // Parent excluded from steps
      expect(plan.steps.find((s) => s.ticketId === "data-export")).toBeUndefined();

      // All 3 children get integration branch
      const framework = plan.steps.find((s) => s.ticketId === "data-export/export-framework")!;
      const vector = plan.steps.find((s) => s.ticketId === "data-export/export-vector")!;
      const raster = plan.steps.find((s) => s.ticketId === "data-export/export-raster")!;

      expect(framework.integrationBranch).toBe("work/data-export/_integration");
      expect(vector.integrationBranch).toBe("work/data-export/_integration");
      expect(raster.integrationBranch).toBe("work/data-export/_integration");
    });

    it("worktree: false → no integrationBranch set even for children", () => {
      const tickets: TicketSet[] = [
        {
          projectId: "proj",
          tickets: [
            makeTicket({ id: "data-export" }),
            makeTicket({ id: "export-framework", parent: "data-export" }),
            makeTicket({ id: "export-vector", parent: "data-export", deps: ["export-framework"] }),
            makeTicket({ id: "export-raster", parent: "data-export", deps: ["export-framework"] }),
          ],
        },
      ];

      const plan = computePlan(tickets, {}, "e2e-plan", undefined, { worktree: false });

      // Children should still be in the plan
      const framework = plan.steps.find((s) => s.ticketId === "data-export/export-framework")!;
      const vector = plan.steps.find((s) => s.ticketId === "data-export/export-vector")!;
      const raster = plan.steps.find((s) => s.ticketId === "data-export/export-raster")!;

      expect(framework).toBeDefined();
      expect(vector).toBeDefined();
      expect(raster).toBeDefined();

      // No integrationBranch when worktree is disabled
      expect(framework.integrationBranch).toBeUndefined();
      expect(vector.integrationBranch).toBeUndefined();
      expect(raster.integrationBranch).toBeUndefined();
    });
  });

  // --- Child worktree branches from integration branch ---

  describe("child worktree branches from integration branch", () => {
    it("child worktree is based on integration branch, not main", async () => {
      // Create integration branch with extra content
      await WorktreeManager.createBranch(tmpDir, "work/parent");

      // Add a commit to integration branch (simulate prior child work)
      const tempWt = join(tmpDir, ".opcom/worktrees/__temp");
      await exec("git", ["worktree", "add", tempWt, "work/parent"], { cwd: tmpDir });
      await writeFile(join(tempWt, "integration-only.ts"), "export const x = 1;", "utf-8");
      await exec("git", ["add", "-A"], { cwd: tempWt });
      await exec("git", ["commit", "-m", "integration branch content"], { cwd: tempWt });
      await exec("git", ["worktree", "remove", tempWt, "--force"], { cwd: tmpDir });

      // Create child worktree from integration branch
      const info = await wm.create(tmpDir, "child-a", "child-a", "work/parent");

      // Child should see the integration branch content
      expect(existsSync(join(info.worktreePath, "integration-only.ts"))).toBe(true);

      // Main should NOT have this content
      expect(await fileExistsOnBranch(tmpDir, "main", "integration-only.ts")).toBe(false);

      // Git log in the child worktree should show the integration branch commit
      const childLog = await logOneline(info.worktreePath);
      expect(childLog).toContain("integration branch content");

      await wm.remove("child-a");
      await exec("git", ["branch", "-D", "work/parent"], { cwd: tmpDir });
    });
  });

  // --- Child merge targets integration branch ---

  describe("child merge targets integration branch", () => {
    it("merge goes to integration branch, not main", async () => {
      // Create integration branch
      await WorktreeManager.createBranch(tmpDir, "work/parent");

      // Create child worktree from integration branch
      const info = await wm.create(tmpDir, "child-a", "child-a", "work/parent");

      // Agent makes changes in child worktree
      await writeFile(join(info.worktreePath, "child-a-feature.ts"), "export const childA = true;", "utf-8");
      await exec("git", ["add", "-A"], { cwd: info.worktreePath });
      await exec("git", ["commit", "-m", "child-a work"], { cwd: info.worktreePath });

      // Merge child to integration branch (not main)
      const result = await wm.merge("child-a", "work/parent");
      expect(result.merged).toBe(true);

      // Integration branch should have the child's file
      expect(await fileExistsOnBranch(tmpDir, "work/parent", "child-a-feature.ts")).toBe(true);

      // Main should NOT have the child's file
      expect(await fileExistsOnBranch(tmpDir, "main", "child-a-feature.ts")).toBe(false);

      // Main repo should still be on main
      expect(await currentBranch(tmpDir)).toBe("main");

      await wm.remove("child-a");
      await exec("git", ["branch", "-D", "work/parent"], { cwd: tmpDir });
    });

    it("main is unchanged after child merge to integration branch", async () => {
      // Record main HEAD before
      const { stdout: mainHeadBefore } = await exec("git", ["rev-parse", "main"], { cwd: tmpDir });

      // Create integration branch and child
      await WorktreeManager.createBranch(tmpDir, "work/parent");
      const info = await wm.create(tmpDir, "child-a", "child-a", "work/parent");

      // Agent work
      await writeFile(join(info.worktreePath, "feature.ts"), "export const f = 1;", "utf-8");
      await exec("git", ["add", "-A"], { cwd: info.worktreePath });
      await exec("git", ["commit", "-m", "agent work"], { cwd: info.worktreePath });

      // Merge to integration branch
      await wm.merge("child-a", "work/parent");

      // Main HEAD should not have changed
      const { stdout: mainHeadAfter } = await exec("git", ["rev-parse", "main"], { cwd: tmpDir });
      expect(mainHeadAfter.trim()).toBe(mainHeadBefore.trim());

      await wm.remove("child-a");
      await exec("git", ["branch", "-D", "work/parent"], { cwd: tmpDir });
    });
  });

  // --- Dependency ordering ---

  describe("dependency ordering", () => {
    it("child B's worktree includes child A's merged code", async () => {
      // Create integration branch
      await WorktreeManager.createBranch(tmpDir, "work/parent");

      // Child A works and merges to integration branch
      const infoA = await wm.create(tmpDir, "child-a", "child-a", "work/parent");
      await writeFile(join(infoA.worktreePath, "child-a.ts"), "export const a = 1;", "utf-8");
      await exec("git", ["add", "-A"], { cwd: infoA.worktreePath });
      await exec("git", ["commit", "-m", "child-a work"], { cwd: infoA.worktreePath });

      const mergeA = await wm.merge("child-a", "work/parent");
      expect(mergeA.merged).toBe(true);
      await wm.remove("child-a");

      // Child B created from integration branch AFTER child A merged
      const infoB = await wm.create(tmpDir, "child-b", "child-b", "work/parent");

      // Child B should see child A's work
      expect(existsSync(join(infoB.worktreePath, "child-a.ts"))).toBe(true);
      const content = await fileContentOnBranch(tmpDir, "work/parent", "child-a.ts");
      expect(content).toContain("export const a = 1");

      // Child B adds its own work
      await writeFile(join(infoB.worktreePath, "child-b.ts"), "export const b = 2;", "utf-8");
      await exec("git", ["add", "-A"], { cwd: infoB.worktreePath });
      await exec("git", ["commit", "-m", "child-b work"], { cwd: infoB.worktreePath });

      const mergeB = await wm.merge("child-b", "work/parent");
      expect(mergeB.merged).toBe(true);

      // Integration branch now has both
      expect(await fileExistsOnBranch(tmpDir, "work/parent", "child-a.ts")).toBe(true);
      expect(await fileExistsOnBranch(tmpDir, "work/parent", "child-b.ts")).toBe(true);

      // Main still has neither
      expect(await fileExistsOnBranch(tmpDir, "main", "child-a.ts")).toBe(false);
      expect(await fileExistsOnBranch(tmpDir, "main", "child-b.ts")).toBe(false);

      await wm.remove("child-b");
      await exec("git", ["branch", "-D", "work/parent"], { cwd: tmpDir });
    });
  });

  // --- Full lifecycle ---

  describe("full lifecycle", () => {
    it("integration branch → children work → merge children → merge to main → cleanup", async () => {
      // 1. Create integration branch
      await WorktreeManager.createBranch(tmpDir, "work/parent");

      // 2. Child A works
      const infoA = await wm.create(tmpDir, "child-a", "child-a", "work/parent");
      await writeFile(join(infoA.worktreePath, "child-a.ts"), "export const a = 1;", "utf-8");
      await exec("git", ["add", "-A"], { cwd: infoA.worktreePath });
      await exec("git", ["commit", "-m", "child-a implementation"], { cwd: infoA.worktreePath });

      expect(await wm.hasCommits("child-a", "work/parent")).toBe(true);
      const mergeA = await wm.merge("child-a", "work/parent");
      expect(mergeA.merged).toBe(true);
      await wm.remove("child-a");

      // 3. Child B works (depends on A — branches from integration branch with A's work)
      const infoB = await wm.create(tmpDir, "child-b", "child-b", "work/parent");
      expect(existsSync(join(infoB.worktreePath, "child-a.ts"))).toBe(true);
      await writeFile(join(infoB.worktreePath, "child-b.ts"), "export const b = 2;", "utf-8");
      await exec("git", ["add", "-A"], { cwd: infoB.worktreePath });
      await exec("git", ["commit", "-m", "child-b implementation"], { cwd: infoB.worktreePath });

      const mergeB = await wm.merge("child-b", "work/parent");
      expect(mergeB.merged).toBe(true);
      await wm.remove("child-b");

      // 4. Child C works (parallel with B — branches from integration branch)
      const infoC = await wm.create(tmpDir, "child-c", "child-c", "work/parent");
      await writeFile(join(infoC.worktreePath, "child-c.ts"), "export const c = 3;", "utf-8");
      await exec("git", ["add", "-A"], { cwd: infoC.worktreePath });
      await exec("git", ["commit", "-m", "child-c implementation"], { cwd: infoC.worktreePath });

      const mergeC = await wm.merge("child-c", "work/parent");
      expect(mergeC.merged).toBe(true);
      await wm.remove("child-c");

      // 5. Merge integration branch to main
      const finalMerge = await WorktreeManager.mergeIntegrationBranch(tmpDir, "work/parent");
      expect(finalMerge.merged).toBe(true);

      // 6. Verify main has all children's work
      expect(await fileExistsOnBranch(tmpDir, "main", "child-a.ts")).toBe(true);
      expect(await fileExistsOnBranch(tmpDir, "main", "child-b.ts")).toBe(true);
      expect(await fileExistsOnBranch(tmpDir, "main", "child-c.ts")).toBe(true);

      // 7. Delete integration branch
      await WorktreeManager.deleteBranch(tmpDir, "work/parent");
      const { stdout: branches } = await exec("git", ["branch"], { cwd: tmpDir });
      expect(branches).not.toContain("work/parent");
    });

    it("main has single merge commit containing all children's work", async () => {
      // Record initial main first-parent merge count
      const initialMerges = await countFirstParentMerges(tmpDir, "main");

      // Setup: integration branch with 2 children
      await WorktreeManager.createBranch(tmpDir, "work/parent");

      const infoA = await wm.create(tmpDir, "child-a", "child-a", "work/parent");
      await writeFile(join(infoA.worktreePath, "a.ts"), "a", "utf-8");
      await exec("git", ["add", "-A"], { cwd: infoA.worktreePath });
      await exec("git", ["commit", "-m", "child-a"], { cwd: infoA.worktreePath });
      await wm.merge("child-a", "work/parent");
      await wm.remove("child-a");

      const infoB = await wm.create(tmpDir, "child-b", "child-b", "work/parent");
      await writeFile(join(infoB.worktreePath, "b.ts"), "b", "utf-8");
      await exec("git", ["add", "-A"], { cwd: infoB.worktreePath });
      await exec("git", ["commit", "-m", "child-b"], { cwd: infoB.worktreePath });
      await wm.merge("child-b", "work/parent");
      await wm.remove("child-b");

      // Merge integration branch to main
      await WorktreeManager.mergeIntegrationBranch(tmpDir, "work/parent");

      // Main should have exactly one new first-parent merge commit (the integration branch merge)
      // Child-to-integration merges are in the integration branch history, not direct on main
      const finalMerges = await countFirstParentMerges(tmpDir, "main");
      expect(finalMerges).toBe(initialMerges + 1);

      // The merge commit message should reference the integration branch
      const mainLog = await logOneline(tmpDir, "main");
      expect(mainLog).toContain("opcom: merge integration branch work/parent");

      // Both files present on main
      expect(await fileExistsOnBranch(tmpDir, "main", "a.ts")).toBe(true);
      expect(await fileExistsOnBranch(tmpDir, "main", "b.ts")).toBe(true);

      await exec("git", ["branch", "-D", "work/parent"], { cwd: tmpDir });
    });

    it("integration branch is deleted after successful merge to main", async () => {
      await WorktreeManager.createBranch(tmpDir, "work/parent");

      const info = await wm.create(tmpDir, "child-a", "child-a", "work/parent");
      await writeFile(join(info.worktreePath, "a.ts"), "a", "utf-8");
      await exec("git", ["add", "-A"], { cwd: info.worktreePath });
      await exec("git", ["commit", "-m", "work"], { cwd: info.worktreePath });
      await wm.merge("child-a", "work/parent");
      await wm.remove("child-a");

      // Merge to main
      await WorktreeManager.mergeIntegrationBranch(tmpDir, "work/parent");

      // Delete integration branch
      await WorktreeManager.deleteBranch(tmpDir, "work/parent");

      // Branch should be gone
      const { stdout: branches } = await exec("git", ["branch"], { cwd: tmpDir });
      expect(branches).not.toContain("work/parent");

      // Main should still have the work
      expect(await fileExistsOnBranch(tmpDir, "main", "a.ts")).toBe(true);
    });
  });

  // --- Rebase handling ---

  describe("rebase handling", () => {
    it("child→integration rebase succeeds when integration branch advanced", async () => {
      // Create integration branch
      await WorktreeManager.createBranch(tmpDir, "work/parent");

      // Child A branches from integration branch
      const infoA = await wm.create(tmpDir, "child-a", "child-a", "work/parent");

      // Child A works on a feature file
      await writeFile(join(infoA.worktreePath, "feature-a.ts"), "export const a = 1;", "utf-8");
      await exec("git", ["add", "-A"], { cwd: infoA.worktreePath });
      await exec("git", ["commit", "-m", "child-a work"], { cwd: infoA.worktreePath });

      // Meanwhile, another child's merge advances the integration branch (different file)
      const tempWt = join(tmpDir, ".opcom/worktrees/__temp-adv");
      await exec("git", ["worktree", "add", tempWt, "work/parent"], { cwd: tmpDir });
      await writeFile(join(tempWt, "other-child.ts"), "export const other = 1;", "utf-8");
      await exec("git", ["add", "-A"], { cwd: tempWt });
      await exec("git", ["commit", "-m", "other child merged"], { cwd: tempWt });
      await exec("git", ["worktree", "remove", tempWt, "--force"], { cwd: tmpDir });

      // Rebase child-a onto updated integration branch (no conflict — different files)
      const rebaseResult = await wm.attemptRebase("child-a", "work/parent");
      expect(rebaseResult.rebased).toBe(true);
      expect(rebaseResult.conflict).toBe(false);

      // After rebase, child-a should see the other child's file
      expect(existsSync(join(infoA.worktreePath, "other-child.ts"))).toBe(true);

      // Merge should now succeed cleanly
      const mergeResult = await wm.merge("child-a", "work/parent");
      expect(mergeResult.merged).toBe(true);

      await wm.remove("child-a");
      await exec("git", ["branch", "-D", "work/parent"], { cwd: tmpDir });
    });

    it("child→integration rebase conflict is detected (not child→main)", async () => {
      // Create integration branch
      await WorktreeManager.createBranch(tmpDir, "work/parent");

      // Child A branches from integration branch
      const infoA = await wm.create(tmpDir, "child-a", "child-a", "work/parent");

      // Child A modifies shared.ts
      await writeFile(join(infoA.worktreePath, "shared.ts"), "export const VERSION = 999; // child-a", "utf-8");
      await exec("git", ["add", "-A"], { cwd: infoA.worktreePath });
      await exec("git", ["commit", "-m", "child-a changes shared.ts"], { cwd: infoA.worktreePath });

      // Another child also changes shared.ts on integration branch (conflict!)
      const tempWt = join(tmpDir, ".opcom/worktrees/__temp-conflict");
      await exec("git", ["worktree", "add", tempWt, "work/parent"], { cwd: tmpDir });
      await writeFile(join(tempWt, "shared.ts"), "export const VERSION = 888; // other child", "utf-8");
      await exec("git", ["add", "-A"], { cwd: tempWt });
      await exec("git", ["commit", "-m", "other child changes shared.ts"], { cwd: tempWt });
      await exec("git", ["worktree", "remove", tempWt, "--force"], { cwd: tmpDir });

      // Rebase child-a onto integration branch → conflict
      const rebaseResult = await wm.attemptRebase("child-a", "work/parent");
      expect(rebaseResult.rebased).toBe(false);
      expect(rebaseResult.conflict).toBe(true);

      // Worktree should be clean (rebase was aborted)
      const { stdout: status } = await exec("git", ["status", "--porcelain"], { cwd: infoA.worktreePath });
      expect(status.trim()).toBe("");

      await wm.remove("child-a");
      await exec("git", ["branch", "-D", "work/parent"], { cwd: tmpDir });
    });

    it("integration→main conflict at final merge is detected", async () => {
      // Create integration branch
      await WorktreeManager.createBranch(tmpDir, "work/parent");

      // Add a commit to integration branch (different shared.ts)
      const tempWt = join(tmpDir, ".opcom/worktrees/__temp-int");
      await exec("git", ["worktree", "add", tempWt, "work/parent"], { cwd: tmpDir });
      await writeFile(join(tempWt, "shared.ts"), "export const VERSION = 2; // from integration", "utf-8");
      await exec("git", ["add", "-A"], { cwd: tempWt });
      await exec("git", ["commit", "-m", "integration changes"], { cwd: tempWt });
      await exec("git", ["worktree", "remove", tempWt, "--force"], { cwd: tmpDir });

      // Meanwhile, main also changes shared.ts (conflict!)
      await writeFile(join(tmpDir, "shared.ts"), "export const VERSION = 3; // from main", "utf-8");
      await exec("git", ["add", "-A"], { cwd: tmpDir });
      await exec("git", ["commit", "-m", "main changes"], { cwd: tmpDir });

      // Attempt to merge integration branch to main → conflict
      const mergeResult = await WorktreeManager.mergeIntegrationBranch(tmpDir, "work/parent");
      expect(mergeResult.merged).toBe(false);
      expect(mergeResult.conflict).toBe(true);

      // Main should be clean (merge was aborted)
      const { stdout: status } = await exec("git", ["status", "--porcelain"], { cwd: tmpDir });
      expect(status.trim()).toBe("");

      await exec("git", ["branch", "-D", "work/parent"], { cwd: tmpDir });
    });
  });

  // --- Cleanup: plan cancellation ---

  describe("plan cancellation cleanup", () => {
    it("deleteBranch removes integration branch on cancellation", async () => {
      // Create integration branch with some work
      await WorktreeManager.createBranch(tmpDir, "work/parent");

      const info = await wm.create(tmpDir, "child-a", "child-a", "work/parent");
      await writeFile(join(info.worktreePath, "partial.ts"), "partial work", "utf-8");
      await exec("git", ["add", "-A"], { cwd: info.worktreePath });
      await exec("git", ["commit", "-m", "partial work"], { cwd: info.worktreePath });

      // Merge child to integration branch
      await wm.merge("child-a", "work/parent");
      await wm.remove("child-a");

      // Simulate plan cancellation — delete integration branch
      await WorktreeManager.deleteBranch(tmpDir, "work/parent");

      const { stdout: branches } = await exec("git", ["branch"], { cwd: tmpDir });
      expect(branches).not.toContain("work/parent");

      // Main should not have the partial work
      expect(await fileExistsOnBranch(tmpDir, "main", "partial.ts")).toBe(false);
    });
  });

  // --- Mixed plan ---

  describe("mixed plan: integration + standalone", () => {
    it("integration children merge to integration branch, standalone merges to main", async () => {
      // Create integration branch for the parent ticket
      await WorktreeManager.createBranch(tmpDir, "work/parent");

      // Create integration child
      const childInfo = await wm.create(tmpDir, "child-a", "child-a", "work/parent");
      await writeFile(join(childInfo.worktreePath, "child-feature.ts"), "export const child = 1;", "utf-8");
      await exec("git", ["add", "-A"], { cwd: childInfo.worktreePath });
      await exec("git", ["commit", "-m", "child work"], { cwd: childInfo.worktreePath });

      // Create standalone step (no integration branch — branches from main/HEAD)
      const standaloneInfo = await wm.create(tmpDir, "standalone", "standalone");
      await writeFile(join(standaloneInfo.worktreePath, "standalone-feature.ts"), "export const standalone = 1;", "utf-8");
      await exec("git", ["add", "-A"], { cwd: standaloneInfo.worktreePath });
      await exec("git", ["commit", "-m", "standalone work"], { cwd: standaloneInfo.worktreePath });

      // Merge child to integration branch
      const childMerge = await wm.merge("child-a", "work/parent");
      expect(childMerge.merged).toBe(true);

      // Integration branch has child work, main does not
      expect(await fileExistsOnBranch(tmpDir, "work/parent", "child-feature.ts")).toBe(true);
      expect(await fileExistsOnBranch(tmpDir, "main", "child-feature.ts")).toBe(false);

      // Merge standalone to main (no targetBranch = current branch = main)
      const standaloneMerge = await wm.merge("standalone");
      expect(standaloneMerge.merged).toBe(true);

      // Main has standalone work but not child work
      expect(await fileExistsOnBranch(tmpDir, "main", "standalone-feature.ts")).toBe(true);
      expect(await fileExistsOnBranch(tmpDir, "main", "child-feature.ts")).toBe(false);

      // Now merge integration branch to main
      const finalMerge = await WorktreeManager.mergeIntegrationBranch(tmpDir, "work/parent");
      expect(finalMerge.merged).toBe(true);

      // Main now has both
      expect(await fileExistsOnBranch(tmpDir, "main", "child-feature.ts")).toBe(true);
      expect(await fileExistsOnBranch(tmpDir, "main", "standalone-feature.ts")).toBe(true);

      await wm.remove("child-a");
      await wm.remove("standalone");
      await exec("git", ["branch", "-D", "work/parent"], { cwd: tmpDir });
    });

    it("planner: mixed plan only sets integrationBranch on parent children", () => {
      const tickets: TicketSet[] = [
        {
          projectId: "proj",
          tickets: [
            makeTicket({ id: "epic" }),
            makeTicket({ id: "epic-child-1", parent: "epic" }),
            makeTicket({ id: "epic-child-2", parent: "epic" }),
            makeTicket({ id: "standalone-a" }),
            makeTicket({ id: "standalone-b", deps: ["standalone-a"] }),
          ],
        },
      ];

      const plan = computePlan(tickets, {}, "mixed-plan", undefined, { worktree: true });

      const c1 = plan.steps.find((s) => s.ticketId === "epic/epic-child-1")!;
      const c2 = plan.steps.find((s) => s.ticketId === "epic/epic-child-2")!;
      const sa = plan.steps.find((s) => s.ticketId === "standalone-a")!;
      const sb = plan.steps.find((s) => s.ticketId === "standalone-b")!;

      expect(c1.integrationBranch).toBe("work/epic/_integration");
      expect(c2.integrationBranch).toBe("work/epic/_integration");
      expect(sa.integrationBranch).toBeUndefined();
      expect(sb.integrationBranch).toBeUndefined();
    });
  });

  // --- hasCommits comparison base ---

  describe("hasCommits with integration branch comparison", () => {
    it("compares against integration branch HEAD, not main HEAD", async () => {
      await WorktreeManager.createBranch(tmpDir, "work/parent");

      // Add a commit to integration branch
      const tempWt = join(tmpDir, ".opcom/worktrees/__temp-hc");
      await exec("git", ["worktree", "add", tempWt, "work/parent"], { cwd: tmpDir });
      await writeFile(join(tempWt, "prior-work.ts"), "export const prior = 1;", "utf-8");
      await exec("git", ["add", "-A"], { cwd: tempWt });
      await exec("git", ["commit", "-m", "prior child work"], { cwd: tempWt });
      await exec("git", ["worktree", "remove", tempWt, "--force"], { cwd: tmpDir });

      // Create child from integration branch
      const info = await wm.create(tmpDir, "child-a", "child-a", "work/parent");

      // No new commits yet — hasCommits should be false against integration branch
      expect(await wm.hasCommits("child-a", "work/parent")).toBe(false);

      // hasCommits against main would be TRUE (because integration branch has more commits)
      // This verifies the comparison base matters
      expect(await wm.hasCommits("child-a", "main")).toBe(true);

      // Now add a commit in the child
      await writeFile(join(info.worktreePath, "new-work.ts"), "export const work = 1;", "utf-8");
      await exec("git", ["add", "-A"], { cwd: info.worktreePath });
      await exec("git", ["commit", "-m", "child work"], { cwd: info.worktreePath });

      // hasCommits against integration branch should now be true
      expect(await wm.hasCommits("child-a", "work/parent")).toBe(true);

      await wm.remove("child-a");
      await exec("git", ["branch", "-D", "work/parent"], { cwd: tmpDir });
    });
  });
});
