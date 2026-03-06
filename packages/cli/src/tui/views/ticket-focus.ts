// TUI Ticket Focus View (Level 3)
// Ticket frontmatter, linked spec contents, and actions

import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import type { WorkItem, ProjectConfig, Changeset } from "@opcom/types";
import type { Panel } from "../layout.js";
import {
  ScreenBuffer,
  ANSI,
  bold,
  dim,
  color,
  truncate,
  wrapText,
} from "../renderer.js";

export interface TicketFocusState {
  ticket: WorkItem;
  projectConfig: ProjectConfig | null;
  specContent: string | null;
  ticketContent: string | null;
  changesets: Changeset[] | null;
  scrollOffset: number;
  displayLines: string[];
  wrapWidth: number;
  loaded: boolean;
}

export function createTicketFocusState(ticket: WorkItem, projectConfig: ProjectConfig | null): TicketFocusState {
  return {
    ticket,
    projectConfig,
    specContent: null,
    ticketContent: null,
    changesets: null,
    scrollOffset: 0,
    displayLines: [],
    wrapWidth: 0,
    loaded: false,
  };
}

export async function loadTicketContent(state: TicketFocusState): Promise<void> {
  const { ticket, projectConfig } = state;

  // Load ticket file content
  try {
    if (existsSync(ticket.filePath)) {
      state.ticketContent = await readFile(ticket.filePath, "utf-8");
    }
  } catch {
    // Ignore read errors
  }

  // Try to find linked spec file
  if (projectConfig?.docs.specsDir) {
    const specDir = join(projectConfig.path, projectConfig.docs.specsDir);
    // Look for spec file matching ticket ID
    const possibleSpecNames = [
      `${ticket.id}.md`,
      `${ticket.id.toLowerCase()}.md`,
      `${ticket.id.replace(/^[A-Z]+-/, "")}.md`,
    ];

    for (const specName of possibleSpecNames) {
      const specPath = join(specDir, specName);
      try {
        if (existsSync(specPath)) {
          state.specContent = await readFile(specPath, "utf-8");
          break;
        }
      } catch {
        // Ignore
      }
    }
  }

  // Also check for spec links in the ticket links
  for (const link of ticket.links) {
    if (link.endsWith(".md") && existsSync(link)) {
      try {
        state.specContent = await readFile(link, "utf-8");
        break;
      } catch {
        // Ignore
      }
    }
  }

  // Load changesets from event store
  try {
    const { EventStore } = await import("@opcom/core");
    const es = new EventStore();
    state.changesets = es.loadChangesets({ ticketId: ticket.id });
    es.close();
  } catch {
    state.changesets = null;
  }

  state.loaded = true;
  rebuildDisplayLines(state);
}

function rebuildDisplayLines(state: TicketFocusState, width = 80): void {
  const { ticket } = state;
  const lines: string[] = [];

  // Header
  lines.push(bold(`${ticket.id}: ${ticket.title}`));
  lines.push("");

  // Metadata table
  const priorityColors = [ANSI.red, ANSI.red, ANSI.yellow, ANSI.cyan, ANSI.dim];
  const pColor = priorityColors[ticket.priority] ?? ANSI.dim;

  lines.push(`${dim("Status:")}   ${formatStatus(ticket.status)}`);
  lines.push(`${dim("Priority:")} ${color(pColor, `P${ticket.priority}`)}`);
  lines.push(`${dim("Type:")}     ${ticket.type || dim("(none)")}`);
  lines.push(`${dim("File:")}     ${dim(ticket.filePath)}`);

  if (ticket.deps.length > 0) {
    lines.push(`${dim("Deps:")}     ${ticket.deps.join(", ")}`);
  }

  if (ticket.links.length > 0) {
    lines.push(`${dim("Links:")}    ${ticket.links.join(", ")}`);
  }

  if (ticket.parent) {
    lines.push(`${dim("Parent:")}   ${ticket.parent}`);
  }

  const tagEntries = Object.entries(ticket.tags);
  if (tagEntries.length > 0) {
    lines.push(`${dim("Tags:")}`);
    for (const [key, values] of tagEntries) {
      lines.push(`  ${dim(key + ":")} ${values.join(", ")}`);
    }
  }

  // Ticket body content
  if (state.ticketContent) {
    lines.push("");
    lines.push(bold("--- Ticket Content ---"));
    lines.push("");

    // Skip frontmatter if present
    let content = state.ticketContent;
    if (content.startsWith("---")) {
      const endIdx = content.indexOf("---", 3);
      if (endIdx !== -1) {
        content = content.slice(endIdx + 3).trim();
      }
    }

    const contentLines = content.split("\n");
    for (const cl of contentLines) {
      lines.push(...wrapText(cl, width));
    }
  }

  // Spec content
  if (state.specContent) {
    lines.push("");
    lines.push(bold("--- Linked Spec ---"));
    lines.push("");

    const specLines = state.specContent.split("\n");
    for (const sl of specLines) {
      lines.push(...wrapText(sl, width));
    }
  }

  // Changeset section
  if (state.changesets && state.changesets.length > 0) {
    lines.push("");
    lines.push(bold("--- Changes ---"));
    lines.push("");

    for (const cs of state.changesets) {
      lines.push(
        `${dim("Session:")} ${cs.sessionId.slice(0, 10)}..  ` +
        `${dim("Time:")} ${cs.timestamp}`,
      );
      lines.push(
        `${dim("Commits:")} ${cs.commitShas.length}  ` +
        `${dim("Total:")} +${cs.totalInsertions}/-${cs.totalDeletions}`,
      );
      lines.push("");

      for (const f of cs.files) {
        const icon = f.status === "added" ? "+" : f.status === "deleted" ? "-" : f.status === "renamed" ? "R" : "M";
        const display = f.status === "renamed" && f.oldPath
          ? `${f.oldPath} → ${f.path}`
          : f.path;
        lines.push(`  ${icon} ${display}  +${f.insertions}/-${f.deletions}`);
      }
      lines.push("");
    }
  }

  state.displayLines = lines;
  state.wrapWidth = width;
}

