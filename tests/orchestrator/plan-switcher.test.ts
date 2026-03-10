import { describe, it, expect } from "vitest";
import type { ClientCommand, ServerEvent, PlanSummary, PlanStatus } from "@opcom/types";

describe("plan switcher protocol types", () => {
  it("list_plans command is valid ClientCommand", () => {
    const cmd: ClientCommand = { type: "list_plans" };
    expect(cmd.type).toBe("list_plans");
  });

  it("list_plans command accepts statusFilter", () => {
    const cmd: ClientCommand = { type: "list_plans", statusFilter: "executing" };
    expect(cmd.type).toBe("list_plans");
    expect((cmd as { statusFilter?: PlanStatus }).statusFilter).toBe("executing");
  });

  it("plans_list event is valid ServerEvent", () => {
    const summaries: PlanSummary[] = [
      { id: "p1", name: "Plan One", status: "executing", stepsDone: 2, stepsTotal: 5, updatedAt: "2026-03-01T00:00:00Z" },
      { id: "p2", name: "Plan Two", status: "paused", stepsDone: 0, stepsTotal: 3, updatedAt: "2026-03-01T01:00:00Z" },
    ];
    const evt: ServerEvent = { type: "plans_list", plans: summaries };
    expect(evt.type).toBe("plans_list");
  });

  it("PlanSummary captures plan status correctly", () => {
    const statuses: PlanStatus[] = ["planning", "executing", "paused", "done", "failed", "cancelled"];
    for (const status of statuses) {
      const summary: PlanSummary = {
        id: `plan-${status}`,
        name: `Plan ${status}`,
        status,
        stepsDone: 0,
        stepsTotal: 1,
        updatedAt: "2026-03-01T00:00:00Z",
      };
      expect(summary.status).toBe(status);
    }
  });
});
