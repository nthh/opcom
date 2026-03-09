import { describe, it, expect } from "vitest";
import { computePlan, recomputePlan } from "../../packages/core/src/orchestrator/planner.js";
import type { WorkItem, VerificationMode } from "@opcom/types";
import type { TicketSet } from "../../packages/core/src/orchestrator/planner.js";

function makeTicket(overrides: Partial<WorkItem> & { id: string }): WorkItem {
  return {
    title: overrides.id,
    status: "open",
    priority: 2,
    type: "feature",
    filePath: `/tickets/${overrides.id}/README.md`,
    deps: [],
    links: [],
    tags: {},
    ...overrides,
  };
}

describe("planner verification mode propagation", () => {
  it("passes verification mode from ticket to step", () => {
    const ticketSets: TicketSet[] = [{
      projectId: "p1",
      tickets: [
        makeTicket({ id: "code-task", verification: "test-gate" as VerificationMode }),
        makeTicket({ id: "confirm-task", verification: "confirmation" as VerificationMode }),
        makeTicket({ id: "fire-task", verification: "none" as VerificationMode }),
        makeTicket({ id: "default-task" }),
      ],
    }];

    const plan = computePlan(ticketSets, {}, "test-plan");

    const codeStep = plan.steps.find(s => s.ticketId === "code-task");
    expect(codeStep?.verificationMode).toBe("test-gate");

    const confirmStep = plan.steps.find(s => s.ticketId === "confirm-task");
    expect(confirmStep?.verificationMode).toBe("confirmation");

    const fireStep = plan.steps.find(s => s.ticketId === "fire-task");
    expect(fireStep?.verificationMode).toBe("none");

    const defaultStep = plan.steps.find(s => s.ticketId === "default-task");
    expect(defaultStep?.verificationMode).toBeUndefined();
  });

  it("preserves pending-confirmation as sticky status", () => {
    const ticketSets: TicketSet[] = [{
      projectId: "p1",
      tickets: [
        makeTicket({ id: "confirm-task", verification: "confirmation" as VerificationMode }),
        makeTicket({ id: "other-task" }),
      ],
    }];

    const plan = computePlan(ticketSets, {}, "test-plan");
    // Simulate step entering pending-confirmation
    plan.steps.find(s => s.ticketId === "confirm-task")!.status = "pending-confirmation";

    const recomputed = recomputePlan(plan, ticketSets);

    // pending-confirmation should be preserved as sticky
    const step = recomputed.steps.find(s => s.ticketId === "confirm-task");
    expect(step?.status).toBe("pending-confirmation");
  });
});
