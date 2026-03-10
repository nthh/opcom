"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const app_js_1 = require("../../packages/cli/src/tui/app.js");
const renderer_js_1 = require("../../packages/cli/src/tui/renderer.js");
(0, vitest_1.describe)("buildHelpLines", () => {
    const lines = (0, app_js_1.buildHelpLines)();
    const plain = lines.map(renderer_js_1.stripAnsi);
    (0, vitest_1.it)("includes Workflow section header", () => {
        (0, vitest_1.expect)(plain.some((l) => l.includes("Workflow"))).toBe(true);
    });
    (0, vitest_1.it)("shows all 5 workflow steps in order", () => {
        const stepLines = plain.filter((l) => /^\s+\d\.\s/.test(l));
        (0, vitest_1.expect)(stepLines).toHaveLength(5);
        (0, vitest_1.expect)(stepLines[0]).toContain("Write spec");
        (0, vitest_1.expect)(stepLines[1]).toContain("Scaffold tickets");
        (0, vitest_1.expect)(stepLines[2]).toContain("Check health");
        (0, vitest_1.expect)(stepLines[3]).toContain("Assign agents");
        (0, vitest_1.expect)(stepLines[4]).toContain("Track use cases");
    });
    (0, vitest_1.it)("includes H keybinding in health step", () => {
        const healthLine = plain.find((l) => l.includes("Check health"));
        (0, vitest_1.expect)(healthLine).toContain("H");
    });
    (0, vitest_1.it)("includes U keybinding in use cases step", () => {
        const ucLine = plain.find((l) => l.includes("Track use cases"));
        (0, vitest_1.expect)(ucLine).toContain("U");
    });
    (0, vitest_1.it)("includes w keybinding in assign step", () => {
        const assignLine = plain.find((l) => l.includes("Assign agents"));
        (0, vitest_1.expect)(assignLine).toContain("w");
    });
    (0, vitest_1.it)("mentions spec-driven process", () => {
        (0, vitest_1.expect)(plain.some((l) => l.includes("Spec-driven"))).toBe(true);
    });
    (0, vitest_1.it)("still includes Global and Level sections", () => {
        (0, vitest_1.expect)(plain.some((l) => l.includes("Global"))).toBe(true);
        (0, vitest_1.expect)(plain.some((l) => l.includes("Level 1: Dashboard"))).toBe(true);
        (0, vitest_1.expect)(plain.some((l) => l.includes("Level 2: Project Detail"))).toBe(true);
        (0, vitest_1.expect)(plain.some((l) => l.includes("Level 3: Agent Focus"))).toBe(true);
    });
    (0, vitest_1.it)("workflow section appears before Global section", () => {
        const workflowIdx = plain.findIndex((l) => l.includes("Workflow"));
        const globalIdx = plain.findIndex((l) => l === "Global");
        (0, vitest_1.expect)(workflowIdx).toBeLessThan(globalIdx);
    });
});
//# sourceMappingURL=help-workflow.test.js.map