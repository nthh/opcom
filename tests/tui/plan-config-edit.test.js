"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const plan_overview_js_1 = require("../../packages/cli/src/tui/views/plan-overview.js");
function makeConfig(overrides = {}) {
    return {
        maxConcurrentAgents: 2,
        autoStart: false,
        backend: "claude-code",
        worktree: true,
        pauseOnFailure: true,
        ticketTransitions: true,
        autoCommit: false,
        verification: { runTests: true, runOracle: false },
        ...overrides,
    };
}
function makeStep(overrides = {}) {
    return {
        ticketId: "step-1",
        projectId: "proj-a",
        status: "ready",
        blockedBy: [],
        ...overrides,
    };
}
function makePlan(overrides = {}) {
    return {
        id: "plan-abc-123",
        name: "Sprint 1",
        status: "planning",
        scope: {},
        steps: [makeStep()],
        config: makeConfig(),
        context: "",
        createdAt: "2026-03-01T10:00:00Z",
        updatedAt: "2026-03-01T10:00:00Z",
        ...overrides,
    };
}
// --- planConfigFields ---
(0, vitest_1.describe)("planConfigFields", () => {
    (0, vitest_1.it)("has entries for all editable plan config fields", () => {
        const keys = plan_overview_js_1.planConfigFields.map((f) => f.key);
        (0, vitest_1.expect)(keys).toContain("maxConcurrentAgents");
        (0, vitest_1.expect)(keys).toContain("backend");
        (0, vitest_1.expect)(keys).toContain("worktree");
        (0, vitest_1.expect)(keys).toContain("autoCommit");
        (0, vitest_1.expect)(keys).toContain("autoStart");
        (0, vitest_1.expect)(keys).toContain("pauseOnFailure");
        (0, vitest_1.expect)(keys).toContain("ticketTransitions");
        (0, vitest_1.expect)(keys).toContain("verification.runTests");
        (0, vitest_1.expect)(keys).toContain("verification.runOracle");
    });
    (0, vitest_1.it)("each field can get and set a value", () => {
        const cfg = makeConfig();
        for (const field of plan_overview_js_1.planConfigFields) {
            const value = field.get(cfg);
            (0, vitest_1.expect)(value).toBeDefined();
        }
    });
});
// --- enterEditMode / exitEditMode ---
(0, vitest_1.describe)("enterEditMode", () => {
    (0, vitest_1.it)("sets editMode to true and fieldIndex to 0", () => {
        const state = (0, plan_overview_js_1.createPlanOverviewState)(makePlan());
        (0, vitest_1.expect)(state.editMode).toBe(false);
        (0, plan_overview_js_1.enterEditMode)(state);
        (0, vitest_1.expect)(state.editMode).toBe(true);
        (0, vitest_1.expect)(state.editFieldIndex).toBe(0);
    });
    (0, vitest_1.it)("does nothing if plan is already confirmed", () => {
        const state = (0, plan_overview_js_1.createPlanOverviewState)(makePlan());
        state.confirmed = true;
        (0, plan_overview_js_1.enterEditMode)(state);
        (0, vitest_1.expect)(state.editMode).toBe(false);
    });
    (0, vitest_1.it)("does nothing if plan is cancelled", () => {
        const state = (0, plan_overview_js_1.createPlanOverviewState)(makePlan());
        state.confirmed = false;
        (0, plan_overview_js_1.enterEditMode)(state);
        (0, vitest_1.expect)(state.editMode).toBe(false);
    });
});
(0, vitest_1.describe)("exitEditMode", () => {
    (0, vitest_1.it)("sets editMode to false", () => {
        const state = (0, plan_overview_js_1.createPlanOverviewState)(makePlan());
        (0, plan_overview_js_1.enterEditMode)(state);
        (0, vitest_1.expect)(state.editMode).toBe(true);
        (0, plan_overview_js_1.exitEditMode)(state);
        (0, vitest_1.expect)(state.editMode).toBe(false);
    });
    (0, vitest_1.it)("rebuilds display lines", () => {
        const state = (0, plan_overview_js_1.createPlanOverviewState)(makePlan());
        (0, plan_overview_js_1.enterEditMode)(state);
        const editLines = [...state.displayLines];
        (0, plan_overview_js_1.exitEditMode)(state);
        // Lines should differ since edit mode shows different UI
        (0, vitest_1.expect)(state.displayLines).not.toEqual(editLines);
    });
});
// --- editMoveUp / editMoveDown ---
(0, vitest_1.describe)("edit navigation", () => {
    (0, vitest_1.it)("editMoveDown increments editFieldIndex", () => {
        const state = (0, plan_overview_js_1.createPlanOverviewState)(makePlan());
        (0, plan_overview_js_1.enterEditMode)(state);
        (0, vitest_1.expect)(state.editFieldIndex).toBe(0);
        (0, plan_overview_js_1.editMoveDown)(state);
        (0, vitest_1.expect)(state.editFieldIndex).toBe(1);
    });
    (0, vitest_1.it)("editMoveUp decrements editFieldIndex", () => {
        const state = (0, plan_overview_js_1.createPlanOverviewState)(makePlan());
        (0, plan_overview_js_1.enterEditMode)(state);
        state.editFieldIndex = 3;
        (0, plan_overview_js_1.editMoveUp)(state);
        (0, vitest_1.expect)(state.editFieldIndex).toBe(2);
    });
    (0, vitest_1.it)("editMoveUp does not go below 0", () => {
        const state = (0, plan_overview_js_1.createPlanOverviewState)(makePlan());
        (0, plan_overview_js_1.enterEditMode)(state);
        (0, plan_overview_js_1.editMoveUp)(state);
        (0, vitest_1.expect)(state.editFieldIndex).toBe(0);
    });
    (0, vitest_1.it)("editMoveDown does not exceed field count", () => {
        const state = (0, plan_overview_js_1.createPlanOverviewState)(makePlan());
        (0, plan_overview_js_1.enterEditMode)(state);
        for (let i = 0; i < plan_overview_js_1.planConfigFields.length + 5; i++) {
            (0, plan_overview_js_1.editMoveDown)(state);
        }
        (0, vitest_1.expect)(state.editFieldIndex).toBe(plan_overview_js_1.planConfigFields.length - 1);
    });
});
// --- editToggleField ---
(0, vitest_1.describe)("editToggleField", () => {
    (0, vitest_1.it)("toggles a boolean field", () => {
        const plan = makePlan({ config: makeConfig({ worktree: true }) });
        const state = (0, plan_overview_js_1.createPlanOverviewState)(plan);
        (0, plan_overview_js_1.enterEditMode)(state);
        // Navigate to worktree field
        const worktreeIdx = plan_overview_js_1.planConfigFields.findIndex((f) => f.key === "worktree");
        state.editFieldIndex = worktreeIdx;
        (0, plan_overview_js_1.editToggleField)(state);
        (0, vitest_1.expect)(state.plan.config.worktree).toBe(false);
        (0, plan_overview_js_1.editToggleField)(state);
        (0, vitest_1.expect)(state.plan.config.worktree).toBe(true);
    });
    (0, vitest_1.it)("toggles verification.runTests", () => {
        const plan = makePlan({ config: makeConfig({ verification: { runTests: true, runOracle: false } }) });
        const state = (0, plan_overview_js_1.createPlanOverviewState)(plan);
        (0, plan_overview_js_1.enterEditMode)(state);
        const testIdx = plan_overview_js_1.planConfigFields.findIndex((f) => f.key === "verification.runTests");
        state.editFieldIndex = testIdx;
        (0, plan_overview_js_1.editToggleField)(state);
        (0, vitest_1.expect)(state.plan.config.verification.runTests).toBe(false);
    });
    (0, vitest_1.it)("toggles verification.runOracle", () => {
        const plan = makePlan({ config: makeConfig({ verification: { runTests: true, runOracle: false } }) });
        const state = (0, plan_overview_js_1.createPlanOverviewState)(plan);
        (0, plan_overview_js_1.enterEditMode)(state);
        const oracleIdx = plan_overview_js_1.planConfigFields.findIndex((f) => f.key === "verification.runOracle");
        state.editFieldIndex = oracleIdx;
        (0, plan_overview_js_1.editToggleField)(state);
        (0, vitest_1.expect)(state.plan.config.verification.runOracle).toBe(true);
    });
    (0, vitest_1.it)("updates summary config reference", () => {
        const state = (0, plan_overview_js_1.createPlanOverviewState)(makePlan());
        (0, plan_overview_js_1.enterEditMode)(state);
        const worktreeIdx = plan_overview_js_1.planConfigFields.findIndex((f) => f.key === "worktree");
        state.editFieldIndex = worktreeIdx;
        const before = state.summary.config.worktree;
        (0, plan_overview_js_1.editToggleField)(state);
        (0, vitest_1.expect)(state.summary.config.worktree).toBe(!before);
    });
});
// --- editAdjustField ---
(0, vitest_1.describe)("editAdjustField", () => {
    (0, vitest_1.it)("increments a number field", () => {
        const plan = makePlan({ config: makeConfig({ maxConcurrentAgents: 2 }) });
        const state = (0, plan_overview_js_1.createPlanOverviewState)(plan);
        (0, plan_overview_js_1.enterEditMode)(state);
        // maxConcurrentAgents is index 0
        state.editFieldIndex = 0;
        (0, plan_overview_js_1.editAdjustField)(state, 1);
        (0, vitest_1.expect)(state.plan.config.maxConcurrentAgents).toBe(3);
    });
    (0, vitest_1.it)("decrements a number field", () => {
        const plan = makePlan({ config: makeConfig({ maxConcurrentAgents: 5 }) });
        const state = (0, plan_overview_js_1.createPlanOverviewState)(plan);
        (0, plan_overview_js_1.enterEditMode)(state);
        state.editFieldIndex = 0;
        (0, plan_overview_js_1.editAdjustField)(state, -1);
        (0, vitest_1.expect)(state.plan.config.maxConcurrentAgents).toBe(4);
    });
    (0, vitest_1.it)("clamps to minimum value", () => {
        const plan = makePlan({ config: makeConfig({ maxConcurrentAgents: 1 }) });
        const state = (0, plan_overview_js_1.createPlanOverviewState)(plan);
        (0, plan_overview_js_1.enterEditMode)(state);
        state.editFieldIndex = 0;
        (0, plan_overview_js_1.editAdjustField)(state, -1);
        (0, vitest_1.expect)(state.plan.config.maxConcurrentAgents).toBe(1); // min is 1
    });
    (0, vitest_1.it)("clamps to maximum value", () => {
        const plan = makePlan({ config: makeConfig({ maxConcurrentAgents: 32 }) });
        const state = (0, plan_overview_js_1.createPlanOverviewState)(plan);
        (0, plan_overview_js_1.enterEditMode)(state);
        state.editFieldIndex = 0;
        (0, plan_overview_js_1.editAdjustField)(state, 1);
        (0, vitest_1.expect)(state.plan.config.maxConcurrentAgents).toBe(32); // max is 32
    });
    (0, vitest_1.it)("does nothing for boolean fields", () => {
        const plan = makePlan({ config: makeConfig({ worktree: true }) });
        const state = (0, plan_overview_js_1.createPlanOverviewState)(plan);
        (0, plan_overview_js_1.enterEditMode)(state);
        const worktreeIdx = plan_overview_js_1.planConfigFields.findIndex((f) => f.key === "worktree");
        state.editFieldIndex = worktreeIdx;
        (0, plan_overview_js_1.editAdjustField)(state, 1);
        // Boolean fields should be unchanged by adjust
        (0, vitest_1.expect)(state.plan.config.worktree).toBe(true);
    });
});
// --- display lines in edit mode ---
(0, vitest_1.describe)("edit mode display lines", () => {
    (0, vitest_1.it)("shows 'editing' label in header when in edit mode", () => {
        const state = (0, plan_overview_js_1.createPlanOverviewState)(makePlan());
        (0, plan_overview_js_1.enterEditMode)(state);
        const hasEditing = state.displayLines.some((l) => l.includes("editing"));
        (0, vitest_1.expect)(hasEditing).toBe(true);
    });
    (0, vitest_1.it)("shows cursor marker on selected field", () => {
        const state = (0, plan_overview_js_1.createPlanOverviewState)(makePlan());
        (0, plan_overview_js_1.enterEditMode)(state);
        const hasArrow = state.displayLines.some((l) => l.includes("\u25b8")); // ▸
        (0, vitest_1.expect)(hasArrow).toBe(true);
    });
    (0, vitest_1.it)("shows all config field labels", () => {
        const state = (0, plan_overview_js_1.createPlanOverviewState)(makePlan());
        (0, plan_overview_js_1.enterEditMode)(state);
        for (const field of plan_overview_js_1.planConfigFields) {
            const hasLabel = state.displayLines.some((l) => l.includes(field.label));
            (0, vitest_1.expect)(hasLabel).toBe(true);
        }
    });
    (0, vitest_1.it)("shows e:edit config hint in non-edit mode", () => {
        const state = (0, plan_overview_js_1.createPlanOverviewState)(makePlan());
        const hasHint = state.displayLines.some((l) => l.includes("e:edit config"));
        (0, vitest_1.expect)(hasHint).toBe(true);
    });
    (0, vitest_1.it)("does not show e:edit config hint after confirmation", () => {
        const state = (0, plan_overview_js_1.createPlanOverviewState)(makePlan());
        state.confirmed = true;
        (0, plan_overview_js_1.rebuildDisplayLines)(state);
        const hasHint = state.displayLines.some((l) => l.includes("e:edit config"));
        (0, vitest_1.expect)(hasHint).toBe(false);
    });
});
// --- per-plan config changes ---
(0, vitest_1.describe)("per-plan config changes", () => {
    (0, vitest_1.it)("changes are applied to the plan config, not a global config", () => {
        const plan = makePlan({ config: makeConfig({ maxConcurrentAgents: 2, worktree: false }) });
        const originalConfig = structuredClone(plan.config);
        const state = (0, plan_overview_js_1.createPlanOverviewState)(plan);
        (0, plan_overview_js_1.enterEditMode)(state);
        // Toggle worktree
        const worktreeIdx = plan_overview_js_1.planConfigFields.findIndex((f) => f.key === "worktree");
        state.editFieldIndex = worktreeIdx;
        (0, plan_overview_js_1.editToggleField)(state);
        // Adjust agents
        state.editFieldIndex = 0;
        (0, plan_overview_js_1.editAdjustField)(state, 3);
        // The plan's config should be modified
        (0, vitest_1.expect)(state.plan.config.worktree).toBe(true);
        (0, vitest_1.expect)(state.plan.config.maxConcurrentAgents).toBe(5);
        // The original config should NOT be modified (we cloned it)
        (0, vitest_1.expect)(originalConfig.worktree).toBe(false);
        (0, vitest_1.expect)(originalConfig.maxConcurrentAgents).toBe(2);
    });
});
//# sourceMappingURL=plan-config-edit.test.js.map