"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const promises_1 = require("node:fs/promises");
const node_path_1 = require("node:path");
const node_os_1 = require("node:os");
const core_1 = require("@opcom/core");
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
let tempDir;
(0, vitest_1.beforeEach)(async () => {
    tempDir = await (0, promises_1.mkdtemp)((0, node_path_1.join)((0, node_os_1.tmpdir)(), "opcom-calendar-test-"));
});
(0, vitest_1.afterEach)(async () => {
    await (0, promises_1.rm)(tempDir, { recursive: true, force: true });
});
// --- importICalFile tests ---
(0, vitest_1.describe)("importICalFile", () => {
    (0, vitest_1.it)("reads and parses an .ics file", async () => {
        const icsPath = (0, node_path_1.join)(tempDir, "events.ics");
        await (0, promises_1.writeFile)(icsPath, SAMPLE_ICS, "utf-8");
        const items = await (0, core_1.importICalFile)(icsPath);
        (0, vitest_1.expect)(items).toHaveLength(2);
        (0, vitest_1.expect)(items[0].title).toBe("Arrive in Tokyo");
        (0, vitest_1.expect)(items[0].scheduled).toBe("2026-05-12T14:30:00Z");
        (0, vitest_1.expect)(items[1].title).toBe("TeamLab Borderless");
        (0, vitest_1.expect)(items[1].due).toBe("2026-05-13");
    });
    (0, vitest_1.it)("throws for nonexistent file", async () => {
        await (0, vitest_1.expect)((0, core_1.importICalFile)("/tmp/nonexistent.ics")).rejects.toThrow();
    });
});
// --- CalendarAdapter tests ---
(0, vitest_1.describe)("CalendarAdapter", () => {
    (0, vitest_1.describe)("detect", () => {
        (0, vitest_1.it)("returns true when .ics files exist in project root", async () => {
            await (0, promises_1.writeFile)((0, node_path_1.join)(tempDir, "events.ics"), SAMPLE_ICS, "utf-8");
            const adapter = new core_1.CalendarAdapter(tempDir);
            (0, vitest_1.expect)(await adapter.detect(tempDir)).toBe(true);
        });
        (0, vitest_1.it)("returns true when .opcom/calendars/ directory exists", async () => {
            const calDir = (0, node_path_1.join)(tempDir, ".opcom", "calendars");
            await (0, promises_1.mkdir)(calDir, { recursive: true });
            const adapter = new core_1.CalendarAdapter(tempDir);
            (0, vitest_1.expect)(await adapter.detect(tempDir)).toBe(true);
        });
        (0, vitest_1.it)("returns true when calendar-sourced tickets exist", async () => {
            // Create a ticket with source:calendar tag
            const ticketDir = (0, node_path_1.join)(tempDir, ".tickets", "impl", "evt-2026-05-12-test");
            await (0, promises_1.mkdir)(ticketDir, { recursive: true });
            await (0, promises_1.writeFile)((0, node_path_1.join)(ticketDir, "README.md"), TICKET_MARKDOWN, "utf-8");
            const adapter = new core_1.CalendarAdapter(tempDir);
            (0, vitest_1.expect)(await adapter.detect(tempDir)).toBe(true);
        });
        (0, vitest_1.it)("returns false for empty project", async () => {
            const adapter = new core_1.CalendarAdapter(tempDir);
            (0, vitest_1.expect)(await adapter.detect(tempDir)).toBe(false);
        });
    });
    (0, vitest_1.describe)("listItems", () => {
        (0, vitest_1.it)("returns only calendar-sourced tickets", async () => {
            // Create a calendar-sourced ticket
            const calTicketDir = (0, node_path_1.join)(tempDir, ".tickets", "impl", "evt-2026-05-12-test");
            await (0, promises_1.mkdir)(calTicketDir, { recursive: true });
            await (0, promises_1.writeFile)((0, node_path_1.join)(calTicketDir, "README.md"), TICKET_MARKDOWN, "utf-8");
            // Create a regular ticket
            const regTicketDir = (0, node_path_1.join)(tempDir, ".tickets", "impl", "regular-task");
            await (0, promises_1.mkdir)(regTicketDir, { recursive: true });
            await (0, promises_1.writeFile)((0, node_path_1.join)(regTicketDir, "README.md"), `---
id: regular-task
title: "Regular task"
status: open
type: feature
priority: 2
---

# Regular task
`, "utf-8");
            const adapter = new core_1.CalendarAdapter(tempDir);
            const items = await adapter.listItems();
            (0, vitest_1.expect)(items).toHaveLength(1);
            (0, vitest_1.expect)(items[0].id).toBe("evt-2026-05-12-arrive-in-tokyo");
        });
        (0, vitest_1.it)("returns empty array when no calendar tickets exist", async () => {
            const adapter = new core_1.CalendarAdapter(tempDir);
            const items = await adapter.listItems();
            (0, vitest_1.expect)(items).toHaveLength(0);
        });
    });
    (0, vitest_1.describe)("getItem", () => {
        (0, vitest_1.it)("returns a specific calendar-sourced ticket", async () => {
            const ticketDir = (0, node_path_1.join)(tempDir, ".tickets", "impl", "evt-2026-05-12-arrive-in-tokyo");
            await (0, promises_1.mkdir)(ticketDir, { recursive: true });
            await (0, promises_1.writeFile)((0, node_path_1.join)(ticketDir, "README.md"), TICKET_MARKDOWN, "utf-8");
            const adapter = new core_1.CalendarAdapter(tempDir);
            const item = await adapter.getItem("evt-2026-05-12-arrive-in-tokyo");
            (0, vitest_1.expect)(item).not.toBeNull();
            (0, vitest_1.expect)(item.title).toBe("Arrive in Tokyo");
        });
        (0, vitest_1.it)("returns null for nonexistent item", async () => {
            const adapter = new core_1.CalendarAdapter(tempDir);
            const item = await adapter.getItem("nonexistent");
            (0, vitest_1.expect)(item).toBeNull();
        });
    });
    (0, vitest_1.describe)("summarize", () => {
        (0, vitest_1.it)("returns correct summary counts", async () => {
            // Create two calendar tickets with different statuses
            const dir1 = (0, node_path_1.join)(tempDir, ".tickets", "impl", "evt-2026-05-12-event-one");
            await (0, promises_1.mkdir)(dir1, { recursive: true });
            await (0, promises_1.writeFile)((0, node_path_1.join)(dir1, "README.md"), `---
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
            const dir2 = (0, node_path_1.join)(tempDir, ".tickets", "impl", "evt-2026-05-13-event-two");
            await (0, promises_1.mkdir)(dir2, { recursive: true });
            await (0, promises_1.writeFile)((0, node_path_1.join)(dir2, "README.md"), `---
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
            const adapter = new core_1.CalendarAdapter(tempDir);
            const summary = await adapter.summarize();
            (0, vitest_1.expect)(summary.total).toBe(2);
            (0, vitest_1.expect)(summary.open).toBe(1);
            (0, vitest_1.expect)(summary.closed).toBe(1);
        });
    });
    (0, vitest_1.describe)("type", () => {
        (0, vitest_1.it)("has type 'calendar'", () => {
            const adapter = new core_1.CalendarAdapter(tempDir);
            (0, vitest_1.expect)(adapter.type).toBe("calendar");
        });
    });
});
//# sourceMappingURL=calendar.test.js.map