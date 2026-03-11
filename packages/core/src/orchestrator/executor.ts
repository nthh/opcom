import { readFile, writeFile, stat } from "node:fs/promises";
import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
import type {
  Plan,
  PlanStep,
  PlanStage,
  StageSummary,
  IntegrationTestResult,
  AgentSession,
  AgentState,
  NormalizedEvent,
  VerificationResult,
  TestGateResult,
  RebaseResult,
  StallSignal,
  VerificationMode,
} from "@opcom/types";
import type { SessionManager } from "../agents/session-manager.js";
import type { EventStore } from "../agents/event-store.js";
import type { TicketSet } from "./planner.js";
import { recomputePlan, computeStages, computeDepthStages, buildExplicitStages, computeStageSummary, baseTicketId, applyStrategy } from "./planner.js";
import { savePlan, savePlanContext } from "./persistence.js";
import { buildContextPacket, contextPacketToMarkdown } from "../agents/context-builder.js";
import { deriveAllowedBashTools, checkForbiddenCommand } from "../agents/allowed-bash.js";
import { loadProject } from "../config/loader.js";
import { scanTickets } from "../detection/tickets.js";
import { commitStepChanges, captureChangeset } from "./git-ops.js";
import { WorktreeManager } from "./worktree.js";
import { collectOracleInputs, formatOraclePrompt, parseOracleResponse, extractAcceptanceCriteria } from "../skills/oracle.js";
import { loadRole, resolveRoleConfig } from "../config/roles.js";
import { updateProjectSummary } from "../config/summary.js";
import { createLogger } from "../logger.js";
import { ingestTestResults, queryGraphContext } from "../graph/graph-service.js";
import { runSmoke } from "./smoke-test.js";
import { StallDetector } from "./stall-detector.js";
import { StateStore } from "../state/state-store.js";

const log = createLogger("executor");

export interface ExecutorEvents {
  step_started: { step: PlanStep; session: AgentSession };
  step_completed: { step: PlanStep };
  step_failed: { step: PlanStep; error: string };
  step_needs_rebase: { step: PlanStep; error: string };
  step_pending_confirmation: { step: PlanStep };
  stage_completed: { planId: string; stage: PlanStage; summary: StageSummary };
  smoke_test: { planId: string; result: IntegrationTestResult; trigger: "stage" | "plan_completion"; stageIndex?: number };
  plan_completed: { plan: Plan };
  plan_paused: { plan: Plan };
  plan_updated: { plan: Plan };
  stall_detected: { signal: StallSignal };
  forbidden_command_warning: { stepTicketId: string; command: string; constraintName: string; rule: string };
  denied_write: { stepTicketId: string; filePath: string; roleId: string; pattern: string };
}

type EventHandler<T> = (data: T) => void;

interface ExecutorEvent {
  type: "agent_completed" | "agent_failed" | "pause" | "resume" | "skip" | "retry" | "inject_context" | "advance_stage" | "verification_done" | "stall_check" | "confirm_step" | "reject_step";
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
  private activeVerifications = 0; // count of concurrent verification runs
  private stepVerification = new Map<string, { runTests: boolean; runOracle: boolean }>(); // ticketId → role verification
  private stepDenyPaths = new Map<string, { denyPaths: string[]; roleId: string }>(); // ticketId → deny paths + role
  private stepFiles = new Map<string, string[]>(); // ticketId → related file paths (cached from graph)
  private ticketCache = new Map<string, import("@opcom/types").WorkItem[]>(); // projectId → tickets
  private stepConstraints = new Map<string, import("@opcom/types").AgentConstraint[]>(); // ticketId → constraints
  private worktreeManager = new WorktreeManager();
  private stallDetector: StallDetector;
  private stallCheckTimer: ReturnType<typeof setInterval> | null = null;
  private stateStore: StateStore;

  constructor(plan: Plan, sessionManager: SessionManager, eventStore?: EventStore, stateStore?: StateStore) {
    this.plan = plan;
    this.sessionManager = sessionManager;
    this.eventStore = eventStore ?? null;
    this.stallDetector = new StallDetector(plan.config.stall);
    this.stateStore = stateStore ?? new StateStore();
  }

  getPlan(): Plan {
    return this.plan;
  }

  /** Exposed for testing. */
  getWorktreeManager(): WorktreeManager {
    return this.worktreeManager;
  }

  /** Exposed for testing. */
  getStallDetector(): StallDetector {
    return this.stallDetector;
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

    // Recover steps stuck in "verifying" from a previous crashed/restarted executor.
    // A step is stuck if its agent session no longer exists in the SessionManager.
    // In worktree mode the agent's work is committed — just re-run verification.
    // In legacy mode there's nothing to verify, so reset to ready.
    for (const step of this.plan.steps) {
      if (step.status === "verifying") {
        const sessionAlive = step.agentSessionId
          ? this.sessionManager.getSession(step.agentSessionId) !== undefined
          : false;
        if (!sessionAlive) {
          step.verifyingPhase = undefined;
          step.verifyingPhaseStartedAt = undefined;
          if (this.plan.config.worktree && step.worktreePath && existsSync(step.worktreePath)) {
            // Restore worktree tracking (lost on executor restart) so that
            // hasCommits() and merge() can find the worktree info.
            const project = await loadProject(step.projectId);
            if (project) {
              const wtKey = this.worktreeKey(step);
              this.worktreeManager.restore({
                stepId: wtKey,
                ticketId: wtKey,
                projectPath: project.path,
                worktreePath: step.worktreePath,
                branch: step.worktreeBranch ?? `work/${wtKey}`,
              });
            }
            log.warn("re-running verification for stuck step", { ticketId: step.ticketId });
            // Re-enter the worktree completion flow which runs verification then merges.
            this.activeVerifications++;
            this.handleWorktreeCompletion(step, { type: "agent_completed", ticketId: step.ticketId })
              .catch(async (err) => {
                log.error("re-verification failed", { ticketId: step.ticketId, error: String(err) });
                if (step.status === "verifying") {
                  await this.failStep(step, `Re-verification crashed: ${String(err)}`);
                  this.emit("step_failed", { step, error: String(err) });
                }
              })
              .finally(async () => {
                this.activeVerifications--;
                await this.recomputeAndContinue();
                this.pushEvent({ type: "verification_done", ticketId: step.ticketId });
              });
          } else {
            log.warn("recovering stuck verifying step (no worktree)", { ticketId: step.ticketId });
            step.status = "ready";
            step.attempt = (step.attempt ?? 1) + 1;
            step.agentSessionId = undefined;
          }
        }
      }
    }

    // Recover needs-rebase steps by re-entering the worktree completion flow.
    // The agent's work is already committed — just retry verification + merge.
    for (const step of this.plan.steps) {
      if (step.status === "needs-rebase") {
        if (this.plan.config.worktree && step.worktreePath) {
          // Restore worktree tracking (lost on executor restart)
          const project = await loadProject(step.projectId);
          if (project) {
            const wtKey = this.worktreeKey(step);
            this.worktreeManager.restore({
              stepId: wtKey,
              ticketId: wtKey,
              projectPath: project.path,
              worktreePath: step.worktreePath,
              branch: step.worktreeBranch ?? `work/${wtKey}`,
            });
          }
          step.rebaseAttempts = 0;
          step.error = undefined;
          step.completedAt = undefined;
          log.info("re-entering merge flow for needs-rebase step", { ticketId: step.ticketId });
          this.activeVerifications++;
          this.handleWorktreeCompletion(step, { type: "agent_completed", ticketId: step.ticketId })
            .catch(async (err) => {
              log.error("needs-rebase recovery failed", { ticketId: step.ticketId, error: String(err) });
              if (step.status === "verifying" || step.status === "needs-rebase") {
                await this.failStep(step, `Rebase recovery failed: ${String(err)}`);
                this.emit("step_failed", { step, error: String(err) });
              }
            })
            .finally(async () => {
              this.activeVerifications--;
              await this.recomputeAndContinue();
              this.pushEvent({ type: "verification_done", ticketId: step.ticketId });
            });
        } else {
          // No worktree — fall back to full redo
          log.info("resetting needs-rebase step (no worktree)", { ticketId: step.ticketId });
          step.status = "ready";
          step.error = undefined;
          step.completedAt = undefined;
          step.agentSessionId = undefined;
        }
      }
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
        // Log but don't fail — error state is often transient (e.g., stall detection
        // warning). The agent may recover and continue producing output. Only
        // agent_end / session stopped should trigger step completion.
        const ticketId = this.sessionToStep.get(sessionId);
        if (ticketId) {
          log.warn("agent entered error state (non-fatal)", { sessionId, ticketId });
        }
      }
    };

    // Track write activity per agent (used when worktree mode is off)
    const WRITE_TOOLS = new Set(["Edit", "Write", "NotebookEdit"]);
    const onAgentEvent = ({ sessionId, event: ev }: { sessionId: string; event: NormalizedEvent }) => {
      if (ev.type === "tool_end" && ev.data?.toolName && WRITE_TOOLS.has(ev.data.toolName) && ev.data.toolSuccess !== false) {
        this.sessionWrites.set(sessionId, (this.sessionWrites.get(sessionId) ?? 0) + 1);
      }
      // Deny path check — reject when agent writes to restricted paths
      if (ev.type === "tool_start" && ev.data?.toolName && WRITE_TOOLS.has(ev.data.toolName) && ev.data.toolInput) {
        const ticketId = this.sessionToStep.get(sessionId);
        if (ticketId) {
          const denyConfig = this.stepDenyPaths.get(ticketId);
          if (denyConfig && denyConfig.denyPaths.length > 0) {
            const filePath = extractFilePath(ev.data.toolInput);
            if (filePath) {
              const matched = matchesDenyPath(filePath, denyConfig.denyPaths);
              if (matched) {
                const errorMsg = `Cannot modify ${filePath} — files matching \`${matched}\` are read-only during execution.`;
                log.warn("denied write to protected path", {
                  ticketId,
                  filePath,
                  roleId: denyConfig.roleId,
                  pattern: matched,
                });
                // Increment denied write count on the plan step
                const planStep = this.plan.steps.find((s) => s.ticketId === ticketId);
                if (planStep) {
                  planStep.deniedWriteCount = (planStep.deniedWriteCount ?? 0) + 1;
                }
                this.emit("denied_write", {
                  stepTicketId: ticketId,
                  filePath,
                  roleId: denyConfig.roleId,
                  pattern: matched,
                });
                this.logPlanEvent("denied_write", {
                  stepTicketId: ticketId,
                  detail: {
                    filePath,
                    roleId: denyConfig.roleId,
                    pattern: matched,
                  },
                });
                // Best-effort: tell the agent the write was rejected.
                // stdin may be closed in one-shot mode — enforcement is still logged.
                this.sessionManager.promptSession(sessionId, errorMsg).catch(() => {});
              }
            }
          }
        }
      }
      // Forbidden command check — soft warn on matching agent constraints
      if (ev.type === "tool_start" && ev.data?.toolName === "Bash" && ev.data.toolInput) {
        const ticketId = this.sessionToStep.get(sessionId);
        if (ticketId) {
          const constraints = this.stepConstraints.get(ticketId);
          const result = checkForbiddenCommand(ev.data.toolInput, constraints);
          if (result.forbidden && result.constraint) {
            log.warn("forbidden command detected", {
              ticketId,
              command: ev.data.toolInput,
              constraint: result.constraint.name,
            });
            this.emit("forbidden_command_warning", {
              stepTicketId: ticketId,
              command: ev.data.toolInput,
              constraintName: result.constraint.name,
              rule: result.constraint.rule,
            });
            this.logPlanEvent("forbidden_command_warning", {
              stepTicketId: ticketId,
              detail: {
                command: ev.data.toolInput,
                constraintName: result.constraint.name,
                rule: result.constraint.rule,
              },
            });
          }
        }
      }
    };

    this.sessionManager.on("session_stopped", onStopped);
    this.sessionManager.on("state_change", onStateChange);
    this.sessionManager.on("agent_event", onAgentEvent);

    // Start periodic stall detection timer (every 60s)
    if (this.plan.config.stall.enabled) {
      this.stallCheckTimer = setInterval(() => {
        this.pushEvent({ type: "stall_check" });
      }, 60_000);
    }

