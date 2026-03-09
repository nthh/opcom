import type { WorkItem } from "@opcom/types";

/**
 * Parsed iCal event — intermediate representation before conversion to WorkItem.
 */
export interface ICalEvent {
  uid: string;
  summary: string;
  description?: string;
  location?: string;
  dtstart: string;
  dtend?: string;
  allDay: boolean;
  rrule?: string;
}

/**
 * Unfold iCal long lines (lines starting with space/tab are continuations).
 */
function unfoldLines(raw: string): string {
  return raw.replace(/\r\n[ \t]/g, "").replace(/\n[ \t]/g, "");
}

/**
 * Unescape iCal text values.
 */
function unescapeValue(value: string): string {
  return value
    .replace(/\\n/g, "\n")
    .replace(/\\,/g, ",")
    .replace(/\\;/g, ";")
    .replace(/\\\\/g, "\\");
}

/**
 * Parse an iCal date/datetime string into an ISO string.
 * Handles: 20260512, 20260512T143000, 20260512T143000Z, TZID=...:20260512T143000
 */
export function parseICalDate(raw: string): { iso: string; allDay: boolean } {
  // Strip VALUE=DATE: or VALUE=DATE-TIME: prefix
  let value = raw;
  const valueTypeMatch = value.match(/^VALUE=DATE(?:-TIME)?:(.*)/i);
  if (valueTypeMatch) {
    value = valueTypeMatch[1];
  }

  // Strip TZID parameter: TZID=America/New_York:20260512T143000
  const tzidMatch = value.match(/^TZID=[^:]+:(.*)/);
  if (tzidMatch) {
    value = tzidMatch[1];
  }

  // All-day: 8 digits only (YYYYMMDD)
  if (/^\d{8}$/.test(value)) {
    const year = value.slice(0, 4);
    const month = value.slice(4, 6);
    const day = value.slice(6, 8);
    return { iso: `${year}-${month}-${day}`, allDay: true };
  }

  // DateTime: 20260512T143000 or 20260512T143000Z
  const dtMatch = value.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(Z)?$/);
  if (dtMatch) {
    const [, year, month, day, hour, min, sec, utc] = dtMatch;
    const suffix = utc ? "Z" : "";
    return {
      iso: `${year}-${month}-${day}T${hour}:${min}:${sec}${suffix}`,
      allDay: false,
    };
  }

  // Fallback: return as-is
  return { iso: value, allDay: false };
}

/**
 * Generate a stable, URL-safe slug from an event for use as a ticket ID.
 */
export function eventToId(event: ICalEvent): string {
  const datePart = event.dtstart.replace(/T.*/, ""); // YYYY-MM-DD
  const titleSlug = event.summary
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 40);
  return `evt-${datePart}-${titleSlug}`;
}

/**
 * Parse iCal (.ics) content into a list of ICalEvent objects.
 */
export function parseICalEvents(content: string): ICalEvent[] {
  const unfolded = unfoldLines(content);
  const lines = unfolded.split(/\r?\n/);
  const events: ICalEvent[] = [];

  let inEvent = false;
  let current: Partial<ICalEvent> = {};
  let currentDtstart = "";

  for (const line of lines) {
    if (line === "BEGIN:VEVENT") {
      inEvent = true;
      current = {};
      currentDtstart = "";
      continue;
    }

    if (line === "END:VEVENT") {
      inEvent = false;
      if (current.uid && current.summary && currentDtstart) {
        const parsed = parseICalDate(currentDtstart);
        events.push({
          uid: current.uid,
          summary: current.summary,
          description: current.description,
          location: current.location,
          dtstart: parsed.iso,
          dtend: current.dtend,
          allDay: parsed.allDay,
        });
      }
      continue;
    }

    if (!inEvent) continue;

    // Parse property:value (may have parameters like DTSTART;VALUE=DATE:20260512)
    const colonIdx = line.indexOf(":");
    if (colonIdx === -1) continue;

    const propWithParams = line.slice(0, colonIdx);
    const value = line.slice(colonIdx + 1);
    const propName = propWithParams.split(";")[0].toUpperCase();
    const params = propWithParams.slice(propName.length);

    switch (propName) {
      case "UID":
        current.uid = value;
        break;
      case "SUMMARY":
        current.summary = unescapeValue(value);
        break;
      case "DESCRIPTION":
        current.description = unescapeValue(value);
        break;
      case "LOCATION":
        current.location = unescapeValue(value);
        break;
      case "DTSTART": {
        // Preserve params for parsing (e.g., ;VALUE=DATE or ;TZID=...)
        currentDtstart = params ? params.slice(1) + ":" + value : value;
        break;
      }
      case "DTEND": {
        const endParams = params ? params.slice(1) + ":" + value : value;
        const parsedEnd = parseICalDate(endParams);
        current.dtend = parsedEnd.iso;
        break;
      }
      case "RRULE":
        current.rrule = value;
        break;
    }
  }

  return events;
}

/**
 * Convert a parsed iCal event to an opcom WorkItem.
 */
export function icalEventToWorkItem(event: ICalEvent, filePath: string = ""): WorkItem {
  const tags: Record<string, string[]> = {
    source: ["calendar"],
  };
  if (event.location) {
    tags.location = [event.location];
  }
  if (event.allDay) {
    tags.category = ["all-day"];
  }

  return {
    id: eventToId(event),
    title: event.summary,
    status: "open",
    priority: 2,
    type: "task",
    filePath,
    scheduled: event.dtstart,
    due: event.allDay ? event.dtstart : undefined,
    deps: [],
    links: [],
    tags,
  };
}

/**
 * Parse an .ics file's content and return WorkItems.
 */
export function parseICalToWorkItems(content: string): WorkItem[] {
  const events = parseICalEvents(content);
  return events.map((e) => icalEventToWorkItem(e));
}
