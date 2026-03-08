import { describe, it, expect } from "vitest";
import {
  createSettingsViewState,
  rebuildDisplayLines,
  moveUp,
  moveDown,
  toggleSetting,
  enterEditMode,
  applyEdit,
  cancelEdit,
  handleEditInput,
  type SettingsViewState,
} from "../../packages/cli/src/tui/views/settings-view.js";
import { defaultSettings, settingsDefs } from "@opcom/core";
import type { OpcomSettings } from "@opcom/types";

function makeSettings(overrides: Partial<OpcomSettings> = {}): OpcomSettings {
  return { ...defaultSettings(), ...overrides };
}

// --- createSettingsViewState ---

describe("createSettingsViewState", () => {
  it("creates state with default selection at 0", () => {
    const state = createSettingsViewState(makeSettings());
    expect(state.selectedIndex).toBe(0);
    expect(state.editMode).toBe(false);
    expect(state.editKey).toBeNull();
    expect(state.message).toBeNull();
  });

  it("generates display lines on creation", () => {
    const state = createSettingsViewState(makeSettings());
    expect(state.displayLines.length).toBeGreaterThan(0);
  });

  it("includes category headers in display lines", () => {
    const state = createSettingsViewState(makeSettings());
    const hasAgent = state.displayLines.some((l) => l.includes("Agent"));
    const hasOrch = state.displayLines.some((l) => l.includes("Orchestrator"));
    const hasNotif = state.displayLines.some((l) => l.includes("Notifications"));
    expect(hasAgent).toBe(true);
    expect(hasOrch).toBe(true);
    expect(hasNotif).toBe(true);
  });

  it("includes setting keys in display lines", () => {
    const state = createSettingsViewState(makeSettings());
    const hasBackend = state.displayLines.some((l) => l.includes("agent.backend"));
    const hasPort = state.displayLines.some((l) => l.includes("server.port"));
    expect(hasBackend).toBe(true);
    expect(hasPort).toBe(true);
  });
});

// --- navigation ---

describe("navigation", () => {
  it("moveDown increments selectedIndex", () => {
    const state = createSettingsViewState(makeSettings());
    expect(state.selectedIndex).toBe(0);
    moveDown(state);
    expect(state.selectedIndex).toBe(1);
  });

  it("moveUp decrements selectedIndex", () => {
    const state = createSettingsViewState(makeSettings());
    state.selectedIndex = 3;
    rebuildDisplayLines(state);
    moveUp(state);
    expect(state.selectedIndex).toBe(2);
  });

  it("moveUp does not go below 0", () => {
    const state = createSettingsViewState(makeSettings());
    moveUp(state);
    expect(state.selectedIndex).toBe(0);
  });

  it("moveDown does not exceed settingsDefs length", () => {
    const state = createSettingsViewState(makeSettings());
    for (let i = 0; i < settingsDefs.length + 5; i++) {
      moveDown(state);
    }
    expect(state.selectedIndex).toBe(settingsDefs.length - 1);
  });

  it("rebuilds display lines after navigation", () => {
    const state = createSettingsViewState(makeSettings());
    const linesBefore = [...state.displayLines];
    moveDown(state);
    // Lines should be rebuilt (cursor position changed)
    expect(state.displayLines).not.toEqual(linesBefore);
  });
});

// --- toggleSetting ---

describe("toggleSetting", () => {
  it("toggles a boolean setting", () => {
    const settings = makeSettings();
    const originalWorktree = settings.agent.worktree;
    const state = createSettingsViewState(settings);

    // Move to agent.worktree (index 2)
    state.selectedIndex = settingsDefs.findIndex((d) => d.key === "agent.worktree");
    const handled = toggleSetting(state);

    expect(handled).toBe(true);
    expect(state.settings.agent.worktree).toBe(!originalWorktree);
  });

  it("cycles an enum setting", () => {
    const state = createSettingsViewState(makeSettings());

    // agent.backend is index 0 and has enum values
    state.selectedIndex = 0;
    const before = state.settings.agent.backend;
    const handled = toggleSetting(state);

    expect(handled).toBe(true);
    expect(state.settings.agent.backend).not.toBe(before);
  });

  it("returns false for number settings", () => {
    const state = createSettingsViewState(makeSettings());

    // server.port is a number setting
    state.selectedIndex = settingsDefs.findIndex((d) => d.key === "server.port");
    const handled = toggleSetting(state);

    expect(handled).toBe(false);
  });

  it("sets a flash message on toggle", () => {
    const state = createSettingsViewState(makeSettings());
    state.selectedIndex = settingsDefs.findIndex((d) => d.key === "agent.worktree");
    toggleSetting(state);

    expect(state.message).toBeTruthy();
    expect(state.message).toContain("agent.worktree");
  });
});

// --- enterEditMode ---

