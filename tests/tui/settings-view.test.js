"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const settings_view_js_1 = require("../../packages/cli/src/tui/views/settings-view.js");
const core_1 = require("@opcom/core");
function makeSettings(overrides = {}) {
    return { ...(0, core_1.defaultSettings)(), ...overrides };
}
// --- createSettingsViewState ---
(0, vitest_1.describe)("createSettingsViewState", () => {
    (0, vitest_1.it)("creates state with default selection at 0", () => {
        const state = (0, settings_view_js_1.createSettingsViewState)(makeSettings());
        (0, vitest_1.expect)(state.selectedIndex).toBe(0);
        (0, vitest_1.expect)(state.editMode).toBe(false);
        (0, vitest_1.expect)(state.editKey).toBeNull();
        (0, vitest_1.expect)(state.message).toBeNull();
    });
    (0, vitest_1.it)("generates display lines on creation", () => {
        const state = (0, settings_view_js_1.createSettingsViewState)(makeSettings());
        (0, vitest_1.expect)(state.displayLines.length).toBeGreaterThan(0);
    });
    (0, vitest_1.it)("includes category headers in display lines", () => {
        const state = (0, settings_view_js_1.createSettingsViewState)(makeSettings());
        const hasAgent = state.displayLines.some((l) => l.includes("Agent"));
        const hasOrch = state.displayLines.some((l) => l.includes("Orchestrator"));
        const hasNotif = state.displayLines.some((l) => l.includes("Notifications"));
        (0, vitest_1.expect)(hasAgent).toBe(true);
        (0, vitest_1.expect)(hasOrch).toBe(true);
        (0, vitest_1.expect)(hasNotif).toBe(true);
    });
    (0, vitest_1.it)("includes setting keys in display lines", () => {
        const state = (0, settings_view_js_1.createSettingsViewState)(makeSettings());
        const hasBackend = state.displayLines.some((l) => l.includes("agent.backend"));
        const hasPort = state.displayLines.some((l) => l.includes("server.port"));
        (0, vitest_1.expect)(hasBackend).toBe(true);
        (0, vitest_1.expect)(hasPort).toBe(true);
    });
});
// --- navigation ---
(0, vitest_1.describe)("navigation", () => {
    (0, vitest_1.it)("moveDown increments selectedIndex", () => {
        const state = (0, settings_view_js_1.createSettingsViewState)(makeSettings());
        (0, vitest_1.expect)(state.selectedIndex).toBe(0);
        (0, settings_view_js_1.moveDown)(state);
        (0, vitest_1.expect)(state.selectedIndex).toBe(1);
    });
    (0, vitest_1.it)("moveUp decrements selectedIndex", () => {
        const state = (0, settings_view_js_1.createSettingsViewState)(makeSettings());
        state.selectedIndex = 3;
        (0, settings_view_js_1.rebuildDisplayLines)(state);
        (0, settings_view_js_1.moveUp)(state);
        (0, vitest_1.expect)(state.selectedIndex).toBe(2);
    });
    (0, vitest_1.it)("moveUp does not go below 0", () => {
        const state = (0, settings_view_js_1.createSettingsViewState)(makeSettings());
        (0, settings_view_js_1.moveUp)(state);
        (0, vitest_1.expect)(state.selectedIndex).toBe(0);
    });
    (0, vitest_1.it)("moveDown does not exceed settingsDefs length", () => {
        const state = (0, settings_view_js_1.createSettingsViewState)(makeSettings());
        for (let i = 0; i < core_1.settingsDefs.length + 5; i++) {
            (0, settings_view_js_1.moveDown)(state);
        }
        (0, vitest_1.expect)(state.selectedIndex).toBe(core_1.settingsDefs.length - 1);
    });
    (0, vitest_1.it)("rebuilds display lines after navigation", () => {
        const state = (0, settings_view_js_1.createSettingsViewState)(makeSettings());
        const linesBefore = [...state.displayLines];
        (0, settings_view_js_1.moveDown)(state);
        // Lines should be rebuilt (cursor position changed)
        (0, vitest_1.expect)(state.displayLines).not.toEqual(linesBefore);
    });
});
// --- toggleSetting ---
(0, vitest_1.describe)("toggleSetting", () => {
    (0, vitest_1.it)("toggles a boolean setting", () => {
        const settings = makeSettings();
        const originalWorktree = settings.agent.worktree;
        const state = (0, settings_view_js_1.createSettingsViewState)(settings);
        // Move to agent.worktree (index 2)
        state.selectedIndex = core_1.settingsDefs.findIndex((d) => d.key === "agent.worktree");
        const handled = (0, settings_view_js_1.toggleSetting)(state);
        (0, vitest_1.expect)(handled).toBe(true);
        (0, vitest_1.expect)(state.settings.agent.worktree).toBe(!originalWorktree);
    });
    (0, vitest_1.it)("cycles an enum setting", () => {
        const state = (0, settings_view_js_1.createSettingsViewState)(makeSettings());
        // agent.backend is index 0 and has enum values
        state.selectedIndex = 0;
        const before = state.settings.agent.backend;
        const handled = (0, settings_view_js_1.toggleSetting)(state);
        (0, vitest_1.expect)(handled).toBe(true);
        (0, vitest_1.expect)(state.settings.agent.backend).not.toBe(before);
    });
    (0, vitest_1.it)("returns false for number settings", () => {
        const state = (0, settings_view_js_1.createSettingsViewState)(makeSettings());
        // server.port is a number setting
        state.selectedIndex = core_1.settingsDefs.findIndex((d) => d.key === "server.port");
        const handled = (0, settings_view_js_1.toggleSetting)(state);
        (0, vitest_1.expect)(handled).toBe(false);
    });
    (0, vitest_1.it)("sets a flash message on toggle", () => {
        const state = (0, settings_view_js_1.createSettingsViewState)(makeSettings());
        state.selectedIndex = core_1.settingsDefs.findIndex((d) => d.key === "agent.worktree");
        (0, settings_view_js_1.toggleSetting)(state);
        (0, vitest_1.expect)(state.message).toBeTruthy();
        (0, vitest_1.expect)(state.message).toContain("agent.worktree");
    });
});
// --- enterEditMode ---
(0, vitest_1.describe)("enterEditMode", () => {
    (0, vitest_1.it)("enters text edit mode for number settings", () => {
        const state = (0, settings_view_js_1.createSettingsViewState)(makeSettings());
        state.selectedIndex = core_1.settingsDefs.findIndex((d) => d.key === "server.port");
        (0, settings_view_js_1.enterEditMode)(state);
        (0, vitest_1.expect)(state.editMode).toBe(true);
        (0, vitest_1.expect)(state.editKey).toBe("server.port");
        (0, vitest_1.expect)(state.editText).toBe("4700"); // default port
    });
    (0, vitest_1.it)("toggles instead of entering edit mode for booleans", () => {
        const settings = makeSettings();
        const originalWorktree = settings.agent.worktree;
        const state = (0, settings_view_js_1.createSettingsViewState)(settings);
        state.selectedIndex = core_1.settingsDefs.findIndex((d) => d.key === "agent.worktree");
        (0, settings_view_js_1.enterEditMode)(state);
        // Should toggle, not enter edit mode
        (0, vitest_1.expect)(state.editMode).toBe(false);
        (0, vitest_1.expect)(state.settings.agent.worktree).toBe(!originalWorktree);
    });
});
// --- applyEdit ---
(0, vitest_1.describe)("applyEdit", () => {
    (0, vitest_1.it)("applies a valid number edit", () => {
        const state = (0, settings_view_js_1.createSettingsViewState)(makeSettings());
        state.selectedIndex = core_1.settingsDefs.findIndex((d) => d.key === "server.port");
        (0, settings_view_js_1.enterEditMode)(state);
        state.editText = "8080";
        const result = (0, settings_view_js_1.applyEdit)(state);
        (0, vitest_1.expect)(result.success).toBe(true);
        (0, vitest_1.expect)(state.settings.server.port).toBe(8080);
        (0, vitest_1.expect)(state.editMode).toBe(false);
    });
    (0, vitest_1.it)("rejects an invalid number", () => {
        const state = (0, settings_view_js_1.createSettingsViewState)(makeSettings());
        state.selectedIndex = core_1.settingsDefs.findIndex((d) => d.key === "server.port");
        (0, settings_view_js_1.enterEditMode)(state);
        state.editText = "not-a-number";
        const result = (0, settings_view_js_1.applyEdit)(state);
        (0, vitest_1.expect)(result.success).toBe(false);
        (0, vitest_1.expect)(result.error).toBeTruthy();
        // Edit mode stays active so user can correct
        (0, vitest_1.expect)(state.editMode).toBe(true);
    });
    (0, vitest_1.it)("rejects out-of-range values", () => {
        const state = (0, settings_view_js_1.createSettingsViewState)(makeSettings());
        state.selectedIndex = core_1.settingsDefs.findIndex((d) => d.key === "server.port");
        (0, settings_view_js_1.enterEditMode)(state);
        state.editText = "0"; // min is 1
        const result = (0, settings_view_js_1.applyEdit)(state);
        (0, vitest_1.expect)(result.success).toBe(false);
        (0, vitest_1.expect)(result.error).toContain(">=");
    });
    (0, vitest_1.it)("returns false when not in edit mode", () => {
        const state = (0, settings_view_js_1.createSettingsViewState)(makeSettings());
        const result = (0, settings_view_js_1.applyEdit)(state);
        (0, vitest_1.expect)(result.success).toBe(false);
    });
});
// --- cancelEdit ---
(0, vitest_1.describe)("cancelEdit", () => {
    (0, vitest_1.it)("exits edit mode without applying changes", () => {
        const state = (0, settings_view_js_1.createSettingsViewState)(makeSettings());
        state.selectedIndex = core_1.settingsDefs.findIndex((d) => d.key === "server.port");
        (0, settings_view_js_1.enterEditMode)(state);
        state.editText = "9999";
        (0, settings_view_js_1.cancelEdit)(state);
        (0, vitest_1.expect)(state.editMode).toBe(false);
        (0, vitest_1.expect)(state.editKey).toBeNull();
        (0, vitest_1.expect)(state.settings.server.port).toBe(4700); // unchanged
    });
});
// --- handleEditInput ---
(0, vitest_1.describe)("handleEditInput", () => {
    (0, vitest_1.it)("appends characters to editText", () => {
        const state = (0, settings_view_js_1.createSettingsViewState)(makeSettings());
        state.selectedIndex = core_1.settingsDefs.findIndex((d) => d.key === "server.port");
        (0, settings_view_js_1.enterEditMode)(state);
        state.editText = "";
        (0, settings_view_js_1.handleEditInput)(state, "8");
        (0, settings_view_js_1.handleEditInput)(state, "0");
        (0, settings_view_js_1.handleEditInput)(state, "8");
        (0, settings_view_js_1.handleEditInput)(state, "0");
        (0, vitest_1.expect)(state.editText).toBe("8080");
    });
    (0, vitest_1.it)("handles backspace", () => {
        const state = (0, settings_view_js_1.createSettingsViewState)(makeSettings());
        state.selectedIndex = core_1.settingsDefs.findIndex((d) => d.key === "server.port");
        (0, settings_view_js_1.enterEditMode)(state);
        state.editText = "808";
        (0, settings_view_js_1.handleEditInput)(state, "\x7f"); // backspace
        (0, vitest_1.expect)(state.editText).toBe("80");
    });
});
// --- display line content ---
(0, vitest_1.describe)("display line content", () => {
    (0, vitest_1.it)("shows current values for settings", () => {
        const settings = makeSettings();
        settings.server.port = 5500;
        const state = (0, settings_view_js_1.createSettingsViewState)(settings);
        const hasPort = state.displayLines.some((l) => l.includes("5500"));
        (0, vitest_1.expect)(hasPort).toBe(true);
    });
    (0, vitest_1.it)("marks modified values with asterisk", () => {
        const settings = makeSettings();
        settings.server.port = 9999; // non-default
        const state = (0, settings_view_js_1.createSettingsViewState)(settings);
        // The modified indicator (*) should appear in the port line
        const portLine = state.displayLines.find((l) => l.includes("server.port"));
        (0, vitest_1.expect)(portLine).toBeTruthy();
        (0, vitest_1.expect)(portLine).toContain("*");
    });
    (0, vitest_1.it)("shows cursor on selected setting", () => {
        const state = (0, settings_view_js_1.createSettingsViewState)(makeSettings());
        // The first setting should have the cursor indicator
        const hasArrow = state.displayLines.some((l) => l.includes("\u25b8")); // ▸
        (0, vitest_1.expect)(hasArrow).toBe(true);
    });
    (0, vitest_1.it)("shows editing cursor in edit mode", () => {
        const state = (0, settings_view_js_1.createSettingsViewState)(makeSettings());
        state.selectedIndex = core_1.settingsDefs.findIndex((d) => d.key === "server.port");
        (0, settings_view_js_1.enterEditMode)(state);
        const hasEditCursor = state.displayLines.some((l) => l.includes("_"));
        (0, vitest_1.expect)(hasEditCursor).toBe(true);
    });
});
//# sourceMappingURL=settings-view.test.js.map