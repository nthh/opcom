import type { WorkItem } from "@opcom/types";

/**
 * Parse a single line of pasted text into a date and title.
 * Handles common formats:
 *   "May 12: Arrive Tokyo NRT 2:30pm"
 *   "May 12 - Event title"
 *   "2026-05-12: Event title"
 *   "2026-05-12 Event title"
 *   "05/12: Event title"
 *   "12 May: Event title"
 *   "Jan 5, 2026: Something"
 */
export interface ParsedLine {
  date: string | null;  // ISO date YYYY-MM-DD or null
  title: string;
}

const MONTHS: Record<string, string> = {
  jan: "01", feb: "02", mar: "03", apr: "04",
  may: "05", jun: "06", jul: "07", aug: "08",
  sep: "09", oct: "10", nov: "11", dec: "12",
  january: "01", february: "02", march: "03", april: "04",
  june: "06", july: "07", august: "08",
  september: "09", october: "10", november: "11", december: "12",
};

function padTwo(n: number): string {
  return n < 10 ? `0${n}` : `${n}`;
}

function resolveYear(year: number | null): number {
  if (year !== null) return year;
  return new Date().getFullYear();
}

/**
 * Try to extract a date prefix from a line. Returns the date and remaining title text.
 */
export function parseLine(line: string): ParsedLine {
  const trimmed = line.trim();
  if (!trimmed) return { date: null, title: "" };

  // ISO date: 2026-05-12: title or 2026-05-12 title
  const isoMatch = trimmed.match(/^(\d{4})-(\d{1,2})-(\d{1,2})\s*[:–\-]?\s*(.*)/);
  if (isoMatch) {
    const [, y, m, d, rest] = isoMatch;
    return {
      date: `${y}-${padTwo(+m)}-${padTwo(+d)}`,
      title: rest.trim(),
    };
  }

  // MM/DD or MM/DD/YYYY: title
  const slashMatch = trimmed.match(/^(\d{1,2})\/(\d{1,2})(?:\/(\d{4}))?\s*[:–\-]?\s*(.*)/);
  if (slashMatch) {
    const [, m, d, y, rest] = slashMatch;
    const year = resolveYear(y ? +y : null);
    return {
      date: `${year}-${padTwo(+m)}-${padTwo(+d)}`,
      title: rest.trim(),
    };
  }

  // "Mon DD" or "Mon DD, YYYY" prefix: "May 12: title", "Jan 5, 2026: title"
  const monthFirstMatch = trimmed.match(
    /^([A-Za-z]+)\s+(\d{1,2})(?:,?\s+(\d{4}))?\s*[:–\-]?\s*(.*)/
  );
  if (monthFirstMatch) {
    const [, monthStr, dayStr, yearStr, rest] = monthFirstMatch;
    const monthNum = MONTHS[monthStr.toLowerCase()];
    if (monthNum) {
      const year = resolveYear(yearStr ? +yearStr : null);
      return {
        date: `${year}-${monthNum}-${padTwo(+dayStr)}`,
        title: rest.trim(),
      };
    }
  }

  // "DD Mon" or "DD Mon YYYY" prefix: "12 May: title"
  const dayFirstMatch = trimmed.match(
    /^(\d{1,2})\s+([A-Za-z]+)(?:\s+(\d{4}))?\s*[:–\-]?\s*(.*)/
  );
  if (dayFirstMatch) {
    const [, dayStr, monthStr, yearStr, rest] = dayFirstMatch;
    const monthNum = MONTHS[monthStr.toLowerCase()];
    if (monthNum) {
      const year = resolveYear(yearStr ? +yearStr : null);
      return {
        date: `${year}-${monthNum}-${padTwo(+dayStr)}`,
        title: rest.trim(),
      };
    }
  }

  // No date found — the whole line is the title
  return { date: null, title: trimmed };
}

/**
 * Generate a stable slug ID from a parsed line.
 */
export function pasteEventToId(date: string | null, title: string): string {
  const titleSlug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 40);

  if (date) {
    return `evt-${date}-${titleSlug}`;
  }
  return `evt-${titleSlug}`;
}

/**
 * Parse multi-line pasted text into WorkItems.
 * Each non-empty line becomes a work item.
 */
export function parsePastedText(text: string): WorkItem[] {
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
  return lines.map((line) => {
    const { date, title } = parseLine(line);
    if (!title) return null;

    const id = pasteEventToId(date, title);
    const tags: Record<string, string[]> = {
      source: ["paste"],
    };

    return {
      id,
      title,
      status: "open" as const,
      priority: 2,
      type: "task",
      filePath: "",
      scheduled: date ?? undefined,
      due: date ?? undefined,
      deps: [],
      links: [],
      tags,
    };
  }).filter((item): item is WorkItem => item !== null);
}