describe("enterEditMode", () => {
  it("enters text edit mode for number settings", () => {
    const state = createSettingsViewState(makeSettings());
    state.selectedIndex = settingsDefs.findIndex((d) => d.key === "server.port");
    enterEditMode(state);

    expect(state.editMode).toBe(true);
    expect(state.editKey).toBe("server.port");
    expect(state.editText).toBe("4700"); // default port
  });

  it("toggles instead of entering edit mode for booleans", () => {
    const settings = makeSettings();
    const originalWorktree = settings.agent.worktree;
    const state = createSettingsViewState(settings);
    state.selectedIndex = settingsDefs.findIndex((d) => d.key === "agent.worktree");
    enterEditMode(state);

    // Should toggle, not enter edit mode
    expect(state.editMode).toBe(false);
    expect(state.settings.agent.worktree).toBe(!originalWorktree);
  });
});

// --- applyEdit ---

describe("applyEdit", () => {
  it("applies a valid number edit", () => {
    const state = createSettingsViewState(makeSettings());
    state.selectedIndex = settingsDefs.findIndex((d) => d.key === "server.port");
    enterEditMode(state);

    state.editText = "8080";
    const result = applyEdit(state);

    expect(result.success).toBe(true);
    expect(state.settings.server.port).toBe(8080);
    expect(state.editMode).toBe(false);
  });

  it("rejects an invalid number", () => {
    const state = createSettingsViewState(makeSettings());
    state.selectedIndex = settingsDefs.findIndex((d) => d.key === "server.port");
    enterEditMode(state);

    state.editText = "not-a-number";
    const result = applyEdit(state);

    expect(result.success).toBe(false);
    expect(result.error).toBeTruthy();
    // Edit mode stays active so user can correct
    expect(state.editMode).toBe(true);
  });

  it("rejects out-of-range values", () => {
    const state = createSettingsViewState(makeSettings());
    state.selectedIndex = settingsDefs.findIndex((d) => d.key === "server.port");
    enterEditMode(state);

    state.editText = "0"; // min is 1
    const result = applyEdit(state);

    expect(result.success).toBe(false);
    expect(result.error).toContain(">=");
  });

  it("returns false when not in edit mode", () => {
    const state = createSettingsViewState(makeSettings());
    const result = applyEdit(state);
    expect(result.success).toBe(false);
  });
});

// --- cancelEdit ---

describe("cancelEdit", () => {
  it("exits edit mode without applying changes", () => {
    const state = createSettingsViewState(makeSettings());
    state.selectedIndex = settingsDefs.findIndex((d) => d.key === "server.port");
    enterEditMode(state);

    state.editText = "9999";
    cancelEdit(state);

    expect(state.editMode).toBe(false);
    expect(state.editKey).toBeNull();
    expect(state.settings.server.port).toBe(4700); // unchanged
  });
});

// --- handleEditInput ---

describe("handleEditInput", () => {
  it("appends characters to editText", () => {
    const state = createSettingsViewState(makeSettings());
    state.selectedIndex = settingsDefs.findIndex((d) => d.key === "server.port");
    enterEditMode(state);

    state.editText = "";
    handleEditInput(state, "8");
    handleEditInput(state, "0");
    handleEditInput(state, "8");
    handleEditInput(state, "0");

    expect(state.editText).toBe("8080");
  });

  it("handles backspace", () => {
    const state = createSettingsViewState(makeSettings());
    state.selectedIndex = settingsDefs.findIndex((d) => d.key === "server.port");
    enterEditMode(state);

    state.editText = "808";
    handleEditInput(state, "\x7f"); // backspace

    expect(state.editText).toBe("80");
  });
});

// --- display line content ---

describe("display line content", () => {
  it("shows current values for settings", () => {
    const settings = makeSettings();
    settings.server.port = 5500;
    const state = createSettingsViewState(settings);

    const hasPort = state.displayLines.some((l) => l.includes("5500"));
    expect(hasPort).toBe(true);
  });

  it("marks modified values with asterisk", () => {
    const settings = makeSettings();
    settings.server.port = 9999; // non-default
    const state = createSettingsViewState(settings);

    // The modified indicator (*) should appear in the port line
    const portLine = state.displayLines.find((l) => l.includes("server.port"));
    expect(portLine).toBeTruthy();
    expect(portLine).toContain("*");
  });

  it("shows cursor on selected setting", () => {
    const state = createSettingsViewState(makeSettings());
    // The first setting should have the cursor indicator
    const hasArrow = state.displayLines.some((l) => l.includes("\u25b8")); // ▸
    expect(hasArrow).toBe(true);
  });

  it("shows editing cursor in edit mode", () => {
    const state = createSettingsViewState(makeSettings());
    state.selectedIndex = settingsDefs.findIndex((d) => d.key === "server.port");
    enterEditMode(state);

    const hasEditCursor = state.displayLines.some((l) => l.includes("_"));
    expect(hasEditCursor).toBe(true);
  });
});
