// TUI Ticket Scope Picker View
// Shows a checklist of tickets for scoping a plan before creation.
// Parent epics group their children; standalone tickets appear individually.

import type { WorkItem } from "@opcom/types";
import type { Panel } from "../layout.js";
import {
  ScreenBuffer,
  ANSI,
  bold,
  dim,
  color,
  truncate,
} from "../renderer.js";

// --- Types ---

export interface PickerItem {
  kind: "epic" | "ticket";
  id: string;
  title: string;
  priority: number;
  childIds?: string[]; // for epics: the child ticket IDs
}

export interface TicketScopePickerState {
  projectId: string;
  tickets: WorkItem[];
  items: PickerItem[];
  /** Set of selected ticket IDs (child IDs for epics, own ID for standalone) */
  selectedIds: Set<string>;
  selectedIndex: number;
  scrollOffset: number;
  displayLines: string[];
  wrapWidth: number;
  confirmed: boolean | null;
}

// --- State creation ---

export function createTicketScopePickerState(
  projectId: string,
  tickets: WorkItem[],
): TicketScopePickerState {
  const open = tickets.filter((t) => t.status === "open" || t.status === "in-progress");

  // Find parent IDs (tickets referenced as parent by other tickets)
  const parentIds = new Set<string>();
  for (const t of open) {
    if (t.parent && open.some((p) => p.id === t.parent)) {
      parentIds.add(t.parent);
    }
  }

  // Group children by parent
  const childrenOf = new Map<string, WorkItem[]>();
  for (const t of open) {
    if (t.parent && parentIds.has(t.parent)) {
      if (!childrenOf.has(t.parent)) childrenOf.set(t.parent, []);
      childrenOf.get(t.parent)!.push(t);
    }
  }

  // Build items: epics first, then standalone tickets
  const items: PickerItem[] = [];

  // Epics (sorted by priority)
  const epicTickets = [...parentIds]
    .map((id) => open.find((t) => t.id === id) ?? { id, title: id, priority: 99 })
    .sort((a, b) => a.priority - b.priority);

  for (const epic of epicTickets) {
    const children = childrenOf.get(epic.id) ?? [];
    items.push({
      kind: "epic",
      id: epic.id,
      title: epic.title,
      priority: epic.priority,
      childIds: children.map((c) => c.id),
    });
  }

  // Standalone tickets (not a parent, not a child of a parent in scope)
  const standalone = open
    .filter((t) => !parentIds.has(t.id) && !(t.parent && parentIds.has(t.parent)))
    .sort((a, b) => a.priority - b.priority);

  for (const t of standalone) {
    items.push({
      kind: "ticket",
      id: t.id,
      title: t.title,
      priority: t.priority,
    });
  }

  // Default: all selected
  const selectedIds = new Set<string>();
  for (const item of items) {
    if (item.kind === "epic" && item.childIds) {
      for (const cid of item.childIds) selectedIds.add(cid);
    } else if (item.kind === "ticket") {
      selectedIds.add(item.id);
    }
  }

  const state: TicketScopePickerState = {
    projectId,
    tickets: open,
    items,
    selectedIds,
    selectedIndex: 0,
    scrollOffset: 0,
    displayLines: [],
    wrapWidth: 0,
    confirmed: null,
  };

  rebuildPickerDisplayLines(state);
  return state;
}

// --- Display ---

