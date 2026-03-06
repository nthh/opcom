import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { ProjectConfig, WorkItem } from "@opcom/types";

const {
  mockLoadGlobalConfig,
  mockLoadWorkspace,
  mockLoadProject,
  mockScanTickets,
  mockBuildContextPacket,
  mockBuildTicketCreationPrompt,
  mockSessionManagerInit,
  mockStartSession,
  mockSubscribeToSession,
  mockReadFile,
} = vi.hoisted(() => ({
  mockLoadGlobalConfig: vi.fn(),
  mockLoadWorkspace: vi.fn(),
  mockLoadProject: vi.fn(),
  mockScanTickets: vi.fn(),
  mockBuildContextPacket: vi.fn(),
  mockBuildTicketCreationPrompt: vi.fn(),
  mockSessionManagerInit: vi.fn(),
  mockStartSession: vi.fn(),
  mockSubscribeToSession: vi.fn(),
  mockReadFile: vi.fn(),
}));

vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  return { ...actual, readFile: mockReadFile };
});

vi.mock("@opcom/core", () => ({
  loadGlobalConfig: mockLoadGlobalConfig,
  loadWorkspace: mockLoadWorkspace,
  loadProject: mockLoadProject,
  scanTickets: mockScanTickets,
  buildContextPacket: mockBuildContextPacket,
  buildTicketCreationPrompt: mockBuildTicketCreationPrompt,
  SessionManager: vi.fn().mockImplementation(() => ({
    init: mockSessionManagerInit,
    startSession: mockStartSession,
    subscribeToSession: mockSubscribeToSession,
  })),
}));

import { runTicketList, runTicketCreate, runTicketShow } from "../../packages/cli/src/commands/ticket.js";

// Strip ANSI codes for easier assertion
function strip(s: string): string {
  return s.replace(/\x1b\[[0-9;]*m/g, "");
}

function makeProject(overrides: Partial<ProjectConfig> = {}): ProjectConfig {
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
  } as ProjectConfig;
}

