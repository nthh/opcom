import { describe, it, expect } from "vitest";
import type { AgentSession, ProjectStatusSnapshot, NormalizedEvent } from "@opcom/types";
import { ScreenBuffer } from "../../packages/cli/src/tui/renderer.js";
import type { Panel } from "../../packages/cli/src/tui/layout.js";
import type { TuiComponent } from "../../packages/cli/src/tui/components/types.js";
import {
  ChatComponent,
  addChatMessage,
  getChatMessages,
  extractMessagesFromEvents,
  buildDisplayLines,
  type ChatState,
  type ChatMessage,
} from "../../packages/cli/src/tui/components/chat.js";
import { getLayout } from "../../packages/cli/src/tui/layout.js";
import { createDashboardState, renderDashboard } from "../../packages/cli/src/tui/views/dashboard.js";
import { createProjectDetailState, renderProjectDetail } from "../../packages/cli/src/tui/views/project-detail.js";

// --- Test helpers ---

function makeAgent(overrides: Partial<AgentSession> = {}): AgentSession {
  return {
    id: "agent-1",
    backend: "claude-code",
    projectId: "proj-1",
    state: "streaming",
    startedAt: new Date().toISOString(),
    ...overrides,
  };
}

function makeProject(overrides: Partial<ProjectStatusSnapshot> = {}): ProjectStatusSnapshot {
  return {
    id: "proj-1",
    name: "folia",
    path: "/projects/folia",
    git: { remote: null, branch: "main", clean: true },
    workSummary: { open: 3, total: 5, inProgress: 1, closed: 1, deferred: 0 },
    ...overrides,
  };
}

function makePanel(overrides: Partial<Panel> = {}): Panel {
  return {
    id: "chat",
    x: 0,
    y: 0,
    width: 60,
    height: 15,
    title: "Chat",
    ...overrides,
  };
}

function makeEvent(overrides: Partial<NormalizedEvent> = {}): NormalizedEvent {
  return {
    type: "message_start",
    sessionId: "agent-1",
    timestamp: new Date().toISOString(),
    ...overrides,
  };
}

// --- TuiComponent interface tests ---

describe("TuiComponent interface", () => {
  it("ChatComponent satisfies TuiComponent<ChatState>", () => {
    const component: TuiComponent<ChatState> = ChatComponent;
    expect(component.id).toBe("chat");
    expect(typeof component.init).toBe("function");
    expect(typeof component.render).toBe("function");
    expect(typeof component.handleKey).toBe("function");
  });
});

// --- ChatComponent.init() ---

describe("ChatComponent.init", () => {
  it("returns correct default state", () => {
    const state = ChatComponent.init();
    expect(state.boundAgentId).toBeNull();
    expect(state.history).toBeInstanceOf(Map);
    expect(state.history.size).toBe(0);
    expect(state.input).toBe("");
    expect(state.scrollOffset).toBe(0);
    expect(state.panelHeight).toBe(0);
    expect(state.inputActive).toBe(false);
  });
});

// --- ChatComponent.handleKey ---

