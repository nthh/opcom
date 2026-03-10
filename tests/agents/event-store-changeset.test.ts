import { describe, it, expect, beforeEach, afterEach } from "vitest";
import type { Changeset } from "@opcom/types";
import { EventStore } from "@opcom/core";

describe("EventStore — Changesets", () => {
  let store: EventStore;

  beforeEach(() => {
    store = new EventStore(":memory:");
  });

  afterEach(() => {
    store.close();
  });

  it("inserts and loads changeset by ticketId", () => {
    store.insertChangeset(makeChangeset("sess-1", "ticket-a", "proj-1"));

    const result = store.loadChangesets({ ticketId: "ticket-a" });
    expect(result).toHaveLength(1);
    expect(result[0].ticketId).toBe("ticket-a");
    expect(result[0].sessionId).toBe("sess-1");
    expect(result[0].projectId).toBe("proj-1");
  });

  it("loads changeset by sessionId", () => {
    store.insertChangeset(makeChangeset("sess-1", "ticket-a", "proj-1"));
    store.insertChangeset(makeChangeset("sess-2", "ticket-b", "proj-1"));

    const result = store.loadChangesets({ sessionId: "sess-1" });
    expect(result).toHaveLength(1);
    expect(result[0].sessionId).toBe("sess-1");
  });

  it("loads changesets by projectId", () => {
    store.insertChangeset(makeChangeset("sess-1", "ticket-a", "proj-1"));
    store.insertChangeset(makeChangeset("sess-2", "ticket-b", "proj-2"));
    store.insertChangeset(makeChangeset("sess-3", "ticket-c", "proj-1"));

    const result = store.loadChangesets({ projectId: "proj-1" });
    expect(result).toHaveLength(2);
    expect(result.every((c) => c.projectId === "proj-1")).toBe(true);
  });

  it("returns multiple changesets for same ticket", () => {
    store.insertChangeset(makeChangeset("sess-1", "ticket-a", "proj-1"));
    store.insertChangeset(makeChangeset("sess-2", "ticket-a", "proj-1"));

    const result = store.loadChangesets({ ticketId: "ticket-a" });
    expect(result).toHaveLength(2);
    expect(result[0].sessionId).toBe("sess-1");
    expect(result[1].sessionId).toBe("sess-2");
  });

  it("round-trips file change data including renames", () => {
    const changeset: Changeset = {
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
    expect(result).toHaveLength(1);

    const loaded = result[0];
    expect(loaded.commitShas).toEqual(["abc123", "def456"]);
    expect(loaded.files).toHaveLength(4);
    expect(loaded.files[0]).toEqual({ path: "src/new.ts", status: "added", insertions: 42, deletions: 0 });
    expect(loaded.files[3]).toEqual({ path: "src/renamed.ts", status: "renamed", insertions: 2, deletions: 1, oldPath: "src/original.ts" });
    expect(loaded.totalInsertions).toBe(54);
    expect(loaded.totalDeletions).toBe(36);
  });

  it("returns empty array for unknown ticket", () => {
    const result = store.loadChangesets({ ticketId: "nonexistent" });
    expect(result).toHaveLength(0);
  });

  it("loads all changesets when no query filters given", () => {
    store.insertChangeset(makeChangeset("sess-1", "ticket-a", "proj-1"));
    store.insertChangeset(makeChangeset("sess-2", "ticket-b", "proj-2"));

    const result = store.loadChangesets({});
    expect(result).toHaveLength(2);
  });
});

describe("EventStore — File-Ticket Traceability", () => {
  let store: EventStore;

  beforeEach(() => {
    store = new EventStore(":memory:");
  });

  afterEach(() => {
    store.close();
  });

  it("populates file_ticket_map when changeset is inserted", () => {
    store.insertChangeset({
      sessionId: "s1",
      ticketId: "auth-setup",
      projectId: "proj",
      commitShas: ["abc"],
      files: [
        { path: "src/auth/session.ts", status: "added", insertions: 50, deletions: 0 },
        { path: "src/auth/middleware.ts", status: "modified", insertions: 10, deletions: 5 },
      ],
      totalInsertions: 60,
      totalDeletions: 5,
      timestamp: "2026-03-10T10:00:00Z",
    });

    const results = store.queryFileTickets("src/auth/session.ts");
    expect(results).toHaveLength(1);
    expect(results[0].ticketId).toBe("auth-setup");
    expect(results[0].changeStatus).toBe("added");
  });

  it("queryFileTickets returns multiple tickets for same file", () => {
    store.insertChangeset({
      sessionId: "s1",
      ticketId: "auth-setup",
      projectId: "proj",
      commitShas: ["abc"],
      files: [{ path: "src/shared.ts", status: "added", insertions: 10, deletions: 0 }],
      totalInsertions: 10,
      totalDeletions: 0,
      timestamp: "2026-03-10T10:00:00Z",
    });
    store.insertChangeset({
      sessionId: "s2",
      ticketId: "auth-bugfix",
      projectId: "proj",
      commitShas: ["def"],
      files: [{ path: "src/shared.ts", status: "modified", insertions: 5, deletions: 2 }],
      totalInsertions: 5,
      totalDeletions: 2,
      timestamp: "2026-03-11T10:00:00Z",
    });

    const results = store.queryFileTickets("src/shared.ts");
    expect(results).toHaveLength(2);
    // Most recent first
    expect(results[0].ticketId).toBe("auth-bugfix");
    expect(results[1].ticketId).toBe("auth-setup");
  });

  it("queryTicketFiles returns all files changed by a ticket", () => {
    store.insertChangeset({
      sessionId: "s1",
      ticketId: "big-feature",
      projectId: "proj",
      commitShas: ["abc"],
      files: [
        { path: "src/api.ts", status: "added", insertions: 100, deletions: 0 },
        { path: "src/types.ts", status: "modified", insertions: 20, deletions: 5 },
        { path: "src/old.ts", status: "deleted", insertions: 0, deletions: 30 },
      ],
      totalInsertions: 120,
      totalDeletions: 35,
      timestamp: "2026-03-10T10:00:00Z",
    });

    const files = store.queryTicketFiles("big-feature");
    expect(files).toHaveLength(3);
    // Sorted by file_path ASC
    expect(files[0].filePath).toBe("src/api.ts");
    expect(files[0].changeStatus).toBe("added");
    expect(files[1].filePath).toBe("src/old.ts");
    expect(files[1].changeStatus).toBe("deleted");
    expect(files[2].filePath).toBe("src/types.ts");
    expect(files[2].changeStatus).toBe("modified");
  });

  it("queryTicketFiles aggregates across multiple changesets", () => {
    // Two sessions for same ticket
    store.insertChangeset({
      sessionId: "s1",
      ticketId: "multi-session",
      projectId: "proj",
      commitShas: ["abc"],
      files: [{ path: "src/a.ts", status: "added", insertions: 10, deletions: 0 }],
      totalInsertions: 10,
      totalDeletions: 0,
      timestamp: "2026-03-10T10:00:00Z",
    });
    store.insertChangeset({
      sessionId: "s2",
      ticketId: "multi-session",
      projectId: "proj",
      commitShas: ["def"],
      files: [
        { path: "src/a.ts", status: "modified", insertions: 5, deletions: 2 },
        { path: "src/b.ts", status: "added", insertions: 20, deletions: 0 },
      ],
      totalInsertions: 25,
      totalDeletions: 2,
      timestamp: "2026-03-11T10:00:00Z",
    });

    const files = store.queryTicketFiles("multi-session");
    expect(files).toHaveLength(2);
    // src/a.ts appeared twice — latest status wins (modified)
    expect(files[0]).toMatchObject({ filePath: "src/a.ts", changeStatus: "modified" });
    expect(files[1]).toMatchObject({ filePath: "src/b.ts", changeStatus: "added" });
  });

  it("returns empty arrays for unknown file/ticket", () => {
    expect(store.queryFileTickets("nonexistent.ts")).toHaveLength(0);
    expect(store.queryTicketFiles("nonexistent")).toHaveLength(0);
  });
});

function makeChangeset(sessionId: string, ticketId: string, projectId: string): Changeset {
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
