import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { workItemToMarkdown, writeWorkItemsToTickets } from "@opcom/core";
import type { WorkItem } from "@opcom/types";

let tempDir: string;

beforeEach(async () => {
  tempDir = await mkdtemp(join(tmpdir(), "opcom-ticket-writer-test-"));
});

afterEach(async () => {
  await rm(tempDir, { recursive: true, force: true });
});

function makeWorkItem(overrides?: Partial<WorkItem>): WorkItem {
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

describe("workItemToMarkdown", () => {
  it("generates valid frontmatter with all fields", () => {
    const item = makeWorkItem({
      due: "2026-05-12",
      created: "2026-04-01",
      parent: "japan-trip",
      deps: ["evt-2026-05-11-pack"],
      links: ["docs/travel.md"],
    });

    const md = workItemToMarkdown(item);

    expect(md).toContain("---");
    expect(md).toContain('id: evt-2026-05-12-arrive-in-tokyo');
    expect(md).toContain('title: "Arrive in Tokyo"');
    expect(md).toContain("status: open");
    expect(md).toContain("type: task");
    expect(md).toContain("priority: 2");
    expect(md).toContain('created: "2026-04-01"');
    expect(md).toContain('due: "2026-05-12"');
    expect(md).toContain('scheduled: "2026-05-12T14:30:00Z"');
    expect(md).toContain("milestone: japan-trip");
    expect(md).toContain("deps:");
    expect(md).toContain("  - evt-2026-05-11-pack");
    expect(md).toContain("links:");
    expect(md).toContain("  - docs/travel.md");
    expect(md).toContain("source:");
    expect(md).toContain("  - calendar");
    expect(md).toContain("location:");
    expect(md).toContain("  - NRT Airport");
    expect(md).toContain("# Arrive in Tokyo");
  });

  it("generates minimal frontmatter for simple items", () => {
    const item = makeWorkItem({
      tags: {},
      scheduled: undefined,
    });

    const md = workItemToMarkdown(item);
    expect(md).toContain("id: evt-2026-05-12-arrive-in-tokyo");
    expect(md).not.toContain("due:");
    expect(md).not.toContain("scheduled:");
    expect(md).not.toContain("milestone:");
    expect(md).not.toContain("deps:");
    expect(md).not.toContain("links:");
  });

  it("includes body content when provided", () => {
    const item = makeWorkItem();
    const md = workItemToMarkdown(item, "Flight JL001 arriving at Narita.");

    expect(md).toContain("Flight JL001 arriving at Narita.");
  });

  it("escapes double quotes in title", () => {
    const item = makeWorkItem({ title: 'Meeting "important" one' });
    const md = workItemToMarkdown(item);
    expect(md).toContain('title: "Meeting \\"important\\" one"');
  });
});

// --- writeWorkItemsToTickets tests ---

describe("writeWorkItemsToTickets", () => {
  it("creates ticket directories and README.md files", async () => {
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

    const result = await writeWorkItemsToTickets(tempDir, items);

    expect(result.written).toBe(2);
    expect(result.skipped).toBe(0);
    expect(result.paths).toHaveLength(2);

    // Verify first ticket
    const ticketPath = join(tempDir, ".tickets", "impl", "evt-2026-05-12-arrive-in-tokyo", "README.md");
    expect(existsSync(ticketPath)).toBe(true);
    const content = await readFile(ticketPath, "utf-8");
    expect(content).toContain('title: "Arrive in Tokyo"');
    expect(content).toContain('scheduled: "2026-05-12T14:30:00Z"');
    expect(content).toContain("# Arrive in Tokyo");

    // Verify second ticket
    const ticketPath2 = join(tempDir, ".tickets", "impl", "evt-2026-05-13-teamlab", "README.md");
    expect(existsSync(ticketPath2)).toBe(true);
  });

  it("skips existing ticket directories", async () => {
    const items = [makeWorkItem()];

    // First write
    const result1 = await writeWorkItemsToTickets(tempDir, items);
    expect(result1.written).toBe(1);
    expect(result1.skipped).toBe(0);

    // Second write — should skip
    const result2 = await writeWorkItemsToTickets(tempDir, items);
    expect(result2.written).toBe(0);
    expect(result2.skipped).toBe(1);
    expect(result2.paths).toHaveLength(0);
  });

  it("creates .tickets/impl/ directory if it does not exist", async () => {
    const items = [makeWorkItem()];
    const implDir = join(tempDir, ".tickets", "impl");
    expect(existsSync(implDir)).toBe(false);

    await writeWorkItemsToTickets(tempDir, items);

    expect(existsSync(implDir)).toBe(true);
  });

  it("writes description as body content", async () => {
    const items = [makeWorkItem()];
    const descriptions = new Map<string, string>();
    descriptions.set("evt-2026-05-12-arrive-in-tokyo", "Flight JL001 arriving at Narita.");

    await writeWorkItemsToTickets(tempDir, items, descriptions);

    const content = await readFile(
      join(tempDir, ".tickets", "impl", "evt-2026-05-12-arrive-in-tokyo", "README.md"),
      "utf-8",
    );
    expect(content).toContain("Flight JL001 arriving at Narita.");
  });

  it("handles empty items array", async () => {
    const result = await writeWorkItemsToTickets(tempDir, []);
    expect(result.written).toBe(0);
    expect(result.skipped).toBe(0);
    expect(result.paths).toHaveLength(0);
  });

  it("updates filePath on written items", async () => {
    const items = [makeWorkItem()];
    await writeWorkItemsToTickets(tempDir, items);

    expect(items[0].filePath).toBe(
      join(tempDir, ".tickets", "impl", "evt-2026-05-12-arrive-in-tokyo", "README.md"),
    );
  });
});
