// TUI Skills Browser View (Level 3)
// Browse available skills with built-in/custom and active/available indicators.

import type { SkillDefinition } from "@opcom/types";
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

// --- State ---

export interface SkillsBrowserState {
  skills: SkillDefinition[];
  /** Skill IDs currently active for the focused project/agent */
  activeSkillIds: Set<string>;
  selectedIndex: number;
  scrollOffset: number;
  /** null = list view, string = drill-down into skill detail */
  drilledSkillId: string | null;
  detailScrollOffset: number;
  detailLines: string[];
}

export function createSkillsBrowserState(
  skills: SkillDefinition[],
  activeSkillIds: string[] = [],
): SkillsBrowserState {
  return {
    skills,
    activeSkillIds: new Set(activeSkillIds),
    selectedIndex: 0,
    scrollOffset: 0,
    drilledSkillId: null,
    detailScrollOffset: 0,
    detailLines: [],
  };
}

// --- Helpers ---

function isBuiltin(skill: SkillDefinition): boolean {
  // Built-in skills have version "1.0.0" and non-empty content starting with "# "
  // More robust: check against known built-in IDs
  return ["code-review", "test-writing", "research", "deployment", "planning"].includes(skill.id);
}

function countBySource(skills: SkillDefinition[]): { builtin: number; custom: number } {
  let builtin = 0;
  let custom = 0;
  for (const s of skills) {
    if (isBuiltin(s)) builtin++;
    else custom++;
  }
  return { builtin, custom };
}

export function buildSkillListLines(
  skills: SkillDefinition[],
  activeSkillIds: Set<string>,
  selectedIndex: number,
  contentWidth: number,
): string[] {
  const lines: string[] = [];
  const counts = countBySource(skills);

  // Header
  const parts: string[] = [];
  if (counts.builtin > 0) parts.push(`${counts.builtin} built-in`);
  if (counts.custom > 0) parts.push(`${counts.custom} custom`);
  lines.push(bold(`Skills`) + dim(` (${parts.join(", ")})`));
  lines.push(dim("─".repeat(Math.min(contentWidth, 50))));

  if (skills.length === 0) {
    lines.push("");
    lines.push(dim("  No skills found. Run `opcom skills create <id>` to add one."));
    return lines;
  }

  for (let i = 0; i < skills.length; i++) {
    const skill = skills[i];
    const active = activeSkillIds.has(skill.id);
    const selected = i === selectedIndex;
    const source = isBuiltin(skill) ? dim("built-in") : color(ANSI.magenta, "custom");
    const indicator = active ? color(ANSI.green, "●") : dim("○");
    const cursor = selected ? color(ANSI.cyan, "▸ ") : "  ";

    const nameStr = selected ? color(ANSI.cyan, skill.id) : skill.id;
    const descStr = dim(`"${truncate(skill.description, 40)}"`);

    const line = `${cursor}${indicator} ${nameStr}  ${descStr}  ${source}`;
    lines.push(line);
  }

  return lines;
}

export function buildSkillDetailLines(skill: SkillDefinition, active: boolean, width: number): string[] {
  const lines: string[] = [];
  const source = isBuiltin(skill) ? "built-in" : "custom";

  lines.push(bold(skill.name));
  lines.push("");
  lines.push(`  ID:          ${skill.id}`);
  lines.push(`  Version:     ${skill.version}`);
  lines.push(`  Source:      ${source}`);
  lines.push(`  Status:      ${active ? color(ANSI.green, "active") : dim("available")}`);

  if (skill.triggers.length > 0) {
    lines.push(`  Triggers:    ${skill.triggers.join(", ")}`);
  }
  if (skill.compatibleRoles.length > 0) {
    lines.push(`  Roles:       ${skill.compatibleRoles.join(", ")}`);
  }
  if (skill.projects.length > 0) {
    lines.push(`  Projects:    ${skill.projects.join(", ")}`);
  }

  if (skill.content) {
    lines.push("");
    lines.push(dim("─".repeat(Math.min(width, 50))));
    lines.push("");
    for (const contentLine of skill.content.split("\n")) {
      if (contentLine.startsWith("#")) {
        lines.push(bold(contentLine));
      } else {
        for (const wrapped of wrapText(contentLine, width)) {
          lines.push(wrapped);
        }
      }
    }
  }

  return lines;
}

// --- Navigation ---

export function moveUp(state: SkillsBrowserState): void {
  if (state.selectedIndex > 0) {
    state.selectedIndex--;
  }
}

export function moveDown(state: SkillsBrowserState): void {
  if (state.selectedIndex < state.skills.length - 1) {
    state.selectedIndex++;
  }
}

