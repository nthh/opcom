import { describe, it, expect } from "vitest";
import {
  createPlanStepFocusState,
  rebuildDisplayLines,
  formatTeamBadge,
} from "../../packages/cli/src/tui/views/plan-step-focus.js";
import {
  createPlanOverviewState,
  rebuildDisplayLines as rebuildOverviewLines,
} from "../../packages/cli/src/tui/views/plan-overview.js";
import {
  createTicketFocusState,
  rebuildDisplayLines as rebuildTicketLines,
  type TicketFocusState,
} from "../../packages/cli/src/tui/views/ticket-focus.js";
import type { PlanStep, Plan, WorkItem, OrchestratorConfig, TeamDefinition } from "@opcom/types";

// --- Test helpers ---

function makeStep(overrides: Partial<PlanStep> = {}): PlanStep {
  return {
    ticketId: "impl-auth",
    projectId: "opcom",
    status: "ready",
    blockedBy: [],
    ...overrides,
  };
}

function makeConfig(overrides: Partial<OrchestratorConfig> = {}): OrchestratorConfig {
  return {
    maxConcurrentAgents: 2,
    autoStart: false,
    backend: "claude-code",
    worktree: false,
    pauseOnFailure: true,
    ticketTransitions: true,
    autoCommit: false,
    verification: { runTests: true, runOracle: false },
    ...overrides,
  } as OrchestratorConfig;
}

function makePlan(steps: PlanStep[], overrides: Partial<Plan> = {}): Plan {
  return {
    id: "plan-1",
    name: "Sprint 1",
    status: "executing",
    scope: {},
    steps,
    config: makeConfig(),
    context: "",
    createdAt: "2026-03-01T10:00:00Z",
    updatedAt: "2026-03-01T10:00:00Z",
    ...overrides,
  };
}

function makeWorkItem(overrides: Partial<WorkItem> = {}): WorkItem {
  return {
    id: "impl-auth",
    title: "Implement authentication",
    status: "open",
    priority: 1,
    type: "feature",
    filePath: "/tmp/impl-auth.md",
    deps: [],
    links: [],
    tags: {},
    ...overrides,
  };
}

// --- formatTeamBadge ---

describe("formatTeamBadge", () => {
  it("returns empty string for steps without teamId", () => {
    const step = makeStep();
    const plan = makePlan([step]);
    expect(formatTeamBadge(step, plan)).toBe("");
  });

  it("returns empty string for single-step teams", () => {
    const step = makeStep({
      teamId: "solo-engineer",
      teamStepRole: "engineer",
    });
    const plan = makePlan([step]);
    expect(formatTeamBadge(step, plan)).toBe("");
  });

  it("returns badge for multi-step team first step", () => {
    const steps = [
      makeStep({ ticketId: "impl-auth/engineer", teamId: "feature-dev", teamStepRole: "engineer", status: "in-progress" }),
      makeStep({ ticketId: "impl-auth/qa", teamId: "feature-dev", teamStepRole: "qa", status: "blocked", blockedBy: ["impl-auth/engineer"] }),
      makeStep({ ticketId: "impl-auth/reviewer", teamId: "feature-dev", teamStepRole: "reviewer", status: "blocked", blockedBy: ["impl-auth/qa"] }),
    ];
    const plan = makePlan(steps);

    expect(formatTeamBadge(steps[0], plan)).toBe("[feature-dev 1/3]");
  });

  it("returns badge for multi-step team middle step", () => {
    const steps = [
      makeStep({ ticketId: "impl-auth/engineer", teamId: "feature-dev", teamStepRole: "engineer", status: "done" }),
      makeStep({ ticketId: "impl-auth/qa", teamId: "feature-dev", teamStepRole: "qa", status: "in-progress", blockedBy: ["impl-auth/engineer"] }),
      makeStep({ ticketId: "impl-auth/reviewer", teamId: "feature-dev", teamStepRole: "reviewer", status: "blocked", blockedBy: ["impl-auth/qa"] }),
    ];
    const plan = makePlan(steps);

    expect(formatTeamBadge(steps[1], plan)).toBe("[feature-dev 2/3]");
  });

  it("returns badge for multi-step team last step", () => {
    const steps = [
      makeStep({ ticketId: "impl-auth/engineer", teamId: "feature-dev", teamStepRole: "engineer", status: "done" }),
      makeStep({ ticketId: "impl-auth/qa", teamId: "feature-dev", teamStepRole: "qa", status: "done", blockedBy: ["impl-auth/engineer"] }),
      makeStep({ ticketId: "impl-auth/reviewer", teamId: "feature-dev", teamStepRole: "reviewer", status: "in-progress", blockedBy: ["impl-auth/qa"] }),
    ];
    const plan = makePlan(steps);

    expect(formatTeamBadge(steps[2], plan)).toBe("[feature-dev 3/3]");
  });

  it("does not cross-match team steps from different base tickets", () => {
    const steps = [
      makeStep({ ticketId: "auth/engineer", teamId: "feature-dev", teamStepRole: "engineer" }),
      makeStep({ ticketId: "auth/qa", teamId: "feature-dev", teamStepRole: "qa", blockedBy: ["auth/engineer"] }),
      makeStep({ ticketId: "billing/engineer", teamId: "feature-dev", teamStepRole: "engineer" }),
      makeStep({ ticketId: "billing/qa", teamId: "feature-dev", teamStepRole: "qa", blockedBy: ["billing/engineer"] }),
    ];
    const plan = makePlan(steps);

    // auth/engineer should be 1/2, not 1/4
    expect(formatTeamBadge(steps[0], plan)).toBe("[feature-dev 1/2]");
    // billing/qa should be 2/2, not 4/4
    expect(formatTeamBadge(steps[3], plan)).toBe("[feature-dev 2/2]");
  });
});

