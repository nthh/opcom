import { describe, it, expect } from "vitest";
import {
  sortAgents,
  getAgentSortTier,
  getPlanStepForAgent,
} from "../../packages/cli/src/tui/views/dashboard.js";
import type { AgentSession, Plan, PlanStep } from "@opcom/types";

function makeAgent(overrides: Partial<AgentSession> = {}): AgentSession {
  return {
    id: "agent-1",
    backend: "claude-code",
    projectId: "proj-1",
    state: "streaming",
    startedAt: new Date().toISOString(),
    ...overrides,
  };
}

function makePlan(steps: Partial<PlanStep>[]): Plan {
  return {
    id: "plan-1",
    name: "Test Plan",
    status: "executing",
    scope: {},
    steps: steps.map((s) => ({
      ticketId: "ticket-1",
      projectId: "proj-1",
      status: "ready",
      blockedBy: [],
      ...s,
    })),
    config: {
      maxConcurrentAgents: 2,
      autoStart: true,
      backend: "claude-code",
      worktree: false,
      pauseOnFailure: false,
      ticketTransitions: true,
      autoCommit: false,
      verification: { runTests: true, runOracle: false },
    },
    context: "",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

describe("getAgentSortTier", () => {
  it("returns 3 for stopped agents", () => {
    const agent = makeAgent({ state: "stopped" });
    expect(getAgentSortTier(agent, null)).toBe(3);
  });

  it("returns 2 for idle agents", () => {
    const agent = makeAgent({ state: "idle" });
    expect(getAgentSortTier(agent, null)).toBe(2);
  });

  it("returns 1 for active agents without a plan step", () => {
    const agent = makeAgent({ state: "streaming" });
    expect(getAgentSortTier(agent, null)).toBe(1);
  });

  it("returns 0 for plan-active agents", () => {
    const agent = makeAgent({ id: "a1", state: "streaming" });
    const plan = makePlan([{ agentSessionId: "a1", status: "in-progress" }]);
    expect(getAgentSortTier(agent, plan)).toBe(0);
  });

  it("returns 1 for active agent whose plan step is done (not in-progress)", () => {
    const agent = makeAgent({ id: "a1", state: "streaming" });
    const plan = makePlan([{ agentSessionId: "a1", status: "done" }]);
    expect(getAgentSortTier(agent, plan)).toBe(1);
  });

  it("returns 1 for waiting state without plan step", () => {
    const agent = makeAgent({ state: "waiting" });
    expect(getAgentSortTier(agent, null)).toBe(1);
  });

  it("returns 1 for error state without plan step", () => {
    const agent = makeAgent({ state: "error" });
    expect(getAgentSortTier(agent, null)).toBe(1);
  });
});

describe("getPlanStepForAgent", () => {
  it("returns undefined when no plan", () => {
    const agent = makeAgent({ id: "a1" });
    expect(getPlanStepForAgent(agent, null)).toBeUndefined();
  });

  it("returns the matching in-progress step", () => {
    const agent = makeAgent({ id: "a1" });
    const plan = makePlan([
      { ticketId: "t1", agentSessionId: "a1", status: "in-progress" },
      { ticketId: "t2", agentSessionId: "a2", status: "in-progress" },
    ]);
    const step = getPlanStepForAgent(agent, plan);
    expect(step).toBeDefined();
    expect(step!.ticketId).toBe("t1");
  });

  it("returns undefined when agent step is not in-progress", () => {
    const agent = makeAgent({ id: "a1" });
    const plan = makePlan([
      { ticketId: "t1", agentSessionId: "a1", status: "done" },
    ]);
    expect(getPlanStepForAgent(agent, plan)).toBeUndefined();
  });

  it("returns undefined when no step matches agent id", () => {
    const agent = makeAgent({ id: "a1" });
    const plan = makePlan([
      { ticketId: "t1", agentSessionId: "a-other", status: "in-progress" },
    ]);
    expect(getPlanStepForAgent(agent, plan)).toBeUndefined();
  });
});

describe("sortAgents", () => {
  it("sorts plan-active before other-active", () => {
    const planActive = makeAgent({ id: "pa", state: "streaming" });
    const otherActive = makeAgent({ id: "oa", state: "streaming" });
    const plan = makePlan([{ agentSessionId: "pa", status: "in-progress" }]);

    const sorted = sortAgents([otherActive, planActive], plan);
    expect(sorted[0].id).toBe("pa");
    expect(sorted[1].id).toBe("oa");
  });

  it("sorts other-active before idle", () => {
    const active = makeAgent({ id: "act", state: "streaming" });
    const idle = makeAgent({ id: "idl", state: "idle" });

    const sorted = sortAgents([idle, active], null);
    expect(sorted[0].id).toBe("act");
    expect(sorted[1].id).toBe("idl");
  });

  it("sorts idle before stopped", () => {
    const idle = makeAgent({ id: "idl", state: "idle" });
    const stopped = makeAgent({ id: "stp", state: "stopped" });

    const sorted = sortAgents([stopped, idle], null);
    expect(sorted[0].id).toBe("idl");
    expect(sorted[1].id).toBe("stp");
  });

  it("full four-tier sort with mixed agents", () => {
    const stopped = makeAgent({ id: "stopped-1", state: "stopped" });
    const idle = makeAgent({ id: "idle-1", state: "idle" });
    const active = makeAgent({ id: "active-1", state: "streaming" });
    const planActive = makeAgent({ id: "plan-1", state: "streaming" });
    const plan = makePlan([{ agentSessionId: "plan-1", status: "in-progress" }]);

    // Deliberately scrambled input order
    const sorted = sortAgents([stopped, active, idle, planActive], plan);
    expect(sorted.map((a) => a.id)).toEqual([
      "plan-1",    // tier 0: plan-active
      "active-1",  // tier 1: other-active
      "idle-1",    // tier 2: idle
      "stopped-1", // tier 3: stopped
    ]);
  });

  it("preserves creation order within the same tier (stable sort)", () => {
    const a1 = makeAgent({ id: "a1", state: "streaming", startedAt: "2026-01-01T00:00:00Z" });
    const a2 = makeAgent({ id: "a2", state: "streaming", startedAt: "2026-01-01T01:00:00Z" });
    const a3 = makeAgent({ id: "a3", state: "streaming", startedAt: "2026-01-01T02:00:00Z" });

    const sorted = sortAgents([a1, a2, a3], null);
    expect(sorted.map((a) => a.id)).toEqual(["a1", "a2", "a3"]);
  });

  it("handles empty agent list", () => {
    expect(sortAgents([], null)).toEqual([]);
  });

  it("handles all agents in same tier", () => {
    const a = makeAgent({ id: "a", state: "idle" });
    const b = makeAgent({ id: "b", state: "idle" });
    const sorted = sortAgents([a, b], null);
    expect(sorted.map((s) => s.id)).toEqual(["a", "b"]);
  });

  it("multiple plan-active agents sort before non-plan agents", () => {
    const pa1 = makeAgent({ id: "pa1", state: "streaming" });
    const pa2 = makeAgent({ id: "pa2", state: "waiting" });
    const other = makeAgent({ id: "other", state: "streaming" });
    const plan = makePlan([
      { agentSessionId: "pa1", status: "in-progress", ticketId: "t1" },
      { agentSessionId: "pa2", status: "in-progress", ticketId: "t2" },
    ]);

    const sorted = sortAgents([other, pa2, pa1], plan);
    expect(sorted[0].id).toBe("pa2");
    expect(sorted[1].id).toBe("pa1");
    expect(sorted[2].id).toBe("other");
  });
});
