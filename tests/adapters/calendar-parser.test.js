"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const core_1 = require("@opcom/core");
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
(0, vitest_1.describe)("parseICalDate", () => {
    (0, vitest_1.it)("parses all-day date (YYYYMMDD)", () => {
        const result = (0, core_1.parseICalDate)("20260512");
        (0, vitest_1.expect)(result.iso).toBe("2026-05-12");
        (0, vitest_1.expect)(result.allDay).toBe(true);
    });
    (0, vitest_1.it)("parses datetime with UTC (Z suffix)", () => {
        const result = (0, core_1.parseICalDate)("20260512T143000Z");
        (0, vitest_1.expect)(result.iso).toBe("2026-05-12T14:30:00Z");
        (0, vitest_1.expect)(result.allDay).toBe(false);
    });
    (0, vitest_1.it)("parses datetime without timezone", () => {
        const result = (0, core_1.parseICalDate)("20260512T143000");
        (0, vitest_1.expect)(result.iso).toBe("2026-05-12T14:30:00");
        (0, vitest_1.expect)(result.allDay).toBe(false);
    });
    (0, vitest_1.it)("parses VALUE=DATE: prefix", () => {
        const result = (0, core_1.parseICalDate)("VALUE=DATE:20260601");
        (0, vitest_1.expect)(result.iso).toBe("2026-06-01");
        (0, vitest_1.expect)(result.allDay).toBe(true);
    });
    (0, vitest_1.it)("parses VALUE=DATE-TIME: prefix", () => {
        const result = (0, core_1.parseICalDate)("VALUE=DATE-TIME:20260601T090000Z");
        (0, vitest_1.expect)(result.iso).toBe("2026-06-01T09:00:00Z");
        (0, vitest_1.expect)(result.allDay).toBe(false);
    });
    (0, vitest_1.it)("parses TZID parameter", () => {
        const result = (0, core_1.parseICalDate)("TZID=America/New_York:20260601T090000");
        (0, vitest_1.expect)(result.iso).toBe("2026-06-01T09:00:00");
        (0, vitest_1.expect)(result.allDay).toBe(false);
    });
    (0, vitest_1.it)("returns raw value as fallback", () => {
        const result = (0, core_1.parseICalDate)("invalid-date");
        (0, vitest_1.expect)(result.iso).toBe("invalid-date");
        (0, vitest_1.expect)(result.allDay).toBe(false);
    });
});
// --- eventToId tests ---
(0, vitest_1.describe)("eventToId", () => {
    (0, vitest_1.it)("generates an id from date and title", () => {
        const event = {
            uid: "test-uid",
            summary: "Arrive in Tokyo",
            dtstart: "2026-05-12T14:30:00Z",
            allDay: false,
        };
        (0, vitest_1.expect)((0, core_1.eventToId)(event)).toBe("evt-2026-05-12-arrive-in-tokyo");
    });
    (0, vitest_1.it)("handles all-day events", () => {
        const event = {
            uid: "test-uid",
            summary: "Company Offsite",
            dtstart: "2026-06-01",
            allDay: true,
        };
        (0, vitest_1.expect)((0, core_1.eventToId)(event)).toBe("evt-2026-06-01-company-offsite");
    });
    (0, vitest_1.it)("truncates long titles", () => {
        const event = {
            uid: "test-uid",
            summary: "This is a very long event title that should be truncated to forty characters",
            dtstart: "2026-07-01",
            allDay: true,
        };
        const id = (0, core_1.eventToId)(event);
        // id format: "evt-YYYY-MM-DD-" + max 40 chars slug
        (0, vitest_1.expect)(id.length).toBeLessThanOrEqual(4 + 10 + 1 + 40); // evt- + date + - + slug
    });
    (0, vitest_1.it)("strips special characters", () => {
        const event = {
            uid: "test-uid",
            summary: "Meeting @ HQ (Room 3)",
            dtstart: "2026-08-01",
            allDay: true,
        };
        (0, vitest_1.expect)((0, core_1.eventToId)(event)).toBe("evt-2026-08-01-meeting-hq-room-3");
    });
});
// --- parseICalEvents tests ---
(0, vitest_1.describe)("parseICalEvents", () => {
    (0, vitest_1.it)("parses a minimal single-event calendar", () => {
        const events = (0, core_1.parseICalEvents)(MINIMAL_ICS);
        (0, vitest_1.expect)(events).toHaveLength(1);
        (0, vitest_1.expect)(events[0].uid).toBe("abc-123@example.com");
        (0, vitest_1.expect)(events[0].summary).toBe("Team standup");
        (0, vitest_1.expect)(events[0].dtstart).toBe("2026-05-12T09:00:00Z");
        (0, vitest_1.expect)(events[0].dtend).toBe("2026-05-12T09:30:00Z");
        (0, vitest_1.expect)(events[0].allDay).toBe(false);
    });
    (0, vitest_1.it)("parses all-day events", () => {
        const events = (0, core_1.parseICalEvents)(ALL_DAY_ICS);
        (0, vitest_1.expect)(events).toHaveLength(1);
        (0, vitest_1.expect)(events[0].summary).toBe("Company offsite");
        (0, vitest_1.expect)(events[0].dtstart).toBe("2026-06-01");
        (0, vitest_1.expect)(events[0].dtend).toBe("2026-06-03");
        (0, vitest_1.expect)(events[0].allDay).toBe(true);
    });
    (0, vitest_1.it)("parses multiple events", () => {
        const events = (0, core_1.parseICalEvents)(MULTI_EVENT_ICS);
        (0, vitest_1.expect)(events).toHaveLength(3);
        (0, vitest_1.expect)(events[0].summary).toBe("Arrive in Tokyo");
        (0, vitest_1.expect)(events[0].location).toBe("NRT Airport");
        (0, vitest_1.expect)(events[0].description).toBe("Flight JL001 arriving at Narita");
        (0, vitest_1.expect)(events[1].summary).toBe("TeamLab Borderless");
        (0, vitest_1.expect)(events[1].allDay).toBe(true);
        (0, vitest_1.expect)(events[2].summary).toBe("Shinkansen to Kyoto");
        (0, vitest_1.expect)(events[2].location).toBe("Tokyo Station");
    });
    (0, vitest_1.it)("parses events with TZID parameter", () => {
        const events = (0, core_1.parseICalEvents)(TZID_ICS);
        (0, vitest_1.expect)(events).toHaveLength(1);
        (0, vitest_1.expect)(events[0].dtstart).toBe("2026-06-01T09:00:00");
        (0, vitest_1.expect)(events[0].dtend).toBe("2026-06-01T10:00:00");
        (0, vitest_1.expect)(events[0].allDay).toBe(false);
    });
    (0, vitest_1.it)("handles folded lines", () => {
        const events = (0, core_1.parseICalEvents)(FOLDED_LINES_ICS);
        (0, vitest_1.expect)(events).toHaveLength(1);
        (0, vitest_1.expect)(events[0].summary).toBe("A very long event title that gets folded across multiple lines");
    });
    (0, vitest_1.it)("handles escaped characters", () => {
        const events = (0, core_1.parseICalEvents)(ESCAPED_ICS);
        (0, vitest_1.expect)(events).toHaveLength(1);
        (0, vitest_1.expect)(events[0].summary).toBe("Meeting, with commas");
        (0, vitest_1.expect)(events[0].description).toBe("Line 1\nLine 2\nLine 3");
    });
    (0, vitest_1.it)("returns empty array for calendar with no events", () => {
        const events = (0, core_1.parseICalEvents)(EMPTY_ICS);
        (0, vitest_1.expect)(events).toHaveLength(0);
    });
    (0, vitest_1.it)("skips events without required fields (summary)", () => {
        const events = (0, core_1.parseICalEvents)(INCOMPLETE_EVENT_ICS);
        (0, vitest_1.expect)(events).toHaveLength(0);
    });
    (0, vitest_1.it)("handles \\r\\n line endings", () => {
        const crlfContent = MINIMAL_ICS.replace(/\n/g, "\r\n");
        const events = (0, core_1.parseICalEvents)(crlfContent);
        (0, vitest_1.expect)(events).toHaveLength(1);
        (0, vitest_1.expect)(events[0].summary).toBe("Team standup");
    });
});
// --- icalEventToWorkItem tests ---
(0, vitest_1.describe)("icalEventToWorkItem", () => {
    (0, vitest_1.it)("converts a timed event to a WorkItem", () => {
        const event = {
            uid: "test-uid",
            summary: "Arrive in Tokyo",
            description: "Flight JL001",
            location: "NRT Airport",
            dtstart: "2026-05-12T14:30:00Z",
            dtend: "2026-05-12T16:00:00Z",
            allDay: false,
        };
        const item = (0, core_1.icalEventToWorkItem)(event, "/path/to/ticket");
        (0, vitest_1.expect)(item.id).toBe("evt-2026-05-12-arrive-in-tokyo");
        (0, vitest_1.expect)(item.title).toBe("Arrive in Tokyo");
        (0, vitest_1.expect)(item.status).toBe("open");
        (0, vitest_1.expect)(item.priority).toBe(2);
        (0, vitest_1.expect)(item.type).toBe("task");
        (0, vitest_1.expect)(item.scheduled).toBe("2026-05-12T14:30:00Z");
        (0, vitest_1.expect)(item.due).toBeUndefined();
        (0, vitest_1.expect)(item.tags.source).toEqual(["calendar"]);
        (0, vitest_1.expect)(item.tags.location).toEqual(["NRT Airport"]);
        (0, vitest_1.expect)(item.filePath).toBe("/path/to/ticket");
    });
    (0, vitest_1.it)("converts an all-day event to a WorkItem with due date", () => {
        const event = {
            uid: "test-uid",
            summary: "Company Offsite",
            dtstart: "2026-06-01",
            allDay: true,
        };
        const item = (0, core_1.icalEventToWorkItem)(event);
        (0, vitest_1.expect)(item.scheduled).toBe("2026-06-01");
        (0, vitest_1.expect)(item.due).toBe("2026-06-01");
        (0, vitest_1.expect)(item.tags.category).toEqual(["all-day"]);
    });
    (0, vitest_1.it)("omits location tag when no location", () => {
        const event = {
            uid: "test-uid",
            summary: "Standup",
            dtstart: "2026-05-12T09:00:00Z",
            allDay: false,
        };
        const item = (0, core_1.icalEventToWorkItem)(event);
        (0, vitest_1.expect)(item.tags.location).toBeUndefined();
    });
    (0, vitest_1.it)("defaults to empty filePath", () => {
        const event = {
            uid: "test-uid",
            summary: "Test",
            dtstart: "2026-01-01",
            allDay: true,
        };
        const item = (0, core_1.icalEventToWorkItem)(event);
        (0, vitest_1.expect)(item.filePath).toBe("");
    });
});
// --- parseICalToWorkItems integration ---
(0, vitest_1.describe)("parseICalToWorkItems", () => {
    (0, vitest_1.it)("parses .ics content directly to WorkItems", () => {
        const items = (0, core_1.parseICalToWorkItems)(MULTI_EVENT_ICS);
        (0, vitest_1.expect)(items).toHaveLength(3);
        (0, vitest_1.expect)(items[0].title).toBe("Arrive in Tokyo");
        (0, vitest_1.expect)(items[0].tags.source).toEqual(["calendar"]);
        (0, vitest_1.expect)(items[0].tags.location).toEqual(["NRT Airport"]);
        (0, vitest_1.expect)(items[0].scheduled).toBe("2026-05-12T14:30:00Z");
        (0, vitest_1.expect)(items[1].title).toBe("TeamLab Borderless");
        (0, vitest_1.expect)(items[1].scheduled).toBe("2026-05-13");
        (0, vitest_1.expect)(items[1].due).toBe("2026-05-13");
        (0, vitest_1.expect)(items[2].title).toBe("Shinkansen to Kyoto");
        (0, vitest_1.expect)(items[2].tags.location).toEqual(["Tokyo Station"]);
    });
    (0, vitest_1.it)("returns empty array for empty calendar", () => {
        const items = (0, core_1.parseICalToWorkItems)(EMPTY_ICS);
        (0, vitest_1.expect)(items).toHaveLength(0);
    });
});
//# sourceMappingURL=calendar-parser.test.js.map