// --- Plan step focus: team section ---

describe("plan-step-focus team display", () => {
  it("shows team section for multi-step team steps", () => {
    const steps = [
      makeStep({ ticketId: "impl-auth/engineer", teamId: "feature-dev", teamStepRole: "engineer", status: "in-progress" }),
      makeStep({ ticketId: "impl-auth/qa", teamId: "feature-dev", teamStepRole: "qa", status: "blocked", blockedBy: ["impl-auth/engineer"] }),
      makeStep({ ticketId: "impl-auth/reviewer", teamId: "feature-dev", teamStepRole: "reviewer", status: "blocked", blockedBy: ["impl-auth/qa"] }),
    ];
    const plan = makePlan(steps);
    const ticket = makeWorkItem({ id: "impl-auth" });

    const state = createPlanStepFocusState(steps[0], plan, ticket, null, [ticket], []);

    const hasTeamHeader = state.displayLines.some((l) => l.includes("Team") && !l.includes("Team:"));
    const hasTeamId = state.displayLines.some((l) => l.includes("feature-dev"));
    const hasRole = state.displayLines.some((l) => l.includes("engineer"));
    const hasPipeline = state.displayLines.some((l) => l.includes("[feature-dev 1/3]"));
    expect(hasTeamId).toBe(true);
    expect(hasRole).toBe(true);
    expect(hasPipeline).toBe(true);
  });

  it("shows pipeline steps with arrows for multi-step teams", () => {
    const steps = [
      makeStep({ ticketId: "impl-auth/engineer", teamId: "feature-dev", teamStepRole: "engineer", status: "in-progress" }),
      makeStep({ ticketId: "impl-auth/qa", teamId: "feature-dev", teamStepRole: "qa", status: "blocked", blockedBy: ["impl-auth/engineer"] }),
      makeStep({ ticketId: "impl-auth/reviewer", teamId: "feature-dev", teamStepRole: "reviewer", status: "blocked", blockedBy: ["impl-auth/qa"] }),
    ];
    const plan = makePlan(steps);
    const ticket = makeWorkItem({ id: "impl-auth" });

    const state = createPlanStepFocusState(steps[1], plan, ticket, null, [ticket], []);

    // Should have pipeline with arrow separator
    const hasArrow = state.displayLines.some((l) => l.includes("\u2192"));
    expect(hasArrow).toBe(true);
    // All roles should appear
    const hasQa = state.displayLines.some((l) => l.includes("qa"));
    const hasReviewer = state.displayLines.some((l) => l.includes("reviewer"));
    expect(hasQa).toBe(true);
    expect(hasReviewer).toBe(true);
  });

  it("shows team section for single-step team (no pipeline)", () => {
    const step = makeStep({
      teamId: "solo-engineer",
      teamStepRole: "engineer",
    });
    const plan = makePlan([step]);

    const state = createPlanStepFocusState(step, plan, null, null, [], []);

    const hasTeamId = state.displayLines.some((l) => l.includes("solo-engineer"));
    const hasRole = state.displayLines.some((l) => l.includes("engineer"));
    // Should NOT have pipeline badge for single-step
    const hasPipeline = state.displayLines.some((l) => l.includes("Pipeline:"));
    expect(hasTeamId).toBe(true);
    expect(hasRole).toBe(true);
    expect(hasPipeline).toBe(false);
  });

  it("omits team section when no teamId", () => {
    const step = makeStep();
    const plan = makePlan([step]);

    const state = createPlanStepFocusState(step, plan, null, null, [], []);

    const hasTeamHeader = state.displayLines.some(
      (l) => /\bTeam\b/.test(l) && !l.includes("Ticket"),
    );
    // No dedicated "Team" bold header
    const hasTeamId = state.displayLines.some((l) => l.includes("feature-dev"));
    expect(hasTeamId).toBe(false);
  });
});

// --- Plan overview: team badge on steps ---

