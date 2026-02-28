import { describe, it, expect } from "vitest";
import { parseFrontmatter, parseTicketFile, summarizeWorkItems } from "@opcom/core";
import type { WorkItem } from "@opcom/types";

describe("parseFrontmatter", () => {
  it("parses YAML frontmatter from ticket content", () => {
    const content = `---
id: auth-system
title: "User Authentication System"
status: open
type: feature
priority: 1
created: 2026-02-01
services:
  - api
  - web
links:
  - docs/spec/AUTH.md
deps: []
---

# Auth System
`;
    const fm = parseFrontmatter(content);
    expect(fm).not.toBeNull();
    expect(fm!.id).toBe("auth-system");
    expect(fm!.title).toBe("User Authentication System");
    expect(fm!.status).toBe("open");
    expect(fm!.priority).toBe(1);
    expect(fm!.services).toEqual(["api", "web"]);
    expect(fm!.links).toEqual(["docs/spec/AUTH.md"]);
    expect(fm!.deps).toEqual([]);
  });

  it("returns null for content without frontmatter", () => {
    expect(parseFrontmatter("# Just a heading\nNo frontmatter.")).toBeNull();
  });
});

describe("parseTicketFile", () => {
  it("parses a ticket with frontmatter", () => {
    const content = `---
id: test-ticket
title: "Test Ticket"
status: closed
type: bug
priority: 0
---

# Test Ticket
`;
    const item = parseTicketFile(content, "/path/test-ticket/README.md", "test-ticket");
    expect(item).not.toBeNull();
    expect(item!.id).toBe("test-ticket");
    expect(item!.status).toBe("closed");
    expect(item!.priority).toBe(0);
    expect(item!.type).toBe("bug");
  });

  it("falls back to dir name when no frontmatter", () => {
    const item = parseTicketFile("# Something", "/path/fallback/README.md", "fallback");
    expect(item!.id).toBe("fallback");
    expect(item!.status).toBe("open");
  });
});

describe("summarizeWorkItems", () => {
  it("summarizes work item statuses", () => {
    const items: WorkItem[] = [
      { id: "1", title: "A", status: "open", priority: 1, type: "feature", filePath: "", deps: [], links: [], tags: {} },
      { id: "2", title: "B", status: "open", priority: 2, type: "bug", filePath: "", deps: [], links: [], tags: {} },
      { id: "3", title: "C", status: "closed", priority: 1, type: "feature", filePath: "", deps: [], links: [], tags: {} },
      { id: "4", title: "D", status: "in-progress", priority: 0, type: "feature", filePath: "", deps: [], links: [], tags: {} },
      { id: "5", title: "E", status: "deferred", priority: 3, type: "feature", filePath: "", deps: [], links: [], tags: {} },
    ];

    const summary = summarizeWorkItems(items);
    expect(summary.total).toBe(5);
    expect(summary.open).toBe(2);
    expect(summary.closed).toBe(1);
    expect(summary.inProgress).toBe(1);
    expect(summary.deferred).toBe(1);
  });
});
