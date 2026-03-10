// TUI Agent Focus View (Level 3)
// Full-screen scrollable agent output with prompt bar

import type { AgentSession, NormalizedEvent, RoleDefinition } from "@opcom/types";
import type { Panel } from "../layout.js";
import {
  ScreenBuffer,
  ANSI,
  bold,
  dim,
  color,
  stateColor,
  truncate,
  progressBar,
  wrapText,
} from "../renderer.js";

export interface AgentFocusState {
  agent: AgentSession;
  events: NormalizedEvent[];
  scrollOffset: number;
  followTail: boolean; // auto-scroll to bottom
  promptMode: boolean;
  promptText: string;
  displayLines: DisplayLine[]; // pre-rendered lines
  renderedEventCount: number; // tracks last rendered count (avoids shared-reference staleness)
  wrapWidth: number;
  role: RoleDefinition | null;
  showRoleDetail: boolean;
}

interface DisplayLine {
  text: string;
  style: "normal" | "tool" | "error" | "system" | "dim";
}

export function createAgentFocusState(
  agent: AgentSession,
  events: NormalizedEvent[],
  role?: RoleDefinition | null,
): AgentFocusState {
  const state: AgentFocusState = {
    agent,
    events,
    scrollOffset: 0,
    followTail: true,
    promptMode: false,
    promptText: "",
    displayLines: [],
    renderedEventCount: 0,
    wrapWidth: 0,
    role: role ?? null,
    showRoleDetail: false,
  };
  rebuildDisplayLines(state);
  state.renderedEventCount = events.length;
  return state;
}

/**
 * Claude Code sends assistant messages twice — once as native streaming events
 * (message_start without role) and once as a final `assistant` NDJSON event
 * (message_start with role="assistant"). This groups ALL message spans
 * (message_start → message_end) and drops any whose normalized text matches
 * a previously seen message.
 */
export function deduplicateAssistantMessages(events: NormalizedEvent[]): NormalizedEvent[] {
  interface MessageSpan {
    startIdx: number;
    endIdx: number; // inclusive
    normalizedText: string;
  }

  // First pass: identify all message spans and extract their text
  const spans: MessageSpan[] = [];
  let i = 0;
  while (i < events.length) {
    if (events[i].type === "message_start") {
      // Skip user messages
      if (events[i].data?.role === "user") { i++; continue; }

      const startIdx = i;
      let text = "";
      i++;
      while (i < events.length && events[i].type !== "message_end") {
        if (events[i].type === "message_delta" && events[i].data?.text) {
          text += events[i].data!.text;
        }
        i++;
      }
      const endIdx = i < events.length ? i : i - 1;
      const normalized = text.replace(/\s+/g, " ").trim();
      if (normalized.length > 100) {
        spans.push({ startIdx, endIdx, normalizedText: normalized });
      }
      i++;
    } else {
      i++;
    }
  }

  // Second pass: mark duplicate spans for removal
  const skipRanges = new Set<number>();
  const seenTexts = new Set<string>();
  for (const span of spans) {
    if (seenTexts.has(span.normalizedText)) {
      for (let j = span.startIdx; j <= span.endIdx; j++) {
        skipRanges.add(j);
      }
    } else {
      seenTexts.add(span.normalizedText);
    }
  }

  if (skipRanges.size === 0) return events;
  return events.filter((_, idx) => !skipRanges.has(idx));
}

