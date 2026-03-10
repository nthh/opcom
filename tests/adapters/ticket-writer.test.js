"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const promises_1 = require("node:fs/promises");
const node_path_1 = require("node:path");
const node_fs_1 = require("node:fs");
const node_os_1 = require("node:os");
const core_1 = require("@opcom/core");
let tempDir;
(0, vitest_1.beforeEach)(async () => {
    tempDir = await (0, promises_1.mkdtemp)((0, node_path_1.join)((0, node_os_1.tmpdir)(), "opcom-ticket-writer-test-"));
});
(0, vitest_1.afterEach)(async () => {
    await (0, promises_1.rm)(tempDir, { recursive: true, force: true });
});
function makeWorkItem(overrides) {
    return {
        id: "evt-2026-05-12-arrive-in-tokyo",
        title: "Arrive in Tokyo",
        status: "open",
        priority: 2,
        type: "task",
        filePath: "",
        deps: [],
        links: [],
        tags: { source: ["calendar"], location: ["NRT Airport"] },
        scheduled: "2026-05-12T14:30:00Z",
        ...overrides,
    };
}
// --- workItemToMarkdown tests ---
(0, vitest_1.describe)("workItemToMarkdown", () => {
    (0, vitest_1.it)("generates valid frontmatter with all fields", () => {
        const item = makeWorkItem({
            due: "2026-05-12",
            created: "2026-04-01",
            parent: "japan-trip",
            deps: ["evt-2026-05-11-pack"],
            links: ["docs/travel.md"],
        });
        const md = (0, core_1.workItemToMarkdown)(item);
        (0, vitest_1.expect)(md).toContain("---");
        (0, vitest_1.expect)(md).toContain('id: evt-2026-05-12-arrive-in-tokyo');
        (0, vitest_1.expect)(md).toContain('title: "Arrive in Tokyo"');
        (0, vitest_1.expect)(md).toContain("status: open");
        (0, vitest_1.expect)(md).toContain("type: task");
        (0, vitest_1.expect)(md).toContain("priority: 2");
        (0, vitest_1.expect)(md).toContain('created: "2026-04-01"');
        (0, vitest_1.expect)(md).toContain('due: "2026-05-12"');
        (0, vitest_1.expect)(md).toContain('scheduled: "2026-05-12T14:30:00Z"');
        (0, vitest_1.expect)(md).toContain("milestone: japan-trip");
        (0, vitest_1.expect)(md).toContain("deps:");
        (0, vitest_1.expect)(md).toContain("  - evt-2026-05-11-pack");
        (0, vitest_1.expect)(md).toContain("links:");
        (0, vitest_1.expect)(md).toContain("  - docs/travel.md");
        (0, vitest_1.expect)(md).toContain("source:");
        (0, vitest_1.expect)(md).toContain("  - calendar");
        (0, vitest_1.expect)(md).toContain("location:");
        (0, vitest_1.expect)(md).toContain("  - NRT Airport");
        (0, vitest_1.expect)(md).toContain("# Arrive in Tokyo");
    });
    (0, vitest_1.it)("generates minimal frontmatter for simple items", () => {
        const item = makeWorkItem({
            tags: {},
            scheduled: undefined,
        });
        const md = (0, core_1.workItemToMarkdown)(item);
        (0, vitest_1.expect)(md).toContain("id: evt-2026-05-12-arrive-in-tokyo");
        (0, vitest_1.expect)(md).not.toContain("due:");
        (0, vitest_1.expect)(md).not.toContain("scheduled:");
        (0, vitest_1.expect)(md).not.toContain("milestone:");
        (0, vitest_1.expect)(md).not.toContain("deps:");
        (0, vitest_1.expect)(md).not.toContain("links:");
    });
    (0, vitest_1.it)("includes body content when provided", () => {
        const item = makeWorkItem();
        const md = (0, core_1.workItemToMarkdown)(item, "Flight JL001 arriving at Narita.");
        (0, vitest_1.expect)(md).toContain("Flight JL001 arriving at Narita.");
    });
    (0, vitest_1.it)("escapes double quotes in title", () => {
        const item = makeWorkItem({ title: 'Meeting "important" one' });
        const md = (0, core_1.workItemToMarkdown)(item);
        (0, vitest_1.expect)(md).toContain('title: "Meeting \\"important\\" one"');
    });
});
// --- writeWorkItemsToTickets tests ---
(0, vitest_1.describe)("writeWorkItemsToTickets", () => {
    (0, vitest_1.it)("creates ticket directories and README.md files", async () => {
        const items = [
            makeWorkItem(),
            makeWorkItem({
                id: "evt-2026-05-13-teamlab",
                title: "TeamLab Borderless",
                scheduled: "2026-05-13",
                due: "2026-05-13",
                tags: { source: ["calendar"], category: ["all-day"] },
            }),
        ];
        const result = await (0, core_1.writeWorkItemsToTickets)(tempDir, items);
        (0, vitest_1.expect)(result.written).toBe(2);
        (0, vitest_1.expect)(result.skipped).toBe(0);
        (0, vitest_1.expect)(result.paths).toHaveLength(2);
        // Verify first ticket
        const ticketPath = (0, node_path_1.join)(tempDir, ".tickets", "impl", "evt-2026-05-12-arrive-in-tokyo", "README.md");
        (0, vitest_1.expect)((0, node_fs_1.existsSync)(ticketPath)).toBe(true);
        const content = await (0, promises_1.readFile)(ticketPath, "utf-8");
        (0, vitest_1.expect)(content).toContain('title: "Arrive in Tokyo"');
        (0, vitest_1.expect)(content).toContain('scheduled: "2026-05-12T14:30:00Z"');
        (0, vitest_1.expect)(content).toContain("# Arrive in Tokyo");
        // Verify second ticket
        const ticketPath2 = (0, node_path_1.join)(tempDir, ".tickets", "impl", "evt-2026-05-13-teamlab", "README.md");
        (0, vitest_1.expect)((0, node_fs_1.existsSync)(ticketPath2)).toBe(true);
    });
    (0, vitest_1.it)("skips existing ticket directories", async () => {
        const items = [makeWorkItem()];
        // First write
        const result1 = await (0, core_1.writeWorkItemsToTickets)(tempDir, items);
        (0, vitest_1.expect)(result1.written).toBe(1);
        (0, vitest_1.expect)(result1.skipped).toBe(0);
        // Second write — should skip
        const result2 = await (0, core_1.writeWorkItemsToTickets)(tempDir, items);
        (0, vitest_1.expect)(result2.written).toBe(0);
        (0, vitest_1.expect)(result2.skipped).toBe(1);
        (0, vitest_1.expect)(result2.paths).toHaveLength(0);
    });
    (0, vitest_1.it)("creates .tickets/impl/ directory if it does not exist", async () => {
        const items = [makeWorkItem()];
        const implDir = (0, node_path_1.join)(tempDir, ".tickets", "impl");
        (0, vitest_1.expect)((0, node_fs_1.existsSync)(implDir)).toBe(false);
        await (0, core_1.writeWorkItemsToTickets)(tempDir, items);
        (0, vitest_1.expect)((0, node_fs_1.existsSync)(implDir)).toBe(true);
    });
    (0, vitest_1.it)("writes description as body content", async () => {
        const items = [makeWorkItem()];
        const descriptions = new Map();
        descriptions.set("evt-2026-05-12-arrive-in-tokyo", "Flight JL001 arriving at Narita.");
        await (0, core_1.writeWorkItemsToTickets)(tempDir, items, descriptions);
        const content = await (0, promises_1.readFile)((0, node_path_1.join)(tempDir, ".tickets", "impl", "evt-2026-05-12-arrive-in-tokyo", "README.md"), "utf-8");
        (0, vitest_1.expect)(content).toContain("Flight JL001 arriving at Narita.");
    });
    (0, vitest_1.it)("handles empty items array", async () => {
        const result = await (0, core_1.writeWorkItemsToTickets)(tempDir, []);
        (0, vitest_1.expect)(result.written).toBe(0);
        (0, vitest_1.expect)(result.skipped).toBe(0);
        (0, vitest_1.expect)(result.paths).toHaveLength(0);
    });
    (0, vitest_1.it)("updates filePath on written items", async () => {
        const items = [makeWorkItem()];
        await (0, core_1.writeWorkItemsToTickets)(tempDir, items);
        (0, vitest_1.expect)(items[0].filePath).toBe((0, node_path_1.join)(tempDir, ".tickets", "impl", "evt-2026-05-12-arrive-in-tokyo", "README.md"));
    });
});
//# sourceMappingURL=ticket-writer.test.js.map