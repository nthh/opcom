import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { existsSync } from "node:fs";
import { join } from "node:path";
import type { GitInfo } from "@opcom/types";

const exec = promisify(execFile);

export async function detectGit(projectPath: string): Promise<GitInfo | null> {
  if (!existsSync(join(projectPath, ".git"))) return null;

  try {
    const [branchResult, statusResult, remoteResult, logResult] = await Promise.all([
      exec("git", ["rev-parse", "--abbrev-ref", "HEAD"], { cwd: projectPath }).catch(() => null),
      exec("git", ["status", "--porcelain"], { cwd: projectPath }).catch(() => null),
      exec("git", ["remote", "get-url", "origin"], { cwd: projectPath }).catch(() => null),
      exec("git", ["log", "-1", "--format=%cI"], { cwd: projectPath }).catch(() => null),
    ]);

    const branch = branchResult?.stdout.trim() ?? "unknown";
    const statusLines = statusResult?.stdout.trim().split("\n").filter(Boolean) ?? [];
    const remote = remoteResult?.stdout.trim() ?? null;
    const lastCommitAt = logResult?.stdout.trim() || undefined;

    return {
      branch,
      clean: statusLines.length === 0,
      remote,
      lastCommitAt,
      uncommittedCount: statusLines.length,
    };
  } catch {
    return null;
  }
}
