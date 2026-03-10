"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const core_1 = require("@opcom/core");
function makePacket() {
    return {
        project: {
            name: "test-project",
            path: "/tmp/test",
            stack: {
                languages: [{ name: "typescript", version: "5.0" }],
                frameworks: [],
                packageManagers: [{ name: "npm" }],
                infrastructure: [],
                versionManagers: [],
            },
            testing: { framework: "vitest", command: "npx vitest run" },
            linting: [],
            services: [],
        },
        git: { branch: "main", remote: null, clean: true },
    };
}
(0, vitest_1.describe)("contextPacketToMarkdown with verificationMode", () => {
    (0, vitest_1.it)("includes test instructions for test-gate mode", () => {
        const packet = makePacket();
        const md = (0, core_1.contextPacketToMarkdown)(packet, undefined, undefined, undefined, undefined, "test-gate");
        (0, vitest_1.expect)(md).toContain("All changes MUST include tests");
        (0, vitest_1.expect)(md).toContain("Run tests relevant to your changes");
        (0, vitest_1.expect)(md).toContain("Do not mark work as complete if tests are failing");
    });
    (0, vitest_1.it)("includes test instructions when verificationMode is undefined (default)", () => {
        const packet = makePacket();
        const md = (0, core_1.contextPacketToMarkdown)(packet);
        (0, vitest_1.expect)(md).toContain("All changes MUST include tests");
        (0, vitest_1.expect)(md).toContain("Do not mark work as complete if tests are failing");
    });
    (0, vitest_1.it)("omits test instructions for confirmation mode", () => {
        const packet = makePacket();
        const md = (0, core_1.contextPacketToMarkdown)(packet, undefined, undefined, undefined, undefined, "confirmation");
        (0, vitest_1.expect)(md).not.toContain("All changes MUST include tests");
        (0, vitest_1.expect)(md).not.toContain("Do not mark work as complete if tests are failing");
    });
    (0, vitest_1.it)("omits test instructions for none mode", () => {
        const packet = makePacket();
        const md = (0, core_1.contextPacketToMarkdown)(packet, undefined, undefined, undefined, undefined, "none");
        (0, vitest_1.expect)(md).not.toContain("All changes MUST include tests");
        (0, vitest_1.expect)(md).not.toContain("Do not mark work as complete if tests are failing");
    });
    (0, vitest_1.it)("omits test instructions for oracle mode", () => {
        const packet = makePacket();
        const md = (0, core_1.contextPacketToMarkdown)(packet, undefined, undefined, undefined, undefined, "oracle");
        (0, vitest_1.expect)(md).not.toContain("All changes MUST include tests");
        (0, vitest_1.expect)(md).not.toContain("Do not mark work as complete if tests are failing");
    });
    (0, vitest_1.it)("omits test instructions for output-exists mode", () => {
        const packet = makePacket();
        const md = (0, core_1.contextPacketToMarkdown)(packet, undefined, undefined, undefined, undefined, "output-exists");
        (0, vitest_1.expect)(md).not.toContain("All changes MUST include tests");
        (0, vitest_1.expect)(md).not.toContain("Do not mark work as complete if tests are failing");
    });
    (0, vitest_1.it)("still includes git stash and commit message requirements for all modes", () => {
        const modes = ["test-gate", "oracle", "confirmation", "output-exists", "none"];
        for (const mode of modes) {
            const packet = makePacket();
            const md = (0, core_1.contextPacketToMarkdown)(packet, undefined, undefined, undefined, undefined, mode);
            (0, vitest_1.expect)(md).toContain("Never use `git stash`");
            (0, vitest_1.expect)(md).toContain("When committing, use a simple single-line commit message");
        }
    });
    (0, vitest_1.it)("uses role instructions regardless of verification mode", () => {
        const packet = makePacket();
        const roleConfig = {
            roleId: "researcher",
            name: "Researcher",
            permissionMode: "default",
            allowedTools: [],
            disallowedTools: [],
            allowedBashPatterns: [],
            instructions: "Research and document findings.",
            doneCriteria: "Report written.",
            runTests: false,
            runOracle: false,
        };
        // Even in test-gate mode, role instructions override default test instructions
        const md = (0, core_1.contextPacketToMarkdown)(packet, roleConfig, undefined, undefined, undefined, "test-gate");
        (0, vitest_1.expect)(md).toContain("Research and document findings.");
        (0, vitest_1.expect)(md).not.toContain("All changes MUST include tests");
    });
});
//# sourceMappingURL=context-builder-verification-mode.test.js.map