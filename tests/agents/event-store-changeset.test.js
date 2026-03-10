"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const core_1 = require("@opcom/core");
(0, vitest_1.describe)("EventStore — Changesets", () => {
    let store;
    (0, vitest_1.beforeEach)(() => {
        store = new core_1.EventStore(":memory:");
    });
    (0, vitest_1.afterEach)(() => {
        store.close();
    });
    (0, vitest_1.it)("inserts and loads changeset by ticketId", () => {
        store.insertChangeset(makeChangeset("sess-1", "ticket-a", "proj-1"));
        const result = store.loadChangesets({ ticketId: "ticket-a" });
        (0, vitest_1.expect)(result).toHaveLength(1);
        (0, vitest_1.expect)(result[0].ticketId).toBe("ticket-a");
        (0, vitest_1.expect)(result[0].sessionId).toBe("sess-1");
        (0, vitest_1.expect)(result[0].projectId).toBe("proj-1");
    });
    (0, vitest_1.it)("loads changeset by sessionId", () => {
        store.insertChangeset(makeChangeset("sess-1", "ticket-a", "proj-1"));
        store.insertChangeset(makeChangeset("sess-2", "ticket-b", "proj-1"));
        const result = store.loadChangesets({ sessionId: "sess-1" });
        (0, vitest_1.expect)(result).toHaveLength(1);
        (0, vitest_1.expect)(result[0].sessionId).toBe("sess-1");
    });
    (0, vitest_1.it)("loads changesets by projectId", () => {
        store.insertChangeset(makeChangeset("sess-1", "ticket-a", "proj-1"));
        store.insertChangeset(makeChangeset("sess-2", "ticket-b", "proj-2"));
        store.insertChangeset(makeChangeset("sess-3", "ticket-c", "proj-1"));
        const result = store.loadChangesets({ projectId: "proj-1" });
        (0, vitest_1.expect)(result).toHaveLength(2);
        (0, vitest_1.expect)(result.every((c) => c.projectId === "proj-1")).toBe(true);
    });
    (0, vitest_1.it)("returns multiple changesets for same ticket", () => {
        store.insertChangeset(makeChangeset("sess-1", "ticket-a", "proj-1"));
        store.insertChangeset(makeChangeset("sess-2", "ticket-a", "proj-1"));
        const result = store.loadChangesets({ ticketId: "ticket-a" });
        (0, vitest_1.expect)(result).toHaveLength(2);
        (0, vitest_1.expect)(result[0].sessionId).toBe("sess-1");
        (0, vitest_1.expect)(result[1].sessionId).toBe("sess-2");
    });
    (0, vitest_1.it)("round-trips file change data including renames", () => {
        const changeset = {
            sessionId: "sess-1",
            ticketId: "ticket-a",
            projectId: "proj-1",
            commitShas: ["abc123", "def456"],
            files: [
                { path: "src/new.ts", status: "added", insertions: 42, deletions: 0 },
                { path: "src/existing.ts", status: "modified", insertions: 10, deletions: 5 },
                { path: "src/old.ts", status: "deleted", insertions: 0, deletions: 30 },
                { path: "src/renamed.ts", status: "renamed", insertions: 2, deletions: 1, oldPath: "src/original.ts" },
            ],
            totalInsertions: 54,
            totalDeletions: 36,
            timestamp: "2025-01-01T00:00:00Z",
        };
        store.insertChangeset(changeset);
        const result = store.loadChangesets({ ticketId: "ticket-a" });
        (0, vitest_1.expect)(result).toHaveLength(1);
        const loaded = result[0];
        (0, vitest_1.expect)(loaded.commitShas).toEqual(["abc123", "def456"]);
        (0, vitest_1.expect)(loaded.files).toHaveLength(4);
        (0, vitest_1.expect)(loaded.files[0]).toEqual({ path: "src/new.ts", status: "added", insertions: 42, deletions: 0 });
        (0, vitest_1.expect)(loaded.files[3]).toEqual({ path: "src/renamed.ts", status: "renamed", insertions: 2, deletions: 1, oldPath: "src/original.ts" });
        (0, vitest_1.expect)(loaded.totalInsertions).toBe(54);
        (0, vitest_1.expect)(loaded.totalDeletions).toBe(36);
    });
    (0, vitest_1.it)("returns empty array for unknown ticket", () => {
        const result = store.loadChangesets({ ticketId: "nonexistent" });
        (0, vitest_1.expect)(result).toHaveLength(0);
    });
    (0, vitest_1.it)("loads all changesets when no query filters given", () => {
        store.insertChangeset(makeChangeset("sess-1", "ticket-a", "proj-1"));
        store.insertChangeset(makeChangeset("sess-2", "ticket-b", "proj-2"));
        const result = store.loadChangesets({});
        (0, vitest_1.expect)(result).toHaveLength(2);
    });
});
function makeChangeset(sessionId, ticketId, projectId) {
    return {
        sessionId,
        ticketId,
        projectId,
        commitShas: ["abc123"],
        files: [
            { path: "src/foo.ts", status: "modified", insertions: 10, deletions: 3 },
        ],
        totalInsertions: 10,
        totalDeletions: 3,
        timestamp: "2025-01-01T00:00:00Z",
    };
}
//# sourceMappingURL=event-store-changeset.test.js.map