import { describe, it, expect, vi } from "vitest";
import { parsePastedText, parseLine, pasteEventToId } from "@opcom/core";

describe("parseLine", () => {
  it("parses 'Month DD: title' format", () => {
    const result = parseLine("May 12: Arrive Tokyo NRT 2:30pm");
    expect(result.title).toBe("Arrive Tokyo NRT 2:30pm");
    expect(result.date).toMatch(/^\d{4}-05-12$/);
  });

  it("parses 'Month DD - title' with dash separator", () => {
    const result = parseLine("Jun 3 - Conference talk");
    expect(result.title).toBe("Conference talk");
    expect(result.date).toMatch(/^\d{4}-06-03$/);
  });

  it("parses full month names", () => {
    const result = parseLine("January 15: New Year planning");
    expect(result.title).toBe("New Year planning");
    expect(result.date).toMatch(/^\d{4}-01-15$/);
  });

  it("parses 'Month DD, YYYY: title' with year", () => {
    const result = parseLine("Jan 5, 2026: Something important");
    expect(result.title).toBe("Something important");
    expect(result.date).toBe("2026-01-05");
  });

  it("parses ISO date format 'YYYY-MM-DD: title'", () => {
    const result = parseLine("2026-05-12: Arrive in Tokyo");
    expect(result.title).toBe("Arrive in Tokyo");
    expect(result.date).toBe("2026-05-12");
  });

  it("parses ISO date without separator", () => {
    const result = parseLine("2026-05-12 Event without colon");
    expect(result.title).toBe("Event without colon");
    expect(result.date).toBe("2026-05-12");
  });

  it("parses MM/DD: title format", () => {
    const result = parseLine("05/12: Mother's day brunch");
    expect(result.title).toBe("Mother's day brunch");
    expect(result.date).toMatch(/^\d{4}-05-12$/);
  });

  it("parses MM/DD/YYYY: title format", () => {
    const result = parseLine("05/12/2026: Mother's day brunch");
    expect(result.title).toBe("Mother's day brunch");
    expect(result.date).toBe("2026-05-12");
  });

  it("parses 'DD Month: title' format", () => {
    const result = parseLine("12 May: Visit temple");
    expect(result.title).toBe("Visit temple");
    expect(result.date).toMatch(/^\d{4}-05-12$/);
  });

  it("returns null date for lines with no date prefix", () => {
    const result = parseLine("Just a plain task");
    expect(result.title).toBe("Just a plain task");
    expect(result.date).toBeNull();
  });

  it("returns empty title for empty lines", () => {
    const result = parseLine("  ");
    expect(result.title).toBe("");
    expect(result.date).toBeNull();
  });
});

describe("pasteEventToId", () => {
  it("generates id with date prefix when date exists", () => {
    const id = pasteEventToId("2026-05-12", "Arrive Tokyo NRT");
    expect(id).toBe("evt-2026-05-12-arrive-tokyo-nrt");
  });

  it("generates id without date when date is null", () => {
    const id = pasteEventToId(null, "Some task");
    expect(id).toBe("evt-some-task");
  });

  it("truncates long titles to 40 chars", () => {
    const id = pasteEventToId("2026-01-01", "A very long event title that exceeds the maximum slug length allowed");
    const slug = id.replace(/^evt-2026-01-01-/, "");
    expect(slug.length).toBeLessThanOrEqual(40);
  });
});

describe("parsePastedText", () => {
  it("parses multi-line itinerary into work items", () => {
    const text = `May 12: Arrive Tokyo NRT 2:30pm
May 13: TeamLab Borderless
May 15: Shinkansen to Kyoto`;

    const items = parsePastedText(text);
    expect(items).toHaveLength(3);
    expect(items[0].title).toBe("Arrive Tokyo NRT 2:30pm");
    expect(items[0].status).toBe("open");
    expect(items[0].type).toBe("task");
    expect(items[0].tags.source).toEqual(["paste"]);
    expect(items[0].scheduled).toMatch(/^\d{4}-05-12$/);
    expect(items[1].title).toBe("TeamLab Borderless");
    expect(items[2].title).toBe("Shinkansen to Kyoto");
  });

  it("skips empty lines", () => {
    const text = `May 12: Event one

May 14: Event two
`;
    const items = parsePastedText(text);
    expect(items).toHaveLength(2);
  });

  it("handles lines without dates", () => {
    const text = `Buy groceries
Pick up dry cleaning`;
    const items = parsePastedText(text);
    expect(items).toHaveLength(2);
    expect(items[0].title).toBe("Buy groceries");
    expect(items[0].scheduled).toBeUndefined();
    expect(items[0].due).toBeUndefined();
  });

  it("sets due and scheduled from dates", () => {
    const items = parsePastedText("2026-03-15: Deadline");
    expect(items).toHaveLength(1);
    expect(items[0].scheduled).toBe("2026-03-15");
    expect(items[0].due).toBe("2026-03-15");
  });

  it("returns empty array for empty input", () => {
    expect(parsePastedText("")).toHaveLength(0);
    expect(parsePastedText("   \n  \n  ")).toHaveLength(0);
  });

  it("generates unique IDs per line", () => {
    const text = `May 12: Event A
May 13: Event B`;
    const items = parsePastedText(text);
    expect(items[0].id).not.toBe(items[1].id);
  });

  it("handles mixed date formats", () => {
    const text = `2026-05-12: ISO format
May 13: Month-first format
05/14: Slash format`;

    const items = parsePastedText(text);
    expect(items).toHaveLength(3);
    expect(items[0].scheduled).toBe("2026-05-12");
    expect(items[1].scheduled).toMatch(/^\d{4}-05-13$/);
    expect(items[2].scheduled).toMatch(/^\d{4}-05-14$/);
  });

  it("all items have deps and links as empty arrays", () => {
    const items = parsePastedText("May 12: Test event");
    expect(items[0].deps).toEqual([]);
    expect(items[0].links).toEqual([]);
  });

  it("all items have priority 2", () => {
    const items = parsePastedText("May 12: Test event");
    expect(items[0].priority).toBe(2);
  });
});