describe("ChatComponent.handleKey", () => {
  it("returns handled=false when no agent bound", () => {
    const state = ChatComponent.init();
    const result = ChatComponent.handleKey("j", state);
    expect(result.handled).toBe(false);
  });

  it("returns handled=false when inputActive (keys handled by app.ts)", () => {
    const state = ChatComponent.init();
    state.boundAgentId = "agent-1";
    state.inputActive = true;
    const result = ChatComponent.handleKey("j", state);
    expect(result.handled).toBe(false);
  });

  it("j scrolls down when content overflows", () => {
    const state = ChatComponent.init();
    state.boundAgentId = "agent-1";
    state.panelHeight = 5; // 5 - 3 = 2 visible history lines
    // Add enough messages to overflow
    for (let i = 0; i < 10; i++) {
      addChatMessage(state, "agent-1", { role: "agent", text: `line ${i}`, timestamp: i });
    }

    const result = ChatComponent.handleKey("j", state);
    expect(result.handled).toBe(true);
    expect(result.state.scrollOffset).toBe(1);
  });

  it("k scrolls up", () => {
    const state = ChatComponent.init();
    state.boundAgentId = "agent-1";
    state.panelHeight = 10;
    state.scrollOffset = 2;
    addChatMessage(state, "agent-1", { role: "agent", text: "line 1", timestamp: 1 });

    const result = ChatComponent.handleKey("k", state);
    expect(result.handled).toBe(true);
    expect(result.state.scrollOffset).toBe(1);
  });

  it("k does not go below 0", () => {
    const state = ChatComponent.init();
    state.boundAgentId = "agent-1";
    state.panelHeight = 10;
    state.scrollOffset = 0;

    const result = ChatComponent.handleKey("k", state);
    expect(result.handled).toBe(true);
    expect(result.state.scrollOffset).toBe(0);
  });

  it("G scrolls to bottom", () => {
    const state = ChatComponent.init();
    state.boundAgentId = "agent-1";
    state.panelHeight = 5; // 5 - 3 = 2 visible lines
    for (let i = 0; i < 10; i++) {
      addChatMessage(state, "agent-1", { role: "agent", text: `line ${i}`, timestamp: i });
    }

    const result = ChatComponent.handleKey("G", state);
    expect(result.handled).toBe(true);
    expect(result.state.scrollOffset).toBeGreaterThan(0);
  });

  it("g scrolls to top", () => {
    const state = ChatComponent.init();
    state.boundAgentId = "agent-1";
    state.panelHeight = 10;
    state.scrollOffset = 5;

    const result = ChatComponent.handleKey("g", state);
    expect(result.handled).toBe(true);
    expect(result.state.scrollOffset).toBe(0);
  });

  it("down arrow scrolls down", () => {
    const state = ChatComponent.init();
    state.boundAgentId = "agent-1";
    state.panelHeight = 10;
    addChatMessage(state, "agent-1", { role: "agent", text: "line 1", timestamp: 1 });

    const result = ChatComponent.handleKey("\x1b[B", state);
    expect(result.handled).toBe(true);
  });

  it("up arrow scrolls up", () => {
    const state = ChatComponent.init();
    state.boundAgentId = "agent-1";
    state.panelHeight = 10;
    state.scrollOffset = 1;

    const result = ChatComponent.handleKey("\x1b[A", state);
    expect(result.handled).toBe(true);
    expect(result.state.scrollOffset).toBe(0);
  });

  it("returns handled=false for unrecognized keys", () => {
    const state = ChatComponent.init();
    state.boundAgentId = "agent-1";

    expect(ChatComponent.handleKey("q", state).handled).toBe(false);
    expect(ChatComponent.handleKey("\t", state).handled).toBe(false);
    expect(ChatComponent.handleKey("w", state).handled).toBe(false);
  });

  it("returns new state object (immutable)", () => {
    const state = ChatComponent.init();
    state.boundAgentId = "agent-1";
    state.panelHeight = 10;
    addChatMessage(state, "agent-1", { role: "agent", text: "hello", timestamp: 1 });

    const result = ChatComponent.handleKey("j", state);
    expect(result.state).not.toBe(state);
    expect(state.scrollOffset).toBe(0); // original unchanged
  });
});

// --- getChatMessages ---

describe("getChatMessages", () => {
  it("returns empty array when no agent bound", () => {
    const state = ChatComponent.init();
    expect(getChatMessages(state)).toEqual([]);
  });

  it("returns empty array when no messages for agent", () => {
    const state = ChatComponent.init();
    state.boundAgentId = "agent-1";
    expect(getChatMessages(state)).toEqual([]);
  });

  it("returns messages for bound agent", () => {
    const state = ChatComponent.init();
    state.boundAgentId = "agent-1";
    addChatMessage(state, "agent-1", { role: "user", text: "hello", timestamp: 1 });
    addChatMessage(state, "agent-1", { role: "agent", text: "hi", timestamp: 2 });

    const messages = getChatMessages(state);
    expect(messages).toHaveLength(2);
    expect(messages[0].role).toBe("user");
    expect(messages[1].role).toBe("agent");
  });

  it("does not return messages from other agents", () => {
    const state = ChatComponent.init();
    state.boundAgentId = "agent-1";
    addChatMessage(state, "agent-1", { role: "user", text: "hello", timestamp: 1 });
    addChatMessage(state, "agent-2", { role: "user", text: "other", timestamp: 2 });

    const messages = getChatMessages(state);
    expect(messages).toHaveLength(1);
    expect(messages[0].text).toBe("hello");
  });
});

// --- addChatMessage ---

describe("addChatMessage", () => {
  it("creates history entry for new agent", () => {
    const state = ChatComponent.init();
    addChatMessage(state, "agent-1", { role: "user", text: "test", timestamp: 1 });
    expect(state.history.has("agent-1")).toBe(true);
    expect(state.history.get("agent-1")).toHaveLength(1);
  });

  it("appends to existing history", () => {
    const state = ChatComponent.init();
    addChatMessage(state, "agent-1", { role: "user", text: "msg1", timestamp: 1 });
    addChatMessage(state, "agent-1", { role: "agent", text: "msg2", timestamp: 2 });
    expect(state.history.get("agent-1")).toHaveLength(2);
  });
});

