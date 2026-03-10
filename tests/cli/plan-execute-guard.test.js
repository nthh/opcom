"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const plan_js_1 = require("../../packages/cli/src/commands/plan.js");
// Mock all heavy dependencies so we never start real executors
const mockLoadPlan = vitest_1.vi.fn();
const mockListPlans = vitest_1.vi.fn();
const mockSavePlan = vitest_1.vi.fn();
vitest_1.vi.mock("@opcom/core", () => ({
    loadPlan: (...args) => mockLoadPlan(...args),
    listPlans: (...args) => mockListPlans(...args),
    savePlan: (...args) => mockSavePlan(...args),
    loadGlobalConfig: vitest_1.vi.fn(async () => ({})),
    loadWorkspace: vitest_1.vi.fn(async () => null),
    loadProject: vitest_1.vi.fn(async () => null),
    scanTickets: vitest_1.vi.fn(async () => []),
    computePlan: vitest_1.vi.fn(),
    resolveScope: vitest_1.vi.fn(),
    deletePlan: vitest_1.vi.fn(),
    checkHygiene: vitest_1.vi.fn(),
    defaultOrchestratorConfig: vitest_1.vi.fn(() => ({
        maxConcurrentAgents: 3,
        worktree: true,
        pauseOnFailure: true,
        ticketTransitions: true,
        autoCommit: true,
        verification: { runTests: true, runOracle: false },
    })),
    Executor: vitest_1.vi.fn(),
    SessionManager: vitest_1.vi.fn().mockImplementation(() => ({
        init: vitest_1.vi.fn(),
    })),
    EventStore: vitest_1.vi.fn(),
}));
function makePlan(overrides = {}) {
    return {
        id: "test-plan",
        name: "Test",
        status: "planning",
        scope: {},
        steps: [],
        config: {
            maxConcurrentAgents: 3,
            autoStart: false,
            backend: "claude-code",
            worktree: true,
            pauseOnFailure: true,
            ticketTransitions: true,
            autoCommit: true,
            verification: { runTests: true, runOracle: false },
        },
        context: "",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        ...overrides,
    };
}
(0, vitest_1.describe)("runPlanExecute guards", () => {
    (0, vitest_1.beforeEach)(() => {
        vitest_1.vi.clearAllMocks();
        vitest_1.vi.spyOn(console, "error").mockImplementation(() => { });
        vitest_1.vi.spyOn(console, "log").mockImplementation(() => { });
    });
    (0, vitest_1.it)("rejects when plan status is 'executing'", async () => {
        const plan = makePlan({ status: "executing" });
        mockLoadPlan.mockResolvedValue(plan);
        await (0, plan_js_1.runPlanExecute)("test-plan");
        (0, vitest_1.expect)(console.error).toHaveBeenCalledWith(vitest_1.expect.stringContaining("already executing"));
    });
    (0, vitest_1.it)("rejects when plan status is 'done'", async () => {
        const plan = makePlan({ status: "done" });
        mockLoadPlan.mockResolvedValue(plan);
        await (0, plan_js_1.runPlanExecute)("test-plan");
        (0, vitest_1.expect)(console.error).toHaveBeenCalledWith(vitest_1.expect.stringContaining("already done"));
    });
    (0, vitest_1.it)("rejects when no plan found", async () => {
        mockLoadPlan.mockResolvedValue(null);
        mockListPlans.mockResolvedValue([]);
        await (0, plan_js_1.runPlanExecute)("nonexistent");
        (0, vitest_1.expect)(console.error).toHaveBeenCalledWith(vitest_1.expect.stringContaining("No plan found"));
    });
});
(0, vitest_1.describe)("runPlanResume guards", () => {
    (0, vitest_1.beforeEach)(() => {
        vitest_1.vi.clearAllMocks();
        vitest_1.vi.spyOn(console, "error").mockImplementation(() => { });
        vitest_1.vi.spyOn(console, "log").mockImplementation(() => { });
    });
    (0, vitest_1.it)("rejects when plan is not paused", async () => {
        const plan = makePlan({ status: "executing" });
        mockLoadPlan.mockResolvedValue(plan);
        await (0, plan_js_1.runPlanResume)("test-plan");
        (0, vitest_1.expect)(console.error).toHaveBeenCalledWith(vitest_1.expect.stringContaining("not paused"));
    });
});
//# sourceMappingURL=plan-execute-guard.test.js.map