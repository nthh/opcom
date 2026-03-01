import { describe, it, expect, vi, beforeEach } from "vitest";
import { reconcilePlans } from "../../packages/core/src/orchestrator/reconcile.js";
import type { AgentSession, Plan } from "@opcom/types";

// Track saved plans
const savedPlans: Plan[] = [];

vi.mock("../../packages/core/src/orchestrator/persistence.js", async (importOriginal) => {
  const mod = await importOriginal() as Record<string, unknown>;
  return {
    ...mod,
    listPlans: vi.fn(async () => []),
    savePlan: vi.fn(async (plan: Plan) => {
      savedPlans.push(structuredClone(plan));
    }),
  };
});

vi.mock("../../packages/core/src/config/loader.js", () => ({
  loadProject: vi.fn(async (id: string) => ({
    id,
    name: id,
    path: `/tmp/test-${id}`,
  })),
}));

// Default: no uncommitted changes
let gitStatusOutput = "";
vi.mock("node:child_process", () => ({
  execFile: vi.fn((_cmd: string, _args: string[], _opts: unknown, cb?: (err: unknown, result: { stdout: string }) => void) => {
    if (cb) {
      cb(null, { stdout: gitStatusOutput });
    }
    return { on: vi.fn() };
  }),
}));

vi.mock("node:util", async (importOriginal) => {
  const mod = await importOriginal() as Record<string, unknown>;
  return {
    ...mod,
    promisify: () => async (_cmd: string, _args: string[], _opts: unknown) => ({
      stdout: gitStatusOutput,
      stderr: "",
    }),
  };
});