function formatStatus(status: string): string {
  switch (status) {
    case "open":
      return color(ANSI.white, "open");
    case "in-progress":
      return color(ANSI.yellow, "in-progress");
    case "closed":
      return color(ANSI.green, "closed");
    case "deferred":
      return dim("deferred");
    default:
      return status;
  }
}

export function renderTicketFocus(
  buf: ScreenBuffer,
  panel: Panel,
  state: TicketFocusState,
): void {
  const headerHeight = 1;
  const footerHeight = 1;
  const contentHeight = panel.height - headerHeight - footerHeight;
  const contentWidth = panel.width - 2;

  // Header
  const title = truncate(
    `${bold("Ticket:")} ${state.ticket.id} - ${state.ticket.title}`,
    contentWidth,
  );
  buf.writeLine(panel.y, panel.x + 1, title, contentWidth);

  // Content
  if (!state.loaded) {
    buf.writeLine(panel.y + headerHeight, panel.x + 1, dim("Loading..."), contentWidth);
  } else {
    // Re-wrap if panel width changed
    if (state.wrapWidth !== contentWidth) {
      rebuildDisplayLines(state, contentWidth);
    }

    const totalLines = state.displayLines.length;

    // Clamp scroll
    state.scrollOffset = Math.max(
      0,
      Math.min(state.scrollOffset, Math.max(0, totalLines - contentHeight)),
    );

    for (let i = 0; i < contentHeight; i++) {
      const lineIdx = i + state.scrollOffset;
      const row = panel.y + headerHeight + i;

      if (lineIdx >= totalLines) break;
      buf.writeLine(row, panel.x + 1, state.displayLines[lineIdx], contentWidth);
    }

    // Scroll indicator
    if (totalLines > contentHeight) {
      const scrollPct = totalLines > contentHeight
        ? Math.round((state.scrollOffset / (totalLines - contentHeight)) * 100)
        : 100;
      const indicator = dim(`[${scrollPct}%]`);
      buf.writeLine(panel.y + headerHeight, panel.x + panel.width - 8, indicator, 7);
    }
  }

  // Footer
  const footerY = panel.y + panel.height - 1;
  const keys = dim("j/k:scroll  w:start agent  c:chat  e:open in $EDITOR  Esc:back");
  buf.writeLine(footerY, panel.x + 1, keys, contentWidth);
}

// --- Navigation ---

export function scrollUp(state: TicketFocusState, amount = 1): void {
  state.scrollOffset = Math.max(0, state.scrollOffset - amount);
}

export function scrollDown(state: TicketFocusState, amount = 1, viewHeight = 20): void {
  const maxScroll = Math.max(0, state.displayLines.length - viewHeight);
  state.scrollOffset = Math.min(maxScroll, state.scrollOffset + amount);
}

export function scrollToTop(state: TicketFocusState): void {
  state.scrollOffset = 0;
}

export function scrollToBottom(state: TicketFocusState, viewHeight = 20): void {
  state.scrollOffset = Math.max(0, state.displayLines.length - viewHeight);
}
