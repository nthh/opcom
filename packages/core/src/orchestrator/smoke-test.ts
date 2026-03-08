import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { IntegrationTestResult } from "@opcom/types";
import { createLogger } from "../logger.js";

const execFileAsync = promisify(execFile);
const log = createLogger("smoke-test");

/**
 * Run a full integration smoke test: build + test suite.
 * Runs `npm run build` first, then the project's test command.
 * Returns a structured result with pass/fail for each phase.
 */
export async function runSmoke(
  projectPath: string,
  testCommand = "npm test",
): Promise<IntegrationTestResult> {
  const start = Date.now();
  let buildOutput = "";
  let buildPassed = false;
  let testOutput = "";
  let testsPassed = false;

  // Phase 1: Build
  try {
    const { stdout, stderr } = await execFileAsync("npm", ["run", "build"], {
      cwd: projectPath,
      timeout: 300_000, // 5 min
      maxBuffer: 10 * 1024 * 1024,
    });
    buildOutput = truncateOutput(stdout + stderr);
    buildPassed = true;
    log.info("smoke build passed", { projectPath });
  } catch (err: unknown) {
    const e = err as { stdout?: string; stderr?: string };
    buildOutput = truncateOutput((e.stdout ?? "") + (e.stderr ?? "") || String(err));
    buildPassed = false;
    log.warn("smoke build failed", { projectPath });

    // Build failed — skip tests
    return {
      passed: false,
      buildPassed,
      testsPassed: false,
      buildOutput,
      testOutput: "",
      durationMs: Date.now() - start,
    };
  }

  // Phase 2: Tests
  try {
    const parts = testCommand.split(/\s+/);
    const { stdout, stderr } = await execFileAsync(parts[0], parts.slice(1), {
      cwd: projectPath,
      timeout: 300_000, // 5 min
      maxBuffer: 10 * 1024 * 1024,
    });
    testOutput = truncateOutput(stdout + stderr);
    testsPassed = true;
    log.info("smoke tests passed", { projectPath });
  } catch (err: unknown) {
    const e = err as { stdout?: string; stderr?: string };
    testOutput = truncateOutput((e.stdout ?? "") + (e.stderr ?? "") || String(err));
    testsPassed = false;
    log.warn("smoke tests failed", { projectPath });
  }

  return {
    passed: buildPassed && testsPassed,
    buildPassed,
    testsPassed,
    buildOutput,
    testOutput,
    durationMs: Date.now() - start,
  };
}

function truncateOutput(output: string, maxSize = 8000): string {
  if (output.length <= maxSize) return output;
  const half = Math.floor(maxSize / 2);
  return output.slice(0, half) + "\n\n… [truncated] …\n\n" + output.slice(-half);
}