describe("plan-overview team badge", () => {
  it("includes team badge on multi-step team steps in tracks", () => {
    const steps = [
      makeStep({ ticketId: "impl-auth/engineer", teamId: "feature-dev", teamStepRole: "engineer", track: "auth" }),
      makeStep({ ticketId: "impl-auth/qa", teamId: "feature-dev", teamStepRole: "qa", track: "auth", blockedBy: ["impl-auth/engineer"] }),
    ];
    const plan = makePlan(steps);
    const state = createPlanOverviewState(plan);

    // Tracks view strips parent prefix: "impl-auth/engineer" → "engineer"
    const hasEngineerBadge = state.displayLines.some(
      (l) => l.includes("engineer") && l.includes("[feature-dev 1/2]"),
    );
    const hasQaBadge = state.displayLines.some(
      (l) => l.includes("qa") && l.includes("[feature-dev 2/2]"),
    );
    expect(hasEngineerBadge).toBe(true);
    expect(hasQaBadge).toBe(true);
  });

  it("does not include team badge for steps without teamId", () => {
    const steps = [
      makeStep({ ticketId: "regular-step", track: "core" }),
    ];
    const plan = makePlan(steps);
    const state = createPlanOverviewState(plan);

    // The step line should include the ticketId but not a team badge like [team N/M]
    const stepLine = state.displayLines.find((l) => l.includes("regular-step"));
    expect(stepLine).toBeDefined();
    expect(stepLine).not.toMatch(/\[\w+-?\w* \d+\/\d+\]/);
  });

  it("includes team badge in stages view", () => {
    const steps = [
      makeStep({ ticketId: "impl-auth/engineer", teamId: "feature-dev", teamStepRole: "engineer", track: "auth" }),
      makeStep({ ticketId: "impl-auth/qa", teamId: "feature-dev", teamStepRole: "qa", track: "auth", blockedBy: ["impl-auth/engineer"] }),
    ];
    // Stages section only renders when plan.stages.length > 1
    const plan = makePlan(steps, {
      stages: [
        { index: 0, name: "Stage 1", stepTicketIds: ["impl-auth/engineer", "impl-auth/qa"], status: "executing" },
        { index: 1, name: "Stage 2", stepTicketIds: [], status: "pending" },
      ],
      currentStage: 0,
    });
    const state = createPlanOverviewState(plan);

    // Stages view uses full ticketId (no prefix stripping)
    const hasEngineerBadge = state.displayLines.some(
      (l) => l.includes("impl-auth/engineer") && l.includes("[feature-dev 1/2]"),
    );
    expect(hasEngineerBadge).toBe(true);
  });
});

// --- Ticket focus: team info ---

describe("ticket-focus team display", () => {
  it("shows team info when resolvedTeam is set", () => {
    const ticket = makeWorkItem({ type: "feature", team: "feature-dev" });
    const state = createTicketFocusState(ticket, null);

    // Simulate loaded state with resolved team
    state.resolvedTeam = {
      id: "feature-dev",
      name: "Feature Development",
      steps: [
        { role: "engineer", verification: "test-gate" },
        { role: "qa", verification: "test-gate", depends_on: "engineer" },
        { role: "reviewer", verification: "none", depends_on: "qa" },
      ],
    };
    state.teamResolutionMethod = "explicit";
    state.loaded = true;

    rebuildTicketLines(state, 80);

    const hasTeamName = state.displayLines.some((l) => l.includes("Feature Development"));
    const hasExplicit = state.displayLines.some((l) => l.includes("explicit"));
    const hasPipeline = state.displayLines.some((l) => l.includes("engineer") && l.includes("\u2192") && l.includes("qa"));
    expect(hasTeamName).toBe(true);
    expect(hasExplicit).toBe(true);
    expect(hasPipeline).toBe(true);
  });

  it("shows auto-resolved team with type trigger", () => {
    const ticket = makeWorkItem({ type: "feature" });
    const state = createTicketFocusState(ticket, null);

    state.resolvedTeam = {
      id: "feature-dev",
      name: "Feature Development",
      steps: [
        { role: "engineer", verification: "test-gate" },
        { role: "qa", verification: "test-gate", depends_on: "engineer" },
      ],
    };
    state.teamResolutionMethod = "trigger";
    state.loaded = true;

    rebuildTicketLines(state, 80);

    const hasAuto = state.displayLines.some((l) => l.includes("auto: type=feature"));
    expect(hasAuto).toBe(true);
  });

  it("does not show pipeline for single-step teams", () => {
    const ticket = makeWorkItem({ type: "research" });
    const state = createTicketFocusState(ticket, null);

    state.resolvedTeam = {
      id: "research",
      name: "Research Task",
      steps: [
        { role: "researcher", verification: "output-exists" },
      ],
    };
    state.teamResolutionMethod = "trigger";
    state.loaded = true;

    rebuildTicketLines(state, 80);

    const hasTeamName = state.displayLines.some((l) => l.includes("Research Task"));
    const hasPipeline = state.displayLines.some((l) => l.includes("Pipeline:"));
    expect(hasTeamName).toBe(true);
    expect(hasPipeline).toBe(false);
  });

  it("does not show team info when no team resolved", () => {
    const ticket = makeWorkItem({ type: "chore" });
    const state = createTicketFocusState(ticket, null);
    state.loaded = true;

    rebuildTicketLines(state, 80);

    const hasTeamLine = state.displayLines.some((l) => l.includes("Team:") && !l.includes("Ticket"));
    expect(hasTeamLine).toBe(false);
  });
});
