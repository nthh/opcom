import { describe, it, expect } from "vitest";
import {
  createPlanOverviewState,
  enterEditMode,
  exitEditMode,
  editMoveUp,
  editMoveDown,
  editToggleField,
  editAdjustField,
  planConfigFields,
  rebuildDisplayLines,
  type PlanOverviewState,
} from "../../packages/cli/src/tui/views/plan-overview.js";
import type { Plan, PlanStep, OrchestratorConfig } from "@opcom/types";

function makeConfig(overrides: Partial<OrchestratorConfig> = {}): OrchestratorConfig {
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

function makeStep(overrides: Partial<PlanStep> = {}): PlanStep {
  return {
    ticketId: "step-1",
    projectId: "proj-a",
    status: "ready",
    blockedBy: [],
    ...overrides,
  };
}

function makePlan(overrides: Partial<Plan> = {}): Plan {
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

describe("planConfigFields", () => {
  it("has entries for all editable plan config fields", () => {
    const keys = planConfigFields.map((f) => f.key);
    expect(keys).toContain("maxConcurrentAgents");
    expect(keys).toContain("backend");
    expect(keys).toContain("worktree");
    expect(keys).toContain("autoCommit");
    expect(keys).toContain("autoStart");
    expect(keys).toContain("pauseOnFailure");
    expect(keys).toContain("ticketTransitions");
    expect(keys).toContain("verification.runTests");
    expect(keys).toContain("verification.runOracle");
  });

  it("each field can get and set a value", () => {
    const cfg = makeConfig();
    for (const field of planConfigFields) {
      const value = field.get(cfg);
      expect(value).toBeDefined();
    }
  });
});

// --- enterEditMode / exitEditMode ---

describe("enterEditMode", () => {
  it("sets editMode to true and fieldIndex to 0", () => {
    const state = createPlanOverviewState(makePlan());
    expect(state.editMode).toBe(false);

    enterEditMode(state);
    expect(state.editMode).toBe(true);
    expect(state.editFieldIndex).toBe(0);
  });

  it("does nothing if plan is already confirmed", () => {
    const state = createPlanOverviewState(makePlan());
    state.confirmed = true;
    enterEditMode(state);
    expect(state.editMode).toBe(false);
  });

  it("does nothing if plan is cancelled", () => {
    const state = createPlanOverviewState(makePlan());
    state.confirmed = false;
    enterEditMode(state);
    expect(state.editMode).toBe(false);
  });
});

describe("exitEditMode", () => {
  it("sets editMode to false", () => {
    const state = createPlanOverviewState(makePlan());
    enterEditMode(state);
    expect(state.editMode).toBe(true);

    exitEditMode(state);
    expect(state.editMode).toBe(false);
  });

  it("rebuilds display lines", () => {
    const state = createPlanOverviewState(makePlan());
    enterEditMode(state);
    const editLines = [...state.displayLines];

    exitEditMode(state);
    // Lines should differ since edit mode shows different UI
    expect(state.displayLines).not.toEqual(editLines);
  });
});

// --- editMoveUp / editMoveDown ---

describe("edit navigation", () => {
  it("editMoveDown increments editFieldIndex", () => {
    const state = createPlanOverviewState(makePlan());
    enterEditMode(state);
    expect(state.editFieldIndex).toBe(0);

    editMoveDown(state);
    expect(state.editFieldIndex).toBe(1);
  });

  it("editMoveUp decrements editFieldIndex", () => {
    const state = createPlanOverviewState(makePlan());
    enterEditMode(state);
    state.editFieldIndex = 3;

    editMoveUp(state);
    expect(state.editFieldIndex).toBe(2);
  });

  it("editMoveUp does not go below 0", () => {
    const state = createPlanOverviewState(makePlan());
    enterEditMode(state);

    editMoveUp(state);
    expect(state.editFieldIndex).toBe(0);
  });

  it("editMoveDown does not exceed field count", () => {
    const state = createPlanOverviewState(makePlan());
    enterEditMode(state);

    for (let i = 0; i < planConfigFields.length + 5; i++) {
      editMoveDown(state);
    }
    expect(state.editFieldIndex).toBe(planConfigFields.length - 1);
  });
});

// --- editToggleField ---

describe("editToggleField", () => {
  it("toggles a boolean field", () => {
    const plan = makePlan({ config: makeConfig({ worktree: true }) });
    const state = createPlanOverviewState(plan);
    enterEditMode(state);

    // Navigate to worktree field
    const worktreeIdx = planConfigFields.findIndex((f) => f.key === "worktree");
    state.editFieldIndex = worktreeIdx;

    editToggleField(state);
    expect(state.plan.config.worktree).toBe(false);

    editToggleField(state);
    expect(state.plan.config.worktree).toBe(true);
  });

  it("toggles verification.runTests", () => {
    const plan = makePlan({ config: makeConfig({ verification: { runTests: true, runOracle: false } }) });
    const state = createPlanOverviewState(plan);
    enterEditMode(state);

    const testIdx = planConfigFields.findIndex((f) => f.key === "verification.runTests");
    state.editFieldIndex = testIdx;

    editToggleField(state);
    expect(state.plan.config.verification.runTests).toBe(false);
  });

  it("toggles verification.runOracle", () => {
    const plan = makePlan({ config: makeConfig({ verification: { runTests: true, runOracle: false } }) });
    const state = createPlanOverviewState(plan);
    enterEditMode(state);

    const oracleIdx = planConfigFields.findIndex((f) => f.key === "verification.runOracle");
    state.editFieldIndex = oracleIdx;

    editToggleField(state);
    expect(state.plan.config.verification.runOracle).toBe(true);
  });

  it("updates summary config reference", () => {
    const state = createPlanOverviewState(makePlan());
    enterEditMode(state);

    const worktreeIdx = planConfigFields.findIndex((f) => f.key === "worktree");
    state.editFieldIndex = worktreeIdx;
    const before = state.summary.config.worktree;
    editToggleField(state);

    expect(state.summary.config.worktree).toBe(!before);
  });
});

// --- editAdjustField ---

describe("editAdjustField", () => {
  it("increments a number field", () => {
    const plan = makePlan({ config: makeConfig({ maxConcurrentAgents: 2 }) });
    const state = createPlanOverviewState(plan);
    enterEditMode(state);

    // maxConcurrentAgents is index 0
    state.editFieldIndex = 0;
    editAdjustField(state, 1);

    expect(state.plan.config.maxConcurrentAgents).toBe(3);
  });

  it("decrements a number field", () => {
    const plan = makePlan({ config: makeConfig({ maxConcurrentAgents: 5 }) });
    const state = createPlanOverviewState(plan);
    enterEditMode(state);

    state.editFieldIndex = 0;
    editAdjustField(state, -1);

    expect(state.plan.config.maxConcurrentAgents).toBe(4);
  });

  it("clamps to minimum value", () => {
    const plan = makePlan({ config: makeConfig({ maxConcurrentAgents: 1 }) });
    const state = createPlanOverviewState(plan);
    enterEditMode(state);

    state.editFieldIndex = 0;
    editAdjustField(state, -1);

    expect(state.plan.config.maxConcurrentAgents).toBe(1); // min is 1
  });

  it("clamps to maximum value", () => {
    const plan = makePlan({ config: makeConfig({ maxConcurrentAgents: 32 }) });
    const state = createPlanOverviewState(plan);
    enterEditMode(state);

    state.editFieldIndex = 0;
    editAdjustField(state, 1);

    expect(state.plan.config.maxConcurrentAgents).toBe(32); // max is 32
  });

  it("does nothing for boolean fields", () => {
    const plan = makePlan({ config: makeConfig({ worktree: true }) });
    const state = createPlanOverviewState(plan);
    enterEditMode(state);

    const worktreeIdx = planConfigFields.findIndex((f) => f.key === "worktree");
    state.editFieldIndex = worktreeIdx;
    editAdjustField(state, 1);

    // Boolean fields should be unchanged by adjust
    expect(state.plan.config.worktree).toBe(true);
  });
});

// --- display lines in edit mode ---

describe("edit mode display lines", () => {
  it("shows 'editing' label in header when in edit mode", () => {
    const state = createPlanOverviewState(makePlan());
    enterEditMode(state);

    const hasEditing = state.displayLines.some((l) => l.includes("editing"));
    expect(hasEditing).toBe(true);
  });

  it("shows cursor marker on selected field", () => {
    const state = createPlanOverviewState(makePlan());
    enterEditMode(state);

    const hasArrow = state.displayLines.some((l) => l.includes("\u25b8")); // ▸
    expect(hasArrow).toBe(true);
  });

  it("shows all config field labels", () => {
    const state = createPlanOverviewState(makePlan());
    enterEditMode(state);

    for (const field of planConfigFields) {
      const hasLabel = state.displayLines.some((l) => l.includes(field.label));
      expect(hasLabel).toBe(true);
    }
  });

  it("shows e:edit config hint in non-edit mode", () => {
    const state = createPlanOverviewState(makePlan());
    const hasHint = state.displayLines.some((l) => l.includes("e:edit config"));
    expect(hasHint).toBe(true);
  });

  it("does not show e:edit config hint after confirmation", () => {
    const state = createPlanOverviewState(makePlan());
    state.confirmed = true;
    rebuildDisplayLines(state);
    const hasHint = state.displayLines.some((l) => l.includes("e:edit config"));
    expect(hasHint).toBe(false);
  });
});

// --- per-plan config changes ---

describe("per-plan config changes", () => {
  it("changes are applied to the plan config, not a global config", () => {
    const plan = makePlan({ config: makeConfig({ maxConcurrentAgents: 2, worktree: false }) });
    const originalConfig = structuredClone(plan.config);
    const state = createPlanOverviewState(plan);

    enterEditMode(state);

    // Toggle worktree
    const worktreeIdx = planConfigFields.findIndex((f) => f.key === "worktree");
    state.editFieldIndex = worktreeIdx;
    editToggleField(state);

    // Adjust agents
    state.editFieldIndex = 0;
    editAdjustField(state, 3);

    // The plan's config should be modified
    expect(state.plan.config.worktree).toBe(true);
    expect(state.plan.config.maxConcurrentAgents).toBe(5);

    // The original config should NOT be modified (we cloned it)
    expect(originalConfig.worktree).toBe(false);
    expect(originalConfig.maxConcurrentAgents).toBe(2);
  });
});
