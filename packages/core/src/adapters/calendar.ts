import { readFile, readdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import type { WorkItem, WorkSummary } from "@opcom/types";
import { parseICalToWorkItems } from "./calendar-parser.js";
import { scanTickets, summarizeWorkItems } from "../detection/tickets.js";

/**
 * CalendarAdapter — imports calendar events as work items.
 *
 * Detects projects that have imported calendar events (tagged with source:calendar)
 * and provides the standard ProjectAdapter interface over them.
 */
export class CalendarAdapter {
  readonly type = "calendar" as const;

  constructor(private projectPath: string) {}

  /**
   * Detect whether this project has calendar-sourced work items.
   * Checks for .ics files in the project root or .opcom/ directory,
   * or existing tickets tagged with source:calendar.
   */
  async detect(projectPath: string): Promise<boolean> {
    // Check for .ics files in project root
    if (existsSync(projectPath)) {
      try {
        const entries = await readdir(projectPath);
        if (entries.some((e) => e.endsWith(".ics"))) {
          return true;
        }
      } catch {
        // ignore
      }
    }

    // Check for .ics files in .opcom/calendars/
    const calDir = join(projectPath, ".opcom", "calendars");
    if (existsSync(calDir)) {
      return true;
    }

    // Check for existing calendar-sourced tickets
    const tickets = await scanTickets(projectPath);
    return tickets.some((t) => t.tags.source?.includes("calendar"));
  }

  /**
   * List all calendar-sourced work items from the .tickets/ directory.
   */
  async listItems(): Promise<WorkItem[]> {
    const allTickets = await scanTickets(this.projectPath);
    return allTickets.filter((t) => t.tags.source?.includes("calendar"));
  }

  /**
   * Get a single calendar-sourced work item by ID.
   */
  async getItem(id: string): Promise<WorkItem | null> {
    const items = await this.listItems();
    return items.find((t) => t.id === id) ?? null;
  }

  /**
   * Summarize calendar-sourced work items by status.
   */
  async summarize(): Promise<WorkSummary> {
    const items = await this.listItems();
    return summarizeWorkItems(items);
  }
}

/**
 * Import events from an .ics file and return WorkItems.
 * Does not write to disk — use writeWorkItemsToTickets for persistence.
 */
export async function importICalFile(filePath: string): Promise<WorkItem[]> {
  const content = await readFile(filePath, "utf-8");
  return parseICalToWorkItems(content);
}
