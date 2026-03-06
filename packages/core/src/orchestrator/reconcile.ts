import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { AgentSession, Plan } from "@opcom/types";
import { listPlans, savePlan } from "./persistence.js";
import { loadProject } from "../config/loader.js";
import { WorktreeManager } from "./worktree.js";
import { createLogger } from "../logger.js";

const execFileAsync = promisify(execFile);
const log = createLogger("reconcile");

/**
 * On station restart, reconcile any plans that were mid-execution.
 * For "in-progress" steps whose agent sessions are dead:
 *   - Has uncommitted changes → mark "done" (with reconciliation note)
 *   - No changes → mark "failed"
 * Also cleans up orphaned worktrees from crashed runs.
 * Final plan status is "paused" (user reviews before resuming) unless all steps are terminal.
 */
export async function reconcilePlans(allSessions: AgentSession[]): Promise<number> {
  const sessionMap = new Map<string, AgentSession>();
  for (const s of allSessions) {
    sessionMap.set(s.id, s);
  }

  const plans = await listPlans();
  let reconciled = 0;

  for (const plan of plans) {
    if (plan.status !== "executing" && plan.status !== "paused") continue;

    const inProgress = plan.steps.filter((s) => s.status === "in-progress");
    if (inProgress.length === 0) continue;

    let changed = false;

    for (const step of inProgress) {
      const session = step.agentSessionId ? sessionMap.get(step.agentSessionId) : undefined;
      const isDead = !session || session.state === "stopped";

      if (!isDead) continue; // Agent still alive, leave it

      // Clean up worktree if it exists
      if (step.worktreePath) {
        try {
          const project = await loadProject(step.projectId);
          if (project) {
            // Use a temporary manager to clean up this worktree
            const wm = new WorktreeManager();
            wm.restore({
              stepId: step.ticketId,
              ticketId: step.ticketId,
              projectPath: project.path,
              worktreePath: step.worktreePath,
              branch: step.worktreeBranch ?? `work/${step.ticketId}`,
            });

            // Check if the agent left commits on its branch
            const hasWork = await wm.hasCommits(step.ticketId);

            if (hasWork) {
              // Don't auto-merge — leave the step for the executor to handle
              // with proper verification. Just mark it so the user knows there's
              // work to review.
              step.status = "ready";
              step.error = "Reconciled: agent has commits, awaiting verification + merge";
              step.agentSessionId = undefined;
              log.info("reconciled worktree step as ready for re-run", { ticketId: step.ticketId, planId: plan.id });
            } else {
              step.status = "failed";
              step.completedAt = new Date().toISOString();
              step.error = "Reconciled: agent exited without commits in worktree";
              log.info("reconciled worktree step as failed", { ticketId: step.ticketId, planId: plan.id });

              // Only remove worktree if truly empty
              await wm.remove(step.ticketId).catch(() => {});
              step.worktreePath = undefined;
              step.worktreeBranch = undefined;
            }
          }
        } catch (err) {
          log.warn("worktree reconciliation failed", { ticketId: step.ticketId, error: String(err) });
          step.status = "failed";
          step.completedAt = new Date().toISOString();
          step.error = `Reconciled: worktree cleanup failed: ${String(err)}`;
        }

        changed = true;
        continue;
      }

      // Legacy (non-worktree) path: check if it left changes
      const hasChanges = await checkUncommittedChanges(step.projectId);

      if (hasChanges) {
        step.status = "done";
        step.completedAt = new Date().toISOString();
        step.error = "Reconciled: agent exited with uncommitted changes";
        log.info("reconciled step as done", { ticketId: step.ticketId, planId: plan.id });
      } else {
        step.status = "failed";
        step.completedAt = new Date().toISOString();
        step.error = "Reconciled: agent exited without changes";
        log.info("reconciled step as failed", { ticketId: step.ticketId, planId: plan.id });
      }
      changed = true;
    }

    if (!changed) continue;

    // Check if all steps are terminal
    const allTerminal = plan.steps.every(
      (s) => s.status === "done" || s.status === "failed" || s.status === "skipped" || s.status === "needs-rebase",
    );

    if (allTerminal) {
      plan.status = "done";
      plan.completedAt = new Date().toISOString();
    } else {
      plan.status = "paused";
    }

    await savePlan(plan);
    reconciled++;
    log.info("reconciled plan", { planId: plan.id, newStatus: plan.status });
  }

  return reconciled;
}

async function checkUncommittedChanges(projectId: string): Promise<boolean> {
  try {
    const project = await loadProject(projectId);
    if (!project) return false;

    const { stdout } = await execFileAsync("git", ["status", "--porcelain"], {
      cwd: project.path,
    });
    return stdout.trim().length > 0;
  } catch {
    return false;
  }
}
