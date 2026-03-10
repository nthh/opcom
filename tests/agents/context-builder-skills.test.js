"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const core_1 = require("@opcom/core");
function makePacket(overrides) {
    return {
        project: {
            name: "test-project",
            path: "/tmp/test-project",
            stack: {
                languages: [{ name: "typescript", version: "5.7", sourceFile: "package.json" }],
                frameworks: [],
                packageManagers: [{ name: "npm", sourceFile: "package-lock.json" }],
                infrastructure: [],
                versionManagers: [],
            },
            testing: { framework: "vitest", command: "npm test" },
            linting: [],
            services: [],
        },
        git: { branch: "main", remote: "origin", clean: true },
        ...overrides,
    };
}
(0, vitest_1.describe)("contextPacketToMarkdown — skills", () => {
    (0, vitest_1.it)("renders skills section when skills are present", () => {
        const packet = makePacket({
            skills: [
                { name: "Code Review", content: "Review methodology here." },
                { name: "Test Writing", content: "Test strategy here." },
            ],
        });
        const md = (0, core_1.contextPacketToMarkdown)(packet);
        (0, vitest_1.expect)(md).toContain("## Skills");
        (0, vitest_1.expect)(md).toContain("### Code Review");
        (0, vitest_1.expect)(md).toContain("Review methodology here.");
        (0, vitest_1.expect)(md).toContain("### Test Writing");
        (0, vitest_1.expect)(md).toContain("Test strategy here.");
    });
    (0, vitest_1.it)("does not render skills section when no skills", () => {
        const packet = makePacket();
        const md = (0, core_1.contextPacketToMarkdown)(packet);
        (0, vitest_1.expect)(md).not.toContain("## Skills");
    });
    (0, vitest_1.it)("does not render skills section when skills array is empty", () => {
        const packet = makePacket({ skills: [] });
        const md = (0, core_1.contextPacketToMarkdown)(packet);
        (0, vitest_1.expect)(md).not.toContain("## Skills");
    });
    (0, vitest_1.it)("renders skills before agent config", () => {
        const packet = makePacket({
            skills: [{ name: "Research", content: "Research protocol." }],
            agentConfig: "# Agent Config\nFollow these rules.",
        });
        const md = (0, core_1.contextPacketToMarkdown)(packet);
        const skillsIdx = md.indexOf("## Skills");
        const configIdx = md.indexOf("## Agent Configuration");
        (0, vitest_1.expect)(skillsIdx).toBeLessThan(configIdx);
    });
});
//# sourceMappingURL=context-builder-skills.test.js.map