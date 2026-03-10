"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const core_1 = require("@opcom/core");
function makePacket(graph) {
    return {
        project: {
            name: "test",
            path: "/tmp/test",
            stack: {
                languages: [{ name: "typescript", version: "5.7", sourceFile: "package.json" }],
                frameworks: [],
                packageManagers: [],
                infrastructure: [],
                versionManagers: [],
            },
            testing: { framework: "vitest", command: "npm test" },
            linting: [],
            services: [],
        },
        workItem: {
            ticket: {
                id: "fix-auth",
                title: "Fix Auth",
                status: "open",
                priority: 1,
                type: "feature",
                filePath: "/tmp/.tickets/fix-auth/README.md",
                deps: [],
                links: [],
                tags: {},
            },
        },
        git: { branch: "main", remote: null, clean: true },
        graph,
    };
}
(0, vitest_1.describe)("contextPacketToMarkdown with graph context", () => {
    (0, vitest_1.it)("renders Related Files section", () => {
        const packet = makePacket({
            relatedFiles: ["src/auth/login.ts", "src/auth/session.ts"],
            testFiles: [],
            driftSignals: [],
        });
        const md = (0, core_1.contextPacketToMarkdown)(packet);
        (0, vitest_1.expect)(md).toContain("## Related Files");
        (0, vitest_1.expect)(md).toContain("- src/auth/login.ts");
        (0, vitest_1.expect)(md).toContain("- src/auth/session.ts");
    });
    (0, vitest_1.it)("renders Test Coverage section", () => {
        const packet = makePacket({
            relatedFiles: [],
            testFiles: ["src/auth/login.test.ts", "src/auth/session.test.ts"],
            driftSignals: [],
        });
        const md = (0, core_1.contextPacketToMarkdown)(packet);
        (0, vitest_1.expect)(md).toContain("## Test Coverage");
        (0, vitest_1.expect)(md).toContain("- src/auth/login.test.ts");
        (0, vitest_1.expect)(md).toContain("- src/auth/session.test.ts");
    });
    (0, vitest_1.it)("renders Drift Signals section with all signal types", () => {
        const packet = makePacket({
            relatedFiles: [],
            testFiles: [],
            driftSignals: [
                { type: "uncovered_spec", id: "spec:auth.md", title: "Auth Spec" },
                { type: "untested_file", id: "file:src/utils.ts", title: "src/utils.ts" },
                { type: "new_failure", id: "test:login", title: "login test", detail: "Expected true" },
                { type: "flaky_test", id: "test:session", title: "session test", detail: "3 pass / 2 fail" },
            ],
        });
        const md = (0, core_1.contextPacketToMarkdown)(packet);
        (0, vitest_1.expect)(md).toContain("## Drift Signals");
        (0, vitest_1.expect)(md).toContain("[uncovered spec] Auth Spec");
        (0, vitest_1.expect)(md).toContain("[untested file] src/utils.ts");
        (0, vitest_1.expect)(md).toContain("[new failure] login test — Expected true");
        (0, vitest_1.expect)(md).toContain("[flaky test] session test — 3 pass / 2 fail");
    });
    (0, vitest_1.it)("renders all three graph sections together", () => {
        const packet = makePacket({
            relatedFiles: ["src/auth/login.ts"],
            testFiles: ["src/auth/login.test.ts"],
            driftSignals: [
                { type: "untested_file", id: "file:src/auth/session.ts", title: "src/auth/session.ts" },
            ],
        });
        const md = (0, core_1.contextPacketToMarkdown)(packet);
        (0, vitest_1.expect)(md).toContain("## Related Files");
        (0, vitest_1.expect)(md).toContain("## Test Coverage");
        (0, vitest_1.expect)(md).toContain("## Drift Signals");
    });
    (0, vitest_1.it)("omits graph sections when no graph context", () => {
        const packet = makePacket();
        const md = (0, core_1.contextPacketToMarkdown)(packet);
        (0, vitest_1.expect)(md).not.toContain("## Related Files");
        (0, vitest_1.expect)(md).not.toContain("## Test Coverage");
        (0, vitest_1.expect)(md).not.toContain("## Drift Signals");
    });
    (0, vitest_1.it)("omits empty graph sections individually", () => {
        const packet = makePacket({
            relatedFiles: ["src/foo.ts"],
            testFiles: [],
            driftSignals: [],
        });
        const md = (0, core_1.contextPacketToMarkdown)(packet);
        (0, vitest_1.expect)(md).toContain("## Related Files");
        (0, vitest_1.expect)(md).not.toContain("## Test Coverage");
        (0, vitest_1.expect)(md).not.toContain("## Drift Signals");
    });
    (0, vitest_1.it)("graph sections appear before Role/Requirements", () => {
        const packet = makePacket({
            relatedFiles: ["src/auth.ts"],
            testFiles: [],
            driftSignals: [],
        });
        const md = (0, core_1.contextPacketToMarkdown)(packet);
        const relatedIdx = md.indexOf("## Related Files");
        const requirementsIdx = md.indexOf("## Requirements");
        (0, vitest_1.expect)(relatedIdx).toBeLessThan(requirementsIdx);
    });
});
//# sourceMappingURL=context-builder-graph.test.js.map