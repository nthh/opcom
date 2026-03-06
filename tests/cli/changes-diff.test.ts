import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { Changeset } from "@opcom/types";

// Use vi.hoisted to avoid reference-before-initialization with vi.mock hoisting
const { mockLoadChangesets, mockClose, mockLoadProject, mockGetTicketDiff } = vi.hoisted(() => ({
  mockLoadChangesets: vi.fn(),
  mockClose: vi.fn(),
  mockLoadProject: vi.fn(),
  mockGetTicketDiff: vi.fn(),
}));

vi.mock("@opcom/core", () => ({
  EventStore: vi.fn().mockImplementation(() => ({
    loadChangesets: mockLoadChangesets,
    close: mockClose,
  })),
  loadProject: mockLoadProject,
  getTicketDiff: mockGetTicketDiff,
}));

import { runChanges } from "../../packages/cli/src/commands/changes.js";
import { runDiff } from "../../packages/cli/src/commands/diff.js";

function makeChangeset(overrides: Partial<Changeset> = {}): Changeset {
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

describe("runChanges", () => {
  let consoleSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
  });

  afterEach(() => {
    consoleSpy.mockRestore();
  });

  it("displays file list for a ticket", async () => {
    mockLoadChangesets.mockReturnValue([makeChangeset()]);

    await runChanges("ticket-1", {});

    expect(mockLoadChangesets).toHaveBeenCalledWith({ ticketId: "ticket-1" });
    const output = consoleSpy.mock.calls.map((c) => c[0]).join("\n");
    expect(output).toContain("ticket-1");
    expect(output).toContain("src/foo.ts");
    expect(output).toContain("src/bar.ts");
    expect(output).toContain("+30");
    expect(output).toContain("-3");
  });

  it("filters by session ID when --session is provided", async () => {
    mockLoadChangesets.mockReturnValue([makeChangeset()]);

    await runChanges("ticket-1", { session: "sess-abc123def456" });

    expect(mockLoadChangesets).toHaveBeenCalledWith({ sessionId: "sess-abc123def456" });
  });

  it("filters by project when --project is provided", async () => {
    const cs1 = makeChangeset({ projectId: "proj-1" });
    const cs2 = makeChangeset({ projectId: "proj-2" });
    mockLoadChangesets.mockReturnValue([cs1, cs2]);

    await runChanges("ticket-1", { project: "proj-1" });

    const output = consoleSpy.mock.calls.map((c) => c[0]).join("\n");
    expect(output).toContain("ticket-1");
  });

  it("shows no changesets message when empty", async () => {
    mockLoadChangesets.mockReturnValue([]);

    await runChanges("ticket-1", {});

    const output = consoleSpy.mock.calls.map((c) => c[0]).join("\n");
    expect(output).toContain("No changesets found");
  });

  it("closes EventStore after completion", async () => {
    mockLoadChangesets.mockReturnValue([]);

    await runChanges("ticket-1", {});

    expect(mockClose).toHaveBeenCalled();
  });
});

describe("runDiff", () => {
  let stdoutSpy: ReturnType<typeof vi.spyOn>;
  let stderrSpy: ReturnType<typeof vi.spyOn>;
  let exitSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    stdoutSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    stderrSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    exitSpy = vi.spyOn(process, "exit").mockImplementation(() => { throw new Error("process.exit"); });
  });

  afterEach(() => {
    stdoutSpy.mockRestore();
    stderrSpy.mockRestore();
    exitSpy.mockRestore();
  });

  it("outputs unified diff for a ticket", async () => {
    const cs = makeChangeset();
    mockLoadChangesets.mockReturnValue([cs]);
    mockLoadProject.mockResolvedValue({ path: "/fake/project" });
    mockGetTicketDiff.mockResolvedValue("diff --git a/src/foo.ts b/src/foo.ts\n+added line\n");

    await runDiff("ticket-1", {});

    expect(mockLoadChangesets).toHaveBeenCalledWith({ ticketId: "ticket-1" });
    expect(mockGetTicketDiff).toHaveBeenCalledWith("/fake/project", {
      commitSha: "aaa111",
    });
    expect(stdoutSpy).toHaveBeenCalledWith(expect.stringContaining("diff --git"));
  });

  it("passes commitShas for multi-commit changesets", async () => {
    const cs = makeChangeset({ commitShas: ["newest", "middle", "oldest"] });
    mockLoadChangesets.mockReturnValue([cs]);
    mockLoadProject.mockResolvedValue({ path: "/fake/project" });
    mockGetTicketDiff.mockResolvedValue("multi-commit diff\n");

    await runDiff("ticket-1", {});

    expect(mockGetTicketDiff).toHaveBeenCalledWith("/fake/project", {
      commitShas: ["newest", "middle", "oldest"],
    });
  });

  it("filters by session when --session is provided", async () => {
    const cs = makeChangeset();
    mockLoadChangesets.mockReturnValue([cs]);
    mockLoadProject.mockResolvedValue({ path: "/fake/project" });
    mockGetTicketDiff.mockResolvedValue("diff output\n");

    await runDiff("ticket-1", { session: "sess-abc123def456" });

    expect(mockLoadChangesets).toHaveBeenCalledWith({ sessionId: "sess-abc123def456" });
  });

  it("exits with error when no changesets found", async () => {
    mockLoadChangesets.mockReturnValue([]);

    await expect(runDiff("ticket-1", {})).rejects.toThrow("process.exit");

    const output = stderrSpy.mock.calls.map((c) => c[0]).join("\n");
    expect(output).toContain("No changesets found");
  });

  it("exits with error when project not found", async () => {
    mockLoadChangesets.mockReturnValue([makeChangeset()]);
    mockLoadProject.mockResolvedValue(null);

    await expect(runDiff("ticket-1", {})).rejects.toThrow("process.exit");

    const output = stderrSpy.mock.calls.map((c) => c[0]).join("\n");
    expect(output).toContain("not found");
  });

  it("closes EventStore after completion", async () => {
    mockLoadChangesets.mockReturnValue([makeChangeset()]);
    mockLoadProject.mockResolvedValue({ path: "/fake/project" });
    mockGetTicketDiff.mockResolvedValue("diff\n");

    await runDiff("ticket-1", {});

    expect(mockClose).toHaveBeenCalled();
  });
});