export function rebuildPickerDisplayLines(state: TicketScopePickerState, width = 80): void {
  const lines: string[] = [];
  const totalSelectable = countSelectable(state);
  const selectedCount = state.selectedIds.size;

  lines.push(bold("Select Tickets for Plan"));
  lines.push(`${dim(`${selectedCount} of ${totalSelectable} tickets selected`)}`);
  lines.push("");

  for (let i = 0; i < state.items.length; i++) {
    const item = state.items[i];
    const isCursor = i === state.selectedIndex;
    const prefix = isCursor ? color(ANSI.cyan, "\u25b8 ") : "  ";

    if (item.kind === "epic") {
      const childIds = item.childIds ?? [];
      const selectedChildren = childIds.filter((id) => state.selectedIds.has(id)).length;
      const checked = selectedChildren === childIds.length && childIds.length > 0;
      const partial = selectedChildren > 0 && selectedChildren < childIds.length;
      const box = checked ? color(ANSI.green, "[x]") : partial ? color(ANSI.yellow, "[-]") : dim("[ ]");
      const label = `${item.title} ${dim(`(${childIds.length} children`)}${dim(")")}`;
      lines.push(`${prefix}${box} ${isCursor ? color(ANSI.cyan, label) : label}`);
    } else {
      const checked = state.selectedIds.has(item.id);
      const box = checked ? color(ANSI.green, "[x]") : dim("[ ]");
      const label = `${item.id} ${dim(`\u2014 ${item.title}`)}`;
      lines.push(`${prefix}${box} ${isCursor ? color(ANSI.cyan, label) : label}`);
    }
  }

  lines.push("");
  lines.push(dim("Space:toggle  a:all  n:none  Enter:confirm  Esc:cancel"));

  state.displayLines = lines;
  state.wrapWidth = width;
}

function countSelectable(state: TicketScopePickerState): number {
  let count = 0;
  for (const item of state.items) {
    if (item.kind === "epic") {
      count += item.childIds?.length ?? 0;
    } else {
      count++;
    }
  }
  return count;
}

// --- Navigation ---

export function moveUp(state: TicketScopePickerState): void {
  if (state.selectedIndex > 0) {
    state.selectedIndex--;
    rebuildPickerDisplayLines(state, state.wrapWidth || 80);
  }
}

export function moveDown(state: TicketScopePickerState): void {
  if (state.selectedIndex < state.items.length - 1) {
    state.selectedIndex++;
    rebuildPickerDisplayLines(state, state.wrapWidth || 80);
  }
}

export function toggleItem(state: TicketScopePickerState): void {
  const item = state.items[state.selectedIndex];
  if (!item) return;

  if (item.kind === "epic") {
    const childIds = item.childIds ?? [];
    const allSelected = childIds.every((id) => state.selectedIds.has(id));
    if (allSelected) {
      for (const id of childIds) state.selectedIds.delete(id);
    } else {
      for (const id of childIds) state.selectedIds.add(id);
    }
  } else {
    if (state.selectedIds.has(item.id)) {
      state.selectedIds.delete(item.id);
    } else {
      state.selectedIds.add(item.id);
    }
  }

  rebuildPickerDisplayLines(state, state.wrapWidth || 80);
}

export function selectAll(state: TicketScopePickerState): void {
  for (const item of state.items) {
    if (item.kind === "epic" && item.childIds) {
      for (const id of item.childIds) state.selectedIds.add(id);
    } else if (item.kind === "ticket") {
      state.selectedIds.add(item.id);
    }
  }
  rebuildPickerDisplayLines(state, state.wrapWidth || 80);
}

export function selectNone(state: TicketScopePickerState): void {
  state.selectedIds.clear();
  rebuildPickerDisplayLines(state, state.wrapWidth || 80);
}

export function getSelectedTicketIds(state: TicketScopePickerState): string[] {
  const ids = [...state.selectedIds];

  // Include parent epic IDs when any of their children are selected,
  // so findParentTicketIds can detect them and apply parent/id format
  for (const item of state.items) {
    if (item.kind === "epic" && item.childIds) {
      if (item.childIds.some((cid) => state.selectedIds.has(cid))) {
        if (!ids.includes(item.id)) ids.push(item.id);
      }
    }
  }

  return ids;
}

// --- Scroll ---

export function scrollUp(state: TicketScopePickerState, amount = 1): void {
  state.scrollOffset = Math.max(0, state.scrollOffset - amount);
}

export function scrollDown(state: TicketScopePickerState, amount = 1, viewHeight = 20): void {
  const maxScroll = Math.max(0, state.displayLines.length - viewHeight);
  state.scrollOffset = Math.min(maxScroll, state.scrollOffset + amount);
}

export function scrollToTop(state: TicketScopePickerState): void {
  state.scrollOffset = 0;
  state.selectedIndex = 0;
  rebuildPickerDisplayLines(state, state.wrapWidth || 80);
}

export function scrollToBottom(state: TicketScopePickerState, viewHeight = 20): void {
  state.scrollOffset = Math.max(0, state.displayLines.length - viewHeight);
  state.selectedIndex = state.items.length - 1;
  rebuildPickerDisplayLines(state, state.wrapWidth || 80);
}

// --- Render ---

export function renderTicketScopePicker(
  buf: ScreenBuffer,
  panel: Panel,
  state: TicketScopePickerState,
): void {
  const headerHeight = 1;
  const footerHeight = 1;
  const contentHeight = panel.height - headerHeight - footerHeight;
  const contentWidth = panel.width - 2;

  // Header
  const header = truncate(bold("Ticket Scope Picker"), contentWidth);
  buf.writeLine(panel.y, panel.x + 1, header, contentWidth);

  // Re-wrap if width changed
  if (state.wrapWidth !== contentWidth) {
    rebuildPickerDisplayLines(state, contentWidth);
  }

  const totalLines = state.displayLines.length;

  // Clamp scroll
  state.scrollOffset = Math.max(
    0,
    Math.min(state.scrollOffset, Math.max(0, totalLines - contentHeight)),
  );

  // Content
  for (let i = 0; i < contentHeight; i++) {
    const lineIdx = i + state.scrollOffset;
    const row = panel.y + headerHeight + i;
    if (lineIdx >= totalLines) break;
    buf.writeLine(row, panel.x + 1, state.displayLines[lineIdx], contentWidth);
  }

  // Footer
  const footerY = panel.y + panel.height - 1;
  const keys = dim("j/k:nav  Space:toggle  a:all  n:none  Enter:confirm  Esc:cancel");
  buf.writeLine(footerY, panel.x + 1, keys, contentWidth);
}
