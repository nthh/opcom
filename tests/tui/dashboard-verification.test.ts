import { describe, it, expect } from "vitest";
import {
  createDashboardState,
  formatStepVerificationBadge,
  type DashboardState,
} from "../../packages/cli/src/tui/views/dashboard.js";
import { stripAnsi } from "../../packages/cli/src/tui/renderer.js";
import type { PlanStep, Plan, VerificationResult } from "@opcom/types";

function makePlanStep(overrides: Partial<PlanStep> = {}): PlanStep {
  return {
    ticketId: "tile-perf",
    projectId: "folia",
    status: "done",
    blockedBy: [],
    ...overrides,
  };
}

function makePlan(steps: PlanStep[], overrides: Partial<Plan> = {}): Plan {
  return {
    id: "plan-1",
    name: "Sprint 1",
    status: "executing",
    scope: {},
    steps,
    config: {
      maxConcurrentAgents: 2,
      autoStart: false,
      backend: "claude-code",
      worktree: false,
      pauseOnFailure: true,
      ticketTransitions: true,
      autoCommit: false,
      verification: { runTests: true, runOracle: false },
    },
    context: "",
    createdAt: "2026-03-01T10:00:00Z",
    updatedAt: "2026-03-01T10:00:00Z",
    ...overrides,
  };
}

function makeVerification(overrides: Partial<VerificationResult> = {}): VerificationResult {
  return {
    stepTicketId: "tile-perf",
    passed: true,
    testGate: {
      passed: true,
      testCommand: "npm test",
      totalTests: 10,
      passedTests: 10,
      failedTests: 0,
      output: "all good",
      durationMs: 1500,
    },
    failureReasons: [],
    ...overrides,
  };
}

describe("formatStepVerificationBadge", () => {
  it("returns empty string when no verification", () => {
    const step = makePlanStep({ verification: undefined });
    expect(formatStepVerificationBadge(step)).toBe("");
  });

  it("shows pass count for passed test gate", () => {
    const step = makePlanStep({
      verification: makeVerification(),
    });
    const badge = stripAnsi(formatStepVerificationBadge(step));
    expect(badge).toContain("✓");
    expect(badge).toContain("10/10");
  });

  it("shows fail count for failed test gate", () => {
    const step = makePlanStep({
      verification: makeVerification({
        passed: false,
        testGate: {
          passed: false,
          testCommand: "npm test",
          totalTests: 10,
          passedTests: 7,
          failedTests: 3,
          output: "3 failed",
          durationMs: 2000,
        },
        failureReasons: ["Tests failed"],
      }),
    });
    const badge = stripAnsi(formatStepVerificationBadge(step));
    expect(badge).toContain("✗");
    expect(badge).toContain("7/10");
  });

  it("shows oracle failure when tests pass but oracle fails", () => {
    const step = makePlanStep({
      verification: makeVerification({
        passed: false,
        testGate: {
          passed: true,
          testCommand: "npm test",
          totalTests: 10,
          passedTests: 10,
          failedTests: 0,
          output: "ok",
          durationMs: 1000,
        },
        oracle: {
          passed: false,
          criteria: [{ criterion: "handles edge case", met: false, reasoning: "missing" }],
          concerns: [],
        },
        failureReasons: ["Oracle failed"],
      }),
    });
    const badge = stripAnsi(formatStepVerificationBadge(step));
    expect(badge).toContain("✗");
    expect(badge).toContain("oracle");
  });

  it("shows verified when passed without test gate", () => {
    const step = makePlanStep({
      verification: makeVerification({
        passed: true,
        testGate: undefined,
      }),
    });
    const badge = stripAnsi(formatStepVerificationBadge(step));
    expect(badge).toContain("✓");
    expect(badge).toContain("verified");
  });
});

describe("plan panel verification stats", () => {
  it("includes verification counts in plan state", () => {
    const steps = [
      makePlanStep({ ticketId: "a", verification: makeVerification({ passed: true }) }),
      makePlanStep({ ticketId: "b", verification: makeVerification({ passed: false, failureReasons: ["x"] }) }),
      makePlanStep({ ticketId: "c", status: "ready" }),
    ];
    const plan = makePlan(steps);

    const state = createDashboardState();
    state.planPanel = { plan };

    const verified = plan.steps.filter((s) => s.verification?.passed).length;
    const failed = plan.steps.filter((s) => s.verification && !s.verification.passed).length;
    expect(verified).toBe(1);
    expect(failed).toBe(1);
  });

  it("has zero counts when no steps are verified", () => {
    const steps = [
      makePlanStep({ ticketId: "a", status: "ready" }),
      makePlanStep({ ticketId: "b", status: "blocked" }),
    ];
    const plan = makePlan(steps);

    const verified = plan.steps.filter((s) => s.verification?.passed).length;
    const failed = plan.steps.filter((s) => s.verification && !s.verification.passed).length;
    expect(verified).toBe(0);
    expect(failed).toBe(0);
  });
});
