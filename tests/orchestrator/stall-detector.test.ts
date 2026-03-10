import { describe, it, expect, beforeEach } from "vitest";
import { StallDetector } from "../../packages/core/src/orchestrator/stall-detector.js";
import type { Plan, PlanStep, StallConfig, VerificationResult } from "@opcom/types";

function makeConfig(overrides: Partial<StallConfig> = {}): StallConfig {
  return {
    enabled: true,
    agentTimeoutMs: 20 * 60 * 1000, // 20 min
    planStallTimeoutMs: 30 * 60 * 1000, // 30 min
    maxIdenticalFailures: 2,
    ...overrides,
  };
}

function makeStep(overrides: Partial<PlanStep> = {}): PlanStep {
  return {
    ticketId: "test-step",
    projectId: "test-project",
    status: "in-progress",
    blockedBy: [],
    startedAt: new Date().toISOString(),
    ...overrides,
  };
}

function makePlan(steps: PlanStep[], status: Plan["status"] = "executing"): Plan {
  return {
    id: "test-plan",
    name: "Test",
    status,
    scope: {},
    steps,
    config: {
      maxConcurrentAgents: 3,
      autoStart: false,
      backend: "claude-code",
      worktree: true,
      pauseOnFailure: true,
      ticketTransitions: true,
      autoCommit: true,
      verification: { runTests: true, runOracle: false },
      stall: makeConfig(),
    },
    context: "",
    createdAt: "2026-03-01T00:00:00Z",
    updatedAt: "2026-03-01T00:00:00Z",
  };
}

function makeVerification(overrides: Partial<VerificationResult> = {}): VerificationResult {
  return {
    stepTicketId: "test-step",
    passed: false,
    failureReasons: ["Tests failed: 3/10 failed"],
    ...overrides,
  };
}

