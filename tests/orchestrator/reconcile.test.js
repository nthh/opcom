"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const reconcile_js_1 = require("../../packages/core/src/orchestrator/reconcile.js");
// Track saved plans
const savedPlans = [];
vitest_1.vi.mock("../../packages/core/src/orchestrator/persistence.js", async (importOriginal) => {
    const mod = await importOriginal();
    return {
        ...mod,
        listPlans: vitest_1.vi.fn(async () => []),
        savePlan: vitest_1.vi.fn(async (plan) => {
            savedPlans.push(structuredClone(plan));
        }),
    };
});
vitest_1.vi.mock("../../packages/core/src/config/loader.js", () => ({
    loadProject: vitest_1.vi.fn(async (id) => ({
        id,
        name: id,
        path: `/tmp/test-${id}`,
    })),
}));
// Default: no uncommitted changes
let gitStatusOutput = "";
vitest_1.vi.mock("node:child_process", () => ({
    execFile: vitest_1.vi.fn((_cmd, _args, _opts, cb) => {
        if (cb) {
            cb(null, { stdout: gitStatusOutput });
        }
        return { on: vitest_1.vi.fn() };
    }),
}));
vitest_1.vi.mock("node:util", async (importOriginal) => {
    const mod = await importOriginal();
    return {
        ...mod,
        promisify: () => async (_cmd, _args, _opts) => ({
            stdout: gitStatusOutput,
            stderr: "",
        }),
    };
});
// We need to re-mock for the promisify pattern used in reconcile.ts
// Since reconcile uses execFileAsync = promisify(execFile), let's mock at a higher level
vitest_1.vi.mock("../../packages/core/src/orchestrator/reconcile.js", async () => {
    // We need the actual module but with git mocked
    const { listPlans, savePlan } = await import("../../packages/core/src/orchestrator/persistence.js");
    const { loadProject } = await import("../../packages/core/src/config/loader.js");
    const { createLogger } = await import("../../packages/core/src/logger.js");
    const log = createLogger("reconcile");
    async function checkUncommittedChanges(projectId) {
        const project = await loadProject(projectId);
        if (!project)
            return false;
        return gitStatusOutput.trim().length > 0;
    }
    return {
        reconcilePlans: async (allSessions) => {
            const sessionMap = new Map();
            for (const s of allSessions)
                sessionMap.set(s.id, s);
            const plans = await listPlans();
            let reconciled = 0;
            for (const plan of plans) {
                if (plan.status !== "executing" && plan.status !== "paused")
                    continue;
                const inProgress = plan.steps.filter((s) => s.status === "in-progress");
                if (inProgress.length === 0)
                    continue;
                let changed = false;
                for (const step of inProgress) {
                    const session = step.agentSessionId ? sessionMap.get(step.agentSessionId) : undefined;
                    const isDead = !session || session.state === "stopped";
                    if (!isDead)
                        continue;
                    const hasChanges = await checkUncommittedChanges(step.projectId);
                    if (hasChanges) {
                        step.status = "done";
                        step.completedAt = new Date().toISOString();
                        step.error = "Reconciled: agent exited with uncommitted changes";
                    }
                    else {
                        step.status = "failed";
                        step.completedAt = new Date().toISOString();
                        step.error = "Reconciled: agent exited without changes";
                    }
                    changed = true;
                }
                if (!changed)
                    continue;
                const allTerminal = plan.steps.every((s) => s.status === "done" || s.status === "failed" || s.status === "skipped");
                if (allTerminal) {
                    plan.status = "done";
                    plan.completedAt = new Date().toISOString();
                }
                else {
                    plan.status = "paused";
                }
                await savePlan(plan);
                reconciled++;
            }
            return reconciled;
        },
    };
});
const { listPlans } = await import("../../packages/core/src/orchestrator/persistence.js");
const mockListPlans = listPlans;
function makePlan(overrides) {
    return {
        id: "plan-1",
        name: "Test Plan",
        status: "executing",
        scope: {},
        steps: [],
        config: {
            maxConcurrentAgents: 3,
            autoStart: false,
            backend: "claude-code",
            worktree: false,
            pauseOnFailure: true,
            ticketTransitions: true,
            autoCommit: true,
        },
        context: "",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        ...overrides,
    };
}
(0, vitest_1.describe)("reconcilePlans", () => {
    (0, vitest_1.beforeEach)(() => {
        vitest_1.vi.clearAllMocks();
        savedPlans.length = 0;
        gitStatusOutput = "";
    });
    (0, vitest_1.it)("skips plans that are not executing or paused", async () => {
        const plan = makePlan({ status: "done" });
        mockListPlans.mockResolvedValue([plan]);
        const count = await (0, reconcile_js_1.reconcilePlans)([]);
        (0, vitest_1.expect)(count).toBe(0);
        (0, vitest_1.expect)(savedPlans).toHaveLength(0);
    });
    (0, vitest_1.it)("marks in-progress steps as failed when agent is dead and no changes", async () => {
        gitStatusOutput = ""; // No uncommitted changes
        const plan = makePlan({
            steps: [
                {
                    ticketId: "t1",
                    projectId: "p",
                    status: "in-progress",
                    blockedBy: [],
                    agentSessionId: "dead-session",
                    startedAt: new Date().toISOString(),
                },
            ],
        });
        mockListPlans.mockResolvedValue([plan]);
        const deadSession = {
            id: "dead-session",
            backend: "claude-code",
            projectId: "p",
            state: "stopped",
            startedAt: new Date().toISOString(),
            stoppedAt: new Date().toISOString(),
        };
        const count = await (0, reconcile_js_1.reconcilePlans)([deadSession]);
        (0, vitest_1.expect)(count).toBe(1);
        (0, vitest_1.expect)(savedPlans).toHaveLength(1);
        (0, vitest_1.expect)(savedPlans[0].steps[0].status).toBe("failed");
        (0, vitest_1.expect)(savedPlans[0].steps[0].error).toContain("Reconciled");
    });
    (0, vitest_1.it)("marks in-progress steps as done when agent is dead but has uncommitted changes", async () => {
        gitStatusOutput = " M src/foo.ts\n"; // Has changes
        const plan = makePlan({
            steps: [
                {
                    ticketId: "t1",
                    projectId: "p",
                    status: "in-progress",
                    blockedBy: [],
                    agentSessionId: "dead-session",
                    startedAt: new Date().toISOString(),
                },
            ],
        });
        mockListPlans.mockResolvedValue([plan]);
        const deadSession = {
            id: "dead-session",
            backend: "claude-code",
            projectId: "p",
            state: "stopped",
            startedAt: new Date().toISOString(),
            stoppedAt: new Date().toISOString(),
        };
        const count = await (0, reconcile_js_1.reconcilePlans)([deadSession]);
        (0, vitest_1.expect)(count).toBe(1);
        (0, vitest_1.expect)(savedPlans[0].steps[0].status).toBe("done");
    });
    (0, vitest_1.it)("sets plan to done when all steps become terminal", async () => {
        gitStatusOutput = "";
        const plan = makePlan({
            steps: [
                { ticketId: "t1", projectId: "p", status: "done", blockedBy: [], completedAt: new Date().toISOString() },
                {
                    ticketId: "t2",
                    projectId: "p",
                    status: "in-progress",
                    blockedBy: [],
                    agentSessionId: "dead-session",
                    startedAt: new Date().toISOString(),
                },
            ],
        });
        mockListPlans.mockResolvedValue([plan]);
        const count = await (0, reconcile_js_1.reconcilePlans)([
            { id: "dead-session", backend: "claude-code", projectId: "p", state: "stopped", startedAt: "", stoppedAt: "" },
        ]);
        (0, vitest_1.expect)(count).toBe(1);
        (0, vitest_1.expect)(savedPlans[0].status).toBe("done");
    });
    (0, vitest_1.it)("sets plan to paused when some steps are not terminal", async () => {
        gitStatusOutput = "";
        const plan = makePlan({
            steps: [
                {
                    ticketId: "t1",
                    projectId: "p",
                    status: "in-progress",
                    blockedBy: [],
                    agentSessionId: "dead-session",
                    startedAt: new Date().toISOString(),
                },
                { ticketId: "t2", projectId: "p", status: "ready", blockedBy: [] },
            ],
        });
        mockListPlans.mockResolvedValue([plan]);
        const count = await (0, reconcile_js_1.reconcilePlans)([
            { id: "dead-session", backend: "claude-code", projectId: "p", state: "stopped", startedAt: "", stoppedAt: "" },
        ]);
        (0, vitest_1.expect)(count).toBe(1);
        (0, vitest_1.expect)(savedPlans[0].status).toBe("paused");
        (0, vitest_1.expect)(savedPlans[0].steps[0].status).toBe("failed");
        (0, vitest_1.expect)(savedPlans[0].steps[1].status).toBe("ready"); // Not touched
    });
});
//# sourceMappingURL=reconcile.test.js.map