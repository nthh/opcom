import { execFile } from "node:child_process";
import { promisify } from "node:util";
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
