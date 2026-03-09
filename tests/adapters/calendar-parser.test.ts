import { describe, it, expect } from "vitest";
import {
  parseICalEvents,
  parseICalToWorkItems,
  parseICalDate,
  icalEventToWorkItem,
  eventToId,
} from "@opcom/core";
import type { ICalEvent } from "@opcom/core";

// --- Test fixtures ---

const MINIMAL_ICS = `BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//Test//Test//EN
BEGIN:VEVENT
UID:abc-123@example.com
SUMMARY:Team standup
DTSTART:20260512T090000Z
DTEND:20260512T093000Z
END:VEVENT
END:VCALENDAR`;

const ALL_DAY_ICS = `BEGIN:VCALENDAR
VERSION:2.0
BEGIN:VEVENT
UID:allday-001@example.com
SUMMARY:Company offsite
DTSTART;VALUE=DATE:20260601
DTEND;VALUE=DATE:20260603
END:VEVENT
END:VCALENDAR`;

const MULTI_EVENT_ICS = `BEGIN:VCALENDAR
VERSION:2.0
BEGIN:VEVENT
UID:evt-1@example.com
SUMMARY:Arrive in Tokyo
DTSTART:20260512T143000Z
LOCATION:NRT Airport
DESCRIPTION:Flight JL001 arriving at Narita
END:VEVENT
BEGIN:VEVENT
UID:evt-2@example.com
SUMMARY:TeamLab Borderless
DTSTART;VALUE=DATE:20260513
END:VEVENT
BEGIN:VEVENT
UID:evt-3@example.com
SUMMARY:Shinkansen to Kyoto
DTSTART:20260515T100000Z
DTEND:20260515T122000Z
LOCATION:Tokyo Station
END:VEVENT
END:VCALENDAR`;

const TZID_ICS = `BEGIN:VCALENDAR
VERSION:2.0
BEGIN:VEVENT
UID:tz-001@example.com
SUMMARY:Morning meeting
DTSTART;TZID=America/New_York:20260601T090000
DTEND;TZID=America/New_York:20260601T100000
END:VEVENT
END:VCALENDAR`;

const FOLDED_LINES_ICS = `BEGIN:VCALENDAR
VERSION:2.0
BEGIN:VEVENT
UID:fold-001@example.com
SUMMARY:A very long event title that gets
  folded across multiple lines
DTSTART:20260701T120000Z
END:VEVENT
END:VCALENDAR`;

const ESCAPED_ICS = `BEGIN:VCALENDAR
VERSION:2.0
BEGIN:VEVENT
UID:esc-001@example.com
SUMMARY:Meeting\\, with commas
DESCRIPTION:Line 1\\nLine 2\\nLine 3
DTSTART:20260801T140000Z
END:VEVENT
END:VCALENDAR`;

const EMPTY_ICS = `BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//Empty//EN
END:VCALENDAR`;

const INCOMPLETE_EVENT_ICS = `BEGIN:VCALENDAR
VERSION:2.0
BEGIN:VEVENT
UID:no-summary@example.com
DTSTART:20260901T100000Z
END:VEVENT
END:VCALENDAR`;

// --- parseICalDate tests ---

describe("parseICalDate", () => {
  it("parses all-day date (YYYYMMDD)", () => {
    const result = parseICalDate("20260512");
    expect(result.iso).toBe("2026-05-12");
    expect(result.allDay).toBe(true);
  });

  it("parses datetime with UTC (Z suffix)", () => {
    const result = parseICalDate("20260512T143000Z");
    expect(result.iso).toBe("2026-05-12T14:30:00Z");
    expect(result.allDay).toBe(false);
  });

  it("parses datetime without timezone", () => {
    const result = parseICalDate("20260512T143000");
    expect(result.iso).toBe("2026-05-12T14:30:00");
    expect(result.allDay).toBe(false);
  });

  it("parses VALUE=DATE: prefix", () => {
    const result = parseICalDate("VALUE=DATE:20260601");
    expect(result.iso).toBe("2026-06-01");
    expect(result.allDay).toBe(true);
  });

  it("parses VALUE=DATE-TIME: prefix", () => {
    const result = parseICalDate("VALUE=DATE-TIME:20260601T090000Z");
    expect(result.iso).toBe("2026-06-01T09:00:00Z");
    expect(result.allDay).toBe(false);
  });

  it("parses TZID parameter", () => {
    const result = parseICalDate("TZID=America/New_York:20260601T090000");
    expect(result.iso).toBe("2026-06-01T09:00:00");
    expect(result.allDay).toBe(false);
  });

  it("returns raw value as fallback", () => {
    const result = parseICalDate("invalid-date");
    expect(result.iso).toBe("invalid-date");
    expect(result.allDay).toBe(false);
  });
});

