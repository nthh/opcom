// TUI Health View — Full-screen overlay showing workspace health
// Equivalent of `opcom audit` + `opcom coverage` in the TUI

import type { Panel } from "../layout.js";
import type { HealthData, SpecSectionCoverage, WorkspaceHealthSummary } from "../health-data.js";
import {
  ScreenBuffer,
  drawBox,
  drawSeparator,
  ANSI,
  bold,
  dim,
  color,
  truncate,
  padRight,
} from "../renderer.js";

export interface HealthViewState {
  data: HealthData | null;
  selectedIndex: number;
  scrollOffset: number;
  // Drill-down state
  drilledSpec: string | null;
  sectionCoverage: SpecSectionCoverage[] | null;
  drillSelectedIndex: number;
  drillScrollOffset: number;
  // Workspace health (from WorkspaceEngine)
  workspaceHealth: WorkspaceHealthSummary | null;
}

export function createHealthViewState(): HealthViewState {
  return {
    data: null,
    selectedIndex: 0,
    scrollOffset: 0,
    drilledSpec: null,
    sectionCoverage: null,
    drillSelectedIndex: 0,
    drillScrollOffset: 0,
    workspaceHealth: null,
  };
}

export function renderHealthView(
  buf: ScreenBuffer,
  panel: Panel,
  state: HealthViewState,
): void {
  if (!state.data) {
    drawBox(buf, panel.x, panel.y, panel.width, panel.height, "Workspace Health", true);
    buf.writeLine(panel.y + 2, panel.x + 3, dim("Loading health data..."), panel.width - 6);
    renderFooter(buf, panel, false);
    return;
  }

  if (state.drilledSpec && state.sectionCoverage) {
    renderDrillDown(buf, panel, state);
    return;
  }

  renderOverview(buf, panel, state);
}