export function rebuildDisplayLines(state: AgentFocusState, width = 80): void {
  // Preprocess: remove duplicate assistant messages
  const events = deduplicateAssistantMessages(state.events);
  const lines: DisplayLine[] = [];

  function pushWrapped(text: string, style: DisplayLine["style"]): void {
    if (width > 0) {
      for (const wl of wrapText(text, width)) {
        lines.push({ text: wl, style });
      }
    } else {
      lines.push({ text, style });
    }
  }

  for (const event of events) {
    switch (event.type) {
      case "agent_start":
        lines.push({
          text: `--- Agent started ${event.data?.reason ? `(${event.data.reason})` : ""} ---`,
          style: "system",
        });
        break;

      case "agent_end":
        lines.push({
          text: `--- Agent stopped ${event.data?.reason ? `(${event.data.reason})` : ""} ---`,
          style: "system",
        });
        if (state.agent.backendSessionId) {
          lines.push({ text: "", style: "normal" });
          lines.push({
            text: "Press p to reply",
            style: "system",
          });
        }
        break;

      case "turn_start":
        lines.push({ text: "", style: "normal" });
        lines.push({ text: "--- Turn ---", style: "dim" });
        break;

      case "message_start":
        if (event.data?.role === "user") {
          lines.push({ text: "", style: "normal" });
          lines.push({ text: "[User]", style: "system" });
        }
        break;

      case "message_delta":
        if (event.data?.text) {
          const textLines = event.data.text.split("\n");
          for (const tl of textLines) {
            pushWrapped(tl, "normal");
          }
        }
        break;

      case "message_end":
        // No visible output needed
        break;

      case "tool_start":
        if (event.data?.toolName) {
          lines.push({ text: "", style: "normal" });
          const input = event.data.toolInput
            ? ` ${event.data.toolInput.slice(0, 200)}${event.data.toolInput.length > 200 ? "..." : ""}`
            : "";
          lines.push({
            text: `> ${event.data.toolName}${input}`,
            style: "tool",
          });
        }
        break;

      case "tool_end":
        if (event.data?.toolOutput) {
          const outputLines = event.data.toolOutput.split("\n").slice(0, 20);
          for (const ol of outputLines) {
            lines.push({ text: `  ${ol}`, style: "dim" });
          }
          if (event.data.toolOutput.split("\n").length > 20) {
            lines.push({ text: `  ... (truncated)`, style: "dim" });
          }
        }
        if (event.data?.toolSuccess === false) {
          lines.push({ text: `  [tool failed]`, style: "error" });
        }
        break;

      case "error":
        lines.push({
          text: `ERROR: ${event.data?.text ?? event.data?.reason ?? "unknown error"}`,
          style: "error",
        });
        break;

      case "compaction_start":
        lines.push({ text: "--- Compacting context... ---", style: "system" });
        break;

      case "compaction_end": {
        const tokens = event.data?.contextTokens;
        lines.push({
          text: `--- Context compacted${tokens ? ` (${tokens} tokens)` : ""} ---`,
          style: "system",
        });
        break;
      }
    }
  }

  // If we only have the initial agent_start event and agent is still active,
  // show a hint so the user knows events are expected
  if (state.events.length <= 1 && state.agent.state !== "stopped") {
    lines.push({ text: "", style: "normal" });
    lines.push({ text: "Waiting for agent output...", style: "dim" });
  }

  state.displayLines = lines;
  state.wrapWidth = width;
}

/** Build the role detail lines shown when R is pressed */
export function buildRoleDetailLines(role: RoleDefinition): string[] {
  const lines: string[] = [];
  lines.push(`Role: ${role.name ?? role.id}`);
  lines.push("─".repeat(40));
  lines.push(`  Permission mode: ${role.permissionMode ?? "acceptEdits"}`);
  if (role.disallowedTools && role.disallowedTools.length > 0) {
    lines.push(`  Disallowed tools: ${role.disallowedTools.join(", ")}`);
  }
  if (role.allowedTools && role.allowedTools.length > 0) {
    lines.push(`  Allowed tools: ${role.allowedTools.join(", ")}`);
  }
  if (role.allowedBashPatterns && role.allowedBashPatterns.length > 0) {
    lines.push(`  Bash patterns: ${role.allowedBashPatterns.join(", ")}`);
  }
  if (role.doneCriteria) {
    lines.push(`  Done criteria: ${role.doneCriteria}`);
  }
  if (role.instructions) {
    lines.push(`  Instructions:`);
    for (const line of role.instructions.split("\n")) {
      lines.push(`    ${line}`);
    }
  }
  lines.push(`  Run tests: ${role.runTests ?? true}`);
  lines.push(`  Run oracle: ${role.runOracle ?? "inherit"}`);
  if (role.skills && role.skills.length > 0) {
    lines.push(`  Skills: ${role.skills.join(", ")}`);
  }
  lines.push("");
  return lines;
}