function makeWorkItem(overrides: Partial<WorkItem> = {}): WorkItem {
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

function setupWorkspace(): void {
  mockLoadGlobalConfig.mockResolvedValue({ defaultWorkspace: "default" });
  mockLoadWorkspace.mockResolvedValue({ projectIds: ["proj-1"] });
  mockLoadProject.mockResolvedValue(makeProject());
}

describe("runTicketList", () => {
  let consoleSpy: ReturnType<typeof vi.spyOn>;
  let exitSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    exitSpy = vi.spyOn(process, "exit").mockImplementation(() => { throw new Error("exit"); });
  });

  afterEach(() => {
    consoleSpy.mockRestore();
    exitSpy.mockRestore();
  });

  it("lists tickets for a specific project sorted by priority", async () => {
    setupWorkspace();
    const tickets = [
      makeWorkItem({ id: "low-pri", title: "Low priority task", priority: 4 }),
      makeWorkItem({ id: "high-pri", title: "High priority task", priority: 1 }),
      makeWorkItem({ id: "mid-pri", title: "Mid priority task", priority: 2 }),
    ];
    mockScanTickets.mockResolvedValue(tickets);

    await runTicketList("proj-1");

    const output = strip(consoleSpy.mock.calls.map((c) => c[0]).join("\n"));
    expect(output).toContain("testproject");
    expect(output).toContain("3 tickets");
    // Verify priority order: P1 before P2 before P4
    const p1Idx = output.indexOf("high-pri");
    const p2Idx = output.indexOf("mid-pri");
    const p4Idx = output.indexOf("low-pri");
    expect(p1Idx).toBeLessThan(p2Idx);
    expect(p2Idx).toBeLessThan(p4Idx);
  });

  it("shows message when no tickets exist", async () => {
    setupWorkspace();
    mockScanTickets.mockResolvedValue([]);

    await runTicketList("proj-1");

    const output = strip(consoleSpy.mock.calls.map((c) => c[0]).join("\n"));
    expect(output).toContain("No tickets");
  });

  it("shows tickets with dependency info", async () => {
    setupWorkspace();
    const tickets = [
      makeWorkItem({ id: "child", title: "Child ticket", deps: ["parent-1", "parent-2"] }),
    ];
    mockScanTickets.mockResolvedValue(tickets);

    await runTicketList("proj-1");

    const output = strip(consoleSpy.mock.calls.map((c) => c[0]).join("\n"));
    expect(output).toContain("deps: parent-1, parent-2");
  });

  it("errors when project not in workspace", async () => {
    mockLoadGlobalConfig.mockResolvedValue({ defaultWorkspace: "default" });
    mockLoadWorkspace.mockResolvedValue({ projectIds: ["other-proj"] });

    await expect(runTicketList("proj-1")).rejects.toThrow("exit");
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it("lists tickets across all projects when no project specified", async () => {
    mockLoadGlobalConfig.mockResolvedValue({ defaultWorkspace: "default" });
    mockLoadWorkspace.mockResolvedValue({ projectIds: ["proj-1"] });
    mockLoadProject.mockResolvedValue(makeProject());
    mockScanTickets.mockResolvedValue([
      makeWorkItem({ id: "t-1", title: "Task one" }),
    ]);

    await runTicketList();

    const output = strip(consoleSpy.mock.calls.map((c) => c[0]).join("\n"));
    expect(output).toContain("testproject");
    expect(output).toContain("t-1");
  });
});

describe("runTicketCreate", () => {
  let consoleSpy: ReturnType<typeof vi.spyOn>;
  let exitSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    exitSpy = vi.spyOn(process, "exit").mockImplementation(() => { throw new Error("exit"); });
  });

  afterEach(() => {
    consoleSpy.mockRestore();
    exitSpy.mockRestore();
  });

  it("spawns agent with ticket creation prompt and streams output", async () => {
    setupWorkspace();
    const existingTickets = [makeWorkItem()];
    mockScanTickets
      .mockResolvedValueOnce(existingTickets)  // initial scan
      .mockResolvedValueOnce([                  // rescan after creation
        ...existingTickets,
        makeWorkItem({ id: "new-ticket", title: "Add retry logic" }),
      ]);
    mockBuildContextPacket.mockResolvedValue({ project: {}, git: {} });
    mockBuildTicketCreationPrompt.mockReturnValue("system prompt");
    mockStartSession.mockResolvedValue({ id: "sess-123" });

    // Create an async iterator that yields nothing (agent finishes immediately)
    mockSubscribeToSession.mockReturnValue({
      [Symbol.asyncIterator]: () => ({
        next: vi.fn().mockResolvedValue({ done: true }),
      }),
    });

    await runTicketCreate("proj-1", "Add retry logic to API calls");

    // Verify prompt was built with existing tickets
    expect(mockBuildTicketCreationPrompt).toHaveBeenCalledWith(
      expect.objectContaining({ id: "proj-1" }),
      "Add retry logic to API calls",
      existingTickets,
    );

    // Verify session started with correct options
    expect(mockStartSession).toHaveBeenCalledWith(
      "proj-1",
      "claude-code",
      expect.objectContaining({
        systemPrompt: "system prompt",
        allowedTools: ["Bash", "Write"],
      }),
    );

    const output = strip(consoleSpy.mock.calls.map((c) => c[0]).join("\n"));
    expect(output).toContain("Creating ticket");
    expect(output).toContain("new-ticket");
    expect(output).toContain("Add retry logic");
  });

  it("reports when no new ticket detected after agent run", async () => {
    setupWorkspace();
    const tickets = [makeWorkItem()];
    mockScanTickets.mockResolvedValue(tickets); // same both times
    mockBuildContextPacket.mockResolvedValue({ project: {}, git: {} });
    mockBuildTicketCreationPrompt.mockReturnValue("prompt");
    mockStartSession.mockResolvedValue({ id: "sess-456" });
    mockSubscribeToSession.mockReturnValue({
      [Symbol.asyncIterator]: () => ({
        next: vi.fn().mockResolvedValue({ done: true }),
      }),
    });

    await runTicketCreate("proj-1", "Some description");

    const output = strip(consoleSpy.mock.calls.map((c) => c[0]).join("\n"));
    expect(output).toContain("No new tickets detected");
  });

  it("errors when project not in workspace", async () => {
    mockLoadGlobalConfig.mockResolvedValue({ defaultWorkspace: "default" });
    mockLoadWorkspace.mockResolvedValue({ projectIds: ["other-proj"] });

    await expect(runTicketCreate("proj-1", "desc")).rejects.toThrow("exit");
    expect(exitSpy).toHaveBeenCalledWith(1);
  });
});

describe("runTicketShow", () => {
  let consoleSpy: ReturnType<typeof vi.spyOn>;
  let exitSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    exitSpy = vi.spyOn(process, "exit").mockImplementation(() => { throw new Error("exit"); });
  });

  afterEach(() => {
    consoleSpy.mockRestore();
    exitSpy.mockRestore();
  });

  it("displays ticket details and body content", async () => {
    setupWorkspace();
    const ticket = makeWorkItem({ id: "show-me", title: "Show Me Ticket", priority: 1, type: "feature", created: "2026-03-01" });
    mockScanTickets.mockResolvedValue([ticket]);
    mockReadFile.mockResolvedValue(
      "---\nid: show-me\ntitle: Show Me Ticket\nstatus: open\n---\n\n## Goal\nDo the thing.\n\n## Tasks\n- [ ] Step 1\n"
    );

    await runTicketShow("proj-1", "show-me");

    const output = strip(consoleSpy.mock.calls.map((c) => c[0]).join("\n"));
    expect(output).toContain("Show Me Ticket");
    expect(output).toContain("P1");
    expect(output).toContain("2026-03-01");
    expect(output).toContain("Do the thing");
  });

  it("errors when ticket not found", async () => {
    setupWorkspace();
    mockScanTickets.mockResolvedValue([makeWorkItem({ id: "other" })]);

    await expect(runTicketShow("proj-1", "nonexistent")).rejects.toThrow("exit");
    expect(exitSpy).toHaveBeenCalledWith(1);
  });
});
