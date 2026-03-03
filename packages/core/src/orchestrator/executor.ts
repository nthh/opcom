import { readFile, writeFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
import type {
  Plan,
  PlanStep,
  AgentSession,
  AgentState,
  NormalizedEvent,
} from "@opcom/types";
import type { SessionManager } from "../agents/session-manager.js";
import type { EventStore } from "../agents/event-store.js";
import type { TicketSet } from "./planner.js";
import { recomputePlan } from "./planner.js";
import { savePlan, savePlanContext } from "./persistence.js";
import { buildContextPacket } from "../agents/context-builder.js";
import { deriveAllowedBashTools } from "../agents/allowed-bash.js";
import { loadProject } from "../config/loader.js";
import { scanTickets } from "../detection/tickets.js";
import { commitStepChanges } from "./git-ops.js";
import { WorktreeManager } from "./worktree.js";
import { createLogger } from "../logger.js";

const log = createLogger("executor");

export interface ExecutorEvents {
  step_started: { step: PlanStep; session: AgentSession };
  step_completed: { step: PlanStep };
  step_failed: { step: PlanStep; error: string };
  step_needs_rebase: { step: PlanStep; error: string };
  plan_completed: { plan: Plan };
  plan_paused: { plan: Plan };
  plan_updated: { plan: Plan };
}

type EventHandler<T> = (data: T) => void;

interface ExecutorEvent {
  type: "agent_completed" | "agent_failed" | "pause" | "resume" | "skip" | "inject_context";
  sessionId?: string;
  ticketId?: string;
  error?: string;
  text?: string;
}

/**
 * Event-driven execution loop for orchestrator plans.
 */
export class Executor {
  private plan: Plan;
  private sessionManager: SessionManager;
  private eventStore: EventStore | null;
  private listeners = new Map<string, Set<EventHandler<unknown>>>();
  private eventQueue: ExecutorEvent[] = [];
  private eventResolve: (() => void) | null = null;
  private running = false;
  private sessionToStep = new Map<string, string>(); // sessionId → ticketId
  private sessionWrites = new Map<string, number>(); // sessionId → count of write tool calls
  private worktreeManager = new WorktreeManager();

  constructor(plan: Plan, sessionManager: SessionManager, eventStore?: EventStore) {
    this.plan = plan;
    this.sessionManager = sessionManager;
    this.eventStore = eventStore ?? null;
  }

  getPlan(): Plan {
    return this.plan;
  }

  /** Exposed for testing. */
  getWorktreeManager(): WorktreeManager {
    return this.worktreeManager;
  }

  /**
   * Main execution loop.
   */
  async run(): Promise<void> {
    this.running = true;
    this.plan.status = "executing";
    await savePlan(this.plan);
    this.logPlanEvent("plan_started", { detail: { stepCount: this.plan.steps.length } });

    // Clean up orphaned worktrees from previous crashed runs
    if (this.plan.config.worktree) {
      await this.cleanupOrphanedWorktrees();
    }

    // Wire SessionManager events
    const onStopped = (session: AgentSession) => {
      const ticketId = this.sessionToStep.get(session.id);
      if (ticketId) {
        this.pushEvent({ type: "agent_completed", sessionId: session.id, ticketId });
      }
    };
    const onStateChange = ({ sessionId, newState }: { sessionId: string; oldState: AgentState; newState: AgentState }) => {
      if (newState === "error") {
        const ticketId = this.sessionToStep.get(sessionId);
        if (ticketId) {
          this.pushEvent({ type: "agent_failed", sessionId, ticketId, error: "Agent entered error state" });
        }
      }
    };

    // Track write activity per agent (used when worktree mode is off)
    const WRITE_TOOLS = new Set(["Edit", "Write", "NotebookEdit"]);
    const onAgentEvent = ({ sessionId, event: ev }: { sessionId: string; event: NormalizedEvent }) => {
      if (ev.type === "tool_end" && ev.data?.toolName && WRITE_TOOLS.has(ev.data.toolName) && ev.data.toolSuccess !== false) {
        this.sessionWrites.set(sessionId, (this.sessionWrites.get(sessionId) ?? 0) + 1);
      }
    };

    this.sessionManager.on("session_stopped", onStopped);
    this.sessionManager.on("state_change", onStateChange);
    this.sessionManager.on("agent_event", onAgentEvent);

    try {
      // Initial: start agents on ready steps
      await this.startReadySteps();
      this.emit("plan_updated", { plan: this.plan });

      // Event loop
      while (this.running && !this.isPlanTerminal()) {
        const event = await this.nextEvent();
        if (!event) continue;

        await this.handleEvent(event);
      }
    } finally {
      this.sessionManager.off("session_stopped", onStopped);
      this.sessionManager.off("state_change", onStateChange);
      this.sessionManager.off("agent_event", onAgentEvent);
    }
  }

  /**
   * Pause execution — stop starting new agents (running agents continue).
   */
  pause(): void {
    this.plan.status = "paused";
    this.pushEvent({ type: "pause" });
  }

  /**
   * Resume execution — recompute plan and start ready steps.
   */
  resume(): void {
    this.pushEvent({ type: "resume" });
  }

  /**
   * Inject context into the plan.
   */
  async injectContext(text: string): Promise<void> {
    this.plan.context += (this.plan.context ? "\n" : "") + text;
    await savePlanContext(this.plan.id, this.plan.context);
    await savePlan(this.plan);
  }

  /**
   * Skip a step — mark as skipped, unblock downstream.
   */
  skipStep(ticketId: string): void {
    this.pushEvent({ type: "skip", ticketId });
  }

  /**
   * Stop the execution loop.
   */
  stop(): void {
    this.running = false;
    // Resolve any pending event wait
    if (this.eventResolve) {
      this.eventResolve();
      this.eventResolve = null;
    }
  }

  // --- Event system ---

  on<K extends keyof ExecutorEvents>(event: K, handler: EventHandler<ExecutorEvents[K]>): void {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
    }
    this.listeners.get(event)!.add(handler as EventHandler<unknown>);
  }

  off<K extends keyof ExecutorEvents>(event: K, handler: EventHandler<ExecutorEvents[K]>): void {
    this.listeners.get(event)?.delete(handler as EventHandler<unknown>);
  }

  private emit<K extends keyof ExecutorEvents>(event: K, data: ExecutorEvents[K]): void {
    const handlers = this.listeners.get(event);
    if (handlers) {
      for (const h of handlers) h(data);
    }
  }

  // --- Plan event logging ---

  private logPlanEvent(
    eventType: string,
    opts?: { stepTicketId?: string; agentSessionId?: string; detail?: Record<string, unknown> },
  ): void {
    this.eventStore?.insertPlanEvent(this.plan.id, eventType, opts);
  }

  // --- Event queue ---

  private pushEvent(event: ExecutorEvent): void {
    this.eventQueue.push(event);
    if (this.eventResolve) {
      this.eventResolve();
      this.eventResolve = null;
    }
  }

  private async nextEvent(): Promise<ExecutorEvent | undefined> {
    if (this.eventQueue.length > 0) {
      return this.eventQueue.shift();
    }
    // Wait for next event
    await new Promise<void>((resolve) => {
      this.eventResolve = resolve;
    });
    return this.eventQueue.shift();
  }

  // --- Event handling ---

  private async handleEvent(event: ExecutorEvent): Promise<void> {
    switch (event.type) {
      case "agent_completed": {
        const step = this.plan.steps.find((s) => s.ticketId === event.ticketId);
        if (step) {
          if (this.plan.config.worktree) {
            await this.handleWorktreeCompletion(step, event);
          } else {
            await this.handleLegacyCompletion(step, event);
          }
        }

        // Recompute and start newly-ready steps
        await this.recomputeAndContinue();
        break;
      }

      case "agent_failed": {
        const step = this.plan.steps.find((s) => s.ticketId === event.ticketId);
        if (step) {
          step.status = "failed";
          step.error = event.error;
          step.completedAt = new Date().toISOString();
          if (event.sessionId) this.sessionToStep.delete(event.sessionId);

          // Keep worktree on failure for inspection/retry
          // Worktree path and branch stay on the step so the TUI can show them

          this.emit("step_failed", { step, error: event.error ?? "unknown" });
          this.logPlanEvent("step_failed", {
            stepTicketId: step.ticketId,
            agentSessionId: event.sessionId,
            detail: { error: event.error },
          });
        }

        if (this.plan.config.pauseOnFailure) {
          this.plan.status = "paused";
          await savePlan(this.plan);
          this.emit("plan_paused", { plan: this.plan });
          this.logPlanEvent("plan_paused", { detail: { reason: "step_failed" } });
        } else {
          await this.recomputeAndContinue();
        }
        break;
      }

      case "pause": {
        this.plan.status = "paused";
        await savePlan(this.plan);
        this.emit("plan_paused", { plan: this.plan });
        this.logPlanEvent("plan_paused", { detail: { reason: "user" } });
        break;
      }

      case "resume": {
        this.plan.status = "executing";
        this.logPlanEvent("plan_resumed");
        await this.recomputeAndContinue();
        break;
      }

      case "skip": {
        const step = this.plan.steps.find((s) => s.ticketId === event.ticketId);
        if (step) {
          step.status = "skipped";
          step.completedAt = new Date().toISOString();
          this.logPlanEvent("step_skipped", { stepTicketId: step.ticketId });

          // Clean up worktree if skipped while in-progress
          if (this.plan.config.worktree && step.worktreePath) {
            await this.worktreeManager.remove(step.ticketId).catch(() => {});
            step.worktreePath = undefined;
            step.worktreeBranch = undefined;
          }
        }
        await this.recomputeAndContinue();
        break;
      }

      case "inject_context": {
        if (event.text) {
          await this.injectContext(event.text);
        }
        break;
      }
    }
  }

  /**
   * Handle agent completion in worktree mode.
   * Uses branch commit detection instead of write-count tracking.
   */
  private async handleWorktreeCompletion(step: PlanStep, event: ExecutorEvent): Promise<void> {
    // Auto-commit any uncommitted changes in the worktree before checking for commits.
    // Agents may write files without committing (e.g. Claude Code in -p mode).
    if (this.plan.config.autoCommit && step.worktreePath) {
      try {
        await commitStepChanges(step.worktreePath, step.ticketId);
      } catch {
        // No changes to commit, or commit failed — hasCommits will catch it
      }
    }

    const hasWork = await this.worktreeManager.hasCommits(step.ticketId);

    if (event.sessionId) {
      this.sessionToStep.delete(event.sessionId);
      this.sessionWrites.delete(event.sessionId);
    }

    if (!hasWork) {
      step.status = "failed";
      step.error = "Agent exited without making any commits";
      step.completedAt = new Date().toISOString();

      // Keep worktree for inspection — only clear truly empty ones
      const hasUncommitted = await this.worktreeHasChanges(step.worktreePath);
      if (!hasUncommitted) {
        await this.worktreeManager.remove(step.ticketId).catch(() => {});
        step.worktreePath = undefined;
        step.worktreeBranch = undefined;
      }

      log.warn("step failed: no commits in worktree", { ticketId: step.ticketId, keptWorktree: hasUncommitted });
      this.emit("step_failed", { step, error: step.error });
      this.logPlanEvent("step_failed", {
        stepTicketId: step.ticketId,
        agentSessionId: event.sessionId,
        detail: { error: step.error, mode: "worktree" },
      });

      if (this.plan.config.pauseOnFailure) {
        this.plan.status = "paused";
        await savePlan(this.plan);
        this.emit("plan_paused", { plan: this.plan });
        this.logPlanEvent("plan_paused", { detail: { reason: "step_failed" } });
      }
      return;
    }

    // Agent has commits — attempt merge into main tree
    const mergeResult = await this.worktreeManager.merge(step.ticketId);

    if (mergeResult.conflict) {
      // Merge conflict — mark as needs-rebase
      step.status = "needs-rebase";
      step.error = `Merge conflict: ${mergeResult.error}`;
      step.completedAt = new Date().toISOString();
      // Keep worktree alive for manual rebase

      log.warn("merge conflict", { ticketId: step.ticketId });
      this.emit("step_needs_rebase", { step, error: step.error });
      this.logPlanEvent("step_needs_rebase", {
        stepTicketId: step.ticketId,
        agentSessionId: event.sessionId,
        detail: { error: step.error },
      });

      if (this.plan.config.pauseOnFailure) {
        this.plan.status = "paused";
        await savePlan(this.plan);
        this.emit("plan_paused", { plan: this.plan });
        this.logPlanEvent("plan_paused", { detail: { reason: "merge_conflict" } });
      }
      return;
    }

    if (!mergeResult.merged) {
      // Merge failed for non-conflict reason
      step.status = "failed";
      step.error = `Merge failed: ${mergeResult.error}`;
      step.completedAt = new Date().toISOString();
      await this.worktreeManager.remove(step.ticketId).catch(() => {});
      step.worktreePath = undefined;
      step.worktreeBranch = undefined;

      log.error("merge failed", { ticketId: step.ticketId, error: mergeResult.error });
      this.emit("step_failed", { step, error: step.error });
      this.logPlanEvent("step_failed", {
        stepTicketId: step.ticketId,
        agentSessionId: event.sessionId,
        detail: { error: step.error },
      });

      if (this.plan.config.pauseOnFailure) {
        this.plan.status = "paused";
        await savePlan(this.plan);
        this.emit("plan_paused", { plan: this.plan });
        this.logPlanEvent("plan_paused", { detail: { reason: "merge_failed" } });
      }
      return;
    }

    // Merge succeeded — step is done
    step.status = "done";
    step.completedAt = new Date().toISOString();

    // Clean up worktree after successful merge
    await this.worktreeManager.remove(step.ticketId).catch((err) => {
      log.warn("worktree cleanup after merge failed", { ticketId: step.ticketId, error: String(err) });
    });
    step.worktreePath = undefined;
    step.worktreeBranch = undefined;

    // Ticket transition
    if (this.plan.config.ticketTransitions) {
      await this.updateTicketStatusSafe(step, "closed");
    }

    this.emit("step_completed", { step });
    this.logPlanEvent("step_completed", {
      stepTicketId: step.ticketId,
      agentSessionId: event.sessionId,
      detail: { mode: "worktree" },
    });
  }

  /** Check if a worktree has uncommitted changes (staged or unstaged). */
  private async worktreeHasChanges(worktreePath?: string): Promise<boolean> {
    if (!worktreePath) return false;
    try {
      const { stdout } = await execFileAsync("git", ["status", "--porcelain"], { cwd: worktreePath });
      return stdout.trim().length > 0;
    } catch {
      return false;
    }
  }

  /**
   * Handle agent completion in legacy (non-worktree) mode.
   * Uses write-count tracking from tool events.
   */
  private async handleLegacyCompletion(step: PlanStep, event: ExecutorEvent): Promise<void> {
    const writes = event.sessionId ? (this.sessionWrites.get(event.sessionId) ?? 0) : 0;

    if (writes === 0) {
      step.status = "failed";
      step.error = "Agent exited without making any file changes";
      step.completedAt = new Date().toISOString();
      if (event.sessionId) {
        this.sessionToStep.delete(event.sessionId);
        this.sessionWrites.delete(event.sessionId);
      }

      log.warn("step failed: no writes", { ticketId: step.ticketId });
      this.emit("step_failed", { step, error: step.error });
      this.logPlanEvent("step_failed", {
        stepTicketId: step.ticketId,
        agentSessionId: event.sessionId,
        detail: { error: step.error },
      });

      if (this.plan.config.pauseOnFailure) {
        this.plan.status = "paused";
        await savePlan(this.plan);
        this.emit("plan_paused", { plan: this.plan });
        this.logPlanEvent("plan_paused", { detail: { reason: "step_failed" } });
      }
    } else {
      step.status = "done";
      step.completedAt = new Date().toISOString();
      if (event.sessionId) {
        this.sessionToStep.delete(event.sessionId);
        this.sessionWrites.delete(event.sessionId);
      }

      // Ticket transition
      if (this.plan.config.ticketTransitions) {
        await this.updateTicketStatusSafe(step, "closed");
      }

      // Auto-commit changes
      if (this.plan.config.autoCommit) {
        const project = await loadProject(step.projectId);
        if (project) {
          await commitStepChanges(project.path, step.ticketId);
        }
      }

      this.emit("step_completed", { step });
      this.logPlanEvent("step_completed", {
        stepTicketId: step.ticketId,
        agentSessionId: event.sessionId,
        detail: { writes },
      });
    }
  }

  private async recomputeAndContinue(): Promise<void> {
    // Refresh ticket state from disk
    const ticketSets = await this.loadCurrentTickets();
    this.plan = recomputePlan(this.plan, ticketSets);
    await savePlan(this.plan);

    if (this.plan.status === "executing") {
      await this.startReadySteps();
    }

    // Check if plan is complete
    if (this.isPlanTerminal()) {
      this.plan.status = "done";
      this.plan.completedAt = new Date().toISOString();
      await savePlan(this.plan);
      this.emit("plan_completed", { plan: this.plan });
      this.logPlanEvent("plan_completed", {
        detail: {
          done: this.plan.steps.filter((s) => s.status === "done").length,
          failed: this.plan.steps.filter((s) => s.status === "failed").length,
          skipped: this.plan.steps.filter((s) => s.status === "skipped").length,
        },
      });
      this.running = false;
    }

    this.emit("plan_updated", { plan: this.plan });
  }

  private async startReadySteps(): Promise<void> {
    const running = this.plan.steps.filter((s) => s.status === "in-progress").length;
    const max = this.plan.config.maxConcurrentAgents;
    const available = max - running;

    if (available <= 0) return;

    const ready = this.plan.steps.filter((s) => s.status === "ready");
    const toStart = ready.slice(0, available);

    for (const step of toStart) {
      try {
        await this.startStep(step);
      } catch (err) {
        log.error("failed to start step", { ticketId: step.ticketId, error: String(err) });
        step.status = "failed";
        step.error = String(err);
      }
    }
  }

  private async startStep(step: PlanStep): Promise<void> {
    const project = await loadProject(step.projectId);
    if (!project) {
      throw new Error(`Project not found: ${step.projectId}`);
    }

    const tickets = await scanTickets(project.path);
    const workItem = tickets.find((t) => t.id === step.ticketId);

    const contextPacket = await buildContextPacket(project, workItem);

    // Create worktree if enabled — agent runs in isolation
    let agentCwd: string | undefined;
    if (this.plan.config.worktree) {
      const wtInfo = await this.worktreeManager.create(
        project.path,
        step.ticketId,
        step.ticketId,
      );
      step.worktreePath = wtInfo.worktreePath;
      step.worktreeBranch = wtInfo.branch;
      agentCwd = wtInfo.worktreePath;

      // Point the context packet at the worktree so the agent uses worktree
      // paths for all file operations instead of writing to the main tree.
      contextPacket.project.path = wtInfo.worktreePath;
    }

    const allowedTools = deriveAllowedBashTools(
      { stack: project.stack, testing: project.testing, linting: project.linting },
      this.plan.config.allowedBashPatterns,
    );

    const session = await this.sessionManager.startSession(
      step.projectId,
      this.plan.config.backend as "claude-code" | "opencode",
      {
        projectPath: agentCwd ?? project.path,
        workItemId: step.ticketId,
        contextPacket,
        cwd: agentCwd,
        worktree: this.plan.config.worktree,
        permissionMode: "acceptEdits",
        disallowedTools: ["EnterPlanMode", "ExitPlanMode", "EnterWorktree"],
        allowedTools,
        additionalDirs: agentCwd ? [agentCwd] : [project.path],
      },
      step.ticketId,
    );

    step.status = "in-progress";
    step.agentSessionId = session.id;
    step.startedAt = new Date().toISOString();
    this.sessionToStep.set(session.id, step.ticketId);

    // Ticket transition: open → in-progress
    if (this.plan.config.ticketTransitions) {
      await this.updateTicketStatusSafe(step, "in-progress");
    }

    await savePlan(this.plan);
    this.emit("step_started", { step, session });
    this.logPlanEvent("step_started", {
      stepTicketId: step.ticketId,
      agentSessionId: session.id,
    });
  }

  private isPlanTerminal(): boolean {
    return this.plan.steps.every(
      (s) => s.status === "done" || s.status === "failed" || s.status === "skipped" || s.status === "needs-rebase",
    );
  }

  private async loadCurrentTickets(): Promise<TicketSet[]> {
    const projectIds = [...new Set(this.plan.steps.map((s) => s.projectId))];
    const ticketSets: TicketSet[] = [];

    for (const pid of projectIds) {
      try {
        const project = await loadProject(pid);
        if (!project) continue;
        const tickets = await scanTickets(project.path);
        ticketSets.push({ projectId: pid, tickets });
      } catch {
        // Skip failed scans
      }
    }

    return ticketSets;
  }

  private async updateTicketStatusSafe(step: PlanStep, newStatus: string): Promise<void> {
    try {
      const project = await loadProject(step.projectId);
      if (!project) return;
      const tickets = await scanTickets(project.path);
      const ticket = tickets.find((t) => t.id === step.ticketId);
      if (ticket) {
        await updateTicketStatus(ticket.filePath, newStatus);
      }
    } catch (err) {
      log.warn("failed to update ticket status", { ticketId: step.ticketId, error: String(err) });
    }
  }

  /**
   * Clean up orphaned worktrees from crashed runs.
   * Scans each project's .opcom/worktrees/ directory.
   */
  private async cleanupOrphanedWorktrees(): Promise<void> {
    const projectIds = [...new Set(this.plan.steps.map((s) => s.projectId))];
    for (const pid of projectIds) {
      try {
        const project = await loadProject(pid);
        if (!project) continue;
        const cleaned = await WorktreeManager.cleanupOrphaned(project.path);
        if (cleaned.length > 0) {
          log.info("cleaned up orphaned worktrees", { projectId: pid, count: cleaned.length });
        }
      } catch (err) {
        log.warn("orphaned worktree cleanup failed", { projectId: pid, error: String(err) });
      }
    }
  }
}

/**
 * Update ticket status in YAML frontmatter.
 */
export async function updateTicketStatus(ticketPath: string, newStatus: string): Promise<void> {
  const content = await readFile(ticketPath, "utf-8");
  const updated = content.replace(
    /^(status:\s*).+$/m,
    `$1${newStatus}`,
  );
  if (updated !== content) {
    await writeFile(ticketPath, updated, "utf-8");
  }
}
