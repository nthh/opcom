import { EventStore, listPlans, loadPlan } from "@opcom/core";
import type { Plan } from "@opcom/types";

const BOLD = "\x1b[1m";
const RESET = "\x1b[0m";
const GREEN = "\x1b[32m";
const RED = "\x1b[31m";
const YELLOW = "\x1b[33m";
const CYAN = "\x1b[36m";
const DIM = "\x1b[2m";
const CLEAR_SCREEN = "\x1b[2J\x1b[H";

interface MonitorOpts {
  planId?: string;
  agents?: boolean;
  errors?: boolean;
  once?: boolean;
}

export async function runMonitor(opts: MonitorOpts): Promise<void> {
  // Find the plan
  let plan: Plan | null = null;
  if (opts.planId) {
    plan = await loadPlan(opts.planId);
    if (!plan) {
      console.error(`  Plan '${opts.planId}' not found.`);
      process.exit(1);
    }
  } else {
    // Find the most recent executing or paused plan
    const plans = (await listPlans()).filter((p) => p != null);
    const byDate = (a: Plan, b: Plan) => (b.updatedAt ?? b.createdAt ?? "").localeCompare(a.updatedAt ?? a.createdAt ?? "");
    plan = plans
      .filter((p) => p.status === "executing" || p.status === "paused")
      .sort(byDate)[0] ?? null;
    if (!plan) {
      // Fall back to most recent plan of any status
      plan = plans.sort(byDate)[0] ?? null;
    }
    if (!plan) {
      console.error("  No plans found. Create one with: opcom plan create");
      process.exit(1);
    }
  }

  if (opts.once) {
    printMonitor(plan);
    return;
  }

  // Live mode — refresh every 2s
  const shutdown = () => {
    process.stdout.write("\x1b[?25h"); // restore cursor
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
  process.stdout.write("\x1b[?25l"); // hide cursor

  while (true) {
    // Reload plan from disk each tick
    const fresh = await loadPlan(plan.id);
    if (fresh) plan = fresh;

    process.stdout.write(CLEAR_SCREEN);
    printMonitor(plan, opts);

    await new Promise((r) => setTimeout(r, 2000));
  }
}

function printMonitor(plan: Plan, opts?: MonitorOpts): void {
  const now = Date.now();

  // --- Plan summary ---
  const steps = plan.steps;
  const done = steps.filter((s) => s.status === "done").length;
  const inProgress = steps.filter((s) => s.status === "in-progress").length;
  const verifying = steps.filter((s) => s.status === "verifying").length;
  const ready = steps.filter((s) => s.status === "ready").length;
  const blocked = steps.filter((s) => s.status === "blocked").length;
  const failed = steps.filter((s) => s.status === "failed").length;
  const total = steps.length;

  const statusColor = plan.status === "executing" ? GREEN
    : plan.status === "paused" ? YELLOW
    : plan.status === "done" ? GREEN
    : plan.status === "failed" ? RED
    : DIM;

  console.log(`  ${BOLD}Plan: ${plan.name}${RESET} ${statusColor}[${plan.status}]${RESET} ${done}/${total} steps done  ${BOLD}${inProgress}${RESET} in-progress  ${verifying} verifying  ${ready} ready  ${blocked} blocked${failed > 0 ? `  ${RED}${failed} failed${RESET}` : ""}`);
  console.log(`  ${DIM}ID: ${plan.id.slice(0, 8)}  Max agents: ${plan.config.maxConcurrentAgents}  Strategy: ${plan.config.strategy ?? "spread"}  Worktree: ${plan.config.worktree ? "yes" : "no"}${RESET}`);
  console.log("");

  // --- Active agents ---
  let store: EventStore | null = null;
  try {
    store = new EventStore();
  } catch {
    // Event store unavailable — show plan-only info
  }

  const activeSteps = steps.filter((s) => s.status === "in-progress" || s.status === "verifying");

  if (!opts?.errors) {
    console.log(`  ${BOLD}AGENTS${RESET} (${activeSteps.length} active)`);
    if (activeSteps.length === 0) {
      console.log(`    ${DIM}No active agents${RESET}`);
    } else {
      for (const step of activeSteps) {
        const sessionId = step.agentSessionId?.slice(0, 11) ?? "—";
        const ticketId = step.ticketId.length > 70 ? step.ticketId.slice(0, 67) + "..." : step.ticketId;
        const startedAt = step.startedAt ? new Date(step.startedAt).getTime() : now;
        const duration = formatDuration(now - startedAt);
        const phase = step.status === "verifying"
          ? `${YELLOW}verifying${step.verifyingPhase ? ` (${step.verifyingPhase})` : ""}${RESET}`
          : `${GREEN}streaming${RESET}`;

        let eventCount = "";
        if (store && step.agentSessionId) {
          try {
            const events = store.loadSessionEvents(step.agentSessionId);
            eventCount = `  ${events.length} events`;
          } catch { /* skip */ }
        }

        console.log(`    ${CYAN}${sessionId}${RESET}  ${ticketId}`);
        console.log(`             ${phase}  ${duration}${eventCount}${step.attempt && step.attempt > 1 ? `  ${YELLOW}attempt ${step.attempt}${RESET}` : ""}`);
      }
    }
    console.log("");
  }

  // --- Recent events ---
  if (store && !opts?.agents) {
    const recentEvents = getRecentEvents(store, activeSteps, 30);
    if (!opts?.errors && recentEvents.length > 0) {
      console.log(`  ${BOLD}RECENT EVENTS${RESET} (last 30s)`);
      for (const evt of recentEvents.slice(-12)) {
        const time = new Date(evt.timestamp).toLocaleTimeString("en-US", { hour12: false });
        const session = evt.sessionId.slice(0, 11);
        const success = evt.success === true ? `${GREEN}✓${RESET}` : evt.success === false ? `${RED}✗${RESET}` : " ";
        const tool = evt.toolName ? pad(evt.toolName, 8) : pad(evt.type, 8);
        console.log(`    ${DIM}${time}${RESET}  ${CYAN}${session}${RESET}  ${tool} ${success}`);
      }
      console.log("");
    }

    // --- Errors ---
    const failedSteps = steps.filter((s) => s.status === "failed" || s.verification?.passed === false);
    if (failedSteps.length > 0) {
      console.log(`  ${BOLD}${RED}ERRORS${RESET} (${failedSteps.length})`);
      for (const step of failedSteps) {
        const ticketId = step.ticketId.length > 60 ? step.ticketId.slice(0, 57) + "..." : step.ticketId;
        if (step.error) {
          console.log(`    ${RED}✗${RESET} ${ticketId}`);
          console.log(`      ${DIM}${step.error}${RESET}`);
        } else if (step.verification && !step.verification.passed) {
          console.log(`    ${YELLOW}⚠${RESET} ${ticketId} ${DIM}(verification failed)${RESET}`);
          for (const reason of (step.verification.failureReasons ?? [])) {
            console.log(`      ${DIM}${reason}${RESET}`);
          }
        }
      }
      console.log("");
    } else if (opts?.errors) {
      console.log(`  ${GREEN}No errors${RESET}`);
      console.log("");
    }

    // --- Stalls ---
    const stallTimeoutMs = plan.config.stall?.agentTimeoutMs ?? 1200000;
    const stalledSteps = activeSteps.filter((s) => {
      if (!s.agentSessionId || !s.startedAt) return false;
      const elapsed = now - new Date(s.startedAt).getTime();
      return elapsed > stallTimeoutMs;
    });
    if (stalledSteps.length > 0) {
      console.log(`  ${BOLD}${YELLOW}STALLS${RESET} (${stalledSteps.length})`);
      for (const step of stalledSteps) {
        const duration = formatDuration(now - new Date(step.startedAt!).getTime());
        console.log(`    ${YELLOW}◌${RESET} ${step.ticketId.slice(0, 60)}  ${duration}`);
        if (step.stallSignal) {
          console.log(`      ${DIM}${step.stallSignal.message}${RESET}`);
        }
      }
      console.log("");
    }
  }

  // --- Tracks/stages summary ---
  if (!opts?.agents && !opts?.errors && plan.stages && plan.stages.length > 1) {
    console.log(`  ${BOLD}STAGES${RESET}`);
    for (const stage of plan.stages) {
      const stageSteps = steps.filter((s) => stage.stepTicketIds.includes(s.ticketId));
      const stageDone = stageSteps.filter((s) => s.status === "done").length;
      const stageTotal = stageSteps.length;
      const statusIcon = stage.status === "completed" ? `${GREEN}✓${RESET}`
        : stage.status === "executing" ? `${YELLOW}▶${RESET}`
        : `${DIM}○${RESET}`;
      console.log(`    ${statusIcon} ${stage.name ?? `stage-${stage.index}`}  ${stageDone}/${stageTotal}`);
    }
    console.log("");
  }

  if (store) store.close();

  console.log(`  ${DIM}Refreshing every 2s. Ctrl+C to exit.${RESET}`);
}

interface RecentEvent {
  timestamp: string;
  sessionId: string;
  type: string;
  toolName?: string;
  success?: boolean;
}

function getRecentEvents(store: EventStore, activeSteps: Plan["steps"], windowSec: number): RecentEvent[] {
  const cutoff = new Date(Date.now() - windowSec * 1000).toISOString();
  const events: RecentEvent[] = [];

  for (const step of activeSteps) {
    if (!step.agentSessionId) continue;
    try {
      const sessionEvents = store.loadSessionEvents(step.agentSessionId, { limit: 50 });
      for (const e of sessionEvents) {
        if (e.timestamp < cutoff) continue;
        if (e.type === "tool_end" || e.type === "error") {
          events.push({
            timestamp: e.timestamp,
            sessionId: step.agentSessionId,
            type: e.type,
            toolName: e.data?.toolName ?? undefined,
            success: e.data?.toolSuccess ?? undefined,
          });
        }
      }
    } catch { /* skip */ }
  }

  return events.sort((a, b) => a.timestamp.localeCompare(b.timestamp));
}

function formatDuration(ms: number): string {
  const sec = Math.floor(ms / 1000);
  if (sec < 60) return `${sec}s`;
  const min = Math.floor(sec / 60);
  const remSec = sec % 60;
  if (min < 60) return `${min}m${remSec.toString().padStart(2, "0")}s`;
  const hr = Math.floor(min / 60);
  const remMin = min % 60;
  return `${hr}h${remMin.toString().padStart(2, "0")}m`;
}

function pad(s: string, n: number): string {
  return s.length >= n ? s : s + " ".repeat(n - s.length);
}