describe("StallDetector", () => {
  let detector: StallDetector;

  beforeEach(() => {
    detector = new StallDetector(makeConfig());
  });

  describe("checkAgentStall", () => {
    it("returns null for steps under the timeout threshold", () => {
      const step = makeStep({ startedAt: new Date().toISOString() });
      expect(detector.checkAgentStall(step)).toBeNull();
    });

    it("detects an agent running past the timeout", () => {
      const pastTimeout = new Date(Date.now() - 25 * 60 * 1000).toISOString(); // 25 min ago
      const step = makeStep({ startedAt: pastTimeout, agentSessionId: "sess-1" });

      const signal = detector.checkAgentStall(step);
      expect(signal).not.toBeNull();
      expect(signal!.type).toBe("long-running");
      expect(signal!.stepId).toBe("test-step");
      expect(signal!.sessionId).toBe("sess-1");
      expect(signal!.durationMs).toBeGreaterThan(20 * 60 * 1000);
      expect(signal!.message).toContain("25m");
    });

    it("returns null for non-in-progress steps", () => {
      const step = makeStep({ status: "done", startedAt: new Date(Date.now() - 25 * 60 * 1000).toISOString() });
      expect(detector.checkAgentStall(step)).toBeNull();
    });

    it("returns null when disabled", () => {
      detector = new StallDetector(makeConfig({ enabled: false }));
      const step = makeStep({ startedAt: new Date(Date.now() - 25 * 60 * 1000).toISOString() });
      expect(detector.checkAgentStall(step)).toBeNull();
    });

    it("returns null when step has no startedAt", () => {
      const step = makeStep({ startedAt: undefined });
      expect(detector.checkAgentStall(step)).toBeNull();
    });

    it("uses custom timeout from config", () => {
      detector = new StallDetector(makeConfig({ agentTimeoutMs: 5 * 60 * 1000 })); // 5 min
      const step = makeStep({ startedAt: new Date(Date.now() - 6 * 60 * 1000).toISOString() });
      expect(detector.checkAgentStall(step)).not.toBeNull();
    });
  });

  describe("checkStepStall", () => {
    it("detects repeated identical failures", () => {
      const verification = makeVerification({ failureReasons: ["Tests failed: 3/10 failed"] });
      const step = makeStep({
        attempt: 2,
        previousVerification: verification,
        verification: makeVerification({ failureReasons: ["Tests failed: 3/10 failed"] }),
      });

      const signal = detector.checkStepStall(step);
      expect(signal).not.toBeNull();
      expect(signal!.type).toBe("repeated-failure");
      expect(signal!.message).toContain("2 times");
    });

    it("returns null when failures differ", () => {
      const step = makeStep({
        attempt: 2,
        previousVerification: makeVerification({ failureReasons: ["Tests failed: 3/10 failed"] }),
        verification: makeVerification({ failureReasons: ["Oracle: 1 criteria unmet"] }),
      });

      expect(detector.checkStepStall(step)).toBeNull();
    });

    it("returns null when previous verification passed", () => {
      const step = makeStep({
        previousVerification: makeVerification({ passed: true }),
        verification: makeVerification({ failureReasons: ["Tests failed: 3/10 failed"] }),
      });

      expect(detector.checkStepStall(step)).toBeNull();
    });

    it("returns null when current verification passed", () => {
      const step = makeStep({
        previousVerification: makeVerification({ failureReasons: ["Tests failed: 3/10 failed"] }),
        verification: makeVerification({ passed: true }),
      });

      expect(detector.checkStepStall(step)).toBeNull();
    });

    it("returns null when no previous verification", () => {
      const step = makeStep({ verification: makeVerification() });
      expect(detector.checkStepStall(step)).toBeNull();
    });

    it("returns null when disabled", () => {
      detector = new StallDetector(makeConfig({ enabled: false }));
      const step = makeStep({
        attempt: 2,
        previousVerification: makeVerification({ failureReasons: ["Tests failed"] }),
        verification: makeVerification({ failureReasons: ["Tests failed"] }),
      });
      expect(detector.checkStepStall(step)).toBeNull();
    });
  });

  describe("checkPlanStall", () => {
    it("detects plan with no step transitions for too long", () => {
      // Force lastStepTransitionAt to be way in the past
      detector.recordStepTransition();
      // @ts-expect-error — testing private field
      detector.lastStepTransitionAt = Date.now() - 35 * 60 * 1000; // 35 min ago

      const plan = makePlan([
        makeStep({ status: "in-progress" }),
      ]);

      const signal = detector.checkPlanStall(plan);
      expect(signal).not.toBeNull();
      expect(signal!.type).toBe("plan-stall");
      expect(signal!.message).toContain("35m");
    });

    it("returns null when transitions are recent", () => {
      detector.recordStepTransition(); // just now

      const plan = makePlan([
        makeStep({ status: "in-progress" }),
      ]);

      expect(detector.checkPlanStall(plan)).toBeNull();
    });

    it("returns null when plan is not executing", () => {
      // @ts-expect-error — testing private field
      detector.lastStepTransitionAt = Date.now() - 35 * 60 * 1000;

      const plan = makePlan([makeStep({ status: "in-progress" })], "paused");
      expect(detector.checkPlanStall(plan)).toBeNull();
    });

    it("returns null when no active steps", () => {
      // @ts-expect-error — testing private field
      detector.lastStepTransitionAt = Date.now() - 35 * 60 * 1000;

      const plan = makePlan([
        makeStep({ status: "ready" }),
        makeStep({ ticketId: "step-2", status: "blocked" }),
      ]);

      expect(detector.checkPlanStall(plan)).toBeNull();
    });

    it("returns null when disabled", () => {
      detector = new StallDetector(makeConfig({ enabled: false }));
      // @ts-expect-error — testing private field
      detector.lastStepTransitionAt = Date.now() - 35 * 60 * 1000;

      const plan = makePlan([makeStep({ status: "in-progress" })]);
      expect(detector.checkPlanStall(plan)).toBeNull();
    });
  });

  describe("checkAll", () => {
    it("returns all detected signals", () => {
      // @ts-expect-error — testing private field
      detector.lastStepTransitionAt = Date.now() - 35 * 60 * 1000;

      const plan = makePlan([
        makeStep({
          ticketId: "step-1",
          status: "in-progress",
          startedAt: new Date(Date.now() - 25 * 60 * 1000).toISOString(),
        }),
      ]);

      const signals = detector.checkAll(plan);
      expect(signals.length).toBe(2); // long-running + plan-stall
      expect(signals.map((s) => s.type)).toContain("long-running");
      expect(signals.map((s) => s.type)).toContain("plan-stall");
    });

    it("skips agent stall for steps with commits in worktree", () => {
      // @ts-expect-error — testing private field
      detector.lastStepTransitionAt = Date.now() - 35 * 60 * 1000;

      const plan = makePlan([
        makeStep({
          ticketId: "step-1",
          status: "in-progress",
          startedAt: new Date(Date.now() - 25 * 60 * 1000).toISOString(),
        }),
      ]);

      const stepsWithCommits = new Set(["step-1"]);
      const signals = detector.checkAll(plan, stepsWithCommits);
      // Should only have plan-stall, NOT long-running
      expect(signals.length).toBe(1);
      expect(signals[0].type).toBe("plan-stall");
    });

    it("returns empty when disabled", () => {
      detector = new StallDetector(makeConfig({ enabled: false }));
      const plan = makePlan([
        makeStep({
          status: "in-progress",
          startedAt: new Date(Date.now() - 25 * 60 * 1000).toISOString(),
        }),
      ]);
      expect(detector.checkAll(plan)).toEqual([]);
    });

    it("skips non-in-progress steps", () => {
      const plan = makePlan([
        makeStep({ status: "done" }),
        makeStep({ ticketId: "step-2", status: "ready" }),
      ]);
      expect(detector.checkAll(plan)).toEqual([]);
    });
  });

  describe("buildStallWarning", () => {
    it("generates warning for repeated identical failures", () => {
      const verification = makeVerification({
        failureReasons: ["Tests failed: 3/10 failed"],
        testGate: {
          passed: false,
          testCommand: "npm test",
          totalTests: 10,
          passedTests: 7,
          failedTests: 3,
          output: "FAIL src/test.ts\nExpected true, got false",
          durationMs: 5000,
        },
      });
      const step = makeStep({
        attempt: 3,
        previousVerification: verification,
        verification: makeVerification({
          failureReasons: ["Tests failed: 3/10 failed"],
          testGate: verification.testGate,
        }),
      });

      const warning = detector.buildStallWarning(step);
      expect(warning).not.toBeNull();
      expect(warning).toContain("Stall Warning");
      expect(warning).toContain("3 times");
      expect(warning).toContain("repeating the same mistake");
      expect(warning).toContain("fundamentally different approach");
    });

    it("returns null when failures differ", () => {
      const step = makeStep({
        previousVerification: makeVerification({ failureReasons: ["Tests failed: 3/10 failed"] }),
        verification: makeVerification({ failureReasons: ["Oracle: 1 criteria unmet"] }),
      });
      expect(detector.buildStallWarning(step)).toBeNull();
    });

    it("returns null when no previous verification", () => {
      const step = makeStep({
        verification: makeVerification(),
      });
      expect(detector.buildStallWarning(step)).toBeNull();
    });

    it("returns null when disabled", () => {
      detector = new StallDetector(makeConfig({ enabled: false }));
      const verification = makeVerification({ failureReasons: ["Tests failed"] });
      const step = makeStep({
        attempt: 2,
        previousVerification: verification,
        verification: makeVerification({ failureReasons: ["Tests failed"] }),
      });
      expect(detector.buildStallWarning(step)).toBeNull();
    });
  });

  describe("recordStepTransition", () => {
    it("resets the plan stall timer", () => {
      // @ts-expect-error — testing private field
      detector.lastStepTransitionAt = Date.now() - 35 * 60 * 1000;

      const plan = makePlan([makeStep({ status: "in-progress" })]);
      expect(detector.checkPlanStall(plan)).not.toBeNull();

      detector.recordStepTransition();
      expect(detector.checkPlanStall(plan)).toBeNull();
    });
  });
});
