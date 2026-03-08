// TUI Settings View (Level 3)
// Shows all global settings grouped by category with inline editing.

import type { OpcomSettings } from "@opcom/types";
import type { SettingDef } from "@opcom/core";
import { settingsDefs, getSetting, setSetting, defaultSettings } from "@opcom/core";
import type { Panel } from "../layout.js";
import {
  ScreenBuffer,
  ANSI,
  bold,
  dim,
  color,
  truncate,
} from "../renderer.js";

// --- State ---

export interface SettingsViewState {
  settings: OpcomSettings;
  selectedIndex: number;
  scrollOffset: number;
  displayLines: string[];
  wrapWidth: number;
  editMode: boolean;
  editText: string;
  editKey: string | null;
  message: string | null; // flash message (saved, error, etc.)
}

export function createSettingsViewState(settings: OpcomSettings): SettingsViewState {
  const state: SettingsViewState = {
    settings,
    selectedIndex: 0,
    scrollOffset: 0,
    displayLines: [],
    wrapWidth: 0,
    editMode: false,
    editText: "",
    editKey: null,
    message: null,
  };
  rebuildDisplayLines(state);
  return state;
}

// --- Display lines ---

/** Category headers and setting entries, with indices mapping to settingsDefs. */
interface DisplayEntry {
  type: "header" | "setting" | "blank";
  settingIndex?: number; // index into settingsDefs for "setting" entries
  text: string;
}

function buildEntries(settings: OpcomSettings, selectedIndex: number, editMode: boolean, editText: string): DisplayEntry[] {
  const entries: DisplayEntry[] = [];
  const defaults = defaultSettings();
  let currentCategory = "";

  for (let i = 0; i < settingsDefs.length; i++) {
    const def = settingsDefs[i];
    const category = def.key.split(".")[0];

    if (category !== currentCategory) {
      if (currentCategory !== "") entries.push({ type: "blank", text: "" });
      const labels: Record<string, string> = {
        agent: "Agent",
        server: "Server",
        orchestrator: "Orchestrator",
        notifications: "Notifications",
      };
      entries.push({ type: "header", text: bold(labels[category] ?? category) });
      currentCategory = category;
    }

    const currentValue = getSetting(settings, def.key);
    const defaultValue = getSetting(defaults, def.key);
    const isSelected = i === selectedIndex;
    const isEditing = isSelected && editMode;

    let valueStr: string;
    if (isEditing) {
      valueStr = color(ANSI.yellow, editText + "_");
    } else {
      valueStr = formatValue(currentValue, def);
    }

    // Mark non-default values
    const modified = currentValue !== defaultValue && currentValue !== undefined;
    const modMarker = modified ? color(ANSI.yellow, "*") : " ";

    const keyStr = isSelected
      ? color(ANSI.cyan, def.key)
      : def.key;
    const descStr = dim(def.description);

    const cursor = isSelected ? color(ANSI.cyan, "▸ ") : "  ";
    entries.push({
      type: "setting",
      settingIndex: i,
      text: `${cursor}${modMarker} ${keyStr} = ${valueStr}  ${descStr}`,
    });
  }

  return entries;
}

function formatValue(value: unknown, def: SettingDef): string {
  if (value === undefined || value === null || value === "") {
    return dim("(not set)");
  }
  if (def.type === "boolean") {
    return value ? color(ANSI.green, "true") : color(ANSI.red, "false");
  }
  if (def.enum) {
    return color(ANSI.magenta, String(value));
  }
  return String(value);
}

export function rebuildDisplayLines(state: SettingsViewState, width = 80): void {
  const entries = buildEntries(state.settings, state.selectedIndex, state.editMode, state.editText);
  state.displayLines = entries.map((e) => e.text);
  state.wrapWidth = width;
}

/** Get the settingsDefs index for a given selectedIndex. */
export function getSettingDefIndex(selectedIndex: number): number {
  return Math.max(0, Math.min(selectedIndex, settingsDefs.length - 1));
}

// --- Navigation ---

export function moveUp(state: SettingsViewState): void {
  if (state.selectedIndex > 0) {
    state.selectedIndex--;
    rebuildDisplayLines(state, state.wrapWidth || 80);
  }
}

export function moveDown(state: SettingsViewState): void {
  if (state.selectedIndex < settingsDefs.length - 1) {
    state.selectedIndex++;
    rebuildDisplayLines(state, state.wrapWidth || 80);
  }
}

export function scrollUp(state: SettingsViewState, amount = 1): void {
  state.scrollOffset = Math.max(0, state.scrollOffset - amount);
}

export function scrollDown(state: SettingsViewState, amount = 1, viewHeight = 20): void {
  const maxScroll = Math.max(0, state.displayLines.length - viewHeight);
  state.scrollOffset = Math.min(maxScroll, state.scrollOffset + amount);
}

// --- Editing ---

/**
 * Toggle a boolean setting or cycle an enum. Returns true if handled inline
 * (no text editing needed).
 */
