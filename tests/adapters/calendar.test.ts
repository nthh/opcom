import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { CalendarAdapter, importICalFile } from "@opcom/core";

// --- Fixtures ---

const SAMPLE_ICS = `BEGIN:VCALENDAR
VERSION:2.0
BEGIN:VEVENT
UID:trip-1@example.com
SUMMARY:Arrive in Tokyo
DTSTART:20260512T143000Z
LOCATION:NRT Airport
END:VEVENT
BEGIN:VEVENT
UID:trip-2@example.com
SUMMARY:TeamLab Borderless
DTSTART;VALUE=DATE:20260513
END:VEVENT
END:VCALENDAR`;

const TICKET_MARKDOWN = `---
id: evt-2026-05-12-arrive-in-tokyo
title: "Arrive in Tokyo"
status: open
type: task
priority: 2
scheduled: "2026-05-12T14:30:00Z"
source:
  - calendar
location:
  - NRT Airport
---

# Arrive in Tokyo
`;

let tempDir: string;

beforeEach(async () => {
  tempDir = await mkdtemp(join(tmpdir(), "opcom-calendar-test-"));
});

afterEach(async () => {
  await rm(tempDir, { recursive: true, force: true });
});

// --- importICalFile tests ---

describe("importICalFile", () => {
  it("reads and parses an .ics file", async () => {
    const icsPath = join(tempDir, "events.ics");
    await writeFile(icsPath, SAMPLE_ICS, "utf-8");

    const items = await importICalFile(icsPath);
    expect(items).toHaveLength(2);
    expect(items[0].title).toBe("Arrive in Tokyo");
    expect(items[0].scheduled).toBe("2026-05-12T14:30:00Z");
    expect(items[1].title).toBe("TeamLab Borderless");
    expect(items[1].due).toBe("2026-05-13");
  });

  it("throws for nonexistent file", async () => {
    await expect(importICalFile("/tmp/nonexistent.ics")).rejects.toThrow();
  });
});

// --- CalendarAdapter tests ---

describe("CalendarAdapter", () => {
  describe("detect", () => {
    it("returns true when .ics files exist in project root", async () => {
      await writeFile(join(tempDir, "events.ics"), SAMPLE_ICS, "utf-8");
      const adapter = new CalendarAdapter(tempDir);
      expect(await adapter.detect(tempDir)).toBe(true);
    });

    it("returns true when .opcom/calendars/ directory exists", async () => {
      const calDir = join(tempDir, ".opcom", "calendars");
      await mkdir(calDir, { recursive: true });
      const adapter = new CalendarAdapter(tempDir);
      expect(await adapter.detect(tempDir)).toBe(true);
    });

    it("returns true when calendar-sourced tickets exist", async () => {
      // Create a ticket with source:calendar tag
      const ticketDir = join(tempDir, ".tickets", "impl", "evt-2026-05-12-test");
      await mkdir(ticketDir, { recursive: true });
      await writeFile(join(ticketDir, "README.md"), TICKET_MARKDOWN, "utf-8");

      const adapter = new CalendarAdapter(tempDir);
      expect(await adapter.detect(tempDir)).toBe(true);
    });

    it("returns false for empty project", async () => {
      const adapter = new CalendarAdapter(tempDir);
      expect(await adapter.detect(tempDir)).toBe(false);
    });
  });

  describe("listItems", () => {
    it("returns only calendar-sourced tickets", async () => {
      // Create a calendar-sourced ticket
      const calTicketDir = join(tempDir, ".tickets", "impl", "evt-2026-05-12-test");
      await mkdir(calTicketDir, { recursive: true });
      await writeFile(join(calTicketDir, "README.md"), TICKET_MARKDOWN, "utf-8");

      // Create a regular ticket
      const regTicketDir = join(tempDir, ".tickets", "impl", "regular-task");
      await mkdir(regTicketDir, { recursive: true });
      await writeFile(join(regTicketDir, "README.md"), `---
id: regular-task
title: "Regular task"
status: open
type: feature
priority: 2
---

# Regular task
`, "utf-8");

      const adapter = new CalendarAdapter(tempDir);
      const items = await adapter.listItems();
      expect(items).toHaveLength(1);
      expect(items[0].id).toBe("evt-2026-05-12-arrive-in-tokyo");
    });

    it("returns empty array when no calendar tickets exist", async () => {
      const adapter = new CalendarAdapter(tempDir);
      const items = await adapter.listItems();
      expect(items).toHaveLength(0);
    });
  });

  describe("getItem", () => {
    it("returns a specific calendar-sourced ticket", async () => {
      const ticketDir = join(tempDir, ".tickets", "impl", "evt-2026-05-12-arrive-in-tokyo");
      await mkdir(ticketDir, { recursive: true });
      await writeFile(join(ticketDir, "README.md"), TICKET_MARKDOWN, "utf-8");

      const adapter = new CalendarAdapter(tempDir);
      const item = await adapter.getItem("evt-2026-05-12-arrive-in-tokyo");
      expect(item).not.toBeNull();
      expect(item!.title).toBe("Arrive in Tokyo");
    });

    it("returns null for nonexistent item", async () => {
      const adapter = new CalendarAdapter(tempDir);
      const item = await adapter.getItem("nonexistent");
      expect(item).toBeNull();
    });
  });

  describe("summarize", () => {
    it("returns correct summary counts", async () => {
      // Create two calendar tickets with different statuses
      const dir1 = join(tempDir, ".tickets", "impl", "evt-2026-05-12-event-one");
      await mkdir(dir1, { recursive: true });
      await writeFile(join(dir1, "README.md"), `---
id: evt-2026-05-12-event-one
title: "Event One"
status: open
type: task
priority: 2
source:
  - calendar
---

# Event One
`, "utf-8");

      const dir2 = join(tempDir, ".tickets", "impl", "evt-2026-05-13-event-two");
      await mkdir(dir2, { recursive: true });
      await writeFile(join(dir2, "README.md"), `---
id: evt-2026-05-13-event-two
title: "Event Two"
status: closed
type: task
priority: 2
source:
  - calendar
---

# Event Two
`, "utf-8");

      const adapter = new CalendarAdapter(tempDir);
      const summary = await adapter.summarize();
      expect(summary.total).toBe(2);
      expect(summary.open).toBe(1);
      expect(summary.closed).toBe(1);
    });
  });

  describe("type", () => {
    it("has type 'calendar'", () => {
      const adapter = new CalendarAdapter(tempDir);
      expect(adapter.type).toBe("calendar");
    });
  });
});
