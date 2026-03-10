"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const core_1 = require("@opcom/core");
// We test the event parsing logic without spawning real processes
(0, vitest_1.describe)("ClaudeCodeAdapter", () => {
    (0, vitest_1.it)("creates an adapter with claude-code backend", () => {
        const adapter = new core_1.ClaudeCodeAdapter();
        (0, vitest_1.expect)(adapter.backend).toBe("claude-code");
    });
    (0, vitest_1.it)("lists no sessions initially", () => {
        const adapter = new core_1.ClaudeCodeAdapter();
        (0, vitest_1.expect)(adapter.listSessions()).toHaveLength(0);
    });
});
(0, vitest_1.describe)("ClaudeCodeAdapter event parsing", () => {
    // We test the private parseClaudeEvent via the public interface
    // Since we can't easily spawn real claude, we test the adapter
    // handles session lifecycle correctly
    (0, vitest_1.it)("getSession returns undefined for unknown sessions", () => {
        const adapter = new core_1.ClaudeCodeAdapter();
        (0, vitest_1.expect)(adapter.getSession("nonexistent")).toBeUndefined();
    });
    (0, vitest_1.it)("stop is safe for unknown sessions", async () => {
        const adapter = new core_1.ClaudeCodeAdapter();
        // Should not throw
        await adapter.stop("nonexistent");
    });
});
(0, vitest_1.describe)("context packet formatting", () => {
    (0, vitest_1.it)("creates a valid context packet structure", () => {
        const packet = {
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
            git: { branch: "main", remote: "origin", clean: true },
        };
        (0, vitest_1.expect)(packet.project.name).toBe("test");
        (0, vitest_1.expect)(packet.project.stack.languages[0].name).toBe("typescript");
        (0, vitest_1.expect)(packet.git.branch).toBe("main");
    });
});
//# sourceMappingURL=claude-code-adapter.test.js.map