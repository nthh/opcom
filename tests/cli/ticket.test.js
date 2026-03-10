"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const { mockLoadGlobalConfig, mockLoadWorkspace, mockLoadProject, mockScanTickets, mockBuildContextPacket, mockBuildTicketCreationPrompt, mockSessionManagerInit, mockStartSession, mockSubscribeToSession, mockReadFile, } = vitest_1.vi.hoisted(() => ({
    mockLoadGlobalConfig: vitest_1.vi.fn(),
    mockLoadWorkspace: vitest_1.vi.fn(),
    mockLoadProject: vitest_1.vi.fn(),
    mockScanTickets: vitest_1.vi.fn(),
    mockBuildContextPacket: vitest_1.vi.fn(),
    mockBuildTicketCreationPrompt: vitest_1.vi.fn(),
    mockSessionManagerInit: vitest_1.vi.fn(),
    mockStartSession: vitest_1.vi.fn(),
    mockSubscribeToSession: vitest_1.vi.fn(),
    mockReadFile: vitest_1.vi.fn(),
}));
vitest_1.vi.mock("node:fs/promises", async (importOriginal) => {
    const actual = await importOriginal();
    return { ...actual, readFile: mockReadFile };
});
vitest_1.vi.mock("@opcom/core", () => ({
    loadGlobalConfig: mockLoadGlobalConfig,
    loadWorkspace: mockLoadWorkspace,
    loadProject: mockLoadProject,
    scanTickets: mockScanTickets,
    buildContextPacket: mockBuildContextPacket,
    buildTicketCreationPrompt: mockBuildTicketCreationPrompt,
    SessionManager: vitest_1.vi.fn().mockImplementation(() => ({
        init: mockSessionManagerInit,
        startSession: mockStartSession,
        subscribeToSession: mockSubscribeToSession,
    })),
}));
const ticket_js_1 = require("../../packages/cli/src/commands/ticket.js");
// Strip ANSI codes for easier assertion
function strip(s) {
    return s.replace(/\x1b\[[0-9;]*m/g, "");
}
function makeProject(overrides = {}) {
    return {
        id: "proj-1",
        name: "testproject",
        path: "/home/user/testproject",
        stack: { languages: [], frameworks: [], packageManagers: [], infrastructure: [], versionManagers: [] },
        git: { branch: "main", clean: true, uncommittedCount: 0 },
        workSystem: { type: "tickets-dir", ticketDir: ".tickets" },
        docs: {},
        linting: [],
        services: [],
        subProjects: [],
        ...overrides,
    };
}
function makeWorkItem(overrides = {}) {
    return {
        id: "ticket-1",
        title: "Fix the bug",
        status: "open",
        priority: 2,
        type: "bug",
        filePath: "/home/user/testproject/.tickets/impl/ticket-1/README.md",
        deps: [],
        links: [],
        tags: {},
        ...overrides,
    };
}
function setupWorkspace() {
    mockLoadGlobalConfig.mockResolvedValue({ defaultWorkspace: "default" });
    mockLoadWorkspace.mockResolvedValue({ projectIds: ["proj-1"] });
    mockLoadProject.mockResolvedValue(makeProject());
}
(0, vitest_1.describe)("runTicketList", () => {
    let consoleSpy;
    let exitSpy;
    (0, vitest_1.beforeEach)(() => {
        vitest_1.vi.clearAllMocks();
        consoleSpy = vitest_1.vi.spyOn(console, "log").mockImplementation(() => { });
        exitSpy = vitest_1.vi.spyOn(process, "exit").mockImplementation(() => { throw new Error("exit"); });
    });
    (0, vitest_1.afterEach)(() => {
        consoleSpy.mockRestore();
        exitSpy.mockRestore();
    });
    (0, vitest_1.it)("lists tickets for a specific project sorted by priority", async () => {
        setupWorkspace();
        const tickets = [
            makeWorkItem({ id: "low-pri", title: "Low priority task", priority: 4 }),
            makeWorkItem({ id: "high-pri", title: "High priority task", priority: 1 }),
            makeWorkItem({ id: "mid-pri", title: "Mid priority task", priority: 2 }),
        ];
        mockScanTickets.mockResolvedValue(tickets);
        await (0, ticket_js_1.runTicketList)("proj-1");
        const output = strip(consoleSpy.mock.calls.map((c) => c[0]).join("\n"));
        (0, vitest_1.expect)(output).toContain("testproject");
        (0, vitest_1.expect)(output).toContain("3 tickets");
        // Verify priority order: P1 before P2 before P4
        const p1Idx = output.indexOf("high-pri");
        const p2Idx = output.indexOf("mid-pri");
        const p4Idx = output.indexOf("low-pri");
        (0, vitest_1.expect)(p1Idx).toBeLessThan(p2Idx);
        (0, vitest_1.expect)(p2Idx).toBeLessThan(p4Idx);
    });
    (0, vitest_1.it)("shows message when no tickets exist", async () => {
        setupWorkspace();
        mockScanTickets.mockResolvedValue([]);
        await (0, ticket_js_1.runTicketList)("proj-1");
        const output = strip(consoleSpy.mock.calls.map((c) => c[0]).join("\n"));
        (0, vitest_1.expect)(output).toContain("No tickets");
    });
    (0, vitest_1.it)("shows tickets with dependency info", async () => {
        setupWorkspace();
        const tickets = [
            makeWorkItem({ id: "child", title: "Child ticket", deps: ["parent-1", "parent-2"] }),
        ];
        mockScanTickets.mockResolvedValue(tickets);
        await (0, ticket_js_1.runTicketList)("proj-1");
        const output = strip(consoleSpy.mock.calls.map((c) => c[0]).join("\n"));
        (0, vitest_1.expect)(output).toContain("deps: parent-1, parent-2");
    });
    (0, vitest_1.it)("errors when project not in workspace", async () => {
        mockLoadGlobalConfig.mockResolvedValue({ defaultWorkspace: "default" });
        mockLoadWorkspace.mockResolvedValue({ projectIds: ["other-proj"] });
        await (0, vitest_1.expect)((0, ticket_js_1.runTicketList)("proj-1")).rejects.toThrow("exit");
        (0, vitest_1.expect)(exitSpy).toHaveBeenCalledWith(1);
    });
    (0, vitest_1.it)("lists tickets across all projects when no project specified", async () => {
        mockLoadGlobalConfig.mockResolvedValue({ defaultWorkspace: "default" });
        mockLoadWorkspace.mockResolvedValue({ projectIds: ["proj-1"] });
        mockLoadProject.mockResolvedValue(makeProject());
        mockScanTickets.mockResolvedValue([
            makeWorkItem({ id: "t-1", title: "Task one" }),
        ]);
        await (0, ticket_js_1.runTicketList)();
        const output = strip(consoleSpy.mock.calls.map((c) => c[0]).join("\n"));
        (0, vitest_1.expect)(output).toContain("testproject");
        (0, vitest_1.expect)(output).toContain("t-1");
    });
});
(0, vitest_1.describe)("runTicketCreate", () => {
    let consoleSpy;
    let exitSpy;
    (0, vitest_1.beforeEach)(() => {
        vitest_1.vi.clearAllMocks();
        consoleSpy = vitest_1.vi.spyOn(console, "log").mockImplementation(() => { });
        exitSpy = vitest_1.vi.spyOn(process, "exit").mockImplementation(() => { throw new Error("exit"); });
    });
    (0, vitest_1.afterEach)(() => {
        consoleSpy.mockRestore();
        exitSpy.mockRestore();
    });
    (0, vitest_1.it)("spawns agent with ticket creation prompt and streams output", async () => {
        setupWorkspace();
        const existingTickets = [makeWorkItem()];
        mockScanTickets
            .mockResolvedValueOnce(existingTickets) // initial scan
            .mockResolvedValueOnce([
            ...existingTickets,
            makeWorkItem({ id: "new-ticket", title: "Add retry logic" }),
        ]);
        mockBuildContextPacket.mockResolvedValue({ project: {}, git: {} });
        mockBuildTicketCreationPrompt.mockReturnValue("system prompt");
        mockStartSession.mockResolvedValue({ id: "sess-123" });
        // Create an async iterator that yields nothing (agent finishes immediately)
        mockSubscribeToSession.mockReturnValue({
            [Symbol.asyncIterator]: () => ({
                next: vitest_1.vi.fn().mockResolvedValue({ done: true }),
            }),
        });
        await (0, ticket_js_1.runTicketCreate)("proj-1", "Add retry logic to API calls");
        // Verify prompt was built with existing tickets
        (0, vitest_1.expect)(mockBuildTicketCreationPrompt).toHaveBeenCalledWith(vitest_1.expect.objectContaining({ id: "proj-1" }), "Add retry logic to API calls", existingTickets);
        // Verify session started with correct options
        (0, vitest_1.expect)(mockStartSession).toHaveBeenCalledWith("proj-1", "claude-code", vitest_1.expect.objectContaining({
            systemPrompt: "system prompt",
            allowedTools: ["Bash", "Write"],
        }));
        const output = strip(consoleSpy.mock.calls.map((c) => c[0]).join("\n"));
        (0, vitest_1.expect)(output).toContain("Creating ticket");
        (0, vitest_1.expect)(output).toContain("new-ticket");
        (0, vitest_1.expect)(output).toContain("Add retry logic");
    });
    (0, vitest_1.it)("reports when no new ticket detected after agent run", async () => {
        setupWorkspace();
        const tickets = [makeWorkItem()];
        mockScanTickets.mockResolvedValue(tickets); // same both times
        mockBuildContextPacket.mockResolvedValue({ project: {}, git: {} });
        mockBuildTicketCreationPrompt.mockReturnValue("prompt");
        mockStartSession.mockResolvedValue({ id: "sess-456" });
        mockSubscribeToSession.mockReturnValue({
            [Symbol.asyncIterator]: () => ({
                next: vitest_1.vi.fn().mockResolvedValue({ done: true }),
            }),
        });
        await (0, ticket_js_1.runTicketCreate)("proj-1", "Some description");
        const output = strip(consoleSpy.mock.calls.map((c) => c[0]).join("\n"));
        (0, vitest_1.expect)(output).toContain("No new tickets detected");
    });
    (0, vitest_1.it)("errors when project not in workspace", async () => {
        mockLoadGlobalConfig.mockResolvedValue({ defaultWorkspace: "default" });
        mockLoadWorkspace.mockResolvedValue({ projectIds: ["other-proj"] });
        await (0, vitest_1.expect)((0, ticket_js_1.runTicketCreate)("proj-1", "desc")).rejects.toThrow("exit");
        (0, vitest_1.expect)(exitSpy).toHaveBeenCalledWith(1);
    });
});
(0, vitest_1.describe)("runTicketShow", () => {
    let consoleSpy;
    let exitSpy;
    (0, vitest_1.beforeEach)(() => {
        vitest_1.vi.clearAllMocks();
        consoleSpy = vitest_1.vi.spyOn(console, "log").mockImplementation(() => { });
        exitSpy = vitest_1.vi.spyOn(process, "exit").mockImplementation(() => { throw new Error("exit"); });
    });
    (0, vitest_1.afterEach)(() => {
        consoleSpy.mockRestore();
        exitSpy.mockRestore();
    });
    (0, vitest_1.it)("displays ticket details and body content", async () => {
        setupWorkspace();
        const ticket = makeWorkItem({ id: "show-me", title: "Show Me Ticket", priority: 1, type: "feature", created: "2026-03-01" });
        mockScanTickets.mockResolvedValue([ticket]);
        mockReadFile.mockResolvedValue("---\nid: show-me\ntitle: Show Me Ticket\nstatus: open\n---\n\n## Goal\nDo the thing.\n\n## Tasks\n- [ ] Step 1\n");
        await (0, ticket_js_1.runTicketShow)("proj-1", "show-me");
        const output = strip(consoleSpy.mock.calls.map((c) => c[0]).join("\n"));
        (0, vitest_1.expect)(output).toContain("Show Me Ticket");
        (0, vitest_1.expect)(output).toContain("P1");
        (0, vitest_1.expect)(output).toContain("2026-03-01");
        (0, vitest_1.expect)(output).toContain("Do the thing");
    });
    (0, vitest_1.it)("errors when ticket not found", async () => {
        setupWorkspace();
        mockScanTickets.mockResolvedValue([makeWorkItem({ id: "other" })]);
        await (0, vitest_1.expect)((0, ticket_js_1.runTicketShow)("proj-1", "nonexistent")).rejects.toThrow("exit");
        (0, vitest_1.expect)(exitSpy).toHaveBeenCalledWith(1);
    });
});
//# sourceMappingURL=ticket.test.js.map