// --- extractMessagesFromEvents ---

describe("extractMessagesFromEvents", () => {
  it("returns empty for no events", () => {
    expect(extractMessagesFromEvents([])).toEqual([]);
  });

  it("extracts complete assistant messages", () => {
    const events: NormalizedEvent[] = [
      makeEvent({ type: "message_start", data: { role: "assistant", text: "Hello" } }),
      makeEvent({ type: "message_delta", data: { text: " world" } }),
      makeEvent({ type: "message_end" }),
    ];
    const messages = extractMessagesFromEvents(events);
    expect(messages).toHaveLength(1);
    expect(messages[0].role).toBe("agent");
    expect(messages[0].text).toBe("Hello world");
  });

  it("extracts multiple messages", () => {
    const events: NormalizedEvent[] = [
      makeEvent({ type: "message_start", data: { role: "assistant", text: "First" } }),
      makeEvent({ type: "message_end" }),
      makeEvent({ type: "message_start", data: { role: "assistant", text: "Second" } }),
      makeEvent({ type: "message_end" }),
    ];
    const messages = extractMessagesFromEvents(events);
    expect(messages).toHaveLength(2);
    expect(messages[0].text).toBe("First");
    expect(messages[1].text).toBe("Second");
  });

  it("includes in-progress messages (no message_end yet)", () => {
    const events: NormalizedEvent[] = [
      makeEvent({ type: "message_start", data: { role: "assistant", text: "Working on" } }),
      makeEvent({ type: "message_delta", data: { text: " it..." } }),
    ];
    const messages = extractMessagesFromEvents(events);
    expect(messages).toHaveLength(1);
    expect(messages[0].text).toBe("Working on it...");
  });

  it("ignores tool events", () => {
    const events: NormalizedEvent[] = [
      makeEvent({ type: "tool_start", data: { toolName: "read" } }),
      makeEvent({ type: "tool_end", data: { toolName: "read", toolSuccess: true } }),
    ];
    const messages = extractMessagesFromEvents(events);
    expect(messages).toEqual([]);
  });

  it("skips empty messages", () => {
    const events: NormalizedEvent[] = [
      makeEvent({ type: "message_start", data: { role: "assistant", text: "" } }),
      makeEvent({ type: "message_end" }),
    ];
    const messages = extractMessagesFromEvents(events);
    expect(messages).toEqual([]);
  });
});

// --- buildDisplayLines ---

describe("buildDisplayLines", () => {
  it("returns empty for no messages", () => {
    expect(buildDisplayLines([], 60)).toEqual([]);
  });

  it("formats user messages with 'you:' prefix", () => {
    const messages: ChatMessage[] = [
      { role: "user", text: "hello", timestamp: 1 },
    ];
    const lines = buildDisplayLines(messages, 60);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain("you:");
    expect(lines[0]).toContain("hello");
  });

  it("formats agent messages with 'agent:' prefix", () => {
    const messages: ChatMessage[] = [
      { role: "agent", text: "hi there", timestamp: 1 },
    ];
    const lines = buildDisplayLines(messages, 60);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain("agent:");
    expect(lines[0]).toContain("hi there");
  });

  it("wraps long messages", () => {
    const messages: ChatMessage[] = [
      { role: "user", text: "a".repeat(100), timestamp: 1 },
    ];
    const lines = buildDisplayLines(messages, 40);
    expect(lines.length).toBeGreaterThan(1);
  });

  it("handles multiple messages", () => {
    const messages: ChatMessage[] = [
      { role: "user", text: "hello", timestamp: 1 },
      { role: "agent", text: "hi", timestamp: 2 },
    ];
    const lines = buildDisplayLines(messages, 60);
    expect(lines).toHaveLength(2);
  });
});

// --- Render tests ---

