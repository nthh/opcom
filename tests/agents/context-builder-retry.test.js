"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const core_1 = require("@opcom/core");
function makeProject(overrides) {
    return {
        id: "test-project",
        name: "test-project",
        path: "/tmp/test-project",
        stack: {
            languages: [{ name: "typescript", version: "5.7", sourceFile: "package.json" }],
            frameworks: [],
            packageManagers: [{ name: "npm", sourceFile: "package-lock.json" }],
            infrastructure: [],
            versionManagers: [],
        },
        git: { branch: "main", clean: true, remote: "origin" },
        workSystem: { type: "tickets-dir", ticketDir: ".tickets" },
        docs: {},
        services: [],
        environments: [],
        testing: { framework: "vitest", command: "npm test" },
        linting: [],
        subProjects: [],
        cloudServices: [],
        lastScannedAt: "2026-03-06T00:00:00Z",
        ...overrides,
    };
}
function makeTestGateFailure() {
    return {
        stepTicketId: "t1",
        passed: false,
        failureReasons: ["Tests failed: 3/10 failed"],
        testGate: {
            passed: false,
            testCommand: "npm test",
            totalTests: 10,
            passedTests: 7,
            failedTests: 3,
            output: "FAIL src/utils/parser.test.ts > parseConfig > handles empty input\n  Expected: null\n  Received: undefined\n\nFAIL src/server/routes.test.ts > /api/config > returns 400\n  Expected status: 400\n  Received: 500",
            durationMs: 5000,
        },
    };
}
function makeOracleFailure() {
    return {
        stepTicketId: "t1",
        passed: false,
        failureReasons: ["Oracle: 2 criteria unmet"],
        oracle: {
            passed: false,
            criteria: [
                { criterion: "API returns proper error codes", met: false, reasoning: "Returns 500 instead of 400 for invalid input" },
                { criterion: "Unit tests cover edge cases", met: false, reasoning: "No test for empty string input" },
                { criterion: "Code follows project conventions", met: true, reasoning: "Naming and structure are consistent" },
            ],
            concerns: ["Error handling is incomplete"],
        },
    };
}
function makeCombinedFailure() {
    return {
        stepTicketId: "t1",
        passed: false,
        failureReasons: ["Tests failed: 3/10 failed", "Oracle: 1 criteria unmet"],
        testGate: {
            passed: false,
            testCommand: "npm test",
            totalTests: 10,
            passedTests: 7,
            failedTests: 3,
            output: "FAIL src/utils.test.ts\n  Expected: true\n  Received: false",
            durationMs: 3000,
        },
        oracle: {
            passed: false,
            criteria: [
                { criterion: "Handles edge cases", met: false, reasoning: "Missing null check" },
            ],
            concerns: [],
        },
    };
}
(0, vitest_1.describe)("contextPacketToMarkdown with previousVerification", () => {
    (0, vitest_1.it)("renders Previous Attempt section when previousVerification is passed", async () => {
        const project = makeProject();
        const packet = await (0, core_1.buildContextPacket)(project);
        const verification = makeTestGateFailure();
        const md = (0, core_1.contextPacketToMarkdown)(packet, undefined, verification);
        (0, vitest_1.expect)(md).toContain("## Previous Attempt");
        (0, vitest_1.expect)(md).toContain("This is a retry. Your previous attempt failed verification.");
    });
    (0, vitest_1.it)("renders test gate failures with test output in code block", async () => {
        const project = makeProject();
        const packet = await (0, core_1.buildContextPacket)(project);
        const verification = makeTestGateFailure();
        const md = (0, core_1.contextPacketToMarkdown)(packet, undefined, verification);
        (0, vitest_1.expect)(md).toContain("### Test Failures");
        (0, vitest_1.expect)(md).toContain("3 failing test(s)");
        (0, vitest_1.expect)(md).toContain("```");
        (0, vitest_1.expect)(md).toContain("FAIL src/utils/parser.test.ts");
        (0, vitest_1.expect)(md).toContain("Expected: null");
        (0, vitest_1.expect)(md).toContain("Received: undefined");
    });
    (0, vitest_1.it)("renders oracle failures with unmet criteria", async () => {
        const project = makeProject();
        const packet = await (0, core_1.buildContextPacket)(project);
        const verification = makeOracleFailure();
        const md = (0, core_1.contextPacketToMarkdown)(packet, undefined, verification);
        (0, vitest_1.expect)(md).toContain("### Unmet Acceptance Criteria");
        (0, vitest_1.expect)(md).toContain("API returns proper error codes");
        (0, vitest_1.expect)(md).toContain("Returns 500 instead of 400");
        (0, vitest_1.expect)(md).toContain("Unit tests cover edge cases");
        (0, vitest_1.expect)(md).toContain("No test for empty string input");
        // Met criteria should NOT appear
        (0, vitest_1.expect)(md).not.toContain("Code follows project conventions");
    });
    (0, vitest_1.it)("renders both test failures and oracle failures when both failed", async () => {
        const project = makeProject();
        const packet = await (0, core_1.buildContextPacket)(project);
        const verification = makeCombinedFailure();
        const md = (0, core_1.contextPacketToMarkdown)(packet, undefined, verification);
        (0, vitest_1.expect)(md).toContain("### Test Failures");
        (0, vitest_1.expect)(md).toContain("### Unmet Acceptance Criteria");
        (0, vitest_1.expect)(md).toContain("Handles edge cases");
        (0, vitest_1.expect)(md).toContain("FAIL src/utils.test.ts");
    });
    (0, vitest_1.it)("does not render Previous Attempt section when previousVerification is undefined", async () => {
        const project = makeProject();
        const packet = await (0, core_1.buildContextPacket)(project);
        const md = (0, core_1.contextPacketToMarkdown)(packet);
        (0, vitest_1.expect)(md).not.toContain("## Previous Attempt");
        (0, vitest_1.expect)(md).not.toContain("This is a retry");
        (0, vitest_1.expect)(md).not.toContain("### Test Failures");
        (0, vitest_1.expect)(md).not.toContain("### What to fix");
    });
    (0, vitest_1.it)("does not render Previous Attempt section when previousVerification is null-ish", async () => {
        const project = makeProject();
        const packet = await (0, core_1.buildContextPacket)(project);
        const md = (0, core_1.contextPacketToMarkdown)(packet, undefined, undefined);
        (0, vitest_1.expect)(md).not.toContain("## Previous Attempt");
    });
    (0, vitest_1.it)("always includes What to fix section when there is a previous verification", async () => {
        const project = makeProject();
        const packet = await (0, core_1.buildContextPacket)(project);
        // Test with test gate failure
        const testVerification = makeTestGateFailure();
        const md1 = (0, core_1.contextPacketToMarkdown)(packet, undefined, testVerification);
        (0, vitest_1.expect)(md1).toContain("### What to fix");
        (0, vitest_1.expect)(md1).toContain("Focus on the failures listed above");
        (0, vitest_1.expect)(md1).toContain("Do not start over");
        (0, vitest_1.expect)(md1).toContain("Do not modify unrelated code");
        // Test with oracle failure
        const oracleVerification = makeOracleFailure();
        const md2 = (0, core_1.contextPacketToMarkdown)(packet, undefined, oracleVerification);
        (0, vitest_1.expect)(md2).toContain("### What to fix");
        // Test with combined failure
        const combinedVerification = makeCombinedFailure();
        const md3 = (0, core_1.contextPacketToMarkdown)(packet, undefined, combinedVerification);
        (0, vitest_1.expect)(md3).toContain("### What to fix");
    });
    (0, vitest_1.it)("works with role config and previous verification together", async () => {
        const project = makeProject();
        const packet = await (0, core_1.buildContextPacket)(project);
        const roleConfig = {
            roleId: "engineer",
            name: "Engineer",
            permissionMode: "acceptEdits",
            allowedTools: [],
            disallowedTools: [],
            allowedBashPatterns: [],
            instructions: "- Fix the bug.\n- Write tests.",
            doneCriteria: "Bug fixed. Tests passing.",
            runTests: true,
            runOracle: false,
        };
        const verification = makeTestGateFailure();
        const md = (0, core_1.contextPacketToMarkdown)(packet, roleConfig, verification);
        // Both role info and retry info should be present
        (0, vitest_1.expect)(md).toContain("## Role: Engineer");
        (0, vitest_1.expect)(md).toContain("Fix the bug");
        (0, vitest_1.expect)(md).toContain("## Previous Attempt");
        (0, vitest_1.expect)(md).toContain("### Test Failures");
        (0, vitest_1.expect)(md).toContain("### What to fix");
        (0, vitest_1.expect)(md).toContain("## Done Criteria");
        (0, vitest_1.expect)(md).toContain("Bug fixed");
    });
    (0, vitest_1.it)("does not render Test Failures section when testGate passed", async () => {
        const project = makeProject();
        const packet = await (0, core_1.buildContextPacket)(project);
        // Oracle-only failure — test gate passed
        const verification = {
            stepTicketId: "t1",
            passed: false,
            failureReasons: ["Oracle: 1 criteria unmet"],
            testGate: {
                passed: true,
                testCommand: "npm test",
                totalTests: 10,
                passedTests: 10,
                failedTests: 0,
                output: "All tests passed",
                durationMs: 2000,
            },
            oracle: {
                passed: false,
                criteria: [
                    { criterion: "Error handling", met: false, reasoning: "Missing error boundary" },
                ],
                concerns: [],
            },
        };
        const md = (0, core_1.contextPacketToMarkdown)(packet, undefined, verification);
        (0, vitest_1.expect)(md).toContain("## Previous Attempt");
        (0, vitest_1.expect)(md).not.toContain("### Test Failures");
        (0, vitest_1.expect)(md).toContain("### Unmet Acceptance Criteria");
        (0, vitest_1.expect)(md).toContain("### What to fix");
    });
    (0, vitest_1.it)("renders oracle infrastructure error when oracleError is set but oracle is null", async () => {
        const project = makeProject();
        const packet = await (0, core_1.buildContextPacket)(project);
        const verification = {
            stepTicketId: "t1",
            passed: false,
            failureReasons: ["Tests failed: 2/10 failed"],
            testGate: {
                passed: false,
                testCommand: "npm test",
                totalTests: 10,
                passedTests: 8,
                failedTests: 2,
                output: "FAIL src/cache.test.ts",
                durationMs: 3000,
            },
            oracleError: "Error: Command failed: claude -p Evaluate whether...",
        };
        const md = (0, core_1.contextPacketToMarkdown)(packet, undefined, verification);
        (0, vitest_1.expect)(md).toContain("## Previous Attempt");
        (0, vitest_1.expect)(md).toContain("### Test Failures");
        (0, vitest_1.expect)(md).toContain("### Oracle Evaluation Failed");
        (0, vitest_1.expect)(md).toContain("infrastructure error");
        (0, vitest_1.expect)(md).toContain("Command failed");
        (0, vitest_1.expect)(md).not.toContain("### Unmet Acceptance Criteria");
    });
    (0, vitest_1.it)("does not render oracle error section when oracle succeeded", async () => {
        const project = makeProject();
        const packet = await (0, core_1.buildContextPacket)(project);
        const verification = {
            stepTicketId: "t1",
            passed: false,
            failureReasons: ["Oracle: 1 criteria unmet"],
            oracle: {
                passed: false,
                criteria: [
                    { criterion: "Handles edge cases", met: false, reasoning: "Missing null check" },
                ],
                concerns: [],
            },
        };
        const md = (0, core_1.contextPacketToMarkdown)(packet, undefined, verification);
        (0, vitest_1.expect)(md).toContain("### Unmet Acceptance Criteria");
        (0, vitest_1.expect)(md).not.toContain("### Oracle Evaluation Failed");
    });
});
//# sourceMappingURL=context-builder-retry.test.js.map