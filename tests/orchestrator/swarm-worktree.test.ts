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
  it("returns true for subtask steps with siblings", () => {
    const steps = [
      makeStep("parent/sub-a"),
      makeStep("parent/sub-b"),
      makeStep("parent/sub-c"),
    ];
    expect(isSwarmSubtask(steps[0], steps)).toBe(true);
    expect(isSwarmSubtask(steps[1], steps)).toBe(true);
  });

  it("returns false for regular steps (no slash)", () => {
    const steps = [makeStep("auth-setup"), makeStep("deploy")];
    expect(isSwarmSubtask(steps[0], steps)).toBe(false);
  });

  it("returns false for team steps (have teamId)", () => {
    const steps = [
      makeStep("auth/engineer", { teamId: "team-1" }),
      makeStep("auth/qa", { teamId: "team-1" }),
    ];
    expect(isSwarmSubtask(steps[0], steps)).toBe(false);
  });

  it("returns false for a slash-id step with no siblings", () => {
    const steps = [makeStep("parent/only-child"), makeStep("other-ticket")];
    expect(isSwarmSubtask(steps[0], steps)).toBe(false);
  });
});

describe("isFinalSwarmSubtask", () => {
  it("returns true when all siblings are done", () => {
    const steps = [
      makeStep("feat/types", { status: "done" }),
      makeStep("feat/api", { status: "done" }),
      makeStep("feat/tests", { status: "in-progress" }),
    ];
    expect(isFinalSwarmSubtask(steps[2], steps)).toBe(true);
  });

  it("returns false when siblings are still in-progress", () => {
    const steps = [
      makeStep("feat/types", { status: "done" }),
      makeStep("feat/api", { status: "in-progress" }),
      makeStep("feat/tests", { status: "ready" }),
    ];
    expect(isFinalSwarmSubtask(steps[2], steps)).toBe(false);
  });

  it("counts skipped siblings as complete", () => {
    const steps = [
      makeStep("feat/types", { status: "done" }),
      makeStep("feat/optional", { status: "skipped" }),
      makeStep("feat/tests", { status: "verifying" }),
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
      makeStep("feat/types", { status: "done" }),
      makeStep("feat/api", { status: "in-progress" }),
      makeStep("feat/tests", { status: "ready" }),
    ];
    const mode = getSwarmVerificationMode(steps[1], steps);
    expect(mode).toEqual({ runTests: false, runOracle: true });
  });

  it("returns full verification for final subtask", () => {
    const steps = [
      makeStep("feat/types", { status: "done" }),
      makeStep("feat/api", { status: "done" }),
      makeStep("feat/tests", { status: "in-progress" }),
    ];
    const mode = getSwarmVerificationMode(steps[2], steps);
    expect(mode).toEqual({ runTests: true, runOracle: true });
  });
});

describe("findSwarmWorktree", () => {
  it("finds worktree from a sibling step", () => {
    const steps = [
      makeStep("feat/types", {
        status: "done",
        worktreePath: "/tmp/worktree/feat",
        worktreeBranch: "work/feat",
      }),
      makeStep("feat/api", { status: "ready" }),
    ];
    const wt = findSwarmWorktree(steps[1], steps);
    expect(wt).toEqual({ worktreePath: "/tmp/worktree/feat", worktreeBranch: "work/feat" });
  });

  it("returns null when no sibling has a worktree", () => {
    const steps = [
      makeStep("feat/types", { status: "done" }),
      makeStep("feat/api", { status: "ready" }),
    ];
    expect(findSwarmWorktree(steps[1], steps)).toBeNull();
  });

  it("returns null for non-swarm steps", () => {
    const steps = [makeStep("standalone")];
    expect(findSwarmWorktree(steps[0], steps)).toBeNull();
  });

  it("does not match steps from a different parent", () => {
    const steps = [
      makeStep("feat-a/types", {
        status: "done",
        worktreePath: "/tmp/worktree/feat-a",
        worktreeBranch: "work/feat-a",
      }),
      makeStep("feat-b/api", { status: "ready" }),
    ];
    expect(findSwarmWorktree(steps[1], steps)).toBeNull();
  });
});
