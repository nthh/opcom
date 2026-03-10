"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
// Use vi.hoisted to avoid reference-before-initialization with vi.mock hoisting
const { mockLoadChangesets, mockClose, mockLoadProject, mockGetTicketDiff } = vitest_1.vi.hoisted(() => ({
    mockLoadChangesets: vitest_1.vi.fn(),
    mockClose: vitest_1.vi.fn(),
    mockLoadProject: vitest_1.vi.fn(),
    mockGetTicketDiff: vitest_1.vi.fn(),
}));
vitest_1.vi.mock("@opcom/core", () => ({
    EventStore: vitest_1.vi.fn().mockImplementation(() => ({
        loadChangesets: mockLoadChangesets,
        close: mockClose,
    })),
    loadProject: mockLoadProject,
    getTicketDiff: mockGetTicketDiff,
}));
const changes_js_1 = require("../../packages/cli/src/commands/changes.js");
const diff_js_1 = require("../../packages/cli/src/commands/diff.js");
function makeChangeset(overrides = {}) {
    return {
        sessionId: "sess-abc123def456",
        ticketId: "ticket-1",
        projectId: "proj-1",
        commitShas: ["aaa111"],
        files: [
            { path: "src/foo.ts", status: "modified", insertions: 10, deletions: 3 },
            { path: "src/bar.ts", status: "added", insertions: 20, deletions: 0 },
        ],
        totalInsertions: 30,
        totalDeletions: 3,
        timestamp: "2025-06-01T12:00:00Z",
        ...overrides,
    };
}
(0, vitest_1.describe)("runChanges", () => {
    let consoleSpy;
    (0, vitest_1.beforeEach)(() => {
        vitest_1.vi.clearAllMocks();
        consoleSpy = vitest_1.vi.spyOn(console, "log").mockImplementation(() => { });
    });
    (0, vitest_1.afterEach)(() => {
        consoleSpy.mockRestore();
    });
    (0, vitest_1.it)("displays file list for a ticket", async () => {
        mockLoadChangesets.mockReturnValue([makeChangeset()]);
        await (0, changes_js_1.runChanges)("ticket-1", {});
        (0, vitest_1.expect)(mockLoadChangesets).toHaveBeenCalledWith({ ticketId: "ticket-1" });
        const output = consoleSpy.mock.calls.map((c) => c[0]).join("\n");
        (0, vitest_1.expect)(output).toContain("ticket-1");
        (0, vitest_1.expect)(output).toContain("src/foo.ts");
        (0, vitest_1.expect)(output).toContain("src/bar.ts");
        (0, vitest_1.expect)(output).toContain("+30");
        (0, vitest_1.expect)(output).toContain("-3");
    });
    (0, vitest_1.it)("filters by session ID when --session is provided", async () => {
        mockLoadChangesets.mockReturnValue([makeChangeset()]);
        await (0, changes_js_1.runChanges)("ticket-1", { session: "sess-abc123def456" });
        (0, vitest_1.expect)(mockLoadChangesets).toHaveBeenCalledWith({ sessionId: "sess-abc123def456" });
    });
    (0, vitest_1.it)("filters by project when --project is provided", async () => {
        const cs1 = makeChangeset({ projectId: "proj-1" });
        const cs2 = makeChangeset({ projectId: "proj-2" });
        mockLoadChangesets.mockReturnValue([cs1, cs2]);
        await (0, changes_js_1.runChanges)("ticket-1", { project: "proj-1" });
        const output = consoleSpy.mock.calls.map((c) => c[0]).join("\n");
        (0, vitest_1.expect)(output).toContain("ticket-1");
    });
    (0, vitest_1.it)("shows no changesets message when empty", async () => {
        mockLoadChangesets.mockReturnValue([]);
        await (0, changes_js_1.runChanges)("ticket-1", {});
        const output = consoleSpy.mock.calls.map((c) => c[0]).join("\n");
        (0, vitest_1.expect)(output).toContain("No changesets found");
    });
    (0, vitest_1.it)("closes EventStore after completion", async () => {
        mockLoadChangesets.mockReturnValue([]);
        await (0, changes_js_1.runChanges)("ticket-1", {});
        (0, vitest_1.expect)(mockClose).toHaveBeenCalled();
    });
});
(0, vitest_1.describe)("runDiff", () => {
    let stdoutSpy;
    let stderrSpy;
    let exitSpy;
    (0, vitest_1.beforeEach)(() => {
        vitest_1.vi.clearAllMocks();
        stdoutSpy = vitest_1.vi.spyOn(process.stdout, "write").mockImplementation(() => true);
        stderrSpy = vitest_1.vi.spyOn(console, "error").mockImplementation(() => { });
        exitSpy = vitest_1.vi.spyOn(process, "exit").mockImplementation(() => { throw new Error("process.exit"); });
    });
    (0, vitest_1.afterEach)(() => {
        stdoutSpy.mockRestore();
        stderrSpy.mockRestore();
        exitSpy.mockRestore();
    });
    (0, vitest_1.it)("outputs unified diff for a ticket", async () => {
        const cs = makeChangeset();
        mockLoadChangesets.mockReturnValue([cs]);
        mockLoadProject.mockResolvedValue({ path: "/fake/project" });
        mockGetTicketDiff.mockResolvedValue("diff --git a/src/foo.ts b/src/foo.ts\n+added line\n");
        await (0, diff_js_1.runDiff)("ticket-1", {});
        (0, vitest_1.expect)(mockLoadChangesets).toHaveBeenCalledWith({ ticketId: "ticket-1" });
        (0, vitest_1.expect)(mockGetTicketDiff).toHaveBeenCalledWith("/fake/project", {
            commitSha: "aaa111",
        });
        (0, vitest_1.expect)(stdoutSpy).toHaveBeenCalledWith(vitest_1.expect.stringContaining("diff --git"));
    });
    (0, vitest_1.it)("passes commitShas for multi-commit changesets", async () => {
        const cs = makeChangeset({ commitShas: ["newest", "middle", "oldest"] });
        mockLoadChangesets.mockReturnValue([cs]);
        mockLoadProject.mockResolvedValue({ path: "/fake/project" });
        mockGetTicketDiff.mockResolvedValue("multi-commit diff\n");
        await (0, diff_js_1.runDiff)("ticket-1", {});
        (0, vitest_1.expect)(mockGetTicketDiff).toHaveBeenCalledWith("/fake/project", {
            commitShas: ["newest", "middle", "oldest"],
        });
    });
    (0, vitest_1.it)("filters by session when --session is provided", async () => {
        const cs = makeChangeset();
        mockLoadChangesets.mockReturnValue([cs]);
        mockLoadProject.mockResolvedValue({ path: "/fake/project" });
        mockGetTicketDiff.mockResolvedValue("diff output\n");
        await (0, diff_js_1.runDiff)("ticket-1", { session: "sess-abc123def456" });
        (0, vitest_1.expect)(mockLoadChangesets).toHaveBeenCalledWith({ sessionId: "sess-abc123def456" });
    });
    (0, vitest_1.it)("exits with error when no changesets found", async () => {
        mockLoadChangesets.mockReturnValue([]);
        await (0, vitest_1.expect)((0, diff_js_1.runDiff)("ticket-1", {})).rejects.toThrow("process.exit");
        const output = stderrSpy.mock.calls.map((c) => c[0]).join("\n");
        (0, vitest_1.expect)(output).toContain("No changesets found");
    });
    (0, vitest_1.it)("exits with error when project not found", async () => {
        mockLoadChangesets.mockReturnValue([makeChangeset()]);
        mockLoadProject.mockResolvedValue(null);
        await (0, vitest_1.expect)((0, diff_js_1.runDiff)("ticket-1", {})).rejects.toThrow("process.exit");
        const output = stderrSpy.mock.calls.map((c) => c[0]).join("\n");
        (0, vitest_1.expect)(output).toContain("not found");
    });
    (0, vitest_1.it)("closes EventStore after completion", async () => {
        mockLoadChangesets.mockReturnValue([makeChangeset()]);
        mockLoadProject.mockResolvedValue({ path: "/fake/project" });
        mockGetTicketDiff.mockResolvedValue("diff\n");
        await (0, diff_js_1.runDiff)("ticket-1", {});
        (0, vitest_1.expect)(mockClose).toHaveBeenCalled();
    });
});
//# sourceMappingURL=changes-diff.test.js.map