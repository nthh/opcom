"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const executor_js_1 = require("../../packages/core/src/orchestrator/executor.js");
(0, vitest_1.describe)("parseTestOutput", () => {
    (0, vitest_1.it)("parses vitest output with all passing", () => {
        const output = `
 Test Files  55 passed (55)
      Tests  857 passed (857)
   Start at  17:37:33
   Duration  19.76s
`;
        const result = (0, executor_js_1.parseTestOutput)(output);
        (0, vitest_1.expect)(result.total).toBe(857);
        (0, vitest_1.expect)(result.passed).toBe(857);
        (0, vitest_1.expect)(result.failed).toBe(0);
    });
    (0, vitest_1.it)("parses vitest output with failures", () => {
        const output = `
 Test Files  1 failed | 54 passed (55)
      Tests  3 failed | 854 passed (857)
   Start at  17:37:33
`;
        const result = (0, executor_js_1.parseTestOutput)(output);
        (0, vitest_1.expect)(result.total).toBe(857);
        (0, vitest_1.expect)(result.passed).toBe(854);
        (0, vitest_1.expect)(result.failed).toBe(3);
    });
    (0, vitest_1.it)("parses jest output with all passing", () => {
        const output = `
Test Suites: 12 passed, 12 total
Tests:       45 passed, 45 total
`;
        const result = (0, executor_js_1.parseTestOutput)(output);
        (0, vitest_1.expect)(result.total).toBe(45);
        (0, vitest_1.expect)(result.passed).toBe(45);
        (0, vitest_1.expect)(result.failed).toBe(0);
    });
    (0, vitest_1.it)("parses jest output with failures", () => {
        const output = `
Test Suites: 2 failed, 10 passed, 12 total
Tests:       5 failed, 40 passed, 45 total
`;
        const result = (0, executor_js_1.parseTestOutput)(output);
        (0, vitest_1.expect)(result.total).toBe(45);
        (0, vitest_1.expect)(result.passed).toBe(40);
        (0, vitest_1.expect)(result.failed).toBe(5);
    });
    (0, vitest_1.it)("parses mocha output", () => {
        const output = `
  30 passing (2s)
  2 failing
`;
        const result = (0, executor_js_1.parseTestOutput)(output);
        (0, vitest_1.expect)(result.total).toBe(32);
        (0, vitest_1.expect)(result.passed).toBe(30);
        (0, vitest_1.expect)(result.failed).toBe(2);
    });
    (0, vitest_1.it)("parses mocha output with only passing", () => {
        const output = `  15 passing (1s)`;
        const result = (0, executor_js_1.parseTestOutput)(output);
        (0, vitest_1.expect)(result.total).toBe(15);
        (0, vitest_1.expect)(result.passed).toBe(15);
        (0, vitest_1.expect)(result.failed).toBe(0);
    });
    (0, vitest_1.it)("returns zeros for unrecognized output", () => {
        const result = (0, executor_js_1.parseTestOutput)("some random output");
        (0, vitest_1.expect)(result.total).toBe(0);
        (0, vitest_1.expect)(result.passed).toBe(0);
        (0, vitest_1.expect)(result.failed).toBe(0);
    });
});
//# sourceMappingURL=verification.test.js.map