    try {
      // Load ticket data for priority sorting and file-overlap detection
      await this.loadCurrentTickets();

      // Compute stages if not already set
      if (!this.plan.stages || this.plan.stages.length === 0) {
        this.initializeStages();
      }

      // Initial: start agents on ready steps
      await this.startReadySteps();
      this.emit("plan_updated", { plan: this.plan });

      // Event loop — keep running while paused so resume can wake us
      while (this.running && !this.shouldExitLoop()) {
        const event = await this.nextEvent();
        if (!event) continue;

        await this.handleEvent(event);
      }
    } finally {
      if (this.stallCheckTimer) {
        clearInterval(this.stallCheckTimer);
        this.stallCheckTimer = null;
      }
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
   * Retry a failed or needs-rebase step — reset to ready for a fresh attempt.
   */
  retryStep(ticketId: string): void {
    this.pushEvent({ type: "retry", ticketId });
  }

  /**
   * Confirm a step in pending-confirmation status — mark it done.
   */
  confirmStep(ticketId: string): void {
    this.pushEvent({ type: "confirm_step", ticketId });
  }

  /**
   * Reject a step in pending-confirmation status — re-enter ready queue.
   */
  rejectStep(ticketId: string, reason?: string): void {
    this.pushEvent({ type: "reject_step", ticketId, error: reason });
  }

  /**
   * Stop the execution loop.
   */
  stop(): void {
    this.running = false;
    if (this.stallCheckTimer) {
      clearInterval(this.stallCheckTimer);
      this.stallCheckTimer = null;
    }
    // Resolve any pending event wait
    if (this.eventResolve) {
      this.eventResolve();
      this.eventResolve = null;
    }
  }

  /**
   * Continue to the next stage (user approval gate).
   * Called from TUI or CLI when user approves.
   */
  continueToNextStage(): void {
    this.pushEvent({ type: "advance_stage" });
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
            // Run verification concurrently — don't block the event loop.
            // This allows multiple steps to verify in parallel.
            this.activeVerifications++;
            this.handleWorktreeCompletion(step, event)
              .catch(async (err) => {
                log.error("worktree completion failed", { ticketId: step.ticketId, error: String(err) });
                // Don't leave step stuck in "verifying"
                if (step.status === "verifying") {
                  await this.failStep(step, `Verification crashed: ${String(err)}`);
                  this.emit("step_failed", { step, error: String(err) });
                }
              })
              .finally(async () => {
                this.activeVerifications--;
                await this.recomputeAndContinue();
                // Wake the event loop — it may be blocked in nextEvent()
                this.pushEvent({ type: "verification_done", ticketId: step.ticketId });
              });
          } else {
            await this.handleLegacyCompletion(step, event);
            await this.recomputeAndContinue();
          }
        }
        break;
      }

      case "agent_failed": {
        const step = this.plan.steps.find((s) => s.ticketId === event.ticketId);
        if (step) {
          await this.failStep(step, event.error ?? "unknown");
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

        // Stop all in-progress agent sessions so they don't keep running.
        // Reset steps to ready so they restart cleanly on resume.
        for (const step of this.plan.steps) {
          if (step.status === "in-progress" && step.agentSessionId) {
            log.info("stopping agent for paused step", { ticketId: step.ticketId, sessionId: step.agentSessionId });
            this.sessionToStep.delete(step.agentSessionId);
            this.sessionWrites.delete(step.agentSessionId);
            await this.sessionManager.stopSession(step.agentSessionId).catch((err) => {
              log.warn("failed to stop agent on pause", { ticketId: step.ticketId, error: String(err) });
            });
            step.status = "ready";
            step.agentSessionId = undefined;
          }
        }

        await savePlan(this.plan);
        this.emit("plan_paused", { plan: this.plan });
        this.logPlanEvent("plan_paused", { detail: { reason: "user" } });
        break;
      }

      case "resume": {
        this.plan.status = "executing";

        for (const step of this.plan.steps) {
          // Restore worktree tracking for steps that need it (may have been
          // lost if the executor was recreated from a saved plan).
          if (this.plan.config.worktree && step.worktreePath && !this.worktreeManager.getInfo(this.worktreeKey(step))) {
            const project = await loadProject(step.projectId);
            if (project) {
              const wtKey = this.worktreeKey(step);
              this.worktreeManager.restore({
                stepId: wtKey,
                ticketId: wtKey,
                projectPath: project.path,
                worktreePath: step.worktreePath,
                branch: step.worktreeBranch ?? `work/${wtKey}`,
              });
            }
          }

          // Recover stuck verifying steps — verification is not resumable,
          // so re-enter the worktree completion flow from the start.
          if (step.status === "verifying") {
            const sessionAlive = step.agentSessionId
              ? this.sessionManager.getSession(step.agentSessionId) !== undefined
              : false;
            if (!sessionAlive) {
              step.verifyingPhase = undefined;
              step.verifyingPhaseStartedAt = undefined;
              if (this.plan.config.worktree && step.worktreePath) {
                log.info("re-running verification for stuck step on resume", { ticketId: step.ticketId });
                this.activeVerifications++;
                this.handleWorktreeCompletion(step, { type: "agent_completed", ticketId: step.ticketId })
                  .catch(async (err) => {
                    log.error("re-verification failed on resume", { ticketId: step.ticketId, error: String(err) });
                    if (step.status === "verifying") {
                      await this.failStep(step, `Re-verification crashed: ${String(err)}`);
                      this.emit("step_failed", { step, error: String(err) });
                    }
                  })
                  .finally(async () => {
                    this.activeVerifications--;
                    await this.recomputeAndContinue();
                    this.pushEvent({ type: "verification_done", ticketId: step.ticketId });
                  });
              } else {
                log.warn("recovering stuck verifying step (no worktree) on resume", { ticketId: step.ticketId });
                step.status = "ready";
                step.attempt = (step.attempt ?? 1) + 1;
                step.agentSessionId = undefined;
              }
            }
          }

          // Re-enter merge flow for needs-rebase steps (work is done, just retry merge)
          if (step.status === "needs-rebase") {
            if (this.plan.config.worktree && step.worktreePath) {
              step.rebaseAttempts = 0;
              step.error = undefined;
              step.completedAt = undefined;
              log.info("re-entering merge flow for needs-rebase step on resume", { ticketId: step.ticketId });
              this.activeVerifications++;
              this.handleWorktreeCompletion(step, { type: "agent_completed", ticketId: step.ticketId })
                .catch(async (err) => {
                  log.error("needs-rebase recovery failed on resume", { ticketId: step.ticketId, error: String(err) });
                  if (step.status === "verifying" || step.status === "needs-rebase") {
                    await this.failStep(step, `Rebase recovery failed: ${String(err)}`);
                    this.emit("step_failed", { step, error: String(err) });
                  }
                })
                .finally(async () => {
                  this.activeVerifications--;
                  await this.recomputeAndContinue();
                  this.pushEvent({ type: "verification_done", ticketId: step.ticketId });
                });
            } else {
              // No worktree — fall back to full redo
              step.status = "ready";
              step.error = undefined;
              step.completedAt = undefined;
              step.agentSessionId = undefined;
              log.info("resetting needs-rebase step (no worktree) on resume", { ticketId: step.ticketId });
            }
          }
        }

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
            await this.worktreeManager.remove(this.worktreeKey(step)).catch(() => {});
            step.worktreePath = undefined;
            step.worktreeBranch = undefined;
          }
        }
        await this.recomputeAndContinue();
        break;
      }

      case "retry": {
        const step = this.plan.steps.find((s) => s.ticketId === event.ticketId);
        if (step && (step.status === "failed" || step.status === "needs-rebase")) {
          step.status = "ready";
          step.error = undefined;
          step.completedAt = undefined;
          step.agentSessionId = undefined;
          step.verification = undefined;
          step.previousVerification = undefined;
          step.rebaseAttempts = 0;
          // Keep worktree if it exists — agent can pick up where it left off
          this.logPlanEvent("step_retry", {
            stepTicketId: step.ticketId,
            detail: { reason: "manual_retry", previousAttempt: step.attempt },
          });
          step.attempt = 1;
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

      case "advance_stage": {
        this.advanceToNextStage();
        this.plan.status = "executing";
        this.logPlanEvent("stage_advanced", { detail: { stage: this.plan.currentStage } });
        await this.recomputeAndContinue();
        break;
      }

      case "verification_done":
        // No-op — recomputeAndContinue was already called in the finally block.
        // This event just wakes the event loop so it can re-check isPlanTerminal.
        break;

      case "stall_check": {
        await this.runStallChecks();
        break;
      }

      case "confirm_step": {
        const step = this.plan.steps.find((s) => s.ticketId === event.ticketId);
        if (step && step.status === "pending-confirmation") {
          step.status = "done";
          step.completedAt = new Date().toISOString();

          // Clean up worktree if present
          if (this.plan.config.worktree && step.worktreePath) {
            // Merge first if there are commits
            const hasCommits = await this.worktreeManager.hasCommits(this.worktreeKey(step)).catch(() => false);
            if (hasCommits) {
              await this.worktreeManager.merge(this.worktreeKey(step)).catch(() => {});
            }
            await this.worktreeManager.remove(this.worktreeKey(step)).catch(() => {});
            step.worktreePath = undefined;
            step.worktreeBranch = undefined;
          }

          if (this.plan.config.ticketTransitions) {
            await this.updateTicketStatusSafe(step, "closed");
          }

          await this.updateSummary(step);
          this.emit("step_completed", { step });
          this.logPlanEvent("step_confirmed", { stepTicketId: step.ticketId });
        }
        await this.recomputeAndContinue();
        break;
      }

      case "reject_step": {
        const step = this.plan.steps.find((s) => s.ticketId === event.ticketId);
        if (step && step.status === "pending-confirmation") {
          step.status = "ready";
          step.agentSessionId = undefined;
          step.completedAt = undefined;
          step.attempt = (step.attempt ?? 1) + 1;
          step.error = event.error ?? "Rejected by user";
          this.logPlanEvent("step_rejected", {
            stepTicketId: step.ticketId,
            detail: { reason: event.error },
          });
        }
        await this.recomputeAndContinue();
        break;
      }
    }
  }

  /**
   * Handle agent completion in worktree mode.
   * Uses branch commit detection instead of write-count tracking.
   */
  private async handleWorktreeCompletion(step: PlanStep, event: ExecutorEvent): Promise<void> {
    // Clear rebase conflict context — agent has either resolved it or failed
    const wasRebaseResolution = !!step.rebaseConflict;
    step.rebaseConflict = undefined;

    // Recover any stashed changes — agents may stash work and forget to pop.
    if (step.worktreePath) {
      try {
        const { stdout } = await execFileAsync(
          "git", ["stash", "list"], { cwd: step.worktreePath },
        );
        if (stdout.trim().length > 0) {
          log.info("recovering stashed changes", { ticketId: step.ticketId });
          await execFileAsync("git", ["stash", "pop"], { cwd: step.worktreePath });
        }
      } catch {
        // No stash or pop failed — continue
      }
    }

    // Auto-commit any uncommitted changes in the worktree before checking for commits.
    // Agents may write files without committing (e.g. Claude Code in -p mode).
    if (this.plan.config.autoCommit && step.worktreePath) {
      try {
        await commitStepChanges(step.worktreePath, step.ticketId);
      } catch {
        // No changes to commit, or commit failed — hasCommits will catch it
      }
    }

    const hasWork = await this.worktreeManager.hasCommits(this.worktreeKey(step));

    if (event.sessionId) {
      this.sessionToStep.delete(event.sessionId);
      this.sessionWrites.delete(event.sessionId);
    }

    // --- Per-work-item verification mode routing ---
    // Only routes when an explicit verificationMode is set on the step (from work item frontmatter).
    // When undefined, falls through to the existing verification pipeline (role + plan config).
    const verificationMode = this.resolveVerificationMode(step);

    // "none" mode: skip all verification, mark done immediately
    if (verificationMode === "none") {
      log.info("verification mode: none — skipping verification", { ticketId: step.ticketId });
      if (hasWork) {
        // Merge into main
        const mergeResult = await this.worktreeManager.merge(this.worktreeKey(step));
        if (!mergeResult.merged) {
          step.status = "needs-rebase";
          step.error = `Merge failed: ${mergeResult.error}`;
          step.completedAt = new Date().toISOString();
          this.emit("step_needs_rebase", { step, error: step.error });
          this.logPlanEvent("step_needs_rebase", { stepTicketId: step.ticketId, detail: { error: step.error } });
          return;
        }
      }
      step.status = "done";
      step.completedAt = new Date().toISOString();
      await this.worktreeManager.remove(this.worktreeKey(step)).catch(() => {});
      step.worktreePath = undefined;
      step.worktreeBranch = undefined;
      if (this.plan.config.ticketTransitions) {
        await this.updateTicketStatusSafe(step, "closed");
      }
      await this.updateSummary(step);
      this.emit("step_completed", { step });
      this.logPlanEvent("step_completed", { stepTicketId: step.ticketId, detail: { mode: "none" } });
      return;
    }

    // "confirmation" mode: enter pending-confirmation status, wait for user
    if (verificationMode === "confirmation") {
      log.info("verification mode: confirmation — awaiting user confirmation", { ticketId: step.ticketId });
      step.status = "pending-confirmation";
      await savePlan(this.plan);
      this.emit("step_pending_confirmation", { step });
      this.emit("plan_updated", { plan: this.plan });
      this.logPlanEvent("step_pending_confirmation", { stepTicketId: step.ticketId });
      return;
    }

    // "output-exists" mode: check that expected files exist
    if (verificationMode === "output-exists") {
      log.info("verification mode: output-exists", { ticketId: step.ticketId });
      step.status = "verifying";
      step.verification = undefined;
      await savePlan(this.plan);
      this.emit("plan_updated", { plan: this.plan });

      const result = await this.runOutputExistsVerification(step, event);
      step.verification = result;

      if (!result.passed) {
        const attempt = step.attempt ?? 1;
        const maxRetries = this.plan.config.verification.maxRetries ?? 2;
        const maxAttempts = 1 + maxRetries;

        if (attempt < maxAttempts) {
          step.attempt = attempt + 1;
          step.previousVerification = result;
          step.status = "ready";
          step.agentSessionId = undefined;
          this.logPlanEvent("step_retry", { stepTicketId: step.ticketId, detail: { attempt: step.attempt, mode: "output-exists" } });
          return;
        }

        const reason = `Output-exists verification failed: ${result.failureReasons.join("; ")}`;
        await this.failStep(step, reason);
        this.emit("step_failed", { step, error: reason });
        this.logPlanEvent("step_failed", { stepTicketId: step.ticketId, detail: { error: reason, mode: "output-exists" } });
        if (this.plan.config.pauseOnFailure) {
          this.plan.status = "paused";
          await savePlan(this.plan);
          this.emit("plan_paused", { plan: this.plan });
        }
        return;
      }

      // Output-exists passed — proceed to merge if there are commits
      if (hasWork) {
        const mergeResult = await this.worktreeManager.merge(this.worktreeKey(step));
        if (!mergeResult.merged) {
          step.status = "needs-rebase";
          step.error = `Merge failed: ${mergeResult.error}`;
          step.completedAt = new Date().toISOString();
          this.emit("step_needs_rebase", { step, error: step.error });
          this.logPlanEvent("step_needs_rebase", { stepTicketId: step.ticketId, detail: { error: step.error } });
          return;
        }
      }

      step.status = "done";
      step.completedAt = new Date().toISOString();
      await this.worktreeManager.remove(this.worktreeKey(step)).catch(() => {});
      step.worktreePath = undefined;
      step.worktreeBranch = undefined;
      if (this.plan.config.ticketTransitions) {
        await this.updateTicketStatusSafe(step, "closed");
      }
      await this.updateSummary(step);
      this.emit("step_completed", { step });
      this.logPlanEvent("step_completed", { stepTicketId: step.ticketId, detail: { mode: "output-exists" } });
      return;
    }

    // "oracle" mode: skip test gate, run oracle only
    // "test-gate" mode: run full pipeline (test gate + oracle if enabled)
    // These flow through the existing verification pipeline below.
    // For "oracle" mode, override the role verification to skip tests.
    if (verificationMode === "oracle") {
      this.stepVerification.set(step.ticketId, { runTests: false, runOracle: true });
    }

    if (!hasWork) {
      // Zero-commit oracle arbitration: if oracle is enabled, ask it whether
      // the acceptance criteria are already met (e.g. a previous step did the work).
      const roleVerify = this.stepVerification.get(step.ticketId);
      const zeroCommitVerification = roleVerify ?? this.plan.config.verification;

      if (zeroCommitVerification.runOracle) {
        log.info("zero-commit oracle arbitration", { ticketId: step.ticketId });
        step.status = "verifying";
        step.verification = undefined;
        this.stallDetector.recordStepTransition();
        await savePlan(this.plan);
        this.emit("plan_updated", { plan: this.plan });

        const result = await this.runVerification(step, event, {
          runTests: false,   // tests are irrelevant (no changes made)
          runOracle: true,
        });

        if (result?.passed) {
          // Oracle confirms criteria are met — step is done without commits
          step.status = "done";
          step.completedAt = new Date().toISOString();
          step.verification = result;
          step.stallSignal = undefined;
          this.stallDetector.recordStepTransition();

          // No merge needed — no commits to merge
          await this.worktreeManager.remove(this.worktreeKey(step)).catch(() => {});
          step.worktreePath = undefined;
          step.worktreeBranch = undefined;

          if (this.plan.config.ticketTransitions) {
            await this.updateTicketStatusSafe(step, "closed");
          }

          await this.updateSummary(step);
          log.info("zero-commit oracle passed — step done (already implemented)", { ticketId: step.ticketId });
          this.emit("step_completed", { step });
          this.logPlanEvent("step_completed", {
            stepTicketId: step.ticketId,
            agentSessionId: event.sessionId,
            detail: { mode: "worktree", zeroCommitOracle: true, verification: result },
          });
          return;
        }
        // Oracle says criteria unmet — fall through to failure
        if (result) {
          step.verification = result;
        }
      }

      const reason = "Agent exited without making any commits";
      await this.failStep(step, reason);

      // Keep worktree for inspection — only clear truly empty ones
      const hasUncommitted = await this.worktreeHasChanges(step.worktreePath);
      if (!hasUncommitted) {
        await this.worktreeManager.remove(this.worktreeKey(step)).catch(() => {});
        step.worktreePath = undefined;
        step.worktreeBranch = undefined;
      }

      log.warn("step failed: no commits in worktree", { ticketId: step.ticketId, keptWorktree: hasUncommitted });
      this.emit("step_failed", { step, error: reason });
      this.logPlanEvent("step_failed", {
        stepTicketId: step.ticketId,
        agentSessionId: event.sessionId,
        detail: { error: reason, mode: "worktree" },
      });

      if (this.plan.config.pauseOnFailure) {
        this.plan.status = "paused";
        await savePlan(this.plan);
        this.emit("plan_paused", { plan: this.plan });
        this.logPlanEvent("plan_paused", { detail: { reason: "step_failed" } });
      }
      return;
    }

    // Agent has commits — run verification IN the worktree before merging.
    // This prevents bad code from landing on main if tests fail.
    step.status = "verifying";
    step.verification = undefined;
    this.stallDetector.recordStepTransition();
    await savePlan(this.plan);
    this.emit("plan_updated", { plan: this.plan });

    const roleVerify = this.stepVerification.get(step.ticketId);
    const swarmVerify = this.getStepVerificationMode(step);
    const verification = await this.runVerification(step, event, swarmVerify ?? roleVerify);

    if (verification && !verification.passed) {
      const attempt = step.attempt ?? 1;
      const maxRetries = this.plan.config.verification.maxRetries ?? 2;
      const maxAttempts = 1 + maxRetries;

      if (attempt < maxAttempts) {
        // Retry: queue the step for a new agent session with failure feedback
        log.info("verification failed, retrying", {
          ticketId: step.ticketId,
          attempt,
          maxAttempts,
          reasons: verification.failureReasons,
        });
        step.attempt = attempt + 1;
        step.previousVerification = verification;
        step.verification = verification;
        step.status = "ready";
        step.agentSessionId = undefined;
        step.completedAt = undefined;
        step.error = undefined;
        if (event.sessionId) {
          this.sessionToStep.delete(event.sessionId);
          this.sessionWrites.delete(event.sessionId);
        }
        // Worktree is preserved — agent picks up where it left off
        this.logPlanEvent("step_retry", {
          stepTicketId: step.ticketId,
          agentSessionId: event.sessionId,
          detail: { attempt: step.attempt, previousVerification: verification },
        });
        return; // recomputeAndContinue will pick up the ready step
      }

      // Out of retries — hard fail
      const reason = `Verification failed after ${attempt} attempt(s): ${verification.failureReasons.join("; ")}`;
      await this.failStep(step, reason);
      step.verification = verification;

      // Keep worktree for inspection on verification failure
      log.warn("step verification failed (retries exhausted)", { ticketId: step.ticketId, attempt, reasons: verification.failureReasons });
      this.emit("step_failed", { step, error: reason });
      this.logPlanEvent("step_failed", {
        stepTicketId: step.ticketId,
        agentSessionId: event.sessionId,
        detail: { error: reason, mode: "worktree", verification, attempt },
      });

      if (this.plan.config.pauseOnFailure) {
        this.plan.status = "paused";
        await savePlan(this.plan);
        this.emit("plan_paused", { plan: this.plan });
        this.logPlanEvent("plan_paused", { detail: { reason: "verification_failed" } });
      }
      return;
    }

    // Swarm subtasks: intermediate steps don't merge to main — they just commit
    // to the shared branch and mark as done. Only the final subtask merges.
    if (this.isSwarmSubtask(step) && !this.isFinalSwarmSubtask(step)) {
      step.status = "done";
      step.completedAt = new Date().toISOString();
      if (verification) step.verification = verification;
      step.stallSignal = undefined;
      this.stallDetector.recordStepTransition();

      // Don't clear worktree — siblings will reuse it
      // Don't merge — branch stays for next subtask agent

      if (this.plan.config.ticketTransitions) {
        await this.updateTicketStatusSafe(step, "closed");
      }

      await this.updateSummary(step);
      this.emit("step_completed", { step });
      this.logPlanEvent("step_completed", {
        stepTicketId: step.ticketId,
        agentSessionId: event.sessionId,
        detail: { mode: "worktree", swarmIntermediate: true, verification },
      });
      await this.writeStepArtifacts(step);
      return;
    }

    // Verification passed (or skipped) — merge into main tree
    const mergeId = this.worktreeKey(step);
    let mergeResult = await this.worktreeManager.merge(mergeId);

    if (mergeResult.conflict) {
      if (verification) step.verification = verification;

      // Auto-rebase: attempt automatic conflict resolution.
      // Allow rebase even after a resolution agent — main may have moved again
      // while the agent was working. Limit total rebase attempts to prevent loops.
      // Loop because a concurrent merge can move main again during re-verification.
      const maxRebaseAttempts = 3;
      while (this.plan.config.verification.autoRebase !== false && (step.rebaseAttempts ?? 0) < maxRebaseAttempts) {
        step.rebaseAttempts = (step.rebaseAttempts ?? 0) + 1;
        const resolved = await this.handleAutoRebase(step, event, roleVerify);
        if (resolved) return; // Step completed or re-queued for agent resolution
        // handleAutoRebase returned false — post-rebase merge still conflicts.
        // Refresh mergeResult for the needs-rebase error message, then retry.
        mergeResult = { merged: false, conflict: true, error: mergeResult.error };
      }

      // Auto-rebase disabled or exhausted — mark as needs-rebase
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
      // Merge failed (non-conflict) — treat as needs-rebase since verification passed.
      // The agent's work is valid; only the merge couldn't complete.
      if (verification) step.verification = verification;
      step.status = "needs-rebase";
      step.error = `Merge failed: ${mergeResult.error}`;
      step.completedAt = new Date().toISOString();

      log.warn("merge failed (treating as needs-rebase)", { ticketId: step.ticketId, error: mergeResult.error });
      this.emit("step_needs_rebase", { step, error: step.error });
      this.logPlanEvent("step_needs_rebase", {
        stepTicketId: step.ticketId,
        agentSessionId: event.sessionId,
        detail: { error: step.error, conflict: false },
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
    if (verification) step.verification = verification;
    step.stallSignal = undefined;
    this.stallDetector.recordStepTransition();

    // Capture changeset before worktree cleanup
    if (event.sessionId) {
      const project = await loadProject(step.projectId);
      if (project) {
        const changeset = await captureChangeset(project.path, {
          sessionId: event.sessionId,
          ticketId: step.ticketId,
          projectId: step.projectId,
          branch: step.worktreeBranch,
        });
        if (changeset) {
          this.eventStore?.insertChangeset(changeset);
          this.logPlanEvent("changeset_recorded", {
            stepTicketId: step.ticketId,
            agentSessionId: event.sessionId,
            detail: {
              files: changeset.files.length,
              insertions: changeset.totalInsertions,
              deletions: changeset.totalDeletions,
            },
          });
        }
      }
    }

    // Clean up worktree after successful merge + verification
    await this.worktreeManager.remove(this.worktreeKey(step)).catch((err) => {
      log.warn("worktree cleanup after merge failed", { ticketId: step.ticketId, error: String(err) });
    });
    step.worktreePath = undefined;
    step.worktreeBranch = undefined;

    // For swarm final subtask, also clear worktree refs from all siblings
    if (this.isSwarmSubtask(step)) {
      const parentId = baseTicketId(step.ticketId);
      for (const s of this.plan.steps) {
        if (s.ticketId !== step.ticketId && baseTicketId(s.ticketId) === parentId) {
          s.worktreePath = undefined;
          s.worktreeBranch = undefined;
        }
      }
    }

    // Ticket transition
    if (this.plan.config.ticketTransitions) {
      await this.updateTicketStatusSafe(step, "closed");
    }

    // Update project summary with completion info
    await this.updateSummary(step);

    this.emit("step_completed", { step });
    this.logPlanEvent("step_completed", {
      stepTicketId: step.ticketId,
      agentSessionId: event.sessionId,
      detail: { mode: "worktree", verification },
    });

    // Write artifact entries for changeset
    await this.writeStepArtifacts(step);
  }

  /**
   * Handle auto-rebase after a merge conflict.
   * Returns true if the step was resolved or re-queued, false if rebase failed entirely.
   */
  private async handleAutoRebase(
    step: PlanStep,
    event: ExecutorEvent,
    roleVerify?: { runTests: boolean; runOracle: boolean },
  ): Promise<boolean> {
    this.logPlanEvent("step_rebase_attempted", {
      stepTicketId: step.ticketId,
      agentSessionId: event.sessionId,
    });

    // Stage 1: attempt clean rebase
    const rebaseResult = await this.worktreeManager.attemptRebase(this.worktreeKey(step));

    if (rebaseResult.rebased) {
      // Clean rebase succeeded — re-verify (upstream changes may break tests)
      log.info("clean rebase succeeded, re-verifying", { ticketId: step.ticketId });
      this.logPlanEvent("step_rebase_resolved", {
        stepTicketId: step.ticketId,
        agentSessionId: event.sessionId,
        detail: { method: "clean" },
      });

      step.status = "verifying";
      step.verification = undefined;
      this.stallDetector.recordStepTransition();
      await savePlan(this.plan);
      this.emit("plan_updated", { plan: this.plan });

      const reVerification = await this.runVerification(step, event, roleVerify);

      if (reVerification && !reVerification.passed) {
        // Post-rebase verification failed — enter retry loop
        const attempt = step.attempt ?? 1;
        const maxRetries = this.plan.config.verification.maxRetries ?? 2;
        const maxAttempts = 1 + maxRetries;

        if (attempt < maxAttempts) {
          step.attempt = attempt + 1;
          step.previousVerification = reVerification;
          step.verification = reVerification;
          step.status = "ready";
          step.agentSessionId = undefined;
          step.completedAt = undefined;
          step.error = undefined;
          this.logPlanEvent("step_retry", {
            stepTicketId: step.ticketId,
            agentSessionId: event.sessionId,
            detail: { attempt: step.attempt, reason: "post-rebase verification failed" },
          });
          return true; // re-queued for retry
        }

        // Out of retries — hard fail
        const reason = `Post-rebase verification failed after ${attempt} attempt(s): ${reVerification.failureReasons.join("; ")}`;
        await this.failStep(step, reason);
        step.verification = reVerification;
        this.emit("step_failed", { step, error: reason });
        this.logPlanEvent("step_rebase_failed", {
          stepTicketId: step.ticketId,
          agentSessionId: event.sessionId,
          detail: { reason },
        });
        if (this.plan.config.pauseOnFailure) {
          this.plan.status = "paused";
          await savePlan(this.plan);
          this.emit("plan_paused", { plan: this.plan });
        }
        return true; // handled (failed)
      }

      // Post-rebase verification passed — merge again
      const reMerge = await this.worktreeManager.merge(this.worktreeKey(step));
      if (reMerge.merged) {
        // Success — complete the step
        step.status = "done";
        step.completedAt = new Date().toISOString();
        if (reVerification) step.verification = reVerification;
        step.stallSignal = undefined;
        this.stallDetector.recordStepTransition();

        if (event.sessionId) {
          const project = await loadProject(step.projectId);
          if (project) {
            const changeset = await captureChangeset(project.path, {
              sessionId: event.sessionId,
              ticketId: step.ticketId,
              projectId: step.projectId,
              branch: step.worktreeBranch,
            });
            if (changeset) {
              this.eventStore?.insertChangeset(changeset);
            }
          }
        }

        await this.worktreeManager.remove(this.worktreeKey(step)).catch(() => {});
        step.worktreePath = undefined;
        step.worktreeBranch = undefined;

        if (this.plan.config.ticketTransitions) {
          await this.updateTicketStatusSafe(step, "closed");
        }

        await this.updateSummary(step);
        this.emit("step_completed", { step });
        this.logPlanEvent("step_completed", {
          stepTicketId: step.ticketId,
          agentSessionId: event.sessionId,
          detail: { mode: "worktree", rebase: "clean", verification: reVerification },
        });
        await this.writeStepArtifacts(step);
        return true;
      }

      // Post-rebase merge still conflicts — fall through to needs-rebase
      log.warn("post-rebase merge still conflicts", { ticketId: step.ticketId });
      return false;
    }

    if (rebaseResult.conflict) {
      // Stage 2: start agent to resolve conflicts
      log.info("rebase has conflicts, starting agent resolution", {
        ticketId: step.ticketId,
        conflictFiles: rebaseResult.conflictFiles,
      });

      step.rebaseConflict = {
        files: rebaseResult.conflictFiles ?? [],
        baseBranch: "main",
      };
      step.status = "ready";
      step.agentSessionId = undefined;
      step.completedAt = undefined;
      step.error = undefined;

      this.logPlanEvent("step_rebase_agent_started", {
        stepTicketId: step.ticketId,
        agentSessionId: event.sessionId,
        detail: { conflictFiles: rebaseResult.conflictFiles },
      });

      return true; // re-queued for agent resolution
    }

    // Rebase failed for non-conflict reason — fall through to needs-rebase
    log.warn("rebase failed (non-conflict)", { ticketId: step.ticketId, error: rebaseResult.error });
    this.logPlanEvent("step_rebase_failed", {
      stepTicketId: step.ticketId,
      agentSessionId: event.sessionId,
      detail: { error: rebaseResult.error },
    });
    return false;
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
   * Resolve the effective verification mode for a step.
   * Returns the explicit mode if set on the step (from work item frontmatter),
   * or undefined to use the existing verification pipeline (role + plan config).
   */
  private resolveVerificationMode(step: PlanStep): VerificationMode | undefined {
    return step.verificationMode;
  }

  /**
   * Run output-exists verification: check that expected files exist and are non-empty.
   */
  private async runOutputExistsVerification(
    step: PlanStep,
    event: ExecutorEvent,
  ): Promise<VerificationResult> {
    const project = await loadProject(step.projectId);
    const result: VerificationResult = {
      stepTicketId: step.ticketId,
      passed: true,
      failureReasons: [],
    };

    // Find expected outputs from the ticket
    const tickets = project ? await scanTickets(project.path) : [];
    const workItem = tickets.find((t) => t.id === this.ticketLookupId(step));
    const expectedOutputs = workItem?.outputs ?? [];

    if (expectedOutputs.length === 0) {
      // No outputs specified — pass (agent produced something, we just can't check specific files)
      log.info("output-exists: no outputs specified, passing by default", { ticketId: step.ticketId });
      return result;
    }

    const basePath = step.worktreePath ?? project?.path ?? "";
    for (const output of expectedOutputs) {
      const fullPath = join(basePath, output);
      try {
        const st = await stat(fullPath);
        if (st.size === 0) {
          result.passed = false;
          result.failureReasons.push(`Output file is empty: ${output}`);
        }
      } catch {
        result.passed = false;
        result.failureReasons.push(`Output file not found: ${output}`);
      }
    }

    this.logPlanEvent("step_verified", {
      stepTicketId: step.ticketId,
      agentSessionId: event.sessionId,
      detail: { verification: result, mode: "output-exists" },
    });

    return result;
  }

  /**
   * Run verification (test gate + oracle) after merge succeeds.
   * Returns null if both are disabled, a result object otherwise.
   */
  private async runVerification(
    step: PlanStep,
    event: ExecutorEvent,
    roleVerification?: { runTests: boolean; runOracle: boolean },
  ): Promise<VerificationResult | null> {
    const verification = roleVerification ?? this.plan.config.verification;
    if (!verification.runTests && !verification.runOracle) return null;

    const project = await loadProject(step.projectId);
    if (!project) return null;

    const result: VerificationResult = {
      stepTicketId: step.ticketId,
      passed: true,
      failureReasons: [],
    };

    // --- Test gate ---
    // Run tests in the worktree if available (verification runs before merge)
    const testPath = step.worktreePath ?? project.path;
    const resolvedTestCmd = this.resolveTestCommandFromProject(project);
    if (verification.runTests && resolvedTestCmd) {
      step.verifyingPhase = "testing";
      step.verifyingPhaseStartedAt = new Date().toISOString();
      await savePlan(this.plan);
      this.emit("plan_updated", { plan: this.plan });
      this.logPlanEvent("step_verify_phase", {
        stepTicketId: step.ticketId,
        detail: { phase: "testing", startedAt: step.verifyingPhaseStartedAt },
      });
      const testResult = await this.runTestGate(testPath, resolvedTestCmd);
      result.testGate = testResult;
      if (!testResult.passed) {
        result.passed = false;
        if (testResult.totalTests === 0) {
          result.failureReasons.push(
            "Test command failed (no test results parsed from output)",
          );
        } else {
          result.failureReasons.push(
            `Tests failed: ${testResult.failedTests}/${testResult.totalTests} failed`,
          );
        }
      }
      log.info("test gate result", {
        ticketId: step.ticketId,
        passed: testResult.passed,
        total: testResult.totalTests,
        failed: testResult.failedTests,
      });

      // Ingest test gate results into the context graph
      if (testResult.output) {
        try {
          const commitHash = await this.getCommitHash(testPath);
          const runId = `verify-${step.ticketId}-${Date.now()}`;
          ingestTestResults(project.name, testResult.output, commitHash, runId);
        } catch {
          // Graph ingestion is non-fatal
        }
      }
    }

    // --- Oracle (runs as agent session) ---
    if (verification.runOracle) {
      step.verifyingPhase = "oracle";
      step.verifyingPhaseStartedAt = new Date().toISOString();
      await savePlan(this.plan);
      this.emit("plan_updated", { plan: this.plan });
      this.logPlanEvent("step_verify_phase", {
        stepTicketId: step.ticketId,
        detail: { phase: "oracle", startedAt: step.verifyingPhaseStartedAt },
      });
      try {
        const tickets = await scanTickets(project.path);
        // For subtask steps (parent/subtask), look up the subtask ID
        const oracleLookupId = step.ticketId.includes("/") && !step.teamId
          ? step.ticketId.split("/").pop()!
          : step.ticketId;
        const workItem = tickets.find((t) => t.id === oracleLookupId);
        if (workItem) {
          const oracleInput = await collectOracleInputs(
            project.path,
            event.sessionId ?? "",
            workItem,
            {
              worktreePath: step.worktreePath,
              worktreeBranch: step.worktreeBranch,
            },
          );

          // For final swarm subtask, include parent ticket's acceptance criteria
          if (this.isFinalSwarmSubtask(step)) {
            const parentId = baseTicketId(step.ticketId);
            const parentTicket = tickets.find((t) => t.id === parentId);
            if (parentTicket) {
              const parentCriteria = await extractAcceptanceCriteria(parentTicket.filePath);
              if (parentCriteria.length > 0) {
                oracleInput.acceptanceCriteria = [
                  ...oracleInput.acceptanceCriteria,
                  ...parentCriteria.map((c) => `[parent] ${c}`),
                ];
              }
            }
          }

          // Feed test results into oracle context
          if (result.testGate) {
            oracleInput.testResults = result.testGate.output;
          }
          const oracleModel = "oracleModel" in verification
            ? (verification as { oracleModel?: string }).oracleModel
            : this.plan.config.verification.oracleModel;

          const oraclePrompt = formatOraclePrompt(oracleInput);
          const oracleResponse = await this.runOracleAgent(step, oraclePrompt, oracleModel, result);
          if (oracleResponse) {
            const oracleResult = parseOracleResponse(oracleResponse);
            result.oracle = oracleResult;
            if (!oracleResult.passed) {
              result.passed = false;
              const unmet = oracleResult.criteria
                .filter((c) => !c.met)
                .map((c) => c.criterion);
              result.failureReasons.push(
                `Oracle: ${unmet.length} criteria unmet`,
              );
            }
            log.info("oracle result", {
              ticketId: step.ticketId,
              passed: oracleResult.passed,
              criteriaCount: oracleResult.criteria.length,
              concerns: oracleResult.concerns.length,
            });
          }
        } else {
          result.oracleError = "ticket not found for oracle evaluation";
          result.passed = false;
          result.failureReasons.push("Oracle: ticket not found — cannot evaluate");
          log.warn("oracle skipped: ticket not found", { ticketId: step.ticketId });
        }
      } catch (err) {
        result.oracleError = String(err);
        result.passed = false;
        result.failureReasons.push(`Oracle: evaluation failed — ${String(err)}`);
        log.warn("oracle evaluation failed", { ticketId: step.ticketId, error: String(err) });
      }
    }

    step.verifyingPhase = undefined;
    step.verifyingPhaseStartedAt = undefined;
    await savePlan(this.plan);
    this.emit("plan_updated", { plan: this.plan });

    this.logPlanEvent("step_verified", {
      stepTicketId: step.ticketId,
      agentSessionId: event.sessionId,
      detail: { verification: result },
    });

    // Write state entries for verification
    await this.writeVerificationState(step, result);

    return result;
  }

  /**
   * Run the project's test command and parse results.
   */
  private async runTestGate(projectPath: string, testCommand: string): Promise<TestGateResult> {
    const start = Date.now();
    try {
      const parts = testCommand.split(/\s+/);
      const { stdout, stderr } = await execFileAsync(parts[0], parts.slice(1), {
        cwd: projectPath,
        timeout: 300_000, // 5 min timeout for tests
        maxBuffer: 10 * 1024 * 1024,
      });
      const output = stdout + stderr;
      const { total, passed, failed } = parseTestOutput(output);
      return {
        passed: true,
        testCommand,
        totalTests: total,
        passedTests: passed,
        failedTests: failed,
        output: truncateTestOutput(output),
        durationMs: Date.now() - start,
      };
    } catch (err: unknown) {
      const errObj = err as { stdout?: string; stderr?: string };
      const output = (errObj.stdout && errObj.stderr)
        ? errObj.stdout + errObj.stderr
        : errObj.stdout ?? errObj.stderr ?? String(err);
      const { total, passed, failed } = parseTestOutput(output);
      return {
        passed: false,
        testCommand,
        totalTests: total,
        passedTests: passed,
        failedTests: failed,
        output: truncateTestOutput(output),
        durationMs: Date.now() - start,
      };
    }
  }

  /**
   * Run oracle evaluation as an agent session.
   * Starts an oracle-role agent, waits for it to finish, collects response text.
   * Returns null if the oracle session fails to produce a response.
   */
  private async runOracleAgent(
    step: PlanStep,
    prompt: string,
    model: string | undefined,
    result: VerificationResult,
  ): Promise<string | null> {
    const project = await loadProject(step.projectId);
    if (!project) return null;

    // Set up event listeners BEFORE starting the session to avoid
    // a race where the oracle finishes before listeners are registered.
    let oracleSessionId: string | undefined;
    let text = "";
    let cleanup: () => void;

    const responseText = await new Promise<string>(async (resolve, reject) => {
      const onEvent = ({ sessionId, event: ev }: { sessionId: string; event: import("@opcom/types").NormalizedEvent }) => {
        if (!oracleSessionId || sessionId !== oracleSessionId) return;
        if (ev.type === "message_delta" && ev.data?.text) {
          text += ev.data.text;
        }
      };

      const onStopped = (stopped: import("@opcom/types").AgentSession) => {
        if (!oracleSessionId || stopped.id !== oracleSessionId) return;
        cleanup();
        resolve(text);
      };

      const timer = setTimeout(() => {
        cleanup();
        if (oracleSessionId) {
          this.sessionManager.stopSession(oracleSessionId).catch(() => {});
        }
        reject(new Error("Oracle agent timed out after 180s"));
      }, 180_000);

      cleanup = () => {
        clearTimeout(timer);
        this.sessionManager.off("agent_event", onEvent);
        this.sessionManager.off("session_stopped", onStopped);
      };

      this.sessionManager.on("agent_event", onEvent);
      this.sessionManager.on("session_stopped", onStopped);

      // Now start the session — listeners are already in place
      try {
        const session = await this.sessionManager.startSession(
          step.projectId,
          this.plan.config.backend as "claude-code" | "opencode",
          {
            projectPath: project.path,
            contextPacket: {
              project: {
                name: project.name,
                path: project.path,
                stack: project.stack,
                testing: project.testing,
                linting: project.linting,
                services: project.services,
              },
              git: {
                branch: project.git?.branch ?? "main",
                remote: project.git?.remote ?? null,
                clean: true,
              },
            },
            systemPrompt: prompt,
            model,
            permissionMode: "default",
            disableAllTools: true,
          },
          `oracle:${step.ticketId}`,
        );

        oracleSessionId = session.id;
        result.oracleSessionId = session.id;
        log.info("oracle agent started", { ticketId: step.ticketId, sessionId: session.id });
      } catch (err) {
        cleanup();
        reject(err);
      }
    });

    if (!responseText.trim()) {
      result.oracleError = "Oracle agent produced no response";
      result.passed = false;
      result.failureReasons.push("Oracle: agent produced no response");
      log.warn("oracle agent empty response", { ticketId: step.ticketId, sessionId: oracleSessionId });
      return null;
    }

    return responseText;
  }

  /**
   * Handle agent completion in legacy (non-worktree) mode.
   * Uses write-count tracking from tool events.
   */
  private async handleLegacyCompletion(step: PlanStep, event: ExecutorEvent): Promise<void> {
    const writes = event.sessionId ? (this.sessionWrites.get(event.sessionId) ?? 0) : 0;

    if (writes === 0) {
      const reason = "Agent exited without making any file changes";
      await this.failStep(step, reason);
      if (event.sessionId) {
        this.sessionToStep.delete(event.sessionId);
        this.sessionWrites.delete(event.sessionId);
      }

      log.warn("step failed: no writes", { ticketId: step.ticketId });
      this.emit("step_failed", { step, error: reason });
      this.logPlanEvent("step_failed", {
        stepTicketId: step.ticketId,
        agentSessionId: event.sessionId,
        detail: { error: reason },
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
      step.stallSignal = undefined;
      this.stallDetector.recordStepTransition();
      if (event.sessionId) {
        this.sessionToStep.delete(event.sessionId);
        this.sessionWrites.delete(event.sessionId);
      }

      // Ticket transition
      if (this.plan.config.ticketTransitions) {
        await this.updateTicketStatusSafe(step, "closed");
      }

      // Auto-commit changes and capture changeset
      const project = await loadProject(step.projectId);
      if (project) {
        if (this.plan.config.autoCommit) {
          await commitStepChanges(project.path, step.ticketId);
        }

        if (event.sessionId) {
          const changeset = await captureChangeset(project.path, {
            sessionId: event.sessionId,
            ticketId: step.ticketId,
            projectId: step.projectId,
          });
          if (changeset) {
            this.eventStore?.insertChangeset(changeset);
            this.logPlanEvent("changeset_recorded", {
              stepTicketId: step.ticketId,
              agentSessionId: event.sessionId,
              detail: {
                files: changeset.files.length,
                insertions: changeset.totalInsertions,
                deletions: changeset.totalDeletions,
              },
            });
          }
        }
      }

      await this.updateSummary(step);
      this.emit("step_completed", { step });
      this.logPlanEvent("step_completed", {
        stepTicketId: step.ticketId,
        agentSessionId: event.sessionId,
        detail: { writes },
      });

      // Write artifact entries for changeset
      await this.writeStepArtifacts(step);
    }
  }

  // --- State file writing helpers ---

  /**
   * Write decision + metric entries after verification.
   */
  private async writeVerificationState(step: PlanStep, result: VerificationResult): Promise<void> {
    const now = new Date().toISOString();

    try {
      // Oracle decision
      if (result.oracle) {
        await this.stateStore.appendDecision({
          timestamp: now,
          planId: this.plan.id,
          stepId: step.ticketId,
          agent: "oracle",
          decision: result.oracle.passed ? "Approved step implementation" : "Rejected step implementation",
          rationale: result.oracle.criteria.map((c) => `${c.met ? "✓" : "✗"} ${c.criterion}: ${c.reasoning}`).join("; "),
          confidence: result.oracle.passed ? 1.0 : 0.0,
        });
      }

      // Test gate metrics
      if (result.testGate) {
        await this.stateStore.appendMetric({
          timestamp: now,
          planId: this.plan.id,
          stepId: step.ticketId,
          metric: "test_pass_rate",
          value: result.testGate.totalTests > 0 ? result.testGate.passedTests / result.testGate.totalTests : 0,
          detail: `${result.testGate.passedTests}/${result.testGate.totalTests} tests passed`,
        });

        await this.stateStore.appendMetric({
          timestamp: now,
          planId: this.plan.id,
          stepId: step.ticketId,
          metric: "test_duration_ms",
          value: result.testGate.durationMs,
        });
      }

      // Step attempt count
      if (step.attempt) {
        await this.stateStore.appendMetric({
          timestamp: now,
          planId: this.plan.id,
          stepId: step.ticketId,
          metric: "attempts",
          value: step.attempt,
        });
      }
    } catch (err) {
      log.warn("failed to write verification state", { ticketId: step.ticketId, error: String(err) });
    }
  }

  /**
   * Write artifact entries for a completed step.
   */
  private async writeStepArtifacts(step: PlanStep): Promise<void> {
    const now = new Date().toISOString();

    try {
      // Step duration metric
      if (step.startedAt && step.completedAt) {
        const durationMs = new Date(step.completedAt).getTime() - new Date(step.startedAt).getTime();
        await this.stateStore.appendMetric({
          timestamp: now,
          planId: this.plan.id,
          stepId: step.ticketId,
          metric: "step_duration_ms",
          value: durationMs,
        });
      }

      // Merge artifact
      await this.stateStore.appendArtifact({
        timestamp: now,
        planId: this.plan.id,
        stepId: step.ticketId,
        type: "merge",
        path: "main",
        agent: "executor",
      });
    } catch (err) {
      log.warn("failed to write step artifacts", { ticketId: step.ticketId, error: String(err) });
    }
  }

  /**
   * Write plan completion metrics.
   */
  private async writePlanCompletionState(): Promise<void> {
    const now = new Date().toISOString();

    try {
      const done = this.plan.steps.filter((s) => s.status === "done").length;
      const failed = this.plan.steps.filter((s) => s.status === "failed").length;
      const skipped = this.plan.steps.filter((s) => s.status === "skipped").length;
      const total = this.plan.steps.length;

      await this.stateStore.appendMetric({
        timestamp: now,
        planId: this.plan.id,
        metric: "plan_progress",
        value: total > 0 ? done / total : 0,
        detail: `${done}/${total} steps done, ${failed} failed, ${skipped} skipped`,
      });

      // Plan duration
      if (this.plan.createdAt && this.plan.completedAt) {
        const durationMs = new Date(this.plan.completedAt).getTime() - new Date(this.plan.createdAt).getTime();
        await this.stateStore.appendMetric({
          timestamp: now,
          planId: this.plan.id,
          metric: "plan_duration_ms",
          value: durationMs,
        });
      }

      // Decision: plan completed
      await this.stateStore.appendDecision({
        timestamp: now,
        planId: this.plan.id,
        agent: "executor",
        decision: "Plan completed",
        rationale: `${done}/${total} steps done, ${failed} failed, ${skipped} skipped`,
        confidence: 1.0,
      });
    } catch (err) {
      log.warn("failed to write plan completion state", { planId: this.plan.id, error: String(err) });
    }
  }

  private async recomputeAndContinue(): Promise<void> {
    // Refresh ticket state from disk
    const ticketSets = await this.loadCurrentTickets();
    this.plan = recomputePlan(this.plan, ticketSets);

    // Close parent tickets whose subtask steps are all done
    await this.closeCompletedSubtaskParents();

    await savePlan(this.plan);

    if (this.plan.status === "executing") {
      // Check for stage completion before starting new steps
      if (await this.checkStageCompletion()) {
        // Stage just completed — don't start new steps yet
        this.emit("plan_updated", { plan: this.plan });
        return;
      }
      await this.startReadySteps();
    }

    // Check if plan is complete (but not while paused — user may resume)
    if (this.plan.status !== "paused" && this.isPlanTerminal()) {
      // Mark final stage as completed if stages are active
      this.markCurrentStageCompleted();

      // Run final smoke test before marking plan as done
      const smokeResult = await this.runPlanCompletionSmokeTest();
      if (smokeResult) {
        this.plan.smokeTestResult = smokeResult;
      }

      this.plan.status = "done";
      this.plan.completedAt = new Date().toISOString();
      await savePlan(this.plan);
      this.emit("plan_completed", { plan: this.plan });
      this.logPlanEvent("plan_completed", {
        detail: {
          done: this.plan.steps.filter((s) => s.status === "done").length,
          failed: this.plan.steps.filter((s) => s.status === "failed").length,
          skipped: this.plan.steps.filter((s) => s.status === "skipped").length,
          smokeTest: smokeResult ?? undefined,
        },
      });

      // Write plan completion metrics
      await this.writePlanCompletionState();

      this.running = false;
    }

    this.emit("plan_updated", { plan: this.plan });
  }

  private async startReadySteps(): Promise<void> {
    const running = this.plan.steps.filter((s) => s.status === "in-progress" || s.status === "verifying").length;
    const max = this.plan.config.maxConcurrentAgents;
    const available = max - running;

    if (available <= 0) return;

    // Filter ready steps by current stage if stages are active and autoContinue is off.
    // When autoContinue is true, dependency-based scheduling (blockedBy + ready status)
    // already handles ordering — the stage gate only adds value as a human review checkpoint.
    let ready = this.plan.steps.filter((s) => s.status === "ready");
    if (!this.plan.config.autoContinue) {
      const currentStageIds = this.getCurrentStageStepIds();
      if (currentStageIds) {
        ready = ready.filter((s) => currentStageIds.has(s.ticketId));
      }
    }

    // Sort ready steps: lower priority number first, then fewer blockedBy, then array order
    const prioritySorted = [...ready].sort((a, b) => {
      const pa = this.getStepPriority(a);
      const pb = this.getStepPriority(b);
      if (pa !== pb) return pa - pb;
      return a.blockedBy.length - b.blockedBy.length;
    });

    // Apply strategy-based reordering (spread/swarm/mixed)
    const sorted = applyStrategy(prioritySorted, this.plan.config.strategy);

    // Collect files claimed by active steps
    const claimedFiles = new Set<string>();
    for (const step of this.plan.steps) {
      if (step.status === "in-progress" || step.status === "verifying") {
        for (const f of this.getStepFiles(step)) claimedFiles.add(f);
      }
    }

    // Filter: skip steps that overlap with claimed files or with each other
    const toStart: PlanStep[] = [];
    for (const step of sorted) {
      if (toStart.length >= available) break;
      const files = this.getStepFiles(step);
      if (files.length > 0 && files.some((f) => claimedFiles.has(f))) {
        log.info("holding step due to file overlap", { ticketId: step.ticketId, overlappingFiles: files.filter((f) => claimedFiles.has(f)) });
        continue;
      }
      toStart.push(step);
      for (const f of files) claimedFiles.add(f);
    }

    for (const step of toStart) {
      try {
        await this.startStep(step);
      } catch (err) {
        log.error("failed to start step", { ticketId: step.ticketId, error: String(err) });
        await this.failStep(step, String(err));
      }
    }
  }

  /** Get related files for a step from the context graph (cached). */
  private getStepFiles(step: PlanStep): string[] {
    if (this.stepFiles.has(step.ticketId)) return this.stepFiles.get(step.ticketId)!;
    try {
      const tickets = this.ticketCache.get(step.projectId);
      const workItem = tickets?.find((t) => t.id === this.ticketLookupId(step));
      const ctx = queryGraphContext(step.projectId, step.ticketId, workItem?.links ?? []);
      const files = ctx?.relatedFiles ?? [];
      this.stepFiles.set(step.ticketId, files);
      return files;
    } catch {
      this.stepFiles.set(step.ticketId, []);
      return [];
    }
  }

  /** Get priority for a step from cached ticket data. */
  private getStepPriority(step: PlanStep): number {
    const tickets = this.ticketCache.get(step.projectId);
    const workItem = tickets?.find((t) => t.id === this.ticketLookupId(step));
    return workItem?.priority ?? 4;
  }

  private isSwarmSubtask(step: PlanStep): boolean {
    return isSwarmSubtask(step, this.plan.steps);
  }

  private isFinalSwarmSubtask(step: PlanStep): boolean {
    return isFinalSwarmSubtask(step, this.plan.steps);
  }

  private getStepVerificationMode(step: PlanStep): { runTests: boolean; runOracle: boolean } | undefined {
    return getSwarmVerificationMode(step, this.plan.steps);
  }

  private findSwarmWorktree(step: PlanStep): { worktreePath: string; worktreeBranch: string } | null {
    return findSwarmWorktree(step, this.plan.steps);
  }

  /**
   * Return the worktree manager lookup key for a step.
   * Swarm subtasks and team sub-steps share a single worktree keyed by the
   * parent ticket ID, so we must use baseTicketId for lookups/operations.
   */
  private worktreeKey(step: PlanStep): string {
    if (step.teamId || this.isSwarmSubtask(step)) {
      return baseTicketId(step.ticketId);
    }
    return step.ticketId;
  }

  /**
   * Return the raw ticket ID for WorkItem lookup.
   * Plan steps use "parent/child" format for swarm subtasks, but WorkItems
   * from scanTickets() use just the child basename.  Team sub-steps use
   * "base/role" and should look up the base ticket.
   */
  private ticketLookupId(step: PlanStep): string {
    if (step.teamId) return baseTicketId(step.ticketId);
    const slash = step.ticketId.lastIndexOf("/");
    if (slash >= 0 && this.isSwarmSubtask(step)) {
      return step.ticketId.slice(slash + 1);
    }
    return step.ticketId;
  }

  private async startStep(step: PlanStep): Promise<void> {
    const project = await loadProject(step.projectId);
    if (!project) {
      throw new Error(`Project not found: ${step.projectId}`);
    }

    const tickets = await scanTickets(project.path);
    const workItem = tickets.find((t) => t.id === this.ticketLookupId(step));

    // Sync verification mode from work item (may have been added after plan creation)
    if (workItem?.verification && !step.verificationMode) {
      step.verificationMode = workItem.verification;
    }

    // Resolve role early so buildContextPacket can match skills
    const roleId = step.role ?? workItem?.role ?? "engineer";
    const roleDef = await loadRole(roleId);

    const contextPacket = await buildContextPacket(project, workItem, roleDef);

    // Create worktree if enabled — agent runs in isolation
    // Skip creation if rebaseConflict is set (worktree already exists from the original step)
    // Team sub-steps share the worktree from earlier steps in the same team sequence
    // Swarm subtasks share worktree from sibling steps of the same parent
    let agentCwd: string | undefined;
    const teamWorktree = step.teamId ? this.findTeamWorktree(step) : null;
    const swarmWorktree = !teamWorktree ? this.findSwarmWorktree(step) : null;
    if (teamWorktree) {
      // Reuse worktree from a prior team step on the same ticket
      step.worktreePath = teamWorktree.worktreePath;
      step.worktreeBranch = teamWorktree.worktreeBranch;
      agentCwd = teamWorktree.worktreePath;
      contextPacket.project.path = teamWorktree.worktreePath;
    } else if (swarmWorktree) {
      // Reuse worktree from a sibling swarm subtask (shared branch)
      step.worktreePath = swarmWorktree.worktreePath;
      step.worktreeBranch = swarmWorktree.worktreeBranch;
      agentCwd = swarmWorktree.worktreePath;
      contextPacket.project.path = swarmWorktree.worktreePath;
      log.info("reusing swarm worktree", { ticketId: step.ticketId, worktree: swarmWorktree.worktreePath });
    } else if (this.plan.config.worktree && !step.rebaseConflict) {
      // Swarm subtasks use parent ID so all siblings share one worktree
      const worktreeId = step.teamId ? baseTicketId(step.ticketId)
        : this.isSwarmSubtask(step) ? baseTicketId(step.ticketId)
        : step.ticketId;
      const wtInfo = await this.worktreeManager.create(
        project.path,
        worktreeId,
        worktreeId,
      );
      step.worktreePath = wtInfo.worktreePath;
      step.worktreeBranch = wtInfo.branch;
      agentCwd = wtInfo.worktreePath;

      // Point the context packet at the worktree so the agent uses worktree
      // paths for all file operations instead of writing to the main tree.
      contextPacket.project.path = wtInfo.worktreePath;
    } else if (step.worktreePath) {
      // Reuse existing worktree (rebase resolution or retry)
      agentCwd = step.worktreePath;
      contextPacket.project.path = step.worktreePath;
    }

    // Resolve role config: role definition → stack tools → plan overrides
    const stackBashPatterns = deriveAllowedBashTools(
      { stack: project.stack, testing: project.testing, linting: project.linting },
    ).map((t) => t.replace(/^Bash\(/, "").replace(/\)$/, ""));
    const resolved = resolveRoleConfig(roleDef, stackBashPatterns, this.plan.config);

    // Build allowed tools: merge role bash patterns into Bash() format + role allowedTools
    const allowedBashTools = resolved.allowedBashPatterns.map((p) => `Bash(${p})`);
    const allowedTools = [...allowedBashTools, ...resolved.allowedTools];

    // Rebase conflict agents need git rebase permissions
    if (step.rebaseConflict) {
      allowedTools.push("Bash(git rebase*)", "Bash(git add*)", "Bash(git diff*)");
    }

    // Build stall warning if the agent is repeating the same failure
    const stallWarning = this.stallDetector.buildStallWarning(step);

    // Build system prompt with role-aware context (and retry feedback if applicable)
    const systemPrompt = contextPacketToMarkdown(
      contextPacket, resolved, step.previousVerification, step.rebaseConflict, stallWarning ?? undefined, step.verificationMode,
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
        permissionMode: resolved.permissionMode as "default" | "acceptEdits" | "bypassPermissions" | "plan",
        disallowedTools: resolved.disallowedTools,
        allowedTools,
        additionalDirs: agentCwd ? [agentCwd] : [project.path],
        systemPrompt,
      },
      step.ticketId,
    );

    step.status = "in-progress";
    step.agentSessionId = session.id;
    step.startedAt = new Date().toISOString();
    step.verifyingPhase = undefined;
    step.verifyingPhaseStartedAt = undefined;
    step.stallSignal = undefined; // Clear any previous stall signal
    this.sessionToStep.set(session.id, step.ticketId);
    this.stallDetector.recordStepTransition();
    this.stepVerification.set(step.ticketId, { runTests: resolved.runTests, runOracle: resolved.runOracle });
    if (resolved.denyPaths.length > 0) {
      this.stepDenyPaths.set(step.ticketId, { denyPaths: resolved.denyPaths, roleId: resolved.roleId });
    }

    // Cache agent constraints for forbidden command checking during execution
    if (project.profile?.agentConstraints?.length) {
      this.stepConstraints.set(step.ticketId, project.profile.agentConstraints);
    }

    // Write lock file so cleanupOrphaned() won't remove this worktree
    if (this.plan.config.worktree && session.pid) {
      await this.worktreeManager.writeLock(this.worktreeKey(step), session.pid).catch((err) => {
        log.warn("failed to write worktree lock", { ticketId: step.ticketId, error: String(err) });
      });
    }

    // Ticket transition: open → in-progress
    // In worktree mode, skip this — modifying ticket files on the main tree
    // creates uncommitted changes that block worktree merges later.
    // The plan step status already tracks in-progress state; ticket files
    // are only updated after merge (closed) or on failure (reset to open).
    if (this.plan.config.ticketTransitions && !this.plan.config.worktree) {
      await this.updateTicketStatusSafe(step, "in-progress");
    }

    await savePlan(this.plan);
    this.emit("step_started", { step, session });
    this.logPlanEvent("step_started", {
      stepTicketId: step.ticketId,
      agentSessionId: session.id,
    });
  }

  /**
   * Find an existing worktree from a prior team step on the same ticket.
   * Team sub-steps share a single worktree so each agent picks up where the last left off.
   */
  private findTeamWorktree(step: PlanStep): { worktreePath: string; worktreeBranch?: string } | null {
    if (!step.teamId) return null;
    const base = baseTicketId(step.ticketId);
    for (const s of this.plan.steps) {
      if (s === step) continue;
      if (s.teamId === step.teamId && baseTicketId(s.ticketId) === base && s.worktreePath) {
        return { worktreePath: s.worktreePath, worktreeBranch: s.worktreeBranch };
      }
    }
    return null;
  }

  private async getCommitHash(cwd: string): Promise<string> {
    try {
      const { stdout } = await execFileAsync("git", ["rev-parse", "HEAD"], { cwd });
      return stdout.trim();
    } catch {
      return "unknown";
    }
  }

  // --- Stage management ---

  /**
   * Initialize stages from config or auto-compute from DAG.
   */
  private initializeStages(): void {
    if (this.plan.config.stages && this.plan.config.stages.length > 0) {
      this.plan.stages = buildExplicitStages(this.plan.steps, this.plan.config.stages);
    } else if (this.plan.config.strategy === "swarm") {
      this.plan.stages = computeDepthStages(this.plan.steps);
    } else {
      this.plan.stages = computeStages(this.plan.steps, this.plan.config.maxStageSize);
    }

    // Only use stages if there are 2+ (single stage adds no value)
    if (this.plan.stages.length <= 1) {
      this.plan.stages = undefined;
      this.plan.currentStage = undefined;
      return;
    }

    this.plan.currentStage = 0;
    this.plan.stages[0].status = "executing";
    this.plan.stages[0].startedAt = new Date().toISOString();
  }

  /**
   * Get the set of step ticket IDs in the current stage, or null if stages aren't active.
   */
  private getCurrentStageStepIds(): Set<string> | null {
    if (!this.plan.stages || this.plan.currentStage === undefined) return null;
    const stage = this.plan.stages[this.plan.currentStage];
    if (!stage) return null;
    return new Set(stage.stepTicketIds);
  }

  /**
   * Check if the current stage is complete. If so, run smoke tests,
   * emit stage_completed, and either auto-continue or pause for approval.
   * When autoContinue is true, advances through all completed stages
   * (later-stage tickets may already be done when autoContinue skips stage gating).
   * Returns true if a stage just completed and we're pausing (caller should not start new steps).
   */
  private async checkStageCompletion(): Promise<boolean> {
    if (!this.plan.stages || this.plan.currentStage === undefined) return false;

    // Loop to advance through multiple completed stages (relevant when
    // autoContinue skips stage gating and later-stage tickets finish early)
    while (this.plan.currentStage < this.plan.stages.length) {
      const stage = this.plan.stages[this.plan.currentStage];
      if (!stage || stage.status !== "executing") return false;

      // Check if all steps in this stage are terminal
      const stageSteps = this.plan.steps.filter((s) =>
        stage.stepTicketIds.includes(s.ticketId),
      );
      const allTerminal = stageSteps.every(
        (s) => s.status === "done" || s.status === "failed" || s.status === "skipped" || s.status === "needs-rebase",
      );

      if (!allTerminal) return false;

      // Stage is complete
      this.markCurrentStageCompleted();

      const summary = computeStageSummary(stage, this.plan.steps);

      // Run smoke test after batch (stage) completion
      const smokeResult = await this.runStageSmokeTest(stage.index);
      if (smokeResult) {
        summary.smokeTest = smokeResult;
      }

      stage.summary = summary;

      this.emit("stage_completed", { planId: this.plan.id, stage, summary });
      this.logPlanEvent("stage_completed", {
        detail: { stageIndex: stage.index, summary },
      });

      // If smoke test failed, pause the plan with clear error
      if (smokeResult && !smokeResult.passed) {
        const reason = smokeResult.buildPassed
          ? "Smoke test failed: tests failed after stage " + stage.index
          : "Smoke test failed: build failed after stage " + stage.index;
        this.plan.status = "paused";
        await savePlan(this.plan);
        this.emit("plan_paused", { plan: this.plan });
        this.logPlanEvent("plan_paused", { detail: { reason, stageIndex: stage.index } });
        return true;
      }

      // Check if there's a next stage
      const nextIdx = this.plan.currentStage + 1;
      if (nextIdx >= this.plan.stages.length) {
        // No more stages — plan will complete naturally
        return false;
      }

      if (this.plan.config.autoContinue) {
        // Auto-advance to next stage and continue loop to check if it's also done
        this.advanceToNextStage();
        continue;
      }

      // Pause for user approval
      this.plan.status = "paused";
      savePlan(this.plan).catch(() => {});
      this.emit("plan_paused", { plan: this.plan });
      this.logPlanEvent("plan_paused", { detail: { reason: "stage_gate", stageIndex: stage.index } });
      return true;
    }

    return false;
  }

  /**
   * Mark the current stage as completed with appropriate status.
   */
  private markCurrentStageCompleted(): void {
    if (!this.plan.stages || this.plan.currentStage === undefined) return;
    const stage = this.plan.stages[this.plan.currentStage];
    if (!stage || stage.status !== "executing") return;

    const stageSteps = this.plan.steps.filter((s) =>
      stage.stepTicketIds.includes(s.ticketId),
    );
    const hasFailed = stageSteps.some(
      (s) => s.status === "failed" || s.status === "needs-rebase",
    );

    stage.status = hasFailed ? "failed" : "completed";
    stage.completedAt = new Date().toISOString();
  }

  /**
   * Advance to the next stage.
   */
  private advanceToNextStage(): void {
    if (!this.plan.stages || this.plan.currentStage === undefined) return;
    const nextIdx = this.plan.currentStage + 1;
    if (nextIdx >= this.plan.stages.length) return;

    this.plan.currentStage = nextIdx;
    const nextStage = this.plan.stages[nextIdx];
    nextStage.status = "executing";
    nextStage.startedAt = new Date().toISOString();
  }

  /**
   * Run a smoke test after a stage (batch) completes.
   * Returns null if no project path could be resolved.
   */
  private async runStageSmokeTest(stageIndex: number): Promise<IntegrationTestResult | null> {
    const projectPath = await this.resolveProjectPath();
    if (!projectPath) return null;

    const testCommand = await this.resolveSmokeTestCommand();
    log.info("running smoke test after stage", { stageIndex });

    const result = await runSmoke(projectPath, testCommand);
    this.emit("smoke_test", { planId: this.plan.id, result, trigger: "stage", stageIndex });
    this.logPlanEvent("smoke_test", {
      detail: { trigger: "stage", stageIndex, result },
    });
    return result;
  }

  /**
   * Run a final smoke test when the plan completes.
   * Returns null if no project path could be resolved.
   */
  private async runPlanCompletionSmokeTest(): Promise<IntegrationTestResult | null> {
    const projectPath = await this.resolveProjectPath();
    if (!projectPath) return null;

    const testCommand = await this.resolveSmokeTestCommand();
    log.info("running final smoke test on plan completion");

    const result = await runSmoke(projectPath, testCommand);
    this.emit("smoke_test", { planId: this.plan.id, result, trigger: "plan_completion" });
    this.logPlanEvent("smoke_test", {
      detail: { trigger: "plan_completion", result },
    });
    return result;
  }

  /** Resolve the primary project path from the plan's steps. */
  private async resolveProjectPath(): Promise<string | null> {
    const projectId = this.plan.steps[0]?.projectId;
    if (!projectId) return null;
    const project = await loadProject(projectId);
    return project?.path ?? null;
  }

  /**
   * Resolve the test command for a project.
   * Precedence: plan-level override > profile "test" command > detected testing > fallback.
   */
  resolveTestCommandFromProject(project: { profile?: { commands?: Array<{ name: string; command: string }> }; testing?: { command?: string } | null }): string {
    if (this.plan.config.testCommand) return this.plan.config.testCommand;
    const profileTest = project.profile?.commands?.find((c) => c.name === "test");
    if (profileTest) return profileTest.command;
    if (project.testing?.command) return project.testing.command;
    return "npm test";
  }

  /**
   * Resolve the smoke/full test command for stage and plan-completion tests.
   * Precedence: plan-level override > profile "testFull" > profile "test" > detected > fallback.
   */
  resolveSmokeTestCommandFromProject(project: { profile?: { commands?: Array<{ name: string; command: string }> }; testing?: { command?: string } | null }): string {
    if (this.plan.config.testCommand) return this.plan.config.testCommand;
    const profileTestFull = project.profile?.commands?.find((c) => c.name === "testFull");
    if (profileTestFull) return profileTestFull.command;
    return this.resolveTestCommandFromProject(project);
  }

  /** Resolve the test command from the primary project (for step verification). */
  private async resolveTestCommand(): Promise<string> {
    const projectId = this.plan.steps[0]?.projectId;
    if (!projectId) return "npm test";
    const project = await loadProject(projectId);
    if (!project) return "npm test";
    return this.resolveTestCommandFromProject(project);
  }

  /** Resolve the smoke test command from the primary project (for stage/plan completion). */
  private async resolveSmokeTestCommand(): Promise<string> {
    const projectId = this.plan.steps[0]?.projectId;
    if (!projectId) return "npm test";
    const project = await loadProject(projectId);
    if (!project) return "npm test";
    return this.resolveSmokeTestCommandFromProject(project);
  }

  /** Don't exit the event loop while paused — resume needs a live loop. */
  private shouldExitLoop(): boolean {
    if (this.plan.status === "paused") return false;
    return this.isPlanTerminal();
  }

  private isPlanTerminal(): boolean {
    if (this.activeVerifications > 0) return false;
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
        this.ticketCache.set(pid, tickets);
      } catch {
        // Skip failed scans
      }
    }

    return ticketSets;
  }

  /**
   * Mark a step as failed and reset the ticket back to open so the planner
   * picks it up on the next run.
   */
  /**
   * Run periodic stall detection checks.
   * Emits stall_detected events and annotates steps with stall signals.
   */
  private async runStallChecks(): Promise<void> {
    if (this.plan.status !== "executing") return;

    // Check which in-progress steps have commits in their worktrees
    // so the stall detector doesn't flag them as "no commits"
    const stepsWithCommits = new Set<string>();
    if (this.plan.config.worktree) {
      for (const step of this.plan.steps) {
        if (step.status === "in-progress" && step.worktreePath) {
          const has = await this.worktreeManager.hasCommits(this.worktreeKey(step)).catch(() => false);
          if (has) stepsWithCommits.add(step.ticketId);
        }
      }
    }

    const signals = this.stallDetector.checkAll(this.plan, stepsWithCommits);
    let updated = false;

    for (const signal of signals) {
      // Annotate the step with the stall signal for TUI display
      if (signal.stepId) {
        const step = this.plan.steps.find((s) => s.ticketId === signal.stepId);
        if (step && !step.stallSignal) {
          step.stallSignal = signal;
          updated = true;
        }
      }

      log.warn("stall detected", { type: signal.type, stepId: signal.stepId, message: signal.message });
      this.emit("stall_detected", { signal });
      this.logPlanEvent("stall_detected", {
        stepTicketId: signal.stepId,
        agentSessionId: signal.sessionId,
        detail: { signal },
      });
    }

    // Pause plan on plan-level stall if pauseOnFailure is enabled
    const planStall = signals.find((s) => s.type === "plan-stall");
    if (planStall && this.plan.config.pauseOnFailure) {
      this.plan.status = "paused";
      await savePlan(this.plan);
      this.emit("plan_paused", { plan: this.plan });
      this.logPlanEvent("plan_paused", { detail: { reason: "plan_stalled" } });
      return;
    }

    if (updated) {
      await savePlan(this.plan);
      this.emit("plan_updated", { plan: this.plan });
    }
  }

  private async failStep(step: PlanStep, error: string): Promise<void> {
    step.status = "failed";
    step.error = error;
    step.completedAt = new Date().toISOString();
    step.verifyingPhase = undefined;
    step.verifyingPhaseStartedAt = undefined;
    step.stallSignal = undefined;
    this.stallDetector.recordStepTransition();
    if (this.plan.config.ticketTransitions) {
      await this.updateTicketStatusSafe(step, "open");
    }
  }

  private async updateSummary(step: PlanStep): Promise<void> {
    try {
      const project = await loadProject(step.projectId);
      if (!project) return;
      const tickets = this.ticketCache.get(step.projectId);
      const ticket = tickets?.find((t) => t.id === this.ticketLookupId(step));
      await updateProjectSummary(step.projectId, project.name, {
        completedTicketId: step.ticketId,
        completedTicketTitle: ticket?.title ?? step.ticketId,
      });
    } catch (err) {
      log.warn("failed to update project summary", { ticketId: step.ticketId, error: String(err) });
    }
  }

  private async updateTicketStatusSafe(step: PlanStep, newStatus: string): Promise<void> {
    try {
      const project = await loadProject(step.projectId);
      if (!project) return;
      const tickets = await scanTickets(project.path);
      const ticket = tickets.find((t) => t.id === this.ticketLookupId(step));
      if (ticket) {
        await updateTicketStatus(ticket.filePath, newStatus);

        // Stamp files + commits into frontmatter on close
        if (newStatus === "closed" && this.eventStore) {
          try {
            const ticketFiles = this.eventStore.queryTicketFiles(step.ticketId);
            const changesets = this.eventStore.loadChangesets({ ticketId: step.ticketId });
            const commitShas = [...new Set(changesets.flatMap((c) => c.commitShas))];
            if (ticketFiles.length > 0 || commitShas.length > 0) {
              await stampTicketFiles(
                ticket.filePath,
                ticketFiles.map((f) => ({ path: f.filePath, status: f.changeStatus })),
                commitShas,
              );
            }
          } catch (stampErr) {
            log.warn("failed to stamp ticket files", { ticketId: step.ticketId, error: String(stampErr) });
          }
        }

        // Stage and commit the ticket status change so it's not left as dirty state
        try {
          await execFileAsync("git", ["add", ticket.filePath], { cwd: project.path });
          await execFileAsync("git", ["commit", "-m", `chore: ${newStatus} ${step.ticketId}`], { cwd: project.path });
        } catch (commitErr) {
          // Commit may fail if nothing changed (status was already target value) — that's fine
          log.debug("ticket status commit skipped", { ticketId: step.ticketId, error: String(commitErr) });
        }
      }
    } catch (err) {
      log.warn("failed to update ticket status", { ticketId: step.ticketId, error: String(err) });
    }
  }

  /**
   * Close parent tickets when all their subtask steps are done.
   * Subtask steps use ticketId format "parent/subtask-id".
   */
  private async closeCompletedSubtaskParents(): Promise<void> {
    if (!this.plan.config.ticketTransitions) return;

    // Find all unique parent IDs from subtask steps
    const parentIds = new Set<string>();
    for (const step of this.plan.steps) {
      const base = baseTicketId(step.ticketId);
      if (base !== step.ticketId) parentIds.add(base);
    }

    for (const parentId of parentIds) {
      // Check if already closed
      if (this.closedSubtaskParents?.has(parentId)) continue;

      const siblings = this.plan.steps.filter((s) => baseTicketId(s.ticketId) === parentId);
      const allDone = siblings.every((s) => s.status === "done" || s.status === "skipped");
      if (!allDone) continue;

      // Close the parent ticket
      const projectId = siblings[0]?.projectId;
      if (projectId) {
        const fakeStep = { ticketId: parentId, projectId } as PlanStep;
        await this.updateTicketStatusSafe(fakeStep, "closed");
        if (!this.closedSubtaskParents) this.closedSubtaskParents = new Set();
        this.closedSubtaskParents.add(parentId);
      }
    }
  }

  private closedSubtaskParents?: Set<string>;

  /**
   * Clean up orphaned worktrees from crashed runs.
   * Scans each project's .opcom/worktrees/ directory.
   */
  private async cleanupOrphanedWorktrees(): Promise<void> {
    // Collect step IDs that are currently in-progress — their worktrees must be preserved
    const activeStepIds = new Set(
      this.plan.steps.filter((s) => s.status === "in-progress" || s.status === "verifying").map((s) => s.ticketId),
    );
    const projectIds = [...new Set(this.plan.steps.map((s) => s.projectId))];
    for (const pid of projectIds) {
      try {
        const project = await loadProject(pid);
        if (!project) continue;
        const cleaned = await WorktreeManager.cleanupOrphaned(project.path, activeStepIds);
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
/**
 * Parse test runner output for pass/fail counts.
 * Supports vitest, jest, and mocha output formats.
 */
/**
 * Keep both the start (where failures are printed) and end (summary) of test output.
 */
function truncateTestOutput(output: string, maxSize = 8000): string {
  if (output.length <= maxSize) return output;
  const half = Math.floor(maxSize / 2);
  return output.slice(0, half) + "\n\n… [truncated] …\n\n" + output.slice(-half);
}

export function parseTestOutput(output: string): { total: number; passed: number; failed: number } {
  // Vitest: "Tests  857 passed (857)" or "Tests  3 failed | 854 passed (857)"
  // Also handles skipped: "Tests  1 failed | 2 skipped | 854 passed (857)"
  const vitestMatch = output.match(/Tests\s+(?:(\d+)\s+failed\s+\|\s+)?(?:\d+\s+skipped\s+\|\s+)?(\d+)\s+passed\s+\((\d+)\)/);
  if (vitestMatch) {
    const failed = parseInt(vitestMatch[1] ?? "0", 10);
    const passed = parseInt(vitestMatch[2], 10);
    const total = parseInt(vitestMatch[3], 10);
    return { total, passed, failed };
  }

  // Vitest failures-only: "Tests  3 failed (3)" (no passing tests)
  const vitestFailOnly = output.match(/Tests\s+(\d+)\s+failed\s+\((\d+)\)/);
  if (vitestFailOnly) {
    const failed = parseInt(vitestFailOnly[1], 10);
    const total = parseInt(vitestFailOnly[2], 10);
    return { total, passed: total - failed, failed };
  }

  // Jest: "Tests:  3 failed, 854 passed, 857 total"
  const jestMatch = output.match(/Tests:\s+(?:(\d+)\s+failed,\s+)?(\d+)\s+passed,\s+(\d+)\s+total/);
  if (jestMatch) {
    const failed = parseInt(jestMatch[1] ?? "0", 10);
    const passed = parseInt(jestMatch[2], 10);
    const total = parseInt(jestMatch[3], 10);
    return { total, passed, failed };
  }

  // Mocha: "3 passing" / "1 failing"
  const mochaPass = output.match(/(\d+)\s+passing/);
  const mochaFail = output.match(/(\d+)\s+failing/);
  if (mochaPass) {
    const passed = parseInt(mochaPass[1], 10);
    const failed = mochaFail ? parseInt(mochaFail[1], 10) : 0;
    return { total: passed + failed, passed, failed };
  }

  // TAP: "# tests 10" / "# pass 8" / "# fail 2"
  const tapTests = output.match(/# tests\s+(\d+)/);
  const tapPass = output.match(/# pass\s+(\d+)/);
  const tapFail = output.match(/# fail\s+(\d+)/);
  if (tapTests || tapPass) {
    const total = tapTests ? parseInt(tapTests[1], 10) : 0;
    const passed = tapPass ? parseInt(tapPass[1], 10) : 0;
    const failed = tapFail ? parseInt(tapFail[1], 10) : 0;
    return { total: total || passed + failed, passed, failed };
  }

  return { total: 0, passed: 0, failed: 0 };
}

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

/**
 * Stamp files: and commits: into ticket frontmatter from changeset data.
 * Called when a ticket is closed to create a durable record of what changed.
 */
export async function stampTicketFiles(
  ticketPath: string,
  files: Array<{ path: string; status: string }>,
  commits: string[],
): Promise<void> {
  const content = await readFile(ticketPath, "utf-8");
  const fmEnd = content.indexOf("---", 4); // second --- delimiter
  if (fmEnd === -1) return;

  // Remove existing files: and commits: blocks if present
  let frontmatter = content.slice(0, fmEnd);
  frontmatter = frontmatter.replace(/^files:\n(?:  - .*\n)*/gm, "");
  frontmatter = frontmatter.replace(/^commits:\n(?:  - .*\n)*/gm, "");
  // Also remove single-line empty arrays
  frontmatter = frontmatter.replace(/^files:\s*\[]\n/gm, "");
  frontmatter = frontmatter.replace(/^commits:\s*\[]\n/gm, "");

  // Build new fields
  let newFields = "";
  if (files.length > 0) {
    newFields += "files:\n";
    for (const f of files) {
      newFields += `  - path: ${f.path}\n    status: ${f.status}\n`;
    }
  }
  if (commits.length > 0) {
    newFields += "commits:\n";
    for (const c of commits) {
      newFields += `  - ${c}\n`;
    }
  }

  if (!newFields) return;

  const updated = frontmatter + newFields + content.slice(fmEnd);
  await writeFile(ticketPath, updated, "utf-8");
}

/**
 * Extract a file path from a tool input string (JSON or plain text).
 * Write/Edit/NotebookEdit tools use `file_path` in their JSON input.
 */
export function extractFilePath(toolInput: string): string | null {
  try {
    const parsed = JSON.parse(toolInput);
    if (typeof parsed.file_path === "string") return parsed.file_path;
    if (typeof parsed.filePath === "string") return parsed.filePath;
    if (typeof parsed.path === "string") return parsed.path;
  } catch {
    // Not JSON — try to extract a path-like string
  }
  return null;
}

/**
 * Check if a file path matches any deny path glob pattern.
 * Returns the matched pattern, or null if no match.
 *
 * Supports simple glob patterns:
 * - `dir/**` matches anything under dir/
 * - `*.ext` matches files with that extension
 * - Literal paths match exactly
 */
export function matchesDenyPath(filePath: string, denyPaths: string[]): string | null {
  // Normalize: strip trailing slashes, work with forward slashes
  const normalized = filePath.replace(/\\/g, "/");

  for (const pattern of denyPaths) {
    const p = pattern.replace(/\\/g, "/");

    if (p.endsWith("/**")) {
      // Directory glob: .tickets/** → matches anything starting with .tickets/
      const prefix = p.slice(0, -3); // Remove /**
      // Check if the normalized path starts with the prefix (relative) or contains it
      if (normalized.startsWith(prefix + "/") || normalized === prefix) return pattern;
      // Also match absolute paths containing the prefix as a segment
      if (normalized.includes("/" + prefix + "/")) return pattern;
    } else if (p.startsWith("*")) {
      // Extension glob: *.md → matches files ending with .md
      const suffix = p.slice(1);
      if (normalized.endsWith(suffix)) return pattern;
    } else {
      // Literal match
      if (normalized === p || normalized.endsWith("/" + p)) return pattern;
    }
  }

  return null;
}

// --- Swarm helpers (exported for testing) ---

/**
 * Check if a step is a swarm subtask (has parent/subtask ticketId format
 * AND has sibling steps from the same parent).
 */
export function isSwarmSubtask(step: PlanStep, allSteps: PlanStep[]): boolean {
  if (!step.ticketId.includes("/") || step.teamId) return false;
  const parentId = baseTicketId(step.ticketId);
  return allSteps.some(
    (s) => s.ticketId !== step.ticketId && baseTicketId(s.ticketId) === parentId,
  );
}

/**
 * Check if this is the final subtask of a swarm parent — all siblings are done.
 */
export function isFinalSwarmSubtask(step: PlanStep, allSteps: PlanStep[]): boolean {
  if (!isSwarmSubtask(step, allSteps)) return false;
  const parentId = baseTicketId(step.ticketId);
  return allSteps
    .filter((s) => s.ticketId !== step.ticketId && baseTicketId(s.ticketId) === parentId)
    .every((s) => s.status === "done" || s.status === "skipped");
}

/**
 * Get verification mode for a step. Swarm subtasks use oracle-only for
 * intermediate steps and full verification for the final one.
 */
export function getSwarmVerificationMode(
  step: PlanStep,
  allSteps: PlanStep[],
): { runTests: boolean; runOracle: boolean } | undefined {
  if (!isSwarmSubtask(step, allSteps)) return undefined;

  if (isFinalSwarmSubtask(step, allSteps)) {
    return { runTests: true, runOracle: true };
  }

  return { runTests: false, runOracle: true };
}

/**
 * Find a sibling swarm subtask that already has a worktree.
 */
export function findSwarmWorktree(
  step: PlanStep,
  allSteps: PlanStep[],
): { worktreePath: string; worktreeBranch: string } | null {
  if (!isSwarmSubtask(step, allSteps)) return null;
  const parentId = baseTicketId(step.ticketId);
  const sibling = allSteps.find(
    (s) => s.ticketId !== step.ticketId
      && baseTicketId(s.ticketId) === parentId
      && s.worktreePath,
  );
  return sibling ? { worktreePath: sibling.worktreePath!, worktreeBranch: sibling.worktreeBranch! } : null;
}
