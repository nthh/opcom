"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const smoke_test_js_1 = require("../../packages/core/src/orchestrator/smoke-test.js");
// Mock child_process
const mockExecFile = vitest_1.vi.fn();
vitest_1.vi.mock("node:child_process", () => ({
    execFile: (...args) => {
        const cb = args[args.length - 1];
        const [cmd, cmdArgs, opts] = args;
        const result = mockExecFile(cmd, cmdArgs, opts);
        if (result instanceof Error) {
            cb(result, { stdout: "", stderr: "" });
        }
        else {
            cb(null, result);
        }
    },
}));
vitest_1.vi.mock("../../packages/core/src/logger.js", () => ({
    createLogger: () => ({
        info: vitest_1.vi.fn(),
        warn: vitest_1.vi.fn(),
        error: vitest_1.vi.fn(),
        debug: vitest_1.vi.fn(),
    }),
}));
(0, vitest_1.describe)("runSmoke", () => {
    (0, vitest_1.beforeEach)(() => {
        vitest_1.vi.clearAllMocks();
    });
    (0, vitest_1.it)("returns passed when build and tests succeed", async () => {
        mockExecFile.mockImplementation((cmd, args) => {
            if (args.includes("build")) {
                return { stdout: "Build complete", stderr: "" };
            }
            return { stdout: "Tests: 10 passed", stderr: "" };
        });
        const result = await (0, smoke_test_js_1.runSmoke)("/tmp/project", "npm test");
        (0, vitest_1.expect)(result.passed).toBe(true);
        (0, vitest_1.expect)(result.buildPassed).toBe(true);
        (0, vitest_1.expect)(result.testsPassed).toBe(true);
        (0, vitest_1.expect)(result.buildOutput).toContain("Build complete");
        (0, vitest_1.expect)(result.testOutput).toContain("Tests: 10 passed");
        (0, vitest_1.expect)(result.durationMs).toBeGreaterThanOrEqual(0);
    });
    (0, vitest_1.it)("returns failed when build fails and skips tests", async () => {
        mockExecFile.mockImplementation((_cmd, args) => {
            if (args.includes("build")) {
                const err = new Error("Build error");
                err.stdout = "error TS2322: Type mismatch";
                err.stderr = "";
                throw err;
            }
            return { stdout: "Tests: 10 passed", stderr: "" };
        });
        const result = await (0, smoke_test_js_1.runSmoke)("/tmp/project");
        (0, vitest_1.expect)(result.passed).toBe(false);
        (0, vitest_1.expect)(result.buildPassed).toBe(false);
        (0, vitest_1.expect)(result.testsPassed).toBe(false);
        (0, vitest_1.expect)(result.buildOutput).toContain("TS2322");
        (0, vitest_1.expect)(result.testOutput).toBe("");
        // Tests should not have been called — build failed first
        (0, vitest_1.expect)(mockExecFile).toHaveBeenCalledTimes(1);
    });
    (0, vitest_1.it)("returns failed when build passes but tests fail", async () => {
        mockExecFile.mockImplementation((_cmd, args) => {
            if (args.includes("build")) {
                return { stdout: "Build complete", stderr: "" };
            }
            const err = new Error("Test failure");
            err.stdout = "FAIL src/utils.test.ts\n3 failed, 7 passed";
            err.stderr = "";
            throw err;
        });
        const result = await (0, smoke_test_js_1.runSmoke)("/tmp/project");
        (0, vitest_1.expect)(result.passed).toBe(false);
        (0, vitest_1.expect)(result.buildPassed).toBe(true);
        (0, vitest_1.expect)(result.testsPassed).toBe(false);
        (0, vitest_1.expect)(result.testOutput).toContain("FAIL");
    });
    (0, vitest_1.it)("uses provided test command", async () => {
        mockExecFile.mockReturnValue({ stdout: "ok", stderr: "" });
        await (0, smoke_test_js_1.runSmoke)("/tmp/project", "npx vitest run");
        // Second call should be the test command
        (0, vitest_1.expect)(mockExecFile).toHaveBeenCalledTimes(2);
        const testCall = mockExecFile.mock.calls[1];
        (0, vitest_1.expect)(testCall[0]).toBe("npx");
        (0, vitest_1.expect)(testCall[1]).toEqual(["vitest", "run"]);
    });
    (0, vitest_1.it)("truncates long output", async () => {
        const longOutput = "x".repeat(20000);
        mockExecFile.mockReturnValue({ stdout: longOutput, stderr: "" });
        const result = await (0, smoke_test_js_1.runSmoke)("/tmp/project");
        (0, vitest_1.expect)(result.buildOutput.length).toBeLessThan(longOutput.length);
        (0, vitest_1.expect)(result.buildOutput).toContain("… [truncated] …");
    });
});
//# sourceMappingURL=smoke-test.test.js.map