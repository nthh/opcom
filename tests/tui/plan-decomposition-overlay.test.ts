import { describe, it, expect } from "vitest";
import type { Plan, DecompositionAssessment } from "@opcom/types";
import {
  createPlanOverviewState,
  rebuildDisplayLines,
} from "../../packages/cli/src/tui/views/plan-overview.js";

function makePlan(overrides: Partial<Plan> = {}): Plan {
  return {
    id: "test-plan",
    name: "Test Plan",
    status: "planning",
    scope: {},
    steps: [
      { ticketId: "cloud-r2-gcs", projectId: "proj-a", status: "ready", blockedBy: [] },
      { ticketId: "fix-button", projectId: "proj-a", status: "ready", blockedBy: [] },
    ],
    config: {
      maxConcurrentAgents: 3,
      autoStart: false,
      backend: "claude-code",
      worktree: true,
      pauseOnFailure: true,
      ticketTransitions: true,
      autoCommit: true,
      verification: { runTests: true, runOracle: false },
      stall: { enabled: true, agentTimeoutMs: 1200000, planStallTimeoutMs: 1800000, maxIdenticalFailures: 2 },
    },
    context: "",
    createdAt: "2026-03-01T00:00:00Z",
    updatedAt: "2026-03-01T00:00:00Z",
    ...overrides,
  };
}

describe("plan overview decomposition overlay", () => {
  it("shows decomposition overlay when assessments are pending", () => {
    const assessments: DecompositionAssessment[] = [
      {
        ticketId: "cloud-r2-gcs",
        needsDecomposition: true,
        reason: "Matches decomposition criteria: multiple-providers",
        criteria: ["multiple-providers"],
      },
    ];

    const state = createPlanOverviewState(makePlan(), undefined, assessments);

    expect(state.decompositionResolved).toBe(false);
    expect(state.decompositionAssessments).toHaveLength(1);

    // Display should show decomposition overlay, not plan details
    const text = state.displayLines.join("\n");
    expect(text).toContain("Decomposition Assessment");
    expect(text).toContain("1 oversized ticket(s)");
    expect(text).toContain("cloud-r2-gcs");
    expect(text).toContain("multiple-providers");
    // Should not show plan header
    expect(text).not.toContain("Plan: Test Plan");
  });

  it("shows normal plan overview when no assessments", () => {
    const state = createPlanOverviewState(makePlan());

    expect(state.decompositionResolved).toBe(true);

    const text = state.displayLines.join("\n");
    expect(text).toContain("Plan: Test Plan");
    expect(text).not.toContain("Decomposition Assessment");
  });

  it("shows normal plan overview when assessments are empty", () => {
    const state = createPlanOverviewState(makePlan(), undefined, []);

    expect(state.decompositionResolved).toBe(true);

    const text = state.displayLines.join("\n");
    expect(text).toContain("Plan: Test Plan");
    expect(text).not.toContain("Decomposition Assessment");
  });

  it("resolving decomposition shows normal plan overview", () => {
    const assessments: DecompositionAssessment[] = [
      {
        ticketId: "cloud-r2-gcs",
        needsDecomposition: true,
        reason: "Multiple providers",
        criteria: ["multiple-providers"],
      },
    ];

    const state = createPlanOverviewState(makePlan(), undefined, assessments);
    expect(state.decompositionResolved).toBe(false);

    // Simulate pressing 's' (skip) — resolves the overlay
    state.decompositionResolved = true;
    rebuildDisplayLines(state, 80);

    const text = state.displayLines.join("\n");
    expect(text).toContain("Plan: Test Plan");
    expect(text).not.toContain("Decomposition Assessment");
  });

  it("shows prompt keys in overlay", () => {
    const assessments: DecompositionAssessment[] = [
      {
        ticketId: "big-ticket",
        needsDecomposition: true,
        reason: "Too complex",
        criteria: ["complex-spec"],
      },
    ];

    const state = createPlanOverviewState(makePlan(), undefined, assessments);
    const text = state.displayLines.join("\n");
    expect(text).toContain("d");
    expect(text).toContain("decompose");
    expect(text).toContain("s");
    expect(text).toContain("skip");
  });

  it("shows multiple flagged tickets in overlay", () => {
    const assessments: DecompositionAssessment[] = [
      {
        ticketId: "ticket-a",
        needsDecomposition: true,
        reason: "Multiple providers",
        criteria: ["multiple-providers"],
      },
      {
        ticketId: "ticket-b",
        needsDecomposition: true,
        reason: "TUI plus backend",
        criteria: ["tui-plus-backend"],
      },
    ];

    const state = createPlanOverviewState(makePlan(), undefined, assessments);

    const text = state.displayLines.join("\n");
    expect(text).toContain("2 oversized ticket(s)");
    expect(text).toContain("ticket-a");
    expect(text).toContain("ticket-b");
    expect(text).toContain("Multiple providers");
    expect(text).toContain("TUI plus backend");
  });
});