/** Build a compact role summary for the header */
export function buildRoleSummary(role: RoleDefinition): string {
  const parts: string[] = [];
  parts.push(role.permissionMode ?? "acceptEdits");
  if (role.doneCriteria) {
    const short = role.doneCriteria.length > 50
      ? role.doneCriteria.slice(0, 47) + "..."
      : role.doneCriteria;
    parts.push(short);
  }
  return parts.join(" · ");
}

export function renderAgentFocus(
  buf: ScreenBuffer,
  panel: Panel,
  state: AgentFocusState,
): void {
  const { agent, role } = state;

  // Header: agent info (2-4 rows depending on role/skills)
  const roleDetailLines = (state.showRoleDetail && role) ? buildRoleDetailLines(role) : [];
  const hasSkills = agent.skills && agent.skills.length > 0;
  let baseHeaderHeight = role ? 3 : 2;
  if (hasSkills) baseHeaderHeight++;
  const headerHeight = baseHeaderHeight + roleDetailLines.length;
  const footerHeight = state.promptMode ? 2 : 1;
  const contentHeight = panel.height - headerHeight - footerHeight;
  const contentWidth = panel.width - 2;

  // --- Header ---
  const sColor = stateColor(agent.state);
  const roleSuffix = role ? ` ${dim("(" + (role.name ?? role.id) + ")")}` : "";
  const headerLine1 = `${bold(agent.id.slice(0, 12))} ${color(sColor, agent.state)} ${dim(agent.backend)} ${dim("project:" + agent.projectId)}${roleSuffix}`;
  buf.writeLine(panel.y, panel.x + 1, headerLine1, contentWidth);

  let headerLine2Parts: string[] = [];
  if (agent.contextUsage) {
    const ctx = agent.contextUsage;
    const pct = Math.round(ctx.percentage);
    const bar = progressBar(ctx.tokensUsed, ctx.maxTokens, 20);
    headerLine2Parts.push(`Context: ${bar} ${pct}%`);
  }
  if (agent.workItemId) {
    headerLine2Parts.push(`Ticket: ${agent.workItemId}`);
  }
  const duration = formatDuration(agent.startedAt, agent.stoppedAt);
  headerLine2Parts.push(`Duration: ${duration}`);
  headerLine2Parts.push(`Events: ${state.events.length}`);
  buf.writeLine(panel.y + 1, panel.x + 1, headerLine2Parts.join("  "), contentWidth);

  // Role summary line
  let nextHeaderRow = 2;
  if (role) {
    const summary = buildRoleSummary(role);
    const toggleHint = state.showRoleDetail ? dim(" [R: collapse]") : dim(" [R: expand]");
    buf.writeLine(panel.y + nextHeaderRow, panel.x + 1, dim("Role: ") + (role.name ?? role.id) + dim(" — " + summary) + toggleHint, contentWidth);
    nextHeaderRow++;
  }

  // Skills line
  if (hasSkills) {
    const skillNames = agent.skills!.map(s => s.name).join(", ");
    buf.writeLine(panel.y + nextHeaderRow, panel.x + 1, dim(`Skills: ${skillNames}`), contentWidth);
    nextHeaderRow++;
  }

  // Expanded role detail lines
  for (let i = 0; i < roleDetailLines.length; i++) {
    buf.writeLine(panel.y + nextHeaderRow + i, panel.x + 1, dim(roleDetailLines[i]), contentWidth);
  }

  // --- Content (scrollable agent output) ---
  // Re-wrap if panel width changed
  if (state.wrapWidth !== contentWidth) {
    rebuildDisplayLines(state, contentWidth);
  }

  const totalLines = state.displayLines.length;

  // Auto-scroll to bottom if followTail
  if (state.followTail && totalLines > contentHeight) {
    state.scrollOffset = totalLines - contentHeight;
  }

  // Clamp scroll
  state.scrollOffset = Math.max(0, Math.min(state.scrollOffset, Math.max(0, totalLines - contentHeight)));

  for (let i = 0; i < contentHeight; i++) {
    const lineIdx = i + state.scrollOffset;
    const row = panel.y + headerHeight + i;

    if (lineIdx >= totalLines) {
      // Empty line
      continue;
    }

    const displayLine = state.displayLines[lineIdx];
    const styledText = styleLine(displayLine, contentWidth);
    buf.writeLine(row, panel.x + 1, styledText, contentWidth);
  }

  // Scroll indicator
  if (totalLines > contentHeight) {
    const scrollPct = totalLines > contentHeight
      ? Math.round((state.scrollOffset / (totalLines - contentHeight)) * 100)
      : 100;
    const indicator = dim(`[${scrollPct}%]`);
    buf.writeLine(panel.y + headerHeight, panel.x + panel.width - 8, indicator, 7);
  }

  // --- Footer ---
  const footerY = panel.y + panel.height - footerHeight;

  if (state.promptMode) {
    // Prompt input line
    const promptPrefix = color(ANSI.cyan, "> ");
    buf.writeLine(footerY, panel.x + 1, promptPrefix + state.promptText + ANSI.showCursor, contentWidth);
    // Cursor position hint
    buf.writeLine(footerY + 1, panel.x + 1, dim("Enter to send, Esc to cancel"), contentWidth);
  } else if (agent.backendSessionId && (agent.state === "stopped" || agent.state === "idle")) {
    // Agent finished but can be resumed — show reply hint
    const replyHint = color(ANSI.cyan, "p:reply") + dim("  (type a number, 'go', or free-form)  j/k:scroll  Esc:back");
    buf.writeLine(footerY, panel.x + 1, replyHint, contentWidth);
  } else {
    // Status line with keybindings
    const roleKey = role ? "  R:role" : "";
    const keys = dim(`j/k:scroll  G:bottom  g:top  p:prompt  S:stop  n/N:cycle${roleKey}  Esc:back`);
    buf.writeLine(footerY, panel.x + 1, keys, contentWidth);
  }
}

function styleLine(line: DisplayLine, maxWidth: number): string {
  const text = truncate(line.text, maxWidth);
  switch (line.style) {
    case "tool":
      return ANSI.cyan + text + ANSI.reset;
    case "error":
      return ANSI.red + ANSI.bold + text + ANSI.reset;
    case "system":
      return ANSI.yellow + ANSI.dim + text + ANSI.reset;
    case "dim":
      return ANSI.dim + text + ANSI.reset;
    case "normal":
    default:
      return text;
  }
}

function formatDuration(startedAt: string, stoppedAt?: string): string {
  const start = new Date(startedAt).getTime();
  const end = stoppedAt ? new Date(stoppedAt).getTime() : Date.now();
  const diffMs = end - start;

  const seconds = Math.floor(diffMs / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);

  if (hours > 0) return `${hours}h${minutes % 60}m`;
  if (minutes > 0) return `${minutes}m${seconds % 60}s`;
  return `${seconds}s`;
}

// --- Navigation ---

export function scrollUp(state: AgentFocusState, amount = 1): void {
  state.followTail = false;
  state.scrollOffset = Math.max(0, state.scrollOffset - amount);
}

export function scrollDown(state: AgentFocusState, amount = 1, viewHeight = 20): void {
  const maxScroll = Math.max(0, state.displayLines.length - viewHeight);
  state.scrollOffset = Math.min(maxScroll, state.scrollOffset + amount);
  if (state.scrollOffset >= maxScroll) {
    state.followTail = true;
  }
}

export function scrollToTop(state: AgentFocusState): void {
  state.followTail = false;
  state.scrollOffset = 0;
}

export function scrollToBottom(state: AgentFocusState): void {
  state.followTail = true;
  // scrollOffset will be set during render
}
