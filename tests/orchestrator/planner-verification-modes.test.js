"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const planner_js_1 = require("../../packages/core/src/orchestrator/planner.js");
function makeTicket(overrides) {
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
(0, vitest_1.describe)("planner verification mode propagation", () => {
    (0, vitest_1.it)("passes verification mode from ticket to step", () => {
        const ticketSets = [{
                projectId: "p1",
                tickets: [
                    makeTicket({ id: "code-task", verification: "test-gate" }),
                    makeTicket({ id: "confirm-task", verification: "confirmation" }),
                    makeTicket({ id: "fire-task", verification: "none" }),
                    makeTicket({ id: "default-task" }),
                ],
            }];
        const plan = (0, planner_js_1.computePlan)(ticketSets, {}, "test-plan");
        const codeStep = plan.steps.find(s => s.ticketId === "code-task");
        (0, vitest_1.expect)(codeStep?.verificationMode).toBe("test-gate");
        const confirmStep = plan.steps.find(s => s.ticketId === "confirm-task");
        (0, vitest_1.expect)(confirmStep?.verificationMode).toBe("confirmation");
        const fireStep = plan.steps.find(s => s.ticketId === "fire-task");
        (0, vitest_1.expect)(fireStep?.verificationMode).toBe("none");
        const defaultStep = plan.steps.find(s => s.ticketId === "default-task");
        (0, vitest_1.expect)(defaultStep?.verificationMode).toBeUndefined();
    });
    (0, vitest_1.it)("preserves pending-confirmation as sticky status", () => {
        const ticketSets = [{
                projectId: "p1",
                tickets: [
                    makeTicket({ id: "confirm-task", verification: "confirmation" }),
                    makeTicket({ id: "other-task" }),
                ],
            }];
        const plan = (0, planner_js_1.computePlan)(ticketSets, {}, "test-plan");
        // Simulate step entering pending-confirmation
        plan.steps.find(s => s.ticketId === "confirm-task").status = "pending-confirmation";
        const recomputed = (0, planner_js_1.recomputePlan)(plan, ticketSets);
        // pending-confirmation should be preserved as sticky
        const step = recomputed.steps.find(s => s.ticketId === "confirm-task");
        (0, vitest_1.expect)(step?.status).toBe("pending-confirmation");
    });
});
//# sourceMappingURL=planner-verification-modes.test.js.map