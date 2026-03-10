"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const core_1 = require("@opcom/core");
(0, vitest_1.describe)("parseLine", () => {
    (0, vitest_1.it)("parses 'Month DD: title' format", () => {
        const result = (0, core_1.parseLine)("May 12: Arrive Tokyo NRT 2:30pm");
        (0, vitest_1.expect)(result.title).toBe("Arrive Tokyo NRT 2:30pm");
        (0, vitest_1.expect)(result.date).toMatch(/^\d{4}-05-12$/);
    });
    (0, vitest_1.it)("parses 'Month DD - title' with dash separator", () => {
        const result = (0, core_1.parseLine)("Jun 3 - Conference talk");
        (0, vitest_1.expect)(result.title).toBe("Conference talk");
        (0, vitest_1.expect)(result.date).toMatch(/^\d{4}-06-03$/);
    });
    (0, vitest_1.it)("parses full month names", () => {
        const result = (0, core_1.parseLine)("January 15: New Year planning");
        (0, vitest_1.expect)(result.title).toBe("New Year planning");
        (0, vitest_1.expect)(result.date).toMatch(/^\d{4}-01-15$/);
    });
    (0, vitest_1.it)("parses 'Month DD, YYYY: title' with year", () => {
        const result = (0, core_1.parseLine)("Jan 5, 2026: Something important");
        (0, vitest_1.expect)(result.title).toBe("Something important");
        (0, vitest_1.expect)(result.date).toBe("2026-01-05");
    });
    (0, vitest_1.it)("parses ISO date format 'YYYY-MM-DD: title'", () => {
        const result = (0, core_1.parseLine)("2026-05-12: Arrive in Tokyo");
        (0, vitest_1.expect)(result.title).toBe("Arrive in Tokyo");
        (0, vitest_1.expect)(result.date).toBe("2026-05-12");
    });
    (0, vitest_1.it)("parses ISO date without separator", () => {
        const result = (0, core_1.parseLine)("2026-05-12 Event without colon");
        (0, vitest_1.expect)(result.title).toBe("Event without colon");
        (0, vitest_1.expect)(result.date).toBe("2026-05-12");
    });
    (0, vitest_1.it)("parses MM/DD: title format", () => {
        const result = (0, core_1.parseLine)("05/12: Mother's day brunch");
        (0, vitest_1.expect)(result.title).toBe("Mother's day brunch");
        (0, vitest_1.expect)(result.date).toMatch(/^\d{4}-05-12$/);
    });
    (0, vitest_1.it)("parses MM/DD/YYYY: title format", () => {
        const result = (0, core_1.parseLine)("05/12/2026: Mother's day brunch");
        (0, vitest_1.expect)(result.title).toBe("Mother's day brunch");
        (0, vitest_1.expect)(result.date).toBe("2026-05-12");
    });
    (0, vitest_1.it)("parses 'DD Month: title' format", () => {
        const result = (0, core_1.parseLine)("12 May: Visit temple");
        (0, vitest_1.expect)(result.title).toBe("Visit temple");
        (0, vitest_1.expect)(result.date).toMatch(/^\d{4}-05-12$/);
    });
    (0, vitest_1.it)("returns null date for lines with no date prefix", () => {
        const result = (0, core_1.parseLine)("Just a plain task");
        (0, vitest_1.expect)(result.title).toBe("Just a plain task");
        (0, vitest_1.expect)(result.date).toBeNull();
    });
    (0, vitest_1.it)("returns empty title for empty lines", () => {
        const result = (0, core_1.parseLine)("  ");
        (0, vitest_1.expect)(result.title).toBe("");
        (0, vitest_1.expect)(result.date).toBeNull();
    });
});
(0, vitest_1.describe)("pasteEventToId", () => {
    (0, vitest_1.it)("generates id with date prefix when date exists", () => {
        const id = (0, core_1.pasteEventToId)("2026-05-12", "Arrive Tokyo NRT");
        (0, vitest_1.expect)(id).toBe("evt-2026-05-12-arrive-tokyo-nrt");
    });
    (0, vitest_1.it)("generates id without date when date is null", () => {
        const id = (0, core_1.pasteEventToId)(null, "Some task");
        (0, vitest_1.expect)(id).toBe("evt-some-task");
    });
    (0, vitest_1.it)("truncates long titles to 40 chars", () => {
        const id = (0, core_1.pasteEventToId)("2026-01-01", "A very long event title that exceeds the maximum slug length allowed");
        const slug = id.replace(/^evt-2026-01-01-/, "");
        (0, vitest_1.expect)(slug.length).toBeLessThanOrEqual(40);
    });
});
(0, vitest_1.describe)("parsePastedText", () => {
    (0, vitest_1.it)("parses multi-line itinerary into work items", () => {
        const text = `May 12: Arrive Tokyo NRT 2:30pm
May 13: TeamLab Borderless
May 15: Shinkansen to Kyoto`;
        const items = (0, core_1.parsePastedText)(text);
        (0, vitest_1.expect)(items).toHaveLength(3);
        (0, vitest_1.expect)(items[0].title).toBe("Arrive Tokyo NRT 2:30pm");
        (0, vitest_1.expect)(items[0].status).toBe("open");
        (0, vitest_1.expect)(items[0].type).toBe("task");
        (0, vitest_1.expect)(items[0].tags.source).toEqual(["paste"]);
        (0, vitest_1.expect)(items[0].scheduled).toMatch(/^\d{4}-05-12$/);
        (0, vitest_1.expect)(items[1].title).toBe("TeamLab Borderless");
        (0, vitest_1.expect)(items[2].title).toBe("Shinkansen to Kyoto");
    });
    (0, vitest_1.it)("skips empty lines", () => {
        const text = `May 12: Event one

May 14: Event two
`;
        const items = (0, core_1.parsePastedText)(text);
        (0, vitest_1.expect)(items).toHaveLength(2);
    });
    (0, vitest_1.it)("handles lines without dates", () => {
        const text = `Buy groceries
Pick up dry cleaning`;
        const items = (0, core_1.parsePastedText)(text);
        (0, vitest_1.expect)(items).toHaveLength(2);
        (0, vitest_1.expect)(items[0].title).toBe("Buy groceries");
        (0, vitest_1.expect)(items[0].scheduled).toBeUndefined();
        (0, vitest_1.expect)(items[0].due).toBeUndefined();
    });
    (0, vitest_1.it)("sets due and scheduled from dates", () => {
        const items = (0, core_1.parsePastedText)("2026-03-15: Deadline");
        (0, vitest_1.expect)(items).toHaveLength(1);
        (0, vitest_1.expect)(items[0].scheduled).toBe("2026-03-15");
        (0, vitest_1.expect)(items[0].due).toBe("2026-03-15");
    });
    (0, vitest_1.it)("returns empty array for empty input", () => {
        (0, vitest_1.expect)((0, core_1.parsePastedText)("")).toHaveLength(0);
        (0, vitest_1.expect)((0, core_1.parsePastedText)("   \n  \n  ")).toHaveLength(0);
    });
    (0, vitest_1.it)("generates unique IDs per line", () => {
        const text = `May 12: Event A
May 13: Event B`;
        const items = (0, core_1.parsePastedText)(text);
        (0, vitest_1.expect)(items[0].id).not.toBe(items[1].id);
    });
    (0, vitest_1.it)("handles mixed date formats", () => {
        const text = `2026-05-12: ISO format
May 13: Month-first format
05/14: Slash format`;
        const items = (0, core_1.parsePastedText)(text);
        (0, vitest_1.expect)(items).toHaveLength(3);
        (0, vitest_1.expect)(items[0].scheduled).toBe("2026-05-12");
        (0, vitest_1.expect)(items[1].scheduled).toMatch(/^\d{4}-05-13$/);
        (0, vitest_1.expect)(items[2].scheduled).toMatch(/^\d{4}-05-14$/);
    });
    (0, vitest_1.it)("all items have deps and links as empty arrays", () => {
        const items = (0, core_1.parsePastedText)("May 12: Test event");
        (0, vitest_1.expect)(items[0].deps).toEqual([]);
        (0, vitest_1.expect)(items[0].links).toEqual([]);
    });
    (0, vitest_1.it)("all items have priority 2", () => {
        const items = (0, core_1.parsePastedText)("May 12: Test event");
        (0, vitest_1.expect)(items[0].priority).toBe(2);
    });
});
//# sourceMappingURL=paste-parser.test.js.map