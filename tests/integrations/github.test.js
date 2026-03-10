"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const core_1 = require("@opcom/core");
(0, vitest_1.describe)("mapLabelToPriority", () => {
    (0, vitest_1.it)("maps P0 to priority 0", () => {
        (0, vitest_1.expect)((0, core_1.mapLabelToPriority)(["P0"])).toBe(0);
    });
    (0, vitest_1.it)("maps P1 to priority 1", () => {
        (0, vitest_1.expect)((0, core_1.mapLabelToPriority)(["P1"])).toBe(1);
    });
    (0, vitest_1.it)("maps P2 to priority 2", () => {
        (0, vitest_1.expect)((0, core_1.mapLabelToPriority)(["P2"])).toBe(2);
    });
    (0, vitest_1.it)("maps P3 to priority 3", () => {
        (0, vitest_1.expect)((0, core_1.mapLabelToPriority)(["P3"])).toBe(3);
    });
    (0, vitest_1.it)("maps critical to priority 0", () => {
        (0, vitest_1.expect)((0, core_1.mapLabelToPriority)(["critical"])).toBe(0);
    });
    (0, vitest_1.it)("maps urgent to priority 1", () => {
        (0, vitest_1.expect)((0, core_1.mapLabelToPriority)(["urgent"])).toBe(1);
    });
    (0, vitest_1.it)("returns default priority 2 for unknown labels", () => {
        (0, vitest_1.expect)((0, core_1.mapLabelToPriority)(["random-label"])).toBe(2);
    });
    (0, vitest_1.it)("returns default priority 2 for empty labels", () => {
        (0, vitest_1.expect)((0, core_1.mapLabelToPriority)([])).toBe(2);
    });
    (0, vitest_1.it)("picks first matching label when multiple are present", () => {
        (0, vitest_1.expect)((0, core_1.mapLabelToPriority)(["P0", "P3"])).toBe(0);
    });
});
(0, vitest_1.describe)("mapLabelToType", () => {
    (0, vitest_1.it)("maps bug label", () => {
        (0, vitest_1.expect)((0, core_1.mapLabelToType)(["bug"])).toBe("bug");
    });
    (0, vitest_1.it)("maps enhancement to feature", () => {
        (0, vitest_1.expect)((0, core_1.mapLabelToType)(["enhancement"])).toBe("feature");
    });
    (0, vitest_1.it)("maps feature label", () => {
        (0, vitest_1.expect)((0, core_1.mapLabelToType)(["feature"])).toBe("feature");
    });
    (0, vitest_1.it)("maps documentation to docs", () => {
        (0, vitest_1.expect)((0, core_1.mapLabelToType)(["documentation"])).toBe("docs");
    });
    (0, vitest_1.it)("maps docs to docs", () => {
        (0, vitest_1.expect)((0, core_1.mapLabelToType)(["docs"])).toBe("docs");
    });
    (0, vitest_1.it)("maps chore label", () => {
        (0, vitest_1.expect)((0, core_1.mapLabelToType)(["chore"])).toBe("chore");
    });
    (0, vitest_1.it)("maps maintenance to chore", () => {
        (0, vitest_1.expect)((0, core_1.mapLabelToType)(["maintenance"])).toBe("chore");
    });
    (0, vitest_1.it)("returns default task for unknown labels", () => {
        (0, vitest_1.expect)((0, core_1.mapLabelToType)(["unknown"])).toBe("task");
    });
    (0, vitest_1.it)("returns default task for empty labels", () => {
        (0, vitest_1.expect)((0, core_1.mapLabelToType)([])).toBe("task");
    });
});
(0, vitest_1.describe)("issueToWorkItem", () => {
    function makeIssue(overrides = {}) {
        return {
            number: 42,
            title: "Fix the widget",
            state: "open",
            labels: [{ name: "bug" }, { name: "P1" }],
            body: "The widget is broken",
            html_url: "https://github.com/test-owner/test-repo/issues/42",
            ...overrides,
        };
    }
    (0, vitest_1.it)("converts a GitHub issue to a WorkItem", () => {
        const issue = makeIssue();
        const workItem = (0, core_1.issueToWorkItem)(issue, "test-owner", "test-repo");
        (0, vitest_1.expect)(workItem.id).toBe("github-test-owner-test-repo-42");
        (0, vitest_1.expect)(workItem.title).toBe("Fix the widget");
        (0, vitest_1.expect)(workItem.status).toBe("open");
        (0, vitest_1.expect)(workItem.priority).toBe(1); // P1 label
        (0, vitest_1.expect)(workItem.type).toBe("bug"); // bug label
        (0, vitest_1.expect)(workItem.filePath).toBe("https://github.com/test-owner/test-repo/issues/42");
        (0, vitest_1.expect)(workItem.deps).toEqual([]);
        (0, vitest_1.expect)(workItem.links).toContain("https://github.com/test-owner/test-repo/issues/42");
    });
    (0, vitest_1.it)("maps closed state correctly", () => {
        const issue = makeIssue({ state: "closed" });
        const workItem = (0, core_1.issueToWorkItem)(issue, "owner", "repo");
        (0, vitest_1.expect)(workItem.status).toBe("closed");
    });
    (0, vitest_1.it)("includes label names in tags", () => {
        const issue = makeIssue({ labels: [{ name: "bug" }, { name: "P0" }, { name: "frontend" }] });
        const workItem = (0, core_1.issueToWorkItem)(issue, "owner", "repo");
        (0, vitest_1.expect)(workItem.tags.labels).toEqual(["bug", "P0", "frontend"]);
        (0, vitest_1.expect)(workItem.tags.source).toEqual(["github"]);
    });
    (0, vitest_1.it)("handles issue with no labels", () => {
        const issue = makeIssue({ labels: [] });
        const workItem = (0, core_1.issueToWorkItem)(issue, "owner", "repo");
        (0, vitest_1.expect)(workItem.priority).toBe(2); // default
        (0, vitest_1.expect)(workItem.type).toBe("task"); // default
        (0, vitest_1.expect)(workItem.tags.labels).toEqual([]);
    });
    (0, vitest_1.it)("uses owner and repo in the WorkItem ID", () => {
        const issue = makeIssue({ number: 100 });
        const workItem = (0, core_1.issueToWorkItem)(issue, "myorg", "myrepo");
        (0, vitest_1.expect)(workItem.id).toBe("github-myorg-myrepo-100");
    });
});
//# sourceMappingURL=github.test.js.map