function renderOverview(
  buf: ScreenBuffer,
  panel: Panel,
  state: HealthViewState,
): void {
  const data = state.data!;
  const title = "Workspace Health";
  drawBox(buf, panel.x, panel.y, panel.width, panel.height, title, true);

  const contentWidth = panel.width - 6;
  let row = panel.y + 1;

  // --- SPEC COVERAGE ---
  const specPct = data.specCount > 0
    ? Math.round(((data.specsCovered + data.specsPartial) / data.specCount) * 100)
    : 0;

  buf.writeLine(row++, panel.x + 3, bold(`SPEC COVERAGE (${data.specCount} specs, ${specPct}% covered)`), contentWidth);
  row++;

  // Column headers
  const nameCol = Math.max(20, Math.floor(contentWidth * 0.4));
  const ticketCol = 10;
  const statusCol = contentWidth - nameCol - ticketCol;
  const header = padRight("Spec", nameCol) + padRight("Tickets", ticketCol) + "Status";
  buf.writeLine(row++, panel.x + 3, dim(header), contentWidth);

  // Spec list with selection
  const maxSpecRows = Math.max(1, panel.height - 14); // Reserve space for ticket health + footer
  const specs = data.specs;
  const scroll = state.scrollOffset;

  for (let i = 0; i < maxSpecRows && i + scroll < specs.length; i++) {
    const idx = i + scroll;
    const spec = specs[idx];
    const isSelected = idx === state.selectedIndex;

    const statusIcon = spec.status === "covered" ? "\u25cf"
      : spec.status === "partial" ? "\u25d0"
      : "\u25cb";
    const statusLabel = spec.status === "covered" ? "covered"
      : spec.status === "partial" ? "partial"
      : "no tickets";
    const sColor = spec.status === "covered" ? ANSI.green
      : spec.status === "partial" ? ANSI.yellow
      : ANSI.red;

    const line = padRight(spec.name, nameCol)
      + padRight(String(spec.ticketCount), ticketCol)
      + color(sColor, `${statusIcon} ${statusLabel}`);

    if (isSelected) {
      buf.writeLine(row, panel.x + 3, ANSI.reverse + truncate(line, contentWidth) + ANSI.reset, contentWidth);
    } else {
      buf.writeLine(row, panel.x + 3, truncate(line, contentWidth), contentWidth);
    }
    row++;
  }

  // Scroll indicator
  if (specs.length > maxSpecRows) {
    const remaining = specs.length - scroll - maxSpecRows;
    if (remaining > 0) {
      buf.writeLine(row, panel.x + 3, dim(`  ... ${remaining} more`), contentWidth);
    }
    row++;
  } else {
    row++;
  }

  // --- TICKET HEALTH ---
  buf.writeLine(row++, panel.x + 3, bold("TICKET HEALTH"), contentWidth);

  const ticketPct = data.ticketCount > 0
    ? Math.round((data.ticketsWithSpec / data.ticketCount) * 100)
    : 0;
  const ticketWarning = data.ticketCount > 0 && (data.ticketsWithoutSpec / data.ticketCount) > 0.25;

  const linkedLine = `With spec links:    ${data.ticketsWithSpec}/${data.ticketCount} (${ticketPct}%)`;
  buf.writeLine(row++, panel.x + 5, ticketWarning ? color(ANSI.yellow, linkedLine) : linkedLine, contentWidth);

  const unlinkedLine = `Without spec links: ${data.ticketsWithoutSpec} tickets`;
  buf.writeLine(row++, panel.x + 5, ticketWarning ? color(ANSI.yellow, unlinkedLine) : unlinkedLine, contentWidth);
  row++;

  // --- BROKEN LINKS ---
  buf.writeLine(row++, panel.x + 3, bold("BROKEN LINKS"), contentWidth);
  if (data.brokenLinks.length === 0) {
    buf.writeLine(row++, panel.x + 5, color(ANSI.green, "None"), contentWidth);
  } else {
    buf.writeLine(row++, panel.x + 5, color(ANSI.red, `${data.brokenLinks.length} broken link(s)`), contentWidth);
    const maxBrokenRows = Math.min(3, data.brokenLinks.length);
    for (let i = 0; i < maxBrokenRows; i++) {
      const bl = data.brokenLinks[i];
      buf.writeLine(row++, panel.x + 7, color(ANSI.red, `${bl.ticket} \u2192 ${bl.link} (${bl.reason})`), contentWidth - 2);
    }
  }

  // --- USE CASES ---
  if (data.useCases.length > 0) {
    row++;
    buf.writeLine(row++, panel.x + 3, bold("USE CASES"), contentWidth);
    for (const uc of data.useCases) {
      const ucPct = uc.total > 0 ? Math.round((uc.done / uc.total) * 100) : 0;
      const ucColor = ucPct === 100 ? ANSI.green : ucPct > 50 ? ANSI.yellow : ANSI.red;
      buf.writeLine(row++, panel.x + 5,
        `${uc.id}: ${color(ucColor, `${uc.done}/${uc.total} (${ucPct}%)`)} ${dim(uc.title)}`,
        contentWidth);
    }
  }

  // --- WORKSPACE HEALTH (cross-project analysis) ---
  if (state.workspaceHealth && state.workspaceHealth.projects.length > 0) {
    row++;
    const ws = state.workspaceHealth;
    buf.writeLine(row++, panel.x + 3, bold(`WORKSPACE (${ws.projects.length} projects, ${ws.totalSignals} drift signals)`), contentWidth);

    for (const p of ws.projects) {
      const driftStr = p.driftSignalCount > 0
        ? color(ANSI.yellow, `${p.driftSignalCount} drift`)
        : color(ANSI.green, "clean");
      const testStr = p.testHealth.total > 0
        ? `${p.testHealth.passed}/${p.testHealth.total} tests`
        : dim("no tests");
      buf.writeLine(row++, panel.x + 5,
        `${p.projectName}: ${driftStr} ${dim("|")} ${testStr}`,
        contentWidth);
    }

    if (ws.sharedPatterns.length > 0) {
      row++;
      buf.writeLine(row++, panel.x + 5, dim(`Shared patterns (${ws.sharedPatterns.length}):`), contentWidth);
      for (const sp of ws.sharedPatterns.slice(0, 3)) {
        buf.writeLine(row++, panel.x + 7, truncate(sp.description, contentWidth - 4), contentWidth - 2);
      }
      if (ws.sharedPatterns.length > 3) {
        buf.writeLine(row++, panel.x + 7, dim(`... ${ws.sharedPatterns.length - 3} more`), contentWidth - 2);
      }
    }
  }

  renderFooter(buf, panel, false);
}

function renderDrillDown(
  buf: ScreenBuffer,
  panel: Panel,
  state: HealthViewState,
): void {
  const sections = state.sectionCoverage!;
  const title = `${state.drilledSpec}.md \u2014 ${sections.length} sections`;
  drawBox(buf, panel.x, panel.y, panel.width, panel.height, title, true);

  const contentWidth = panel.width - 6;
  let row = panel.y + 1;

  // Column headers
  const anchorCol = Math.max(20, Math.floor(contentWidth * 0.35));
  const ticketCol = Math.max(20, Math.floor(contentWidth * 0.35));
  const statusCol = contentWidth - anchorCol - ticketCol;
  const header = padRight("Section", anchorCol) + padRight("Ticket", ticketCol) + "Status";
  buf.writeLine(row++, panel.x + 3, dim(header), contentWidth);

  const maxRows = panel.height - 4; // Box borders + header + footer
  const scroll = state.drillScrollOffset;

  for (let i = 0; i < maxRows && i + scroll < sections.length; i++) {
    const idx = i + scroll;
    const section = sections[idx];
    const isSelected = idx === state.drillSelectedIndex;

    let ticketStr: string;
    let statusStr: string;
    if (section.tickets.length === 0) {
      ticketStr = "\u2014";
      statusStr = color(ANSI.red, "missing");
    } else {
      ticketStr = section.tickets[0].id;
      statusStr = `[${section.tickets[0].status}]`;
      if (section.tickets[0].status === "closed") {
        statusStr = color(ANSI.green, statusStr);
      }
    }

    const line = padRight(`\u00a7 ${section.anchor}`, anchorCol)
      + padRight(ticketStr, ticketCol)
      + statusStr;

    if (isSelected) {
      buf.writeLine(row, panel.x + 3, ANSI.reverse + truncate(line, contentWidth) + ANSI.reset, contentWidth);
    } else {
      buf.writeLine(row, panel.x + 3, truncate(line, contentWidth), contentWidth);
    }
    row++;
  }

  renderFooter(buf, panel, true);
}

function renderFooter(buf: ScreenBuffer, panel: Panel, isDrillDown: boolean): void {
  const footerY = panel.y + panel.height - 2;
  drawSeparator(buf, panel.x, footerY, panel.width, true);

  const keys = isDrillDown
    ? dim("Esc:back to overview  j/k:navigate")
    : dim("Esc:back  Enter:drill into spec  j/k:navigate");
  buf.writeLine(footerY + 1, panel.x + 2, keys, panel.width - 4);
}

// --- Navigation helpers ---

export function healthScrollUp(state: HealthViewState): void {
  if (state.drilledSpec && state.sectionCoverage) {
    if (state.drillSelectedIndex > 0) {
      state.drillSelectedIndex--;
      if (state.drillSelectedIndex < state.drillScrollOffset) {
        state.drillScrollOffset = state.drillSelectedIndex;
      }
    }
  } else if (state.data) {
    if (state.selectedIndex > 0) {
      state.selectedIndex--;
      if (state.selectedIndex < state.scrollOffset) {
        state.scrollOffset = state.selectedIndex;
      }
    }
  }
}

export function healthScrollDown(state: HealthViewState, panelHeight: number): void {
  if (state.drilledSpec && state.sectionCoverage) {
    const maxIdx = state.sectionCoverage.length - 1;
    if (state.drillSelectedIndex < maxIdx) {
      state.drillSelectedIndex++;
      const maxVisible = panelHeight - 4;
      if (state.drillSelectedIndex >= state.drillScrollOffset + maxVisible) {
        state.drillScrollOffset = state.drillSelectedIndex - maxVisible + 1;
      }
    }
  } else if (state.data) {
    const maxIdx = state.data.specs.length - 1;
    if (state.selectedIndex < maxIdx) {
      state.selectedIndex++;
      const maxVisible = Math.max(1, panelHeight - 14);
      if (state.selectedIndex >= state.scrollOffset + maxVisible) {
        state.scrollOffset = state.selectedIndex - maxVisible + 1;
      }
    }
  }
}