export function scrollDetailUp(state: SkillsBrowserState, amount = 1): void {
  state.detailScrollOffset = Math.max(0, state.detailScrollOffset - amount);
}

export function scrollDetailDown(state: SkillsBrowserState, amount = 1, viewHeight = 20): void {
  const maxScroll = Math.max(0, state.detailLines.length - viewHeight);
  state.detailScrollOffset = Math.min(maxScroll, state.detailScrollOffset + amount);
}

export function scrollDetailToTop(state: SkillsBrowserState): void {
  state.detailScrollOffset = 0;
}

export function scrollDetailToBottom(state: SkillsBrowserState, viewHeight = 20): void {
  state.detailScrollOffset = Math.max(0, state.detailLines.length - viewHeight);
}

export function drillDown(state: SkillsBrowserState, width: number): void {
  const skill = state.skills[state.selectedIndex];
  if (!skill) return;
  state.drilledSkillId = skill.id;
  state.detailScrollOffset = 0;
  state.detailLines = buildSkillDetailLines(skill, state.activeSkillIds.has(skill.id), width);
}

export function drillUp(state: SkillsBrowserState): boolean {
  if (state.drilledSkillId) {
    state.drilledSkillId = null;
    state.detailScrollOffset = 0;
    state.detailLines = [];
    return true;
  }
  return false;
}

// --- Rendering ---

export function renderSkillsBrowser(
  buf: ScreenBuffer,
  panel: Panel,
  state: SkillsBrowserState,
): void {
  const headerHeight = 0;
  const footerHeight = 1;
  const contentHeight = panel.height - headerHeight - footerHeight;
  const contentWidth = panel.width - 2;

  if (state.drilledSkillId) {
    renderDetail(buf, panel, state, contentHeight, contentWidth);
  } else {
    renderList(buf, panel, state, contentHeight, contentWidth);
  }

  // Footer
  const footerY = panel.y + panel.height - 1;
  const keys = state.drilledSkillId
    ? dim("j/k:scroll  g:top  G:bottom  Esc:back")
    : dim("j/k:nav  Enter:detail  Esc:back");
  buf.writeLine(footerY, panel.x + 1, keys, contentWidth);
}

function renderList(
  buf: ScreenBuffer,
  panel: Panel,
  state: SkillsBrowserState,
  contentHeight: number,
  contentWidth: number,
): void {
  const lines = buildSkillListLines(state.skills, state.activeSkillIds, state.selectedIndex, contentWidth);

  // Ensure selected item is visible (account for 2 header lines)
  const selectedDisplayLine = state.selectedIndex + 2; // header + separator
  if (selectedDisplayLine < state.scrollOffset) {
    state.scrollOffset = selectedDisplayLine;
  } else if (selectedDisplayLine >= state.scrollOffset + contentHeight) {
    state.scrollOffset = selectedDisplayLine - contentHeight + 1;
  }
  state.scrollOffset = Math.max(0, Math.min(state.scrollOffset, Math.max(0, lines.length - contentHeight)));

  for (let i = 0; i < contentHeight; i++) {
    const lineIdx = i + state.scrollOffset;
    const row = panel.y + i;
    if (lineIdx >= lines.length) break;
    buf.writeLine(row, panel.x + 1, lines[lineIdx], contentWidth);
  }

  // Scroll indicator
  if (lines.length > contentHeight) {
    const scrollPct = Math.round((state.scrollOffset / Math.max(1, lines.length - contentHeight)) * 100);
    buf.writeLine(panel.y, panel.x + panel.width - 8, dim(`[${scrollPct}%]`), 7);
  }
}

function renderDetail(
  buf: ScreenBuffer,
  panel: Panel,
  state: SkillsBrowserState,
  contentHeight: number,
  contentWidth: number,
): void {
  const lines = state.detailLines;

  // Clamp scroll
  state.detailScrollOffset = Math.max(0, Math.min(state.detailScrollOffset, Math.max(0, lines.length - contentHeight)));

  for (let i = 0; i < contentHeight; i++) {
    const lineIdx = i + state.detailScrollOffset;
    const row = panel.y + i;
    if (lineIdx >= lines.length) break;
    buf.writeLine(row, panel.x + 1, lines[lineIdx], contentWidth);
  }

  // Scroll indicator
  if (lines.length > contentHeight) {
    const scrollPct = Math.round((state.detailScrollOffset / Math.max(1, lines.length - contentHeight)) * 100);
    buf.writeLine(panel.y, panel.x + panel.width - 8, dim(`[${scrollPct}%]`), 7);
  }
}