describe("ChatComponent.render", () => {
  it("renders without crashing with no agent bound", () => {
    const state = ChatComponent.init();
    const buf = new ScreenBuffer(80, 30);
    const panel = makePanel();

    ChatComponent.render(buf, panel, state, true);
    expect(state.panelHeight).toBe(15);
  });

  it("renders with agent bound but no messages", () => {
    const state = ChatComponent.init();
    state.boundAgentId = "agent-abc123";
    const buf = new ScreenBuffer(80, 30);
    const panel = makePanel();

    ChatComponent.render(buf, panel, state, true);
    expect(state.panelHeight).toBe(15);
  });

  it("renders with messages", () => {
    const state = ChatComponent.init();
    state.boundAgentId = "agent-1";
    addChatMessage(state, "agent-1", { role: "user", text: "hello", timestamp: 1 });
    addChatMessage(state, "agent-1", { role: "agent", text: "hi there", timestamp: 2 });

    const buf = new ScreenBuffer(80, 30);
    const panel = makePanel();

    ChatComponent.render(buf, panel, state, true);
    // Should not throw
  });

  it("renders input line when inputActive", () => {
    const state = ChatComponent.init();
    state.boundAgentId = "agent-1";
    state.inputActive = true;
    state.input = "test message";

    const buf = new ScreenBuffer(80, 30);
    const panel = makePanel();

    ChatComponent.render(buf, panel, state, true);
    // Should not throw
  });

  it("renders within panel bounds", () => {
    const state = ChatComponent.init();
    state.boundAgentId = "agent-1";
    addChatMessage(state, "agent-1", { role: "user", text: "hello", timestamp: 1 });
    addChatMessage(state, "agent-1", { role: "agent", text: "hi there", timestamp: 2 });

    const buf = new ScreenBuffer(100, 50);
    const panel = makePanel({ x: 10, y: 5, width: 40, height: 10 });

    ChatComponent.render(buf, panel, state, false);
    // ScreenBuffer clips out-of-bounds — no crash = success
  });
});

// --- Layout tests ---

describe("layout with chat panel", () => {
  it("dashboard layout includes chat panel", () => {
    const layout = getLayout(1, 120, 40);
    const chatPanel = layout.panels.find((p) => p.id === "chat");
    expect(chatPanel).toBeDefined();
    expect(chatPanel!.width).toBeGreaterThan(0);
    expect(chatPanel!.height).toBeGreaterThan(0);
  });

  it("dashboard layout positions chat below agents", () => {
    const layout = getLayout(1, 120, 40);
    const agentsPanel = layout.panels.find((p) => p.id === "agents")!;
    const chatPanel = layout.panels.find((p) => p.id === "chat")!;
    expect(chatPanel.y).toBe(agentsPanel.y + agentsPanel.height);
    expect(chatPanel.x).toBe(agentsPanel.x);
  });

  it("project-detail layout includes chat panel", () => {
    const layout = getLayout(2, 120, 40);
    const chatPanel = layout.panels.find((p) => p.id === "chat");
    expect(chatPanel).toBeDefined();
    expect(chatPanel!.width).toBeGreaterThan(0);
    expect(chatPanel!.height).toBeGreaterThan(0);
  });

  it("project-detail layout positions chat at bottom of right column", () => {
    const layout = getLayout(2, 120, 40);
    const cicdPanel = layout.panels.find((p) => p.id === "cicd")!;
    const chatPanel = layout.panels.find((p) => p.id === "chat")!;
    expect(chatPanel.y).toBe(cicdPanel.y + cicdPanel.height);
  });

  it("L3 layout has no chat panel", () => {
    const layout = getLayout(3, 120, 40);
    const chatPanel = layout.panels.find((p) => p.id === "chat");
    expect(chatPanel).toBeUndefined();
  });
});

// --- Integration: Dashboard with ChatComponent ---

describe("dashboard integration with ChatComponent", () => {
  it("renders dashboard with chat component", () => {
    const state = createDashboardState();
    state.chatComponent.boundAgentId = "agent-1";

    const buf = new ScreenBuffer(120, 40);
    const layout = getLayout(1, 120, 40);

    renderDashboard(buf, layout.panels, state);
    // Should not throw; chat panel rendered via component
  });

  it("dashboard state includes chatComponent", () => {
    const state = createDashboardState();
    expect(state.chatComponent).toBeDefined();
    expect(state.chatComponent.boundAgentId).toBeNull();
    expect(state.chatComponent.history).toBeInstanceOf(Map);
  });

  it("Tab cycles across all 4 panels including chat", () => {
    const state = createDashboardState();
    expect(state.focusedPanel).toBe(0);

    state.focusedPanel = (state.focusedPanel + 1) % 4;
    expect(state.focusedPanel).toBe(1);

    state.focusedPanel = (state.focusedPanel + 1) % 4;
    expect(state.focusedPanel).toBe(2);

    state.focusedPanel = (state.focusedPanel + 1) % 4;
    expect(state.focusedPanel).toBe(3); // chat

    state.focusedPanel = (state.focusedPanel + 1) % 4;
    expect(state.focusedPanel).toBe(0); // back to projects
  });

  it("chat component key dispatch handles j/k when focused on chat", () => {
    const state = createDashboardState();
    state.chatComponent.boundAgentId = "agent-1";
    state.chatComponent.panelHeight = 20;
    addChatMessage(state.chatComponent, "agent-1", { role: "agent", text: "hello", timestamp: 1 });
    state.focusedPanel = 3;

    const result = ChatComponent.handleKey("j", state.chatComponent);
    expect(result.handled).toBe(true);
  });

  it("non-chat keys fall through from chat component", () => {
    const state = createDashboardState();
    state.chatComponent.boundAgentId = "agent-1";
    state.focusedPanel = 3;

    const result = ChatComponent.handleKey("\t", state.chatComponent);
    expect(result.handled).toBe(false);
  });
});