export function toggleSetting(state: SettingsViewState): boolean {
  const def = settingsDefs[state.selectedIndex];
  if (!def) return false;

  const current = getSetting(state.settings, def.key);

  if (def.type === "boolean") {
    const newVal = !current;
    try {
      state.settings = setSetting(state.settings, def.key, String(newVal));
      state.message = `${def.key} = ${newVal}`;
    } catch (e) {
      state.message = e instanceof Error ? e.message : "Error";
    }
    rebuildDisplayLines(state, state.wrapWidth || 80);
    return true;
  }

  if (def.enum) {
    const values = def.enum;
    const currentIdx = values.indexOf(String(current));
    const nextIdx = (currentIdx + 1) % values.length;
    try {
      state.settings = setSetting(state.settings, def.key, values[nextIdx]);
      state.message = `${def.key} = ${values[nextIdx]}`;
    } catch (e) {
      state.message = e instanceof Error ? e.message : "Error";
    }
    rebuildDisplayLines(state, state.wrapWidth || 80);
    return true;
  }

  return false;
}

export function enterEditMode(state: SettingsViewState): void {
  const def = settingsDefs[state.selectedIndex];
  if (!def) return;

  // For booleans/enums, toggle instead
  if (toggleSetting(state)) return;

  // For numbers/strings, enter text edit mode
  const current = getSetting(state.settings, def.key);
  state.editMode = true;
  state.editKey = def.key;
  state.editText = current !== undefined && current !== null ? String(current) : "";
  rebuildDisplayLines(state, state.wrapWidth || 80);
}

export function applyEdit(state: SettingsViewState): { success: boolean; error?: string } {
  if (!state.editMode || !state.editKey) return { success: false };

  try {
    state.settings = setSetting(state.settings, state.editKey, state.editText);
    state.message = `${state.editKey} = ${state.editText}`;
    state.editMode = false;
    state.editKey = null;
    state.editText = "";
    rebuildDisplayLines(state, state.wrapWidth || 80);
    return { success: true };
  } catch (e) {
    const error = e instanceof Error ? e.message : "Invalid value";
    state.message = error;
    return { success: false, error };
  }
}

export function cancelEdit(state: SettingsViewState): void {
  state.editMode = false;
  state.editKey = null;
  state.editText = "";
  state.message = null;
  rebuildDisplayLines(state, state.wrapWidth || 80);
}

export function handleEditInput(state: SettingsViewState, data: string): void {
  if (data === "\x7f" || data === "\b") {
    state.editText = state.editText.slice(0, -1);
  } else if (data.length === 1 && data.charCodeAt(0) >= 32) {
    state.editText += data;
  }
  rebuildDisplayLines(state, state.wrapWidth || 80);
}

// --- Rendering ---

export function renderSettingsView(
  buf: ScreenBuffer,
  panel: Panel,
  state: SettingsViewState,
): void {
  const headerHeight = 1;
  const footerHeight = 1;
  const contentHeight = panel.height - headerHeight - footerHeight;
  const contentWidth = panel.width - 2;

  // Header
  const header = truncate(bold("Settings"), contentWidth);
  buf.writeLine(panel.y, panel.x + 1, header, contentWidth);

  // Re-wrap if panel width changed
  if (state.wrapWidth !== contentWidth) {
    rebuildDisplayLines(state, contentWidth);
  }

  const totalLines = state.displayLines.length;

  // Ensure selected setting line is visible
  const selectedDisplayLine = getDisplayLineForSetting(state.selectedIndex);
  if (selectedDisplayLine >= 0) {
    if (selectedDisplayLine < state.scrollOffset) {
      state.scrollOffset = selectedDisplayLine;
    } else if (selectedDisplayLine >= state.scrollOffset + contentHeight) {
      state.scrollOffset = selectedDisplayLine - contentHeight + 1;
    }
  }

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

  // Scroll indicator
  if (totalLines > contentHeight) {
    const scrollPct = totalLines > contentHeight
      ? Math.round((state.scrollOffset / (totalLines - contentHeight)) * 100)
      : 100;
    const indicator = dim(`[${scrollPct}%]`);
    buf.writeLine(panel.y + headerHeight, panel.x + panel.width - 8, indicator, 7);
  }

  // Footer
  const footerY = panel.y + panel.height - 1;
  let keys: string;
  if (state.editMode) {
    keys = dim("Type value, Enter:apply, Esc:cancel");
  } else {
    const msg = state.message ? ` ${color(ANSI.green, state.message)}` : "";
    keys = dim("j/k:nav  Enter/Space:edit  Esc:back") + msg;
  }
  buf.writeLine(footerY, panel.x + 1, keys, contentWidth);
}

/**
 * Map a settingsDefs index to its display line index.
 * Accounts for headers and blank lines.
 */
function getDisplayLineForSetting(settingIndex: number): number {
  let lineIdx = 0;
  let currentCategory = "";

  for (let i = 0; i <= settingIndex && i < settingsDefs.length; i++) {
    const category = settingsDefs[i].key.split(".")[0];
    if (category !== currentCategory) {
      if (currentCategory !== "") lineIdx++; // blank line
      lineIdx++; // header line
      currentCategory = category;
    }
    if (i === settingIndex) return lineIdx;
    lineIdx++; // setting line
  }

  return lineIdx;
}