// --- eventToId tests ---

describe("eventToId", () => {
  it("generates an id from date and title", () => {
    const event: ICalEvent = {
      uid: "test-uid",
      summary: "Arrive in Tokyo",
      dtstart: "2026-05-12T14:30:00Z",
      allDay: false,
    };
    expect(eventToId(event)).toBe("evt-2026-05-12-arrive-in-tokyo");
  });

  it("handles all-day events", () => {
    const event: ICalEvent = {
      uid: "test-uid",
      summary: "Company Offsite",
      dtstart: "2026-06-01",
      allDay: true,
    };
    expect(eventToId(event)).toBe("evt-2026-06-01-company-offsite");
  });

  it("truncates long titles", () => {
    const event: ICalEvent = {
      uid: "test-uid",
      summary: "This is a very long event title that should be truncated to forty characters",
      dtstart: "2026-07-01",
      allDay: true,
    };
    const id = eventToId(event);
    // id format: "evt-YYYY-MM-DD-" + max 40 chars slug
    expect(id.length).toBeLessThanOrEqual(4 + 10 + 1 + 40); // evt- + date + - + slug
  });

  it("strips special characters", () => {
    const event: ICalEvent = {
      uid: "test-uid",
      summary: "Meeting @ HQ (Room 3)",
      dtstart: "2026-08-01",
      allDay: true,
    };
    expect(eventToId(event)).toBe("evt-2026-08-01-meeting-hq-room-3");
  });
});

// --- parseICalEvents tests ---

describe("parseICalEvents", () => {
  it("parses a minimal single-event calendar", () => {
    const events = parseICalEvents(MINIMAL_ICS);
    expect(events).toHaveLength(1);
    expect(events[0].uid).toBe("abc-123@example.com");
    expect(events[0].summary).toBe("Team standup");
    expect(events[0].dtstart).toBe("2026-05-12T09:00:00Z");
    expect(events[0].dtend).toBe("2026-05-12T09:30:00Z");
    expect(events[0].allDay).toBe(false);
  });

  it("parses all-day events", () => {
    const events = parseICalEvents(ALL_DAY_ICS);
    expect(events).toHaveLength(1);
    expect(events[0].summary).toBe("Company offsite");
    expect(events[0].dtstart).toBe("2026-06-01");
    expect(events[0].dtend).toBe("2026-06-03");
    expect(events[0].allDay).toBe(true);
  });

  it("parses multiple events", () => {
    const events = parseICalEvents(MULTI_EVENT_ICS);
    expect(events).toHaveLength(3);
    expect(events[0].summary).toBe("Arrive in Tokyo");
    expect(events[0].location).toBe("NRT Airport");
    expect(events[0].description).toBe("Flight JL001 arriving at Narita");
    expect(events[1].summary).toBe("TeamLab Borderless");
    expect(events[1].allDay).toBe(true);
    expect(events[2].summary).toBe("Shinkansen to Kyoto");
    expect(events[2].location).toBe("Tokyo Station");
  });

  it("parses events with TZID parameter", () => {
    const events = parseICalEvents(TZID_ICS);
    expect(events).toHaveLength(1);
    expect(events[0].dtstart).toBe("2026-06-01T09:00:00");
    expect(events[0].dtend).toBe("2026-06-01T10:00:00");
    expect(events[0].allDay).toBe(false);
  });

  it("handles folded lines", () => {
    const events = parseICalEvents(FOLDED_LINES_ICS);
    expect(events).toHaveLength(1);
    expect(events[0].summary).toBe("A very long event title that gets folded across multiple lines");
  });

  it("handles escaped characters", () => {
    const events = parseICalEvents(ESCAPED_ICS);
    expect(events).toHaveLength(1);
    expect(events[0].summary).toBe("Meeting, with commas");
    expect(events[0].description).toBe("Line 1\nLine 2\nLine 3");
  });

  it("returns empty array for calendar with no events", () => {
    const events = parseICalEvents(EMPTY_ICS);
    expect(events).toHaveLength(0);
  });

  it("skips events without required fields (summary)", () => {
    const events = parseICalEvents(INCOMPLETE_EVENT_ICS);
    expect(events).toHaveLength(0);
  });

  it("handles \\r\\n line endings", () => {
    const crlfContent = MINIMAL_ICS.replace(/\n/g, "\r\n");
    const events = parseICalEvents(crlfContent);
    expect(events).toHaveLength(1);
    expect(events[0].summary).toBe("Team standup");
  });
});

