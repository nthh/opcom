import { describe, it, expect, vi, beforeEach } from "vitest";
import { runSmoke } from "../../packages/core/src/orchestrator/smoke-test.js";

// Mock child_process
const mockExecFile = vi.fn();
vi.mock("node:child_process", () => ({
  execFile: (...args: unknown[]) => {
    const cb = args[args.length - 1] as (err: unknown, result: unknown) => void;
    const [cmd, cmdArgs, opts] = args as [string, string[], Record<string, unknown>];
    const result = mockExecFile(cmd, cmdArgs, opts);
    if (result instanceof Error) {
      cb(result, { stdout: "", stderr: "" });
    } else {
      cb(null, result);
    }
  },
}));

vi.mock("../../packages/core/src/logger.js", () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

describe("runSmoke", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns passed when build and tests succeed", async () => {
    mockExecFile.mockImplementation((cmd: string, args: string[]) => {
      if (args.includes("build")) {
        return { stdout: "Build complete", stderr: "" };
      }
      return { stdout: "Tests: 10 passed", stderr: "" };
    });

    const result = await runSmoke("/tmp/project", "npm test");

    expect(result.passed).toBe(true);
    expect(result.buildPassed).toBe(true);
    expect(result.testsPassed).toBe(true);
    expect(result.buildOutput).toContain("Build complete");
    expect(result.testOutput).toContain("Tests: 10 passed");
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
  });

  it("returns failed when build fails and skips tests", async () => {
    mockExecFile.mockImplementation((_cmd: string, args: string[]) => {
      if (args.includes("build")) {
        const err = new Error("Build error") as Error & { stdout: string; stderr: string };
        err.stdout = "error TS2322: Type mismatch";
        err.stderr = "";
        throw err;
      }
      return { stdout: "Tests: 10 passed", stderr: "" };
    });

    const result = await runSmoke("/tmp/project");

    expect(result.passed).toBe(false);
    expect(result.buildPassed).toBe(false);
    expect(result.testsPassed).toBe(false);
    expect(result.buildOutput).toContain("TS2322");
    expect(result.testOutput).toBe("");
    // Tests should not have been called — build failed first
    expect(mockExecFile).toHaveBeenCalledTimes(1);
  });

  it("returns failed when build passes but tests fail", async () => {
    mockExecFile.mockImplementation((_cmd: string, args: string[]) => {
      if (args.includes("build")) {
        return { stdout: "Build complete", stderr: "" };
      }
      const err = new Error("Test failure") as Error & { stdout: string; stderr: string };
      err.stdout = "FAIL src/utils.test.ts\n3 failed, 7 passed";
      err.stderr = "";
      throw err;
    });

    const result = await runSmoke("/tmp/project");

    expect(result.passed).toBe(false);
    expect(result.buildPassed).toBe(true);
    expect(result.testsPassed).toBe(false);
    expect(result.testOutput).toContain("FAIL");
  });

  it("uses provided test command", async () => {
    mockExecFile.mockReturnValue({ stdout: "ok", stderr: "" });

    await runSmoke("/tmp/project", "npx vitest run");

    // Second call should be the test command
    expect(mockExecFile).toHaveBeenCalledTimes(2);
    const testCall = mockExecFile.mock.calls[1];
    expect(testCall[0]).toBe("npx");
    expect(testCall[1]).toEqual(["vitest", "run"]);
  });

  it("truncates long output", async () => {
    const longOutput = "x".repeat(20000);
    mockExecFile.mockReturnValue({ stdout: longOutput, stderr: "" });

    const result = await runSmoke("/tmp/project");

    expect(result.buildOutput.length).toBeLessThan(longOutput.length);
    expect(result.buildOutput).toContain("… [truncated] …");
  });
});
