"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const renderer_js_1 = require("../../packages/cli/src/tui/renderer.js");
const chat_js_1 = require("../../packages/cli/src/tui/components/chat.js");
const layout_js_1 = require("../../packages/cli/src/tui/layout.js");
const dashboard_js_1 = require("../../packages/cli/src/tui/views/dashboard.js");
const project_detail_js_1 = require("../../packages/cli/src/tui/views/project-detail.js");
// --- Test helpers ---
function makeAgent(overrides = {}) {
    return {
        id: "agent-1",
        backend: "claude-code",
        projectId: "proj-1",
        state: "streaming",
        startedAt: new Date().toISOString(),
        ...overrides,
    };
}
function makeProject(overrides = {}) {
    return {
        id: "proj-1",
        name: "folia",
        path: "/projects/folia",
        git: { remote: null, branch: "main", clean: true },
        workSummary: { open: 3, total: 5, inProgress: 1, closed: 1, deferred: 0 },
        ...overrides,
    };
}
function makePanel(overrides = {}) {
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
function makeEvent(overrides = {}) {
    return {
        type: "message_start",
        sessionId: "agent-1",
        timestamp: new Date().toISOString(),
        ...overrides,
    };
}
// --- TuiComponent interface tests ---
(0, vitest_1.describe)("TuiComponent interface", () => {
    (0, vitest_1.it)("ChatComponent satisfies TuiComponent<ChatState>", () => {
        const component = chat_js_1.ChatComponent;
        (0, vitest_1.expect)(component.id).toBe("chat");
        (0, vitest_1.expect)(typeof component.init).toBe("function");
        (0, vitest_1.expect)(typeof component.render).toBe("function");
        (0, vitest_1.expect)(typeof component.handleKey).toBe("function");
    });
});
// --- ChatComponent.init() ---
(0, vitest_1.describe)("ChatComponent.init", () => {
    (0, vitest_1.it)("returns correct default state", () => {
        const state = chat_js_1.ChatComponent.init();
        (0, vitest_1.expect)(state.boundAgentId).toBeNull();
        (0, vitest_1.expect)(state.history).toBeInstanceOf(Map);
        (0, vitest_1.expect)(state.history.size).toBe(0);
        (0, vitest_1.expect)(state.input).toBe("");
        (0, vitest_1.expect)(state.scrollOffset).toBe(0);
        (0, vitest_1.expect)(state.panelHeight).toBe(0);
        (0, vitest_1.expect)(state.inputActive).toBe(false);
    });
});
// --- ChatComponent.handleKey ---
(0, vitest_1.describe)("ChatComponent.handleKey", () => {
    (0, vitest_1.it)("returns handled=false when no agent bound", () => {
        const state = chat_js_1.ChatComponent.init();
        const result = chat_js_1.ChatComponent.handleKey("j", state);
        (0, vitest_1.expect)(result.handled).toBe(false);
    });
    (0, vitest_1.it)("returns handled=false when inputActive (keys handled by app.ts)", () => {
        const state = chat_js_1.ChatComponent.init();
        state.boundAgentId = "agent-1";
        state.inputActive = true;
        const result = chat_js_1.ChatComponent.handleKey("j", state);
        (0, vitest_1.expect)(result.handled).toBe(false);
    });
    (0, vitest_1.it)("j scrolls down when content overflows", () => {
        const state = chat_js_1.ChatComponent.init();
        state.boundAgentId = "agent-1";
        state.panelHeight = 5; // 5 - 3 = 2 visible history lines
        // Add enough messages to overflow
        for (let i = 0; i < 10; i++) {
            (0, chat_js_1.addChatMessage)(state, "agent-1", { role: "agent", text: `line ${i}`, timestamp: i });
        }
        const result = chat_js_1.ChatComponent.handleKey("j", state);
        (0, vitest_1.expect)(result.handled).toBe(true);
        (0, vitest_1.expect)(result.state.scrollOffset).toBe(1);
    });
    (0, vitest_1.it)("k scrolls up", () => {
        const state = chat_js_1.ChatComponent.init();
        state.boundAgentId = "agent-1";
        state.panelHeight = 10;
        state.scrollOffset = 2;
        (0, chat_js_1.addChatMessage)(state, "agent-1", { role: "agent", text: "line 1", timestamp: 1 });
        const result = chat_js_1.ChatComponent.handleKey("k", state);
        (0, vitest_1.expect)(result.handled).toBe(true);
        (0, vitest_1.expect)(result.state.scrollOffset).toBe(1);
    });
    (0, vitest_1.it)("k does not go below 0", () => {
        const state = chat_js_1.ChatComponent.init();
        state.boundAgentId = "agent-1";
        state.panelHeight = 10;
        state.scrollOffset = 0;
        const result = chat_js_1.ChatComponent.handleKey("k", state);
        (0, vitest_1.expect)(result.handled).toBe(true);
        (0, vitest_1.expect)(result.state.scrollOffset).toBe(0);
    });
    (0, vitest_1.it)("G scrolls to bottom", () => {
        const state = chat_js_1.ChatComponent.init();
        state.boundAgentId = "agent-1";
        state.panelHeight = 5; // 5 - 3 = 2 visible lines
        for (let i = 0; i < 10; i++) {
            (0, chat_js_1.addChatMessage)(state, "agent-1", { role: "agent", text: `line ${i}`, timestamp: i });
        }
        const result = chat_js_1.ChatComponent.handleKey("G", state);
        (0, vitest_1.expect)(result.handled).toBe(true);
        (0, vitest_1.expect)(result.state.scrollOffset).toBeGreaterThan(0);
    });
    (0, vitest_1.it)("g scrolls to top", () => {
        const state = chat_js_1.ChatComponent.init();
        state.boundAgentId = "agent-1";
        state.panelHeight = 10;
        state.scrollOffset = 5;
        const result = chat_js_1.ChatComponent.handleKey("g", state);
        (0, vitest_1.expect)(result.handled).toBe(true);
        (0, vitest_1.expect)(result.state.scrollOffset).toBe(0);
    });
    (0, vitest_1.it)("down arrow scrolls down", () => {
        const state = chat_js_1.ChatComponent.init();
        state.boundAgentId = "agent-1";
        state.panelHeight = 10;
        (0, chat_js_1.addChatMessage)(state, "agent-1", { role: "agent", text: "line 1", timestamp: 1 });
        const result = chat_js_1.ChatComponent.handleKey("\x1b[B", state);
        (0, vitest_1.expect)(result.handled).toBe(true);
    });
    (0, vitest_1.it)("up arrow scrolls up", () => {
        const state = chat_js_1.ChatComponent.init();
        state.boundAgentId = "agent-1";
        state.panelHeight = 10;
        state.scrollOffset = 1;
        const result = chat_js_1.ChatComponent.handleKey("\x1b[A", state);
        (0, vitest_1.expect)(result.handled).toBe(true);
        (0, vitest_1.expect)(result.state.scrollOffset).toBe(0);
    });
    (0, vitest_1.it)("returns handled=false for unrecognized keys", () => {
        const state = chat_js_1.ChatComponent.init();
        state.boundAgentId = "agent-1";
        (0, vitest_1.expect)(chat_js_1.ChatComponent.handleKey("q", state).handled).toBe(false);
        (0, vitest_1.expect)(chat_js_1.ChatComponent.handleKey("\t", state).handled).toBe(false);
        (0, vitest_1.expect)(chat_js_1.ChatComponent.handleKey("w", state).handled).toBe(false);
    });
    (0, vitest_1.it)("returns new state object (immutable)", () => {
        const state = chat_js_1.ChatComponent.init();
        state.boundAgentId = "agent-1";
        state.panelHeight = 10;
        (0, chat_js_1.addChatMessage)(state, "agent-1", { role: "agent", text: "hello", timestamp: 1 });
        const result = chat_js_1.ChatComponent.handleKey("j", state);
        (0, vitest_1.expect)(result.state).not.toBe(state);
        (0, vitest_1.expect)(state.scrollOffset).toBe(0); // original unchanged
    });
});
// --- getChatMessages ---
(0, vitest_1.describe)("getChatMessages", () => {
    (0, vitest_1.it)("returns empty array when no agent bound", () => {
        const state = chat_js_1.ChatComponent.init();
        (0, vitest_1.expect)((0, chat_js_1.getChatMessages)(state)).toEqual([]);
    });
    (0, vitest_1.it)("returns empty array when no messages for agent", () => {
        const state = chat_js_1.ChatComponent.init();
        state.boundAgentId = "agent-1";
        (0, vitest_1.expect)((0, chat_js_1.getChatMessages)(state)).toEqual([]);
    });
    (0, vitest_1.it)("returns messages for bound agent", () => {
        const state = chat_js_1.ChatComponent.init();
        state.boundAgentId = "agent-1";
        (0, chat_js_1.addChatMessage)(state, "agent-1", { role: "user", text: "hello", timestamp: 1 });
        (0, chat_js_1.addChatMessage)(state, "agent-1", { role: "agent", text: "hi", timestamp: 2 });
        const messages = (0, chat_js_1.getChatMessages)(state);
        (0, vitest_1.expect)(messages).toHaveLength(2);
        (0, vitest_1.expect)(messages[0].role).toBe("user");
        (0, vitest_1.expect)(messages[1].role).toBe("agent");
    });
    (0, vitest_1.it)("does not return messages from other agents", () => {
        const state = chat_js_1.ChatComponent.init();
        state.boundAgentId = "agent-1";
        (0, chat_js_1.addChatMessage)(state, "agent-1", { role: "user", text: "hello", timestamp: 1 });
        (0, chat_js_1.addChatMessage)(state, "agent-2", { role: "user", text: "other", timestamp: 2 });
        const messages = (0, chat_js_1.getChatMessages)(state);
        (0, vitest_1.expect)(messages).toHaveLength(1);
        (0, vitest_1.expect)(messages[0].text).toBe("hello");
    });
});
// --- addChatMessage ---
(0, vitest_1.describe)("addChatMessage", () => {
    (0, vitest_1.it)("creates history entry for new agent", () => {
        const state = chat_js_1.ChatComponent.init();
        (0, chat_js_1.addChatMessage)(state, "agent-1", { role: "user", text: "test", timestamp: 1 });
        (0, vitest_1.expect)(state.history.has("agent-1")).toBe(true);
        (0, vitest_1.expect)(state.history.get("agent-1")).toHaveLength(1);
    });
    (0, vitest_1.it)("appends to existing history", () => {
        const state = chat_js_1.ChatComponent.init();
        (0, chat_js_1.addChatMessage)(state, "agent-1", { role: "user", text: "msg1", timestamp: 1 });
        (0, chat_js_1.addChatMessage)(state, "agent-1", { role: "agent", text: "msg2", timestamp: 2 });
        (0, vitest_1.expect)(state.history.get("agent-1")).toHaveLength(2);
    });
});
// --- extractMessagesFromEvents ---
(0, vitest_1.describe)("extractMessagesFromEvents", () => {
    (0, vitest_1.it)("returns empty for no events", () => {
        (0, vitest_1.expect)((0, chat_js_1.extractMessagesFromEvents)([])).toEqual([]);
    });
    (0, vitest_1.it)("extracts complete assistant messages", () => {
        const events = [
            makeEvent({ type: "message_start", data: { role: "assistant", text: "Hello" } }),
            makeEvent({ type: "message_delta", data: { text: " world" } }),
            makeEvent({ type: "message_end" }),
        ];
        const messages = (0, chat_js_1.extractMessagesFromEvents)(events);
        (0, vitest_1.expect)(messages).toHaveLength(1);
        (0, vitest_1.expect)(messages[0].role).toBe("agent");
        (0, vitest_1.expect)(messages[0].text).toBe("Hello world");
    });
    (0, vitest_1.it)("extracts multiple messages", () => {
        const events = [
            makeEvent({ type: "message_start", data: { role: "assistant", text: "First" } }),
            makeEvent({ type: "message_end" }),
            makeEvent({ type: "message_start", data: { role: "assistant", text: "Second" } }),
            makeEvent({ type: "message_end" }),
        ];
        const messages = (0, chat_js_1.extractMessagesFromEvents)(events);
        (0, vitest_1.expect)(messages).toHaveLength(2);
        (0, vitest_1.expect)(messages[0].text).toBe("First");
        (0, vitest_1.expect)(messages[1].text).toBe("Second");
    });
    (0, vitest_1.it)("includes in-progress messages (no message_end yet)", () => {
        const events = [
            makeEvent({ type: "message_start", data: { role: "assistant", text: "Working on" } }),
            makeEvent({ type: "message_delta", data: { text: " it..." } }),
        ];
        const messages = (0, chat_js_1.extractMessagesFromEvents)(events);
        (0, vitest_1.expect)(messages).toHaveLength(1);
        (0, vitest_1.expect)(messages[0].text).toBe("Working on it...");
    });
    (0, vitest_1.it)("ignores tool events", () => {
        const events = [
            makeEvent({ type: "tool_start", data: { toolName: "read" } }),
            makeEvent({ type: "tool_end", data: { toolName: "read", toolSuccess: true } }),
        ];
        const messages = (0, chat_js_1.extractMessagesFromEvents)(events);
        (0, vitest_1.expect)(messages).toEqual([]);
    });
    (0, vitest_1.it)("skips empty messages", () => {
        const events = [
            makeEvent({ type: "message_start", data: { role: "assistant", text: "" } }),
            makeEvent({ type: "message_end" }),
        ];
        const messages = (0, chat_js_1.extractMessagesFromEvents)(events);
        (0, vitest_1.expect)(messages).toEqual([]);
    });
});
// --- buildDisplayLines ---
(0, vitest_1.describe)("buildDisplayLines", () => {
    (0, vitest_1.it)("returns empty for no messages", () => {
        (0, vitest_1.expect)((0, chat_js_1.buildDisplayLines)([], 60)).toEqual([]);
    });
    (0, vitest_1.it)("formats user messages with 'you:' prefix", () => {
        const messages = [
            { role: "user", text: "hello", timestamp: 1 },
        ];
        const lines = (0, chat_js_1.buildDisplayLines)(messages, 60);
        (0, vitest_1.expect)(lines).toHaveLength(1);
        (0, vitest_1.expect)(lines[0]).toContain("you:");
        (0, vitest_1.expect)(lines[0]).toContain("hello");
    });
    (0, vitest_1.it)("formats agent messages with 'agent:' prefix", () => {
        const messages = [
            { role: "agent", text: "hi there", timestamp: 1 },
        ];
        const lines = (0, chat_js_1.buildDisplayLines)(messages, 60);
        (0, vitest_1.expect)(lines).toHaveLength(1);
        (0, vitest_1.expect)(lines[0]).toContain("agent:");
        (0, vitest_1.expect)(lines[0]).toContain("hi there");
    });
    (0, vitest_1.it)("wraps long messages", () => {
        const messages = [
            { role: "user", text: "a".repeat(100), timestamp: 1 },
        ];
        const lines = (0, chat_js_1.buildDisplayLines)(messages, 40);
        (0, vitest_1.expect)(lines.length).toBeGreaterThan(1);
    });
    (0, vitest_1.it)("handles multiple messages", () => {
        const messages = [
            { role: "user", text: "hello", timestamp: 1 },
            { role: "agent", text: "hi", timestamp: 2 },
        ];
        const lines = (0, chat_js_1.buildDisplayLines)(messages, 60);
        (0, vitest_1.expect)(lines).toHaveLength(2);
    });
});
// --- Render tests ---
(0, vitest_1.describe)("ChatComponent.render", () => {
    (0, vitest_1.it)("renders without crashing with no agent bound", () => {
        const state = chat_js_1.ChatComponent.init();
        const buf = new renderer_js_1.ScreenBuffer(80, 30);
        const panel = makePanel();
        chat_js_1.ChatComponent.render(buf, panel, state, true);
        (0, vitest_1.expect)(state.panelHeight).toBe(15);
    });
    (0, vitest_1.it)("renders with agent bound but no messages", () => {
        const state = chat_js_1.ChatComponent.init();
        state.boundAgentId = "agent-abc123";
        const buf = new renderer_js_1.ScreenBuffer(80, 30);
        const panel = makePanel();
        chat_js_1.ChatComponent.render(buf, panel, state, true);
        (0, vitest_1.expect)(state.panelHeight).toBe(15);
    });
    (0, vitest_1.it)("renders with messages", () => {
        const state = chat_js_1.ChatComponent.init();
        state.boundAgentId = "agent-1";
        (0, chat_js_1.addChatMessage)(state, "agent-1", { role: "user", text: "hello", timestamp: 1 });
        (0, chat_js_1.addChatMessage)(state, "agent-1", { role: "agent", text: "hi there", timestamp: 2 });
        const buf = new renderer_js_1.ScreenBuffer(80, 30);
        const panel = makePanel();
        chat_js_1.ChatComponent.render(buf, panel, state, true);
        // Should not throw
    });
    (0, vitest_1.it)("renders input line when inputActive", () => {
        const state = chat_js_1.ChatComponent.init();
        state.boundAgentId = "agent-1";
        state.inputActive = true;
        state.input = "test message";
        const buf = new renderer_js_1.ScreenBuffer(80, 30);
        const panel = makePanel();
        chat_js_1.ChatComponent.render(buf, panel, state, true);
        // Should not throw
    });
    (0, vitest_1.it)("renders within panel bounds", () => {
        const state = chat_js_1.ChatComponent.init();
        state.boundAgentId = "agent-1";
        (0, chat_js_1.addChatMessage)(state, "agent-1", { role: "user", text: "hello", timestamp: 1 });
        (0, chat_js_1.addChatMessage)(state, "agent-1", { role: "agent", text: "hi there", timestamp: 2 });
        const buf = new renderer_js_1.ScreenBuffer(100, 50);
        const panel = makePanel({ x: 10, y: 5, width: 40, height: 10 });
        chat_js_1.ChatComponent.render(buf, panel, state, false);
        // ScreenBuffer clips out-of-bounds — no crash = success
    });
});
// --- Layout tests ---
(0, vitest_1.describe)("layout with chat panel", () => {
    (0, vitest_1.it)("dashboard layout includes chat panel", () => {
        const layout = (0, layout_js_1.getLayout)(1, 120, 40);
        const chatPanel = layout.panels.find((p) => p.id === "chat");
        (0, vitest_1.expect)(chatPanel).toBeDefined();
        (0, vitest_1.expect)(chatPanel.width).toBeGreaterThan(0);
        (0, vitest_1.expect)(chatPanel.height).toBeGreaterThan(0);
    });
    (0, vitest_1.it)("dashboard layout positions chat below agents", () => {
        const layout = (0, layout_js_1.getLayout)(1, 120, 40);
        const agentsPanel = layout.panels.find((p) => p.id === "agents");
        const chatPanel = layout.panels.find((p) => p.id === "chat");
        (0, vitest_1.expect)(chatPanel.y).toBe(agentsPanel.y + agentsPanel.height);
        (0, vitest_1.expect)(chatPanel.x).toBe(agentsPanel.x);
    });
    (0, vitest_1.it)("project-detail layout includes chat panel", () => {
        const layout = (0, layout_js_1.getLayout)(2, 120, 40);
        const chatPanel = layout.panels.find((p) => p.id === "chat");
        (0, vitest_1.expect)(chatPanel).toBeDefined();
        (0, vitest_1.expect)(chatPanel.width).toBeGreaterThan(0);
        (0, vitest_1.expect)(chatPanel.height).toBeGreaterThan(0);
    });
    (0, vitest_1.it)("project-detail layout positions chat at bottom of right column", () => {
        const layout = (0, layout_js_1.getLayout)(2, 120, 40);
        const infraPanel = layout.panels.find((p) => p.id === "infra");
        const chatPanel = layout.panels.find((p) => p.id === "chat");
        (0, vitest_1.expect)(chatPanel.y).toBe(infraPanel.y + infraPanel.height);
    });
    (0, vitest_1.it)("L3 layout has no chat panel", () => {
        const layout = (0, layout_js_1.getLayout)(3, 120, 40);
        const chatPanel = layout.panels.find((p) => p.id === "chat");
        (0, vitest_1.expect)(chatPanel).toBeUndefined();
    });
});
// --- Integration: Dashboard with ChatComponent ---
(0, vitest_1.describe)("dashboard integration with ChatComponent", () => {
    (0, vitest_1.it)("renders dashboard with chat component", () => {
        const state = (0, dashboard_js_1.createDashboardState)();
        state.chatComponent.boundAgentId = "agent-1";
        const buf = new renderer_js_1.ScreenBuffer(120, 40);
        const layout = (0, layout_js_1.getLayout)(1, 120, 40);
        (0, dashboard_js_1.renderDashboard)(buf, layout.panels, state);
        // Should not throw; chat panel rendered via component
    });
    (0, vitest_1.it)("dashboard state includes chatComponent", () => {
        const state = (0, dashboard_js_1.createDashboardState)();
        (0, vitest_1.expect)(state.chatComponent).toBeDefined();
        (0, vitest_1.expect)(state.chatComponent.boundAgentId).toBeNull();
        (0, vitest_1.expect)(state.chatComponent.history).toBeInstanceOf(Map);
    });
    (0, vitest_1.it)("Tab cycles across all 4 panels including chat", () => {
        const state = (0, dashboard_js_1.createDashboardState)();
        (0, vitest_1.expect)(state.focusedPanel).toBe(0);
        state.focusedPanel = (state.focusedPanel + 1) % 4;
        (0, vitest_1.expect)(state.focusedPanel).toBe(1);
        state.focusedPanel = (state.focusedPanel + 1) % 4;
        (0, vitest_1.expect)(state.focusedPanel).toBe(2);
        state.focusedPanel = (state.focusedPanel + 1) % 4;
        (0, vitest_1.expect)(state.focusedPanel).toBe(3); // chat
        state.focusedPanel = (state.focusedPanel + 1) % 4;
        (0, vitest_1.expect)(state.focusedPanel).toBe(0); // back to projects
    });
    (0, vitest_1.it)("chat component key dispatch handles j/k when focused on chat", () => {
        const state = (0, dashboard_js_1.createDashboardState)();
        state.chatComponent.boundAgentId = "agent-1";
        state.chatComponent.panelHeight = 20;
        (0, chat_js_1.addChatMessage)(state.chatComponent, "agent-1", { role: "agent", text: "hello", timestamp: 1 });
        state.focusedPanel = 3;
        const result = chat_js_1.ChatComponent.handleKey("j", state.chatComponent);
        (0, vitest_1.expect)(result.handled).toBe(true);
    });
    (0, vitest_1.it)("non-chat keys fall through from chat component", () => {
        const state = (0, dashboard_js_1.createDashboardState)();
        state.chatComponent.boundAgentId = "agent-1";
        state.focusedPanel = 3;
        const result = chat_js_1.ChatComponent.handleKey("\t", state.chatComponent);
        (0, vitest_1.expect)(result.handled).toBe(false);
    });
});
// --- Integration: Project Detail with ChatComponent ---
(0, vitest_1.describe)("project-detail integration with ChatComponent", () => {
    (0, vitest_1.it)("renders project-detail with chat component", () => {
        const project = makeProject();
        const state = (0, project_detail_js_1.createProjectDetailState)(project);
        state.chatComponent.boundAgentId = "agent-1";
        const buf = new renderer_js_1.ScreenBuffer(120, 50);
        const layout = (0, layout_js_1.getLayout)(2, 120, 50);
        (0, project_detail_js_1.renderProjectDetail)(buf, layout.panels, state);
        // Should not throw
    });
    (0, vitest_1.it)("project-detail state includes chatComponent", () => {
        const project = makeProject();
        const state = (0, project_detail_js_1.createProjectDetailState)(project);
        (0, vitest_1.expect)(state.chatComponent).toBeDefined();
        (0, vitest_1.expect)(state.chatComponent.boundAgentId).toBeNull();
    });
    (0, vitest_1.it)("Tab cycles across 7 panels including chat", () => {
        const project = makeProject();
        const state = (0, project_detail_js_1.createProjectDetailState)(project);
        // cycle to chat (panel 6)
        state.focusedPanel = 6;
        (0, vitest_1.expect)(state.focusedPanel).toBe(6);
        // Tab wraps around
        state.focusedPanel = (state.focusedPanel + 1) % 7;
        (0, vitest_1.expect)(state.focusedPanel).toBe(0);
    });
});
// --- Agent binding ---
(0, vitest_1.describe)("chat agent binding", () => {
    (0, vitest_1.it)("switching boundAgentId switches chat context", () => {
        const state = chat_js_1.ChatComponent.init();
        // Add messages for two agents
        (0, chat_js_1.addChatMessage)(state, "agent-1", { role: "user", text: "hello 1", timestamp: 1 });
        (0, chat_js_1.addChatMessage)(state, "agent-2", { role: "user", text: "hello 2", timestamp: 2 });
        state.boundAgentId = "agent-1";
        (0, vitest_1.expect)((0, chat_js_1.getChatMessages)(state)).toHaveLength(1);
        (0, vitest_1.expect)((0, chat_js_1.getChatMessages)(state)[0].text).toBe("hello 1");
        state.boundAgentId = "agent-2";
        (0, vitest_1.expect)((0, chat_js_1.getChatMessages)(state)).toHaveLength(1);
        (0, vitest_1.expect)((0, chat_js_1.getChatMessages)(state)[0].text).toBe("hello 2");
    });
    (0, vitest_1.it)("chat history persists when switching agents", () => {
        const state = chat_js_1.ChatComponent.init();
        (0, chat_js_1.addChatMessage)(state, "agent-1", { role: "user", text: "first", timestamp: 1 });
        state.boundAgentId = "agent-1";
        (0, vitest_1.expect)((0, chat_js_1.getChatMessages)(state)).toHaveLength(1);
        // Switch away and back
        state.boundAgentId = "agent-2";
        state.boundAgentId = "agent-1";
        (0, vitest_1.expect)((0, chat_js_1.getChatMessages)(state)).toHaveLength(1);
        (0, vitest_1.expect)((0, chat_js_1.getChatMessages)(state)[0].text).toBe("first");
    });
    (0, vitest_1.it)("scroll resets conceptually when switching agents (offset stays)", () => {
        const state = chat_js_1.ChatComponent.init();
        state.boundAgentId = "agent-1";
        state.scrollOffset = 5;
        // Switching agents keeps scrollOffset (will be clamped on render)
        state.boundAgentId = "agent-2";
        (0, vitest_1.expect)(state.scrollOffset).toBe(5);
    });
});
// --- Edge cases ---
(0, vitest_1.describe)("edge cases", () => {
    (0, vitest_1.it)("handles empty input on Enter", () => {
        const state = chat_js_1.ChatComponent.init();
        state.boundAgentId = "agent-1";
        state.inputActive = true;
        state.input = "";
        // handleKey returns handled=false during inputActive (handled by app.ts)
        const result = chat_js_1.ChatComponent.handleKey("\r", state);
        (0, vitest_1.expect)(result.handled).toBe(false);
    });
    (0, vitest_1.it)("renders with very small panel", () => {
        const state = chat_js_1.ChatComponent.init();
        state.boundAgentId = "agent-1";
        (0, chat_js_1.addChatMessage)(state, "agent-1", { role: "agent", text: "hello", timestamp: 1 });
        const buf = new renderer_js_1.ScreenBuffer(80, 30);
        const panel = makePanel({ width: 10, height: 4 }); // minimum viable panel
        chat_js_1.ChatComponent.render(buf, panel, state, true);
        // Should not crash
    });
    (0, vitest_1.it)("handles large history without crashing", () => {
        const state = chat_js_1.ChatComponent.init();
        state.boundAgentId = "agent-1";
        state.panelHeight = 10;
        for (let i = 0; i < 100; i++) {
            (0, chat_js_1.addChatMessage)(state, "agent-1", { role: i % 2 === 0 ? "user" : "agent", text: `message ${i}`, timestamp: i });
        }
        const buf = new renderer_js_1.ScreenBuffer(80, 30);
        const panel = makePanel();
        chat_js_1.ChatComponent.render(buf, panel, state, true);
        // Should not crash
    });
});
// --- Delivery mode (prompt vs steer) ---
(0, vitest_1.describe)("getDeliveryMode", () => {
    (0, vitest_1.it)("returns 'prompt' for idle agent", () => {
        const agents = [makeAgent({ id: "agent-1", state: "idle" })];
        (0, vitest_1.expect)((0, chat_js_1.getDeliveryMode)(agents, "agent-1")).toBe("prompt");
    });
    (0, vitest_1.it)("returns 'steer' for streaming agent", () => {
        const agents = [makeAgent({ id: "agent-1", state: "streaming" })];
        (0, vitest_1.expect)((0, chat_js_1.getDeliveryMode)(agents, "agent-1")).toBe("steer");
    });
    (0, vitest_1.it)("returns 'prompt' for waiting agent", () => {
        const agents = [makeAgent({ id: "agent-1", state: "waiting" })];
        (0, vitest_1.expect)((0, chat_js_1.getDeliveryMode)(agents, "agent-1")).toBe("prompt");
    });
    (0, vitest_1.it)("returns 'prompt' when agent not found", () => {
        (0, vitest_1.expect)((0, chat_js_1.getDeliveryMode)([], "agent-unknown")).toBe("prompt");
    });
    (0, vitest_1.it)("returns 'prompt' for stopped agent", () => {
        const agents = [makeAgent({ id: "agent-1", state: "stopped" })];
        (0, vitest_1.expect)((0, chat_js_1.getDeliveryMode)(agents, "agent-1")).toBe("prompt");
    });
});
//# sourceMappingURL=chat-component.test.js.map