// --- icalEventToWorkItem tests ---

describe("icalEventToWorkItem", () => {
  it("converts a timed event to a WorkItem", () => {
    const event: ICalEvent = {
      uid: "test-uid",
      summary: "Arrive in Tokyo",
      description: "Flight JL001",
      location: "NRT Airport",
      dtstart: "2026-05-12T14:30:00Z",
      dtend: "2026-05-12T16:00:00Z",
      allDay: false,
    };
    const item = icalEventToWorkItem(event, "/path/to/ticket");
    expect(item.id).toBe("evt-2026-05-12-arrive-in-tokyo");
    expect(item.title).toBe("Arrive in Tokyo");
    expect(item.status).toBe("open");
    expect(item.priority).toBe(2);
    expect(item.type).toBe("task");
    expect(item.scheduled).toBe("2026-05-12T14:30:00Z");
    expect(item.due).toBeUndefined();
    expect(item.tags.source).toEqual(["calendar"]);
    expect(item.tags.location).toEqual(["NRT Airport"]);
    expect(item.filePath).toBe("/path/to/ticket");
  });

  it("converts an all-day event to a WorkItem with due date", () => {
    const event: ICalEvent = {
      uid: "test-uid",
      summary: "Company Offsite",
      dtstart: "2026-06-01",
      allDay: true,
    };
    const item = icalEventToWorkItem(event);
    expect(item.scheduled).toBe("2026-06-01");
    expect(item.due).toBe("2026-06-01");
    expect(item.tags.category).toEqual(["all-day"]);
  });

  it("omits location tag when no location", () => {
    const event: ICalEvent = {
      uid: "test-uid",
      summary: "Standup",
      dtstart: "2026-05-12T09:00:00Z",
      allDay: false,
    };
    const item = icalEventToWorkItem(event);
    expect(item.tags.location).toBeUndefined();
  });

  it("defaults to empty filePath", () => {
    const event: ICalEvent = {
      uid: "test-uid",
      summary: "Test",
      dtstart: "2026-01-01",
      allDay: true,
    };
    const item = icalEventToWorkItem(event);
    expect(item.filePath).toBe("");
  });
});

// --- parseICalToWorkItems integration ---

describe("parseICalToWorkItems", () => {
  it("parses .ics content directly to WorkItems", () => {
    const items = parseICalToWorkItems(MULTI_EVENT_ICS);
    expect(items).toHaveLength(3);
    expect(items[0].title).toBe("Arrive in Tokyo");
    expect(items[0].tags.source).toEqual(["calendar"]);
    expect(items[0].tags.location).toEqual(["NRT Airport"]);
    expect(items[0].scheduled).toBe("2026-05-12T14:30:00Z");

    expect(items[1].title).toBe("TeamLab Borderless");
    expect(items[1].scheduled).toBe("2026-05-13");
    expect(items[1].due).toBe("2026-05-13");

    expect(items[2].title).toBe("Shinkansen to Kyoto");
    expect(items[2].tags.location).toEqual(["Tokyo Station"]);
  });

  it("returns empty array for empty calendar", () => {
    const items = parseICalToWorkItems(EMPTY_ICS);
    expect(items).toHaveLength(0);
  });
});
