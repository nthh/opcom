import { describe, it, expect } from "vitest";
import {
  isSwarmSubtask,
  isFinalSwarmSubtask,
  getSwarmVerificationMode,
  findSwarmWorktree,
} from "../../packages/core/src/orchestrator/executor.js";
import type { PlanStep } from "@opcom/types";

function makeStep(ticketId: string, overrides?: Partial<PlanStep>): PlanStep {
  return {
    ticketId,
    projectId: "proj",
    status: "ready" as const,
    blockedBy: [],
    ...overrides,
  };
}

describe("isSwarmSubtask", () => {
  it("returns true for steps with swarm flag", () => {
    const steps = [
      makeStep("parent/sub-a", { swarm: true }),
      makeStep("parent/sub-b", { swarm: true }),
      makeStep("parent/sub-c", { swarm: true }),
    ];
    expect(isSwarmSubtask(steps[0], steps)).toBe(true);
    expect(isSwarmSubtask(steps[1], steps)).toBe(true);
  });

  it("returns false for regular steps (no swarm flag)", () => {
    const steps = [makeStep("auth-setup"), makeStep("deploy")];
    expect(isSwarmSubtask(steps[0], steps)).toBe(false);
  });

  it("returns false for parent/child steps without swarm flag", () => {
    const steps = [
      makeStep("product-flywheel/phase-0"),
      makeStep("product-flywheel/phase-1"),
      makeStep("product-flywheel/phase-2"),
    ];
    expect(isSwarmSubtask(steps[0], steps)).toBe(false);
    expect(isSwarmSubtask(steps[1], steps)).toBe(false);
  });

  it("returns false for team steps even with slash", () => {
    const steps = [
      makeStep("auth/engineer", { teamId: "team-1" }),
      makeStep("auth/qa", { teamId: "team-1" }),
    ];
    expect(isSwarmSubtask(steps[0], steps)).toBe(false);
  });
});

describe("isFinalSwarmSubtask", () => {
  it("returns true when all siblings are done", () => {
    const steps = [
      makeStep("feat/types", { status: "done", swarm: true }),
      makeStep("feat/api", { status: "done", swarm: true }),
      makeStep("feat/tests", { status: "in-progress", swarm: true }),
    ];
    expect(isFinalSwarmSubtask(steps[2], steps)).toBe(true);
  });

  it("returns false when siblings are still in-progress", () => {
    const steps = [
      makeStep("feat/types", { status: "done", swarm: true }),
      makeStep("feat/api", { status: "in-progress", swarm: true }),
      makeStep("feat/tests", { status: "ready", swarm: true }),
    ];
    expect(isFinalSwarmSubtask(steps[2], steps)).toBe(false);
  });

  it("counts skipped siblings as complete", () => {
    const steps = [
      makeStep("feat/types", { status: "done", swarm: true }),
      makeStep("feat/optional", { status: "skipped", swarm: true }),
      makeStep("feat/tests", { status: "verifying", swarm: true }),
    ];
    expect(isFinalSwarmSubtask(steps[2], steps)).toBe(true);
  });

  it("returns false for non-swarm steps", () => {
    const steps = [makeStep("standalone")];
    expect(isFinalSwarmSubtask(steps[0], steps)).toBe(false);
  });
});

describe("getSwarmVerificationMode", () => {
  it("returns undefined for non-swarm steps", () => {
    const steps = [makeStep("auth-setup")];
    expect(getSwarmVerificationMode(steps[0], steps)).toBeUndefined();
  });

  it("returns oracle-only for intermediate subtasks", () => {
    const steps = [
      makeStep("feat/types", { status: "done", swarm: true }),
      makeStep("feat/api", { status: "in-progress", swarm: true }),
      makeStep("feat/tests", { status: "ready", swarm: true }),
    ];
    const mode = getSwarmVerificationMode(steps[1], steps);
    expect(mode).toEqual({ runTests: false, runOracle: true });
  });

  it("returns full verification for final subtask", () => {
    const steps = [
      makeStep("feat/types", { status: "done", swarm: true }),
      makeStep("feat/api", { status: "done", swarm: true }),
      makeStep("feat/tests", { status: "in-progress", swarm: true }),
    ];
    const mode = getSwarmVerificationMode(steps[2], steps);
    expect(mode).toEqual({ runTests: true, runOracle: true });
  });

  it("returns undefined for parent/child steps (not swarm)", () => {
    const steps = [
      makeStep("product-flywheel/phase-0", { status: "done" }),
      makeStep("product-flywheel/phase-1", { status: "in-progress" }),
    ];
    expect(getSwarmVerificationMode(steps[1], steps)).toBeUndefined();
  });
});

describe("findSwarmWorktree", () => {
  it("finds worktree from a sibling step", () => {
    const steps = [
      makeStep("feat/types", {
        status: "done",
        swarm: true,
        worktreePath: "/tmp/worktree/feat",
        worktreeBranch: "work/feat",
      }),
      makeStep("feat/api", { status: "ready", swarm: true }),
    ];
    const wt = findSwarmWorktree(steps[1], steps);
    expect(wt).toEqual({ worktreePath: "/tmp/worktree/feat", worktreeBranch: "work/feat" });
  });

  it("returns null when no sibling has a worktree", () => {
    const steps = [
      makeStep("feat/types", { status: "done", swarm: true }),
      makeStep("feat/api", { status: "ready", swarm: true }),
    ];
    expect(findSwarmWorktree(steps[1], steps)).toBeNull();
  });

  it("returns null for non-swarm steps", () => {
    const steps = [makeStep("standalone")];
    expect(findSwarmWorktree(steps[0], steps)).toBeNull();
  });

  it("returns null for parent/child steps (not swarm)", () => {
    const steps = [
      makeStep("product-flywheel/phase-0", {
        status: "done",
        worktreePath: "/tmp/worktree/pf",
        worktreeBranch: "work/pf",
      }),
      makeStep("product-flywheel/phase-1", { status: "ready" }),
    ];
    expect(findSwarmWorktree(steps[1], steps)).toBeNull();
  });
});
