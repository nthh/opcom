// ChatComponent — Persistent chat panel for agent interaction
// Follows TuiComponent interface. Used on dashboard (L1) and project-detail (L2).

import type { AgentSession, NormalizedEvent, DeliveryMode } from "@opcom/types";
import type { TuiComponent } from "./types.js";
import type { Panel } from "../layout.js";
import {
  ScreenBuffer,
  drawBox,
  ANSI,
  bold,
  dim,
  color,
  truncate,
} from "../renderer.js";

// --- Chat State ---

export interface ChatMessage {
  role: "user" | "agent";
  text: string;
  timestamp: number;
}

export interface ChatState {
  /** Agent session ID currently bound to */
  boundAgentId: string | null;
  /** Chat history per agent (keyed by agent ID) */
  history: Map<string, ChatMessage[]>;
  /** Current input buffer */
  input: string;
  /** Scroll offset in history */
  scrollOffset: number;
  /** Cached panel height from last render */
  panelHeight: number;
  /** Whether the chat input is active (focused and accepting text) */
  inputActive: boolean;
}

// --- Helpers ---

/** Get chat messages for the currently bound agent. */
export function getChatMessages(state: ChatState): ChatMessage[] {
  if (!state.boundAgentId) return [];
  return state.history.get(state.boundAgentId) ?? [];
}

/** Add a message to the chat history for a given agent. */
export function addChatMessage(state: ChatState, agentId: string, message: ChatMessage): void {
  if (!state.history.has(agentId)) {
    state.history.set(agentId, []);
  }
  state.history.get(agentId)!.push(message);
}

/** Extract chat-relevant messages from agent events (message_start/message_delta with assistant role). */
export function extractMessagesFromEvents(events: NormalizedEvent[]): ChatMessage[] {
  const messages: ChatMessage[] = [];
  let currentText = "";

  for (const event of events) {
    if (event.type === "message_start" && event.data?.role === "assistant") {
      currentText = event.data.text ?? "";
    } else if (event.type === "message_delta" && event.data?.text) {
      currentText += event.data.text;
    } else if (event.type === "message_end") {
      if (currentText.trim()) {
        messages.push({
          role: "agent",
          text: currentText.trim(),
          timestamp: new Date(event.timestamp).getTime(),
        });
      }
      currentText = "";
    } else if (event.type === "error" && event.data?.reason) {
      // Surface errors in the chat so they're visible
      messages.push({
        role: "agent",
        text: `[error] ${event.data.reason}`,
        timestamp: new Date(event.timestamp).getTime(),
      });
    } else if (event.type === "agent_end" && event.data?.reason && event.data.reason !== "completed") {
      // Show non-zero exit codes
      messages.push({
        role: "agent",
        text: `[agent exited] ${event.data.reason}`,
        timestamp: new Date(event.timestamp).getTime(),
      });
    }
  }

  // If there's an in-progress message (no message_end yet), include it
  if (currentText.trim()) {
    messages.push({
      role: "agent",
      text: currentText.trim(),
      timestamp: Date.now(),
    });
  }

  return messages;
}

/** Determine delivery mode based on agent state: 'steer' for streaming agents, 'prompt' for idle. */
export function getDeliveryMode(agents: AgentSession[], agentId: string): DeliveryMode {
  const agent = agents.find((a) => a.id === agentId);
  return agent?.state === "streaming" ? "steer" : "prompt";
}

/** Wrap text to fit within a given width, returning wrapped lines. */
function wrapText(text: string, width: number): string[] {
  if (width <= 0) return [text];
  const lines: string[] = [];
  for (const rawLine of text.split("\n")) {
    if (rawLine.length <= width) {
      lines.push(rawLine);
    } else {
      let remaining = rawLine;
      while (remaining.length > width) {
        // Try to break at a space
        let breakAt = remaining.lastIndexOf(" ", width);
        if (breakAt <= 0) breakAt = width;
        lines.push(remaining.slice(0, breakAt));
        remaining = remaining.slice(breakAt).trimStart();
      }
      if (remaining) lines.push(remaining);
    }
  }
  return lines;
}

/** Build display lines from chat messages, word-wrapped to fit panel width. */
export function buildDisplayLines(
  messages: ChatMessage[],
  contentWidth: number,
): string[] {
  const lines: string[] = [];
  for (const msg of messages) {
    const prefix = msg.role === "user" ? "you" : "agent";
    const prefixStr = msg.role === "user"
      ? color(ANSI.cyan, "you: ")
      : color(ANSI.green, "agent: ");

    const prefixLen = prefix.length + 2; // "you: " or "agent: "
    const textWidth = contentWidth - prefixLen;
    const wrapped = wrapText(msg.text, textWidth > 0 ? textWidth : contentWidth);

    for (let i = 0; i < wrapped.length; i++) {
      if (i === 0) {
        lines.push(prefixStr + wrapped[i]);
      } else {
        lines.push(" ".repeat(prefixLen) + wrapped[i]);
      }
    }
  }
  return lines;
}

// --- Scroll helpers ---

function clampScroll(state: ChatState, totalLines: number): void {
  if (state.panelHeight <= 0) return;
  const visibleLines = state.panelHeight - 3; // box borders + input line
  const maxScroll = Math.max(0, totalLines - visibleLines);
  state.scrollOffset = Math.min(state.scrollOffset, maxScroll);
  state.scrollOffset = Math.max(state.scrollOffset, 0);
}

function scrollToBottom(state: ChatState, totalLines: number): void {
  if (state.panelHeight <= 0) return;
  const visibleLines = state.panelHeight - 3;
  state.scrollOffset = Math.max(0, totalLines - visibleLines);
}

// --- Component ---

export const ChatComponent: TuiComponent<ChatState> = {
  id: "chat",

  init(): ChatState {
    return {
      boundAgentId: null,
      history: new Map(),
      input: "",
      scrollOffset: 0,
      panelHeight: 0,
      inputActive: false,
    };
  },

  render(buf: ScreenBuffer, panel: Panel, state: ChatState, focused: boolean): void {
    state.panelHeight = panel.height;

    const agentLabel = state.boundAgentId
      ? state.boundAgentId.slice(0, 12)
      : "";
    const title = agentLabel ? `Chat (${agentLabel})` : "Chat";

    drawBox(buf, panel.x, panel.y, panel.width, panel.height, title, focused);

    const contentWidth = panel.width - 4;
    const contentHeight = panel.height - 2; // inside box borders

    if (!state.boundAgentId) {
      buf.writeLine(panel.y + 1, panel.x + 2, dim("Select an agent to chat"), contentWidth);
      return;
    }

    const messages = getChatMessages(state);
    if (messages.length === 0 && !state.inputActive) {
      buf.writeLine(panel.y + 1, panel.x + 2, dim("No messages yet"), contentWidth);
      buf.writeLine(panel.y + 2, panel.x + 2, dim("Press c to start chatting"), contentWidth);
      // Input line
      const inputY = panel.y + panel.height - 2;
      const inputLine = state.inputActive
        ? `${color(ANSI.cyan, ">")} ${state.input}_`
        : dim("> ...");
      buf.writeLine(inputY, panel.x + 2, inputLine, contentWidth);
      return;
    }

    // Build display lines
    const displayLines = buildDisplayLines(messages, contentWidth);

    // Reserve 1 line for input prompt at bottom
    const historyHeight = contentHeight - 1;
    const scroll = state.scrollOffset;

    for (let i = 0; i < historyHeight && i + scroll < displayLines.length; i++) {
      const lineIdx = i + scroll;
      buf.writeLine(panel.y + 1 + i, panel.x + 2, displayLines[lineIdx], contentWidth);
    }

    // Input line at bottom of box
    const inputY = panel.y + panel.height - 2;
    if (state.inputActive) {
      const inputLine = `${color(ANSI.cyan, ">")} ${state.input}_`;
      buf.writeLine(inputY, panel.x + 2, inputLine, contentWidth);
    } else {
      buf.writeLine(inputY, panel.x + 2, dim("> ..."), contentWidth);
    }
  },

  handleKey(key: string, state: ChatState): { handled: boolean; state: ChatState } {
    if (!state.boundAgentId) {
      return { handled: false, state };
    }

    // When input is active, all keys go to text input (handled in app.ts)
    // Component only handles scroll keys when input is NOT active
    if (state.inputActive) {
      return { handled: false, state };
    }

    const messages = getChatMessages(state);
    const displayLines = buildDisplayLines(messages, 60); // approx width for line count
    const totalLines = displayLines.length;

    switch (key) {
      case "j":
      case "\x1b[B": { // Down
        const newState = { ...state };
        newState.scrollOffset = Math.min(state.scrollOffset + 1, Math.max(0, totalLines - 1));
        clampScroll(newState, totalLines);
        return { handled: true, state: newState };
      }
      case "k":
      case "\x1b[A": { // Up
        const newState = { ...state };
        newState.scrollOffset = Math.max(state.scrollOffset - 1, 0);
        return { handled: true, state: newState };
      }
      case "G": {
        const newState = { ...state };
        scrollToBottom(newState, totalLines);
        return { handled: true, state: newState };
      }
      case "g": {
        const newState = { ...state };
        newState.scrollOffset = 0;
        return { handled: true, state: newState };
      }
      default:
        return { handled: false, state };
    }
  },
};
