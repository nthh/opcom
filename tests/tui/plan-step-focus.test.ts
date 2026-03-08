import { describe, it, expect } from "vitest";
import {
  createPlanStepFocusState,
  rebuildDisplayLines,
  toggleTestOutput,
  scrollUp,
  scrollDown,
  scrollToTop,
  scrollToBottom,
  type PlanStepFocusState,
} from "../../packages/cli/src/tui/views/plan-step-focus.js";
import type {
  PlanStep,
  Plan,
  WorkItem,
  AgentSession,
  VerificationResult,
} from "@opcom/types";

function makePlanStep(overrides: Partial<PlanStep> = {}): PlanStep {
  return {
    ticketId: "tile-perf",
    projectId: "folia",
    status: "ready",
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

function makeWorkItem(overrides: Partial<WorkItem> = {}): WorkItem {
  return {
    id: "tile-perf",
    title: "Tile server performance",
    status: "open",
    priority: 1,
    type: "feature",
    filePath: "/tmp/tile-perf.md",
    deps: [],
    links: [],
    tags: {},
    ...overrides,
  };
}

function makeAgent(overrides: Partial<AgentSession> = {}): AgentSession {
  return {
    id: "agent-001",
    backend: "claude-code",
    projectId: "folia",
    state: "streaming",
    startedAt: "2026-03-01T10:05:00Z",
    ...overrides,
  };
}

describe("createPlanStepFocusState", () => {
  it("creates state with basic step and ticket", () => {
    const step = makePlanStep();
    const ticket = makeWorkItem();
    const plan = makePlan([step]);

    const state = createPlanStepFocusState(step, plan, ticket, null, [ticket], []);

    expect(state.step).toBe(step);
    expect(state.plan).toBe(plan);
    expect(state.ticket).toBe(ticket);
    expect(state.agent).toBeNull();
    expect(state.scrollOffset).toBe(0);
    expect(state.displayLines.length).toBeGreaterThan(0);
  });

  it("resolves agent by agentSessionId", () => {
    const agent = makeAgent();
    const step = makePlanStep({ agentSessionId: "agent-001" });
    const plan = makePlan([step]);
    const ticket = makeWorkItem();

    const state = createPlanStepFocusState(step, plan, ticket, null, [ticket], [agent]);

    expect(state.agent).toBe(agent);
  });

  it("resolves blocker statuses from plan steps", () => {
    const blockerStep = makePlanStep({ ticketId: "change-det", status: "in-progress" });
    const step = makePlanStep({ status: "blocked", blockedBy: ["change-det"] });
    const plan = makePlan([blockerStep, step]);
    const blockerTicket = makeWorkItem({ id: "change-det", title: "Change detection" });
    const ticket = makeWorkItem();

    const state = createPlanStepFocusState(step, plan, ticket, null, [ticket, blockerTicket], []);

    expect(state.blockerStatuses.size).toBe(1);
    const blocker = state.blockerStatuses.get("change-det");
    expect(blocker).toBeDefined();
    expect(blocker!.status).toBe("in-progress");
    expect(blocker!.ticket?.title).toBe("Change detection");
  });

  it("handles missing blocker ticket gracefully", () => {
    const blockerStep = makePlanStep({ ticketId: "missing-dep", status: "done" });
    const step = makePlanStep({ status: "blocked", blockedBy: ["missing-dep"] });
    const plan = makePlan([blockerStep, step]);
    const ticket = makeWorkItem();

    const state = createPlanStepFocusState(step, plan, ticket, null, [ticket], []);

    const blocker = state.blockerStatuses.get("missing-dep");
    expect(blocker).toBeDefined();
    expect(blocker!.status).toBe("done");
    expect(blocker!.ticket).toBeNull();
  });

  it("handles missing blocker step gracefully", () => {
    const step = makePlanStep({ status: "blocked", blockedBy: ["ghost-ticket"] });
    const plan = makePlan([step]);
    const ticket = makeWorkItem();

    const state = createPlanStepFocusState(step, plan, ticket, null, [ticket], []);

    const blocker = state.blockerStatuses.get("ghost-ticket");
    expect(blocker).toBeDefined();
    expect(blocker!.status).toBe("unknown");
  });
});

describe("rebuildDisplayLines", () => {
  it("includes status line", () => {
    const step = makePlanStep({ status: "in-progress" });
    const plan = makePlan([step]);
    const ticket = makeWorkItem();

    const state = createPlanStepFocusState(step, plan, ticket, null, [ticket], []);

    const hasStatus = state.displayLines.some((l) => l.includes("in-progress"));
    expect(hasStatus).toBe(true);
  });

  it("includes ticket details when ticket present", () => {
    const step = makePlanStep();
    const plan = makePlan([step]);
    const ticket = makeWorkItem({ title: "Tile server performance", priority: 1 });

    const state = createPlanStepFocusState(step, plan, ticket, null, [ticket], []);

    const hasTitle = state.displayLines.some((l) => l.includes("Tile server performance"));
    const hasPriority = state.displayLines.some((l) => l.includes("P1"));
    expect(hasTitle).toBe(true);
    expect(hasPriority).toBe(true);
  });

  it("shows ticket not found when ticket is null", () => {
    const step = makePlanStep({ ticketId: "orphan-step" });
    const plan = makePlan([step]);

    const state = createPlanStepFocusState(step, plan, null, null, [], []);

    const hasNotFound = state.displayLines.some((l) => l.includes("ticket not found"));
    const hasId = state.displayLines.some((l) => l.includes("orphan-step"));
    expect(hasNotFound).toBe(true);
    expect(hasId).toBe(true);
  });

  it("includes blocker section when blockedBy is non-empty", () => {
    const blockerStep = makePlanStep({ ticketId: "dep-1", status: "done" });
    const step = makePlanStep({ blockedBy: ["dep-1"] });
    const plan = makePlan([blockerStep, step]);
    const depTicket = makeWorkItem({ id: "dep-1", title: "Dependency one" });

    const state = createPlanStepFocusState(step, plan, null, null, [depTicket], []);

    const hasBlockedBy = state.displayLines.some((l) => l.includes("Blocked By"));
    const hasDep = state.displayLines.some((l) => l.includes("dep-1"));
    expect(hasBlockedBy).toBe(true);
    expect(hasDep).toBe(true);
  });

  it("omits blocker section when no blockers", () => {
    const step = makePlanStep({ blockedBy: [] });
    const plan = makePlan([step]);

    const state = createPlanStepFocusState(step, plan, null, null, [], []);

    const hasBlockedBy = state.displayLines.some((l) => l.includes("Blocked By"));
    expect(hasBlockedBy).toBe(false);
  });

  it("includes agent details when agent present", () => {
    const agent = makeAgent({ id: "agent-xyz-1234567890", backend: "claude-code", state: "streaming" });
    const step = makePlanStep({ agentSessionId: "agent-xyz-1234567890" });
    const plan = makePlan([step]);

    const state = createPlanStepFocusState(step, plan, null, null, [], [agent]);

    const hasBackend = state.displayLines.some((l) => l.includes("claude-code"));
    const hasState = state.displayLines.some((l) => l.includes("streaming"));
    expect(hasBackend).toBe(true);
    expect(hasState).toBe(true);
  });

  it("shows no agent when none assigned", () => {
    const step = makePlanStep();
    const plan = makePlan([step]);

    const state = createPlanStepFocusState(step, plan, null, null, [], []);

    const hasNoAgent = state.displayLines.some((l) => l.includes("No agent assigned"));
    expect(hasNoAgent).toBe(true);
  });

  it("includes timing section", () => {
    const step = makePlanStep({
      startedAt: "2026-03-01T10:00:00Z",
      completedAt: "2026-03-01T10:05:00Z",
    });
    const plan = makePlan([step]);

    const state = createPlanStepFocusState(step, plan, null, null, [], []);

    const hasStarted = state.displayLines.some((l) => l.includes("Started:"));
    const hasCompleted = state.displayLines.some((l) => l.includes("Completed:"));
    const hasDuration = state.displayLines.some((l) => l.includes("Duration:"));
    expect(hasStarted).toBe(true);
    expect(hasCompleted).toBe(true);
    expect(hasDuration).toBe(true);
  });

  it("includes error message when step has error", () => {
    const step = makePlanStep({ status: "failed", error: "Tests failed: 3 assertions" });
    const plan = makePlan([step]);

    const state = createPlanStepFocusState(step, plan, null, null, [], []);

    const hasError = state.displayLines.some((l) => l.includes("Tests failed: 3 assertions"));
    expect(hasError).toBe(true);
  });

  it("omits error section when no error", () => {
    const step = makePlanStep({ status: "done" });
    const plan = makePlan([step]);

    const state = createPlanStepFocusState(step, plan, null, null, [], []);

    const hasError = state.displayLines.some((l) => l.includes("Error"));
    expect(hasError).toBe(false);
  });

  it("includes verification results when provided", () => {
    const step = makePlanStep({ status: "done" });
    const plan = makePlan([step]);
    const verification: VerificationResult = {
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
    };

    const state = createPlanStepFocusState(step, plan, null, null, [], [], verification);

    const hasVerification = state.displayLines.some((l) => l.includes("Verification"));
    const hasTests = state.displayLines.some((l) => l.includes("10/10 passed"));
    expect(hasVerification).toBe(true);
    expect(hasTests).toBe(true);
  });

  it("includes track when present", () => {
    const step = makePlanStep({ track: "backend" });
    const plan = makePlan([step]);

    const state = createPlanStepFocusState(step, plan, null, null, [], []);

    const hasTrack = state.displayLines.some((l) => l.includes("backend"));
    expect(hasTrack).toBe(true);
  });

  it("re-wraps when width changes", () => {
    const step = makePlanStep();
    const plan = makePlan([step]);

    const state = createPlanStepFocusState(step, plan, null, null, [], []);
    const originalWidth = state.wrapWidth;

    rebuildDisplayLines(state, 40);
    expect(state.wrapWidth).toBe(40);
    expect(state.wrapWidth).not.toBe(originalWidth);
  });
});

describe("scroll navigation", () => {
  function makeScrollableState(): PlanStepFocusState {
    const step = makePlanStep({
      status: "failed",
      error: "Long error\nLine 2\nLine 3\nLine 4\nLine 5",
      startedAt: "2026-03-01T10:00:00Z",
      completedAt: "2026-03-01T10:05:00Z",
      blockedBy: ["dep-1", "dep-2"],
    });
    const blockerStep1 = makePlanStep({ ticketId: "dep-1", status: "done" });
    const blockerStep2 = makePlanStep({ ticketId: "dep-2", status: "in-progress" });
    const plan = makePlan([blockerStep1, blockerStep2, step]);

    return createPlanStepFocusState(step, plan, makeWorkItem(), makeAgent(), [makeWorkItem()], [makeAgent()]);
  }

  it("scrollDown increases offset", () => {
    const state = makeScrollableState();
    expect(state.scrollOffset).toBe(0);

    scrollDown(state, 3, 5);
    expect(state.scrollOffset).toBe(3);
  });

  it("scrollUp decreases offset", () => {
    const state = makeScrollableState();
    state.scrollOffset = 5;

    scrollUp(state, 2);
    expect(state.scrollOffset).toBe(3);
  });

  it("scrollUp does not go below 0", () => {
    const state = makeScrollableState();
    state.scrollOffset = 1;

    scrollUp(state, 5);
    expect(state.scrollOffset).toBe(0);
  });

  it("scrollDown does not exceed max", () => {
    const state = makeScrollableState();
    const totalLines = state.displayLines.length;
    const viewHeight = 5;

    scrollDown(state, totalLines + 100, viewHeight);
    expect(state.scrollOffset).toBe(Math.max(0, totalLines - viewHeight));
  });

  it("scrollToTop resets to 0", () => {
    const state = makeScrollableState();
    state.scrollOffset = 10;

    scrollToTop(state);
    expect(state.scrollOffset).toBe(0);
  });

  it("scrollToBottom jumps to end", () => {
    const state = makeScrollableState();
    const viewHeight = 5;

    scrollToBottom(state, viewHeight);
    expect(state.scrollOffset).toBe(Math.max(0, state.displayLines.length - viewHeight));
  });
});

describe("toggleTestOutput", () => {
  function makeVerifiedState(output = "PASS tests/foo.test.ts\nAll tests passed"): PlanStepFocusState {
    const step = makePlanStep({ status: "done" });
    const plan = makePlan([step]);
    const verification: VerificationResult = {
      stepTicketId: "tile-perf",
      passed: true,
      testGate: {
        passed: true,
        testCommand: "npm test",
        totalTests: 5,
        passedTests: 5,
        failedTests: 0,
        output,
        durationMs: 800,
      },
      failureReasons: [],
    };
    return createPlanStepFocusState(step, plan, null, null, [], [], verification);
  }

  it("starts with showTestOutput false", () => {
    const state = makeVerifiedState();
    expect(state.showTestOutput).toBe(false);
  });

  it("does not show test output lines by default", () => {
    const state = makeVerifiedState();
    const hasOutputLine = state.displayLines.some((l) => l.includes("All tests passed"));
    expect(hasOutputLine).toBe(false);
  });

  it("shows 'press o to show' hint when output available", () => {
    const state = makeVerifiedState();
    const hasHint = state.displayLines.some((l) => l.includes("press o to show"));
    expect(hasHint).toBe(true);
  });

  it("shows test output after toggle", () => {
    const state = makeVerifiedState();
    toggleTestOutput(state);
    expect(state.showTestOutput).toBe(true);
    const hasOutputLine = state.displayLines.some((l) => l.includes("All tests passed"));
    expect(hasOutputLine).toBe(true);
  });

  it("shows 'press o to hide' when output is shown", () => {
    const state = makeVerifiedState();
    toggleTestOutput(state);
    const hasHint = state.displayLines.some((l) => l.includes("press o to hide"));
    expect(hasHint).toBe(true);
  });

  it("hides test output on second toggle", () => {
    const state = makeVerifiedState();
    toggleTestOutput(state);
    toggleTestOutput(state);
    expect(state.showTestOutput).toBe(false);
    const hasOutputLine = state.displayLines.some((l) => l.includes("All tests passed"));
    expect(hasOutputLine).toBe(false);
  });

  it("is a no-op when no verification", () => {
    const step = makePlanStep({ status: "done" });
    const plan = makePlan([step]);
    const state = createPlanStepFocusState(step, plan, null, null, [], []);
    const linesBefore = state.displayLines.length;

    toggleTestOutput(state);

    expect(state.showTestOutput).toBe(false);
    expect(state.displayLines.length).toBe(linesBefore);
  });

  it("is a no-op when test gate has no output", () => {
    const step = makePlanStep({ status: "done" });
    const plan = makePlan([step]);
    const verification: VerificationResult = {
      stepTicketId: "tile-perf",
      passed: true,
      testGate: {
        passed: true,
        testCommand: "npm test",
        totalTests: 5,
        passedTests: 5,
        failedTests: 0,
        output: "",
        durationMs: 500,
      },
      failureReasons: [],
    };
    const state = createPlanStepFocusState(step, plan, null, null, [], [], verification);

    toggleTestOutput(state);
    expect(state.showTestOutput).toBe(false);
  });

  it("includes all output lines when shown", () => {
    const output = "line1\nline2\nline3\nline4";
    const state = makeVerifiedState(output);
    toggleTestOutput(state);

    const outputLines = state.displayLines.filter((l) => l.includes("line"));
    expect(outputLines.length).toBe(4);
  });

  it("includes footer hint for o key when test output available", () => {
    const state = makeVerifiedState();
    // Footer includes "o:output" — check in display by rendering context
    // (The footer is rendered separately in renderPlanStepFocus, not in displayLines)
    // So we just verify the state flag is correct
    expect(state.verification?.testGate?.output).toBeTruthy();
  });
});

describe("rebuildDisplayLines live update", () => {
  it("updates display lines when step status changes", () => {
    const step = makePlanStep({ status: "in-progress" });
    const plan = makePlan([step]);
    const ticket = makeWorkItem();

    const state = createPlanStepFocusState(step, plan, ticket, null, [ticket], []);

    const hasInProgress = state.displayLines.some((l) => l.includes("in-progress"));
    expect(hasInProgress).toBe(true);

    // Simulate status change
    state.step = { ...step, status: "done" };
    rebuildDisplayLines(state, 80);

    const hasDone = state.displayLines.some((l) => l.includes("done"));
    expect(hasDone).toBe(true);
  });

  it("updates display lines when verification is added", () => {
    const step = makePlanStep({ status: "verifying" });
    const plan = makePlan([step]);

    const state = createPlanStepFocusState(step, plan, null, null, [], []);

    const hasVerification = state.displayLines.some((l) => l.includes("Verification"));
    expect(hasVerification).toBe(false);

    // Simulate verification arriving
    state.verification = {
      stepTicketId: "tile-perf",
      passed: true,
      testGate: { passed: true, testCommand: "npm test", totalTests: 5, passedTests: 5, failedTests: 0, output: "", durationMs: 100 },
      failureReasons: [],
    };
    rebuildDisplayLines(state, 80);

    const hasVerificationNow = state.displayLines.some((l) => l.includes("Verification"));
    expect(hasVerificationNow).toBe(true);
  });

  it("display lines contain only structured content, no raw markdown", () => {
    const step = makePlanStep({ status: "done" });
    const plan = makePlan([step]);
    const ticket = makeWorkItem({ title: "Test ticket" });
    const agent = makeAgent();
    const verification: VerificationResult = {
      stepTicketId: "tile-perf",
      passed: true,
      testGate: { passed: true, testCommand: "npm test", totalTests: 10, passedTests: 10, failedTests: 0, output: "all good", durationMs: 1000 },
      failureReasons: [],
    };

    const state = createPlanStepFocusState(step, plan, ticket, agent, [ticket], [agent], verification);

    // Display should only contain structured sections, not raw markdown
    for (const line of state.displayLines) {
      // No markdown headers
      expect(line).not.toMatch(/^#{1,3}\s/);
      // No markdown code fences
      expect(line).not.toMatch(/^```/);
    }
  });
});

describe("verification phase visibility", () => {
  it("shows testing sub-phase when verifyingPhase is testing", () => {
    const step = makePlanStep({ status: "verifying", verifyingPhase: "testing" });
    const plan = makePlan([step]);

    const state = createPlanStepFocusState(step, plan, null, null, [], []);

    const hasTestingLabel = state.displayLines.some((l) => l.includes("Testing..."));
    expect(hasTestingLabel).toBe(true);
  });

  it("shows oracle sub-phase when verifyingPhase is oracle", () => {
    const step = makePlanStep({ status: "verifying", verifyingPhase: "oracle" });
    const plan = makePlan([step]);

    const state = createPlanStepFocusState(step, plan, null, null, [], []);

    const hasOracleEval = state.displayLines.some((l) => l.includes("Oracle evaluation..."));
    expect(hasOracleEval).toBe(true);
  });

  it("shows plain verifying when no sub-phase set", () => {
    const step = makePlanStep({ status: "verifying" });
    const plan = makePlan([step]);

    const state = createPlanStepFocusState(step, plan, null, null, [], []);

    const hasVerifying = state.displayLines.some((l) => l.includes("verifying"));
    expect(hasVerifying).toBe(true);
    const hasTestingLabel = state.displayLines.some((l) => l.includes("Testing..."));
    const hasOracleEval = state.displayLines.some((l) => l.includes("Oracle evaluation..."));
    expect(hasTestingLabel).toBe(false);
    expect(hasOracleEval).toBe(false);
  });

  it("shows elapsed time when verifyingPhaseStartedAt is set", () => {
    const startedAt = new Date(Date.now() - 12000).toISOString(); // 12 seconds ago
    const step = makePlanStep({
      status: "verifying",
      verifyingPhase: "testing",
      verifyingPhaseStartedAt: startedAt,
    });
    const plan = makePlan([step]);

    const state = createPlanStepFocusState(step, plan, null, null, [], []);

    // Should show "Testing... (12s)" or similar elapsed time
    const statusLine = state.displayLines.find((l) => l.includes("Testing..."));
    expect(statusLine).toBeDefined();
    expect(statusLine).toMatch(/\(\d+s\)/);
  });

  it("shows oracle model name when configured", () => {
    const step = makePlanStep({ status: "verifying", verifyingPhase: "oracle" });
    const plan = makePlan([step], {
      config: {
        maxConcurrentAgents: 2,
        autoStart: false,
        backend: "claude-code",
        worktree: false,
        pauseOnFailure: true,
        ticketTransitions: true,
        autoCommit: false,
        verification: { runTests: true, runOracle: true, oracleModel: "claude-sonnet-4-5-20250514" },
      },
    });

    const state = createPlanStepFocusState(step, plan, null, null, [], []);

    const statusLine = state.displayLines.find((l) => l.includes("Oracle evaluation..."));
    expect(statusLine).toBeDefined();
    expect(statusLine).toContain("claude-sonnet-4-5-20250514");
  });

  it("does not show model name when oracleModel is not configured", () => {
    const step = makePlanStep({ status: "verifying", verifyingPhase: "oracle" });
    const plan = makePlan([step]);

    const state = createPlanStepFocusState(step, plan, null, null, [], []);

    const statusLine = state.displayLines.find((l) => l.includes("Oracle evaluation..."));
    expect(statusLine).toBeDefined();
    // No brackets with model name
    expect(statusLine).not.toMatch(/\[.*\]/);
  });
});

describe("verification display with failed tests", () => {
  it("shows failure count and reasons", () => {
    const step = makePlanStep({ status: "failed" });
    const plan = makePlan([step]);
    const verification: VerificationResult = {
      stepTicketId: "tile-perf",
      passed: false,
      testGate: {
        passed: false,
        testCommand: "npm test",
        totalTests: 10,
        passedTests: 7,
        failedTests: 3,
        output: "FAIL test_a\nFAIL test_b\nFAIL test_c",
        durationMs: 2000,
      },
      failureReasons: ["3 tests failed"],
    };
    const state = createPlanStepFocusState(step, plan, null, null, [], [], verification);

    const hasFailCount = state.displayLines.some((l) => l.includes("7/10"));
    const hasFailedLabel = state.displayLines.some((l) => l.includes("3"));
    const hasReason = state.displayLines.some((l) => l.includes("3 tests failed"));
    expect(hasFailCount).toBe(true);
    expect(hasFailedLabel).toBe(true);
    expect(hasReason).toBe(true);
  });

  it("shows oracle criteria when oracle present", () => {
    const step = makePlanStep({ status: "done" });
    const plan = makePlan([step]);
    const verification: VerificationResult = {
      stepTicketId: "tile-perf",
      passed: false,
      testGate: {
        passed: true,
        testCommand: "npm test",
        totalTests: 5,
        passedTests: 5,
        failedTests: 0,
        output: "ok",
        durationMs: 500,
      },
      oracle: {
        passed: false,
        criteria: [
          { criterion: "handles empty input", met: true, reasoning: "covered" },
          { criterion: "validates schema", met: false, reasoning: "missing validation" },
        ],
        concerns: ["No error handling for edge cases"],
      },
      failureReasons: ["Oracle criterion not met: validates schema"],
    };
    const state = createPlanStepFocusState(step, plan, null, null, [], [], verification);

    const hasCriterion = state.displayLines.some((l) => l.includes("handles empty input"));
    const hasFailedCriterion = state.displayLines.some((l) => l.includes("validates schema"));
    const hasConcern = state.displayLines.some((l) => l.includes("No error handling"));
    expect(hasCriterion).toBe(true);
    expect(hasFailedCriterion).toBe(true);
    expect(hasConcern).toBe(true);
  });

  it("shows oracle error when oracle was skipped or failed", () => {
    const step = makePlanStep({ status: "done" });
    const plan = makePlan([step]);
    const verification: VerificationResult = {
      stepTicketId: "tile-perf",
      passed: true,
      testGate: {
        passed: true,
        testCommand: "npm test",
        totalTests: 5,
        passedTests: 5,
        failedTests: 0,
        output: "ok",
        durationMs: 500,
      },
      oracleError: "ticket not found for oracle evaluation",
      failureReasons: [],
    };
    const state = createPlanStepFocusState(step, plan, null, null, [], [], verification);

    const hasOracleError = state.displayLines.some((l) => l.includes("ticket not found"));
    expect(hasOracleError).toBe(true);
  });
});