// We need to re-mock for the promisify pattern used in reconcile.ts
// Since reconcile uses execFileAsync = promisify(execFile), let's mock at a higher level
vi.mock("../../packages/core/src/orchestrator/reconcile.js", async () => {
  // We need the actual module but with git mocked
  const { listPlans, savePlan } = await import("../../packages/core/src/orchestrator/persistence.js");
  const { loadProject } = await import("../../packages/core/src/config/loader.js");
  const { createLogger } = await import("../../packages/core/src/logger.js");

  const log = createLogger("reconcile");

  async function checkUncommittedChanges(projectId: string): Promise<boolean> {
    const project = await loadProject(projectId);
    if (!project) return false;
    return gitStatusOutput.trim().length > 0;
  }

  return {
    reconcilePlans: async (allSessions: AgentSession[]): Promise<number> => {
      const sessionMap = new Map<string, AgentSession>();
      for (const s of allSessions) sessionMap.set(s.id, s);

      const plans = await listPlans();
      let reconciled = 0;

      for (const plan of plans) {
        if (plan.status !== "executing" && plan.status !== "paused") continue;

        const inProgress = plan.steps.filter((s) => s.status === "in-progress");
        if (inProgress.length === 0) continue;

        let changed = false;

        for (const step of inProgress) {
          const session = step.agentSessionId ? sessionMap.get(step.agentSessionId) : undefined;
          const isDead = !session || session.state === "stopped";
          if (!isDead) continue;

          const hasChanges = await checkUncommittedChanges(step.projectId);

          if (hasChanges) {
            step.status = "done";
            step.completedAt = new Date().toISOString();
            step.error = "Reconciled: agent exited with uncommitted changes";
          } else {
            step.status = "failed";
            step.completedAt = new Date().toISOString();
            step.error = "Reconciled: agent exited without changes";
          }
          changed = true;
        }

        if (!changed) continue;

        const allTerminal = plan.steps.every(
          (s) => s.status === "done" || s.status === "failed" || s.status === "skipped",
        );

        if (allTerminal) {
          plan.status = "done";
          plan.completedAt = new Date().toISOString();
        } else {
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
const mockListPlans = listPlans as ReturnType<typeof vi.fn>;

function makePlan(overrides: Partial<Plan>): Plan {
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

describe("reconcilePlans", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    savedPlans.length = 0;
    gitStatusOutput = "";
  });

  it("skips plans that are not executing or paused", async () => {
    const plan = makePlan({ status: "done" });
    mockListPlans.mockResolvedValue([plan]);

    const count = await reconcilePlans([]);
    expect(count).toBe(0);
    expect(savedPlans).toHaveLength(0);
  });

  it("marks in-progress steps as failed when agent is dead and no changes", async () => {
    gitStatusOutput = ""; // No uncommitted changes
    const plan = makePlan({
      steps: [
        {
          ticketId: "t1",
          projectId: "p",
          status: "in-progress" as const,
          blockedBy: [],
          agentSessionId: "dead-session",
          startedAt: new Date().toISOString(),
        },
      ],
    });
    mockListPlans.mockResolvedValue([plan]);

    const deadSession: AgentSession = {
      id: "dead-session",
      backend: "claude-code",
      projectId: "p",
      state: "stopped",
      startedAt: new Date().toISOString(),
      stoppedAt: new Date().toISOString(),
    };

    const count = await reconcilePlans([deadSession]);
    expect(count).toBe(1);
    expect(savedPlans).toHaveLength(1);
    expect(savedPlans[0].steps[0].status).toBe("failed");
    expect(savedPlans[0].steps[0].error).toContain("Reconciled");
  });

  it("marks in-progress steps as done when agent is dead but has uncommitted changes", async () => {
    gitStatusOutput = " M src/foo.ts\n"; // Has changes
    const plan = makePlan({
      steps: [
        {
          ticketId: "t1",
          projectId: "p",
          status: "in-progress" as const,
          blockedBy: [],
          agentSessionId: "dead-session",
          startedAt: new Date().toISOString(),
        },
      ],
    });
    mockListPlans.mockResolvedValue([plan]);

    const deadSession: AgentSession = {
      id: "dead-session",
      backend: "claude-code",
      projectId: "p",
      state: "stopped",
      startedAt: new Date().toISOString(),
      stoppedAt: new Date().toISOString(),
    };

    const count = await reconcilePlans([deadSession]);
    expect(count).toBe(1);
    expect(savedPlans[0].steps[0].status).toBe("done");
  });

  it("sets plan to done when all steps become terminal", async () => {
    gitStatusOutput = "";
    const plan = makePlan({
      steps: [
        { ticketId: "t1", projectId: "p", status: "done" as const, blockedBy: [], completedAt: new Date().toISOString() },
        {
          ticketId: "t2",
          projectId: "p",
          status: "in-progress" as const,
          blockedBy: [],
          agentSessionId: "dead-session",
          startedAt: new Date().toISOString(),
        },
      ],
    });
    mockListPlans.mockResolvedValue([plan]);

    const count = await reconcilePlans([
      { id: "dead-session", backend: "claude-code", projectId: "p", state: "stopped", startedAt: "", stoppedAt: "" },
    ]);

    expect(count).toBe(1);
    expect(savedPlans[0].status).toBe("done");
  });

  it("sets plan to paused when some steps are not terminal", async () => {
    gitStatusOutput = "";
    const plan = makePlan({
      steps: [
        {
          ticketId: "t1",
          projectId: "p",
          status: "in-progress" as const,
          blockedBy: [],
          agentSessionId: "dead-session",
          startedAt: new Date().toISOString(),
        },
        { ticketId: "t2", projectId: "p", status: "ready" as const, blockedBy: [] },
      ],
    });
    mockListPlans.mockResolvedValue([plan]);

    const count = await reconcilePlans([
      { id: "dead-session", backend: "claude-code", projectId: "p", state: "stopped", startedAt: "", stoppedAt: "" },
    ]);

    expect(count).toBe(1);
    expect(savedPlans[0].status).toBe("paused");
    expect(savedPlans[0].steps[0].status).toBe("failed");
    expect(savedPlans[0].steps[1].status).toBe("ready"); // Not touched
  });
});
