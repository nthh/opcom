"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const core_1 = require("@opcom/core");
(0, vitest_1.describe)("Engineer role instructions (test responsibility split)", () => {
    const engineer = core_1.BUILTIN_ROLES.engineer;
    (0, vitest_1.it)("contains instruction to run relevant tests only", () => {
        (0, vitest_1.expect)(engineer.instructions).toContain("relevant to your changes");
    });
    (0, vitest_1.it)("contains instruction telling agent not to run the full suite", () => {
        (0, vitest_1.expect)(engineer.instructions).toContain("Do not run it yourself");
    });
    (0, vitest_1.it)("mentions the verification pipeline runs the full suite", () => {
        (0, vitest_1.expect)(engineer.instructions).toContain("verification pipeline");
        (0, vitest_1.expect)(engineer.instructions).toContain("full test suite");
    });
    (0, vitest_1.it)("has doneCriteria mentioning relevant tests passing", () => {
        (0, vitest_1.expect)(engineer.doneCriteria).toContain("Relevant tests passing");
    });
    (0, vitest_1.it)("does NOT contain old instruction to run the full test command", () => {
        (0, vitest_1.expect)(engineer.instructions).not.toContain("Run the project's test command before finishing");
    });
    (0, vitest_1.it)("requires all changes include tests", () => {
        (0, vitest_1.expect)(engineer.instructions).toContain("All changes MUST include tests");
    });
});
(0, vitest_1.describe)("QA role instructions (test responsibility split)", () => {
    const qa = core_1.BUILTIN_ROLES.qa;
    (0, vitest_1.it)("instructs QA to run the test files they wrote", () => {
        (0, vitest_1.expect)(qa.instructions).toContain("Run the test files you wrote");
    });
    (0, vitest_1.it)("instructs QA not to run the full test suite", () => {
        (0, vitest_1.expect)(qa.instructions).toContain("Do not run the full test suite");
    });
    (0, vitest_1.it)("restricts QA to test files only", () => {
        (0, vitest_1.expect)(qa.instructions).toContain("Do NOT modify production source code");
        (0, vitest_1.expect)(qa.instructions).toContain("Only create or edit test files");
    });
});
(0, vitest_1.describe)("Other roles have appropriate test settings", () => {
    (0, vitest_1.it)("reviewer does not run tests", () => {
        (0, vitest_1.expect)(core_1.BUILTIN_ROLES.reviewer.runTests).toBe(false);
    });
    (0, vitest_1.it)("researcher does not run tests", () => {
        (0, vitest_1.expect)(core_1.BUILTIN_ROLES.researcher.runTests).toBe(false);
    });
    (0, vitest_1.it)("devops does not run tests", () => {
        (0, vitest_1.expect)(core_1.BUILTIN_ROLES.devops.runTests).toBe(false);
    });
    (0, vitest_1.it)("engineer runs tests", () => {
        (0, vitest_1.expect)(core_1.BUILTIN_ROLES.engineer.runTests).toBe(true);
    });
    (0, vitest_1.it)("qa runs tests", () => {
        (0, vitest_1.expect)(core_1.BUILTIN_ROLES.qa.runTests).toBe(true);
    });
});
//# sourceMappingURL=roles-instructions.test.js.map