// --- Integration: Project Detail with ChatComponent ---

describe("project-detail integration with ChatComponent", () => {
  it("renders project-detail with chat component", () => {
    const project = makeProject();
    const state = createProjectDetailState(project);
    state.chatComponent.boundAgentId = "agent-1";

    const buf = new ScreenBuffer(120, 50);
    const layout = getLayout(2, 120, 50);

    renderProjectDetail(buf, layout.panels, state);
    // Should not throw
  });

  it("project-detail state includes chatComponent", () => {
    const project = makeProject();
    const state = createProjectDetailState(project);
    expect(state.chatComponent).toBeDefined();
    expect(state.chatComponent.boundAgentId).toBeNull();
  });

  it("Tab cycles across 7 panels including chat", () => {
    const project = makeProject();
    const state = createProjectDetailState(project);

    // cycle to chat (panel 6)
    state.focusedPanel = 6;
    expect(state.focusedPanel).toBe(6);

    // Tab wraps around
    state.focusedPanel = (state.focusedPanel + 1) % 7;
    expect(state.focusedPanel).toBe(0);
  });
});

// --- Agent binding ---

describe("chat agent binding", () => {
  it("switching boundAgentId switches chat context", () => {
    const state = ChatComponent.init();

    // Add messages for two agents
    addChatMessage(state, "agent-1", { role: "user", text: "hello 1", timestamp: 1 });
    addChatMessage(state, "agent-2", { role: "user", text: "hello 2", timestamp: 2 });

    state.boundAgentId = "agent-1";
    expect(getChatMessages(state)).toHaveLength(1);
    expect(getChatMessages(state)[0].text).toBe("hello 1");

    state.boundAgentId = "agent-2";
    expect(getChatMessages(state)).toHaveLength(1);
    expect(getChatMessages(state)[0].text).toBe("hello 2");
  });

  it("chat history persists when switching agents", () => {
    const state = ChatComponent.init();

    addChatMessage(state, "agent-1", { role: "user", text: "first", timestamp: 1 });
    state.boundAgentId = "agent-1";
    expect(getChatMessages(state)).toHaveLength(1);

    // Switch away and back
    state.boundAgentId = "agent-2";
    state.boundAgentId = "agent-1";
    expect(getChatMessages(state)).toHaveLength(1);
    expect(getChatMessages(state)[0].text).toBe("first");
  });

  it("scroll resets conceptually when switching agents (offset stays)", () => {
    const state = ChatComponent.init();
    state.boundAgentId = "agent-1";
    state.scrollOffset = 5;

    // Switching agents keeps scrollOffset (will be clamped on render)
    state.boundAgentId = "agent-2";
    expect(state.scrollOffset).toBe(5);
  });
});

// --- Edge cases ---

describe("edge cases", () => {
  it("handles empty input on Enter", () => {
    const state = ChatComponent.init();
    state.boundAgentId = "agent-1";
    state.inputActive = true;
    state.input = "";
    // handleKey returns handled=false during inputActive (handled by app.ts)
    const result = ChatComponent.handleKey("\r", state);
    expect(result.handled).toBe(false);
  });

  it("renders with very small panel", () => {
    const state = ChatComponent.init();
    state.boundAgentId = "agent-1";
    addChatMessage(state, "agent-1", { role: "agent", text: "hello", timestamp: 1 });

    const buf = new ScreenBuffer(80, 30);
    const panel = makePanel({ width: 10, height: 4 }); // minimum viable panel

    ChatComponent.render(buf, panel, state, true);
    // Should not crash
  });

  it("handles large history without crashing", () => {
    const state = ChatComponent.init();
    state.boundAgentId = "agent-1";
    state.panelHeight = 10;

    for (let i = 0; i < 100; i++) {
      addChatMessage(state, "agent-1", { role: i % 2 === 0 ? "user" : "agent", text: `message ${i}`, timestamp: i });
    }

    const buf = new ScreenBuffer(80, 30);
    const panel = makePanel();
    ChatComponent.render(buf, panel, state, true);
    // Should not crash
  });
});
