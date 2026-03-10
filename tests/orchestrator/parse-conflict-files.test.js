"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const worktree_js_1 = require("../../packages/core/src/orchestrator/worktree.js");
(0, vitest_1.describe)("parseConflictFiles", () => {
    (0, vitest_1.it)("parses CONFLICT (content) lines", () => {
        const output = `
First, rewinding head to replay your work on top of it...
Applying: agent work
CONFLICT (content): Merge conflict in src/file.ts
CONFLICT (content): Merge conflict in src/other.ts
error: could not apply abc1234... agent work
    `;
        const files = (0, worktree_js_1.parseConflictFiles)(output);
        (0, vitest_1.expect)(files).toEqual(["src/file.ts", "src/other.ts"]);
    });
    (0, vitest_1.it)("parses CONFLICT (add/add) lines", () => {
        const output = `
CONFLICT (add/add): Merge conflict in src/new-file.ts
    `;
        const files = (0, worktree_js_1.parseConflictFiles)(output);
        (0, vitest_1.expect)(files).toEqual(["src/new-file.ts"]);
    });
    (0, vitest_1.it)("returns empty array when no conflicts", () => {
        const output = "Successfully rebased and updated refs/heads/work/ticket-1.";
        const files = (0, worktree_js_1.parseConflictFiles)(output);
        (0, vitest_1.expect)(files).toEqual([]);
    });
    (0, vitest_1.it)("handles mixed conflict types", () => {
        const output = `
CONFLICT (content): Merge conflict in src/a.ts
CONFLICT (modify/delete): Merge conflict in src/b.ts
CONFLICT (rename/rename): Merge conflict in src/c.ts
    `;
        const files = (0, worktree_js_1.parseConflictFiles)(output);
        (0, vitest_1.expect)(files).toEqual(["src/a.ts", "src/b.ts", "src/c.ts"]);
    });
    (0, vitest_1.it)("handles empty output", () => {
        (0, vitest_1.expect)((0, worktree_js_1.parseConflictFiles)("")).toEqual([]);
    });
});
//# sourceMappingURL=parse-conflict-files.test.js.map