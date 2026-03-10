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
(0, vitest_1.describe)("contextPacketToMarkdown with rebaseConflict", () => {
    (0, vitest_1.it)("renders Merge Conflict Resolution section when rebaseConflict is passed", async () => {
        const project = makeProject();
        const packet = await (0, core_1.buildContextPacket)(project);
        const rebaseConflict = {
            files: ["src/index.ts", "src/utils.ts"],
            baseBranch: "main",
        };
        const md = (0, core_1.contextPacketToMarkdown)(packet, undefined, undefined, rebaseConflict);
        (0, vitest_1.expect)(md).toContain("## Merge Conflict Resolution");
        (0, vitest_1.expect)(md).toContain("Your branch has conflicts with `main`");
        (0, vitest_1.expect)(md).toContain("### Conflicting Files");
        (0, vitest_1.expect)(md).toContain("- src/index.ts");
        (0, vitest_1.expect)(md).toContain("- src/utils.ts");
        (0, vitest_1.expect)(md).toContain("### Instructions");
        (0, vitest_1.expect)(md).toContain("git rebase main");
        (0, vitest_1.expect)(md).toContain("git add <file>");
        (0, vitest_1.expect)(md).toContain("git rebase --continue");
    });
    (0, vitest_1.it)("does not render rebase section when rebaseConflict is undefined", async () => {
        const project = makeProject();
        const packet = await (0, core_1.buildContextPacket)(project);
        const md = (0, core_1.contextPacketToMarkdown)(packet);
        (0, vitest_1.expect)(md).not.toContain("## Merge Conflict Resolution");
        (0, vitest_1.expect)(md).not.toContain("### Conflicting Files");
    });
    (0, vitest_1.it)("handles empty conflict files list", async () => {
        const project = makeProject();
        const packet = await (0, core_1.buildContextPacket)(project);
        const rebaseConflict = {
            files: [],
            baseBranch: "main",
        };
        const md = (0, core_1.contextPacketToMarkdown)(packet, undefined, undefined, rebaseConflict);
        (0, vitest_1.expect)(md).toContain("## Merge Conflict Resolution");
        // No conflicting files section when list is empty
        (0, vitest_1.expect)(md).not.toContain("### Conflicting Files");
        (0, vitest_1.expect)(md).toContain("### Instructions");
    });
    (0, vitest_1.it)("works with both previousVerification and rebaseConflict", async () => {
        const project = makeProject();
        const packet = await (0, core_1.buildContextPacket)(project);
        const verification = {
            stepTicketId: "t1",
            passed: false,
            failureReasons: ["Tests failed"],
            testGate: {
                passed: false,
                testCommand: "npm test",
                totalTests: 5,
                passedTests: 3,
                failedTests: 2,
                output: "FAIL test.ts",
                durationMs: 1000,
            },
        };
        const rebaseConflict = {
            files: ["src/index.ts"],
            baseBranch: "main",
        };
        const md = (0, core_1.contextPacketToMarkdown)(packet, undefined, verification, rebaseConflict);
        // Both sections should be present
        (0, vitest_1.expect)(md).toContain("## Previous Attempt");
        (0, vitest_1.expect)(md).toContain("## Merge Conflict Resolution");
        (0, vitest_1.expect)(md).toContain("### Conflicting Files");
    });
    (0, vitest_1.it)("works with role config and rebaseConflict", async () => {
        const project = makeProject();
        const packet = await (0, core_1.buildContextPacket)(project);
        const roleConfig = {
            roleId: "engineer",
            name: "Engineer",
            permissionMode: "acceptEdits",
            allowedTools: [],
            disallowedTools: [],
            allowedBashPatterns: [],
            instructions: "- Fix the bug.",
            doneCriteria: "Bug fixed.",
            runTests: true,
            runOracle: false,
        };
        const rebaseConflict = {
            files: ["src/file.ts"],
            baseBranch: "main",
        };
        const md = (0, core_1.contextPacketToMarkdown)(packet, roleConfig, undefined, rebaseConflict);
        (0, vitest_1.expect)(md).toContain("## Role: Engineer");
        (0, vitest_1.expect)(md).toContain("## Merge Conflict Resolution");
        (0, vitest_1.expect)(md).toContain("- src/file.ts");
    });
    (0, vitest_1.it)("uses baseBranch from rebaseConflict in instructions", async () => {
        const project = makeProject();
        const packet = await (0, core_1.buildContextPacket)(project);
        const rebaseConflict = {
            files: ["src/file.ts"],
            baseBranch: "develop",
        };
        const md = (0, core_1.contextPacketToMarkdown)(packet, undefined, undefined, rebaseConflict);
        (0, vitest_1.expect)(md).toContain("conflicts with `develop`");
        (0, vitest_1.expect)(md).toContain("git rebase develop");
    });
});
//# sourceMappingURL=context-builder-rebase.test.js.map