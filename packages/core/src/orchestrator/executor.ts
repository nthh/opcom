import { readFile, writeFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
import type {
  Plan,
  PlanStep,
  PlanStage,
  StageSummary,
  AgentSession,
  AgentState,
  NormalizedEvent,
  VerificationResult,
  TestGateResult,
} from "@opcom/types";
import type { SessionManager } from "../agents/session-manager.js";
import type { EventStore } from "../agents/event-store.js";
import type { TicketSet } from "./planner.js";
import { recomputePlan, computeStages, buildExplicitStages, computeStageSummary } from "./planner.js";
import { savePlan, savePlanContext } from "./persistence.js";
import { buildContextPacket, contextPacketToMarkdown } from "../agents/context-builder.js";
import { deriveAllowedBashTools } from "../agents/allowed-bash.js";
import { loadProject } from "../config/loader.js";
import { scanTickets } from "../detection/tickets.js";
import { commitStepChanges, captureChangeset } from "./git-ops.js";
import { WorktreeManager } from "./worktree.js";
import { collectOracleInputs, runOracle } from "../skills/oracle.js";
import { loadRole, resolveRoleConfig } from "../config/roles.js";
import { createLogger } from "../logger.js";
import { ingestTestResults, queryGraphContext } from "../graph/graph-service.js";

const log = createLogger("executor");

export interface ExecutorEvents {
  step_started: { step: PlanStep; session: AgentSession };
  step_completed: { step: PlanStep };
  step_failed: { step: PlanStep; error: string };
  step_needs_rebase: { step: PlanStep; error: string };
  stage_completed: { planId: string; stage: PlanStage; summary: StageSummary };
  plan_completed: { plan: Plan };
  plan_paused: { plan: Plan };
  plan_updated: { plan: Plan };
}

type EventHandler<T> = (data: T) => void;

interface ExecutorEvent {
  type: "agent_completed" | "agent_failed" | "pause" | "resume" | "skip" | "inject_context" | "advance_stage";
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
  private stepVerification = new Map<string, { runTests: boolean; runOracle: boolean }>(); // ticketId → role verification
  private stepFiles = new Map<string, string[]>(); // ticketId → related file paths (cached from graph)
  private ticketCache = new Map<string, import("@opcom/types").WorkItem[]>(); // projectId → tickets
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
    };

    this.sessionManager.on("session_stopped", onStopped);
    this.sessionManager.on("state_change", onStateChange);
    this.sessionManager.on("agent_event", onAgentEvent);

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

      case "advance_stage": {
        this.advanceToNextStage();
        this.plan.status = "executing";
        this.logPlanEvent("stage_advanced", { detail: { stage: this.plan.currentStage } });
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

    const hasWork = await this.worktreeManager.hasCommits(step.ticketId);

    if (event.sessionId) {
      this.sessionToStep.delete(event.sessionId);
      this.sessionWrites.delete(event.sessionId);
    }

    if (!hasWork) {
      const reason = "Agent exited without making any commits";
      await this.failStep(step, reason);

      // Keep worktree for inspection — only clear truly empty ones
      const hasUncommitted = await this.worktreeHasChanges(step.worktreePath);
      if (!hasUncommitted) {
        await this.worktreeManager.remove(step.ticketId).catch(() => {});
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
    await savePlan(this.plan);
    this.emit("plan_updated", { plan: this.plan });

    const roleVerify = this.stepVerification.get(step.ticketId);
    const verification = await this.runVerification(step, event, roleVerify);

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

    // Verification passed (or skipped) — merge into main tree
    const mergeResult = await this.worktreeManager.merge(step.ticketId);

    if (mergeResult.conflict) {
      // Merge conflict — mark as needs-rebase
      step.status = "needs-rebase";
      step.error = `Merge conflict: ${mergeResult.error}`;
      step.completedAt = new Date().toISOString();
      if (verification) step.verification = verification;
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
      // Merge failed for non-conflict reason — keep worktree + branch
      // so the agent's work can be retried without redoing everything.
      const reason = `Merge failed: ${mergeResult.error}`;
      await this.failStep(step, reason);

      log.error("merge failed", { ticketId: step.ticketId, error: mergeResult.error });
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
        this.logPlanEvent("plan_paused", { detail: { reason: "merge_failed" } });
      }
      return;
    }

    // Merge succeeded — step is done
    step.status = "done";
    step.completedAt = new Date().toISOString();
    if (verification) step.verification = verification;

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
      detail: { mode: "worktree", verification },
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
    if (verification.runTests && project.testing?.command) {
      const testResult = await this.runTestGate(testPath, project.testing.command);
      result.testGate = testResult;
      if (!testResult.passed) {
        result.passed = false;
        result.failureReasons.push(
          `Tests failed: ${testResult.failedTests}/${testResult.totalTests} failed`,
        );
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

    // --- Oracle ---
    if (verification.runOracle) {
      try {
        const tickets = await scanTickets(project.path);
        const workItem = tickets.find((t) => t.id === step.ticketId);
        if (workItem) {
          const oracleInput = await collectOracleInputs(
            project.path,
            event.sessionId ?? "",
            workItem,
          );
          // Feed test results into oracle context
          if (result.testGate) {
            oracleInput.testResults = result.testGate.output;
          }
          const oracleModel = "oracleModel" in verification
            ? (verification as { oracleModel?: string }).oracleModel
            : this.plan.config.verification.oracleModel;
          const oracleResult = await runOracle(oracleInput, (prompt) =>
            this.llmCall(prompt, oracleModel),
          );
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

    this.logPlanEvent("step_verified", {
      stepTicketId: step.ticketId,
      agentSessionId: event.sessionId,
      detail: { verification: result },
    });

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
      const output = (err as { stdout?: string; stderr?: string }).stdout
        ?? (err as { stderr?: string }).stderr
        ?? String(err);
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
   * Make an LLM call via Claude Code CLI for oracle evaluation.
   */
  private async llmCall(prompt: string, model?: string): Promise<string> {
    const args = ["-p", prompt, "--output-format", "text"];
    if (model) args.push("--model", model);

    // Strip Claude env vars to avoid nested session detection
    const childEnv: Record<string, string> = {};
    for (const [k, v] of Object.entries(process.env)) {
      if (!k.startsWith("CLAUDE") && v !== undefined) {
        childEnv[k] = v;
      }
    }

    const { stdout } = await execFileAsync("claude", args, {
      timeout: 120_000,
      maxBuffer: 10 * 1024 * 1024,
      env: childEnv,
    });
    return stdout;
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
      // Check for stage completion before starting new steps
      if (this.checkStageCompletion()) {
        // Stage just completed — don't start new steps yet
        this.emit("plan_updated", { plan: this.plan });
        return;
      }
      await this.startReadySteps();
    }

    // Check if plan is complete
    if (this.isPlanTerminal()) {
      // Mark final stage as completed if stages are active
      this.markCurrentStageCompleted();

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
    const running = this.plan.steps.filter((s) => s.status === "in-progress" || s.status === "verifying").length;
    const max = this.plan.config.maxConcurrentAgents;
    const available = max - running;

    if (available <= 0) return;

    // Filter ready steps by current stage if stages are active
    let ready = this.plan.steps.filter((s) => s.status === "ready");
    const currentStageIds = this.getCurrentStageStepIds();
    if (currentStageIds) {
      ready = ready.filter((s) => currentStageIds.has(s.ticketId));
    }

    // Sort ready steps: lower priority number first, then fewer blockedBy, then array order
    const sorted = [...ready].sort((a, b) => {
      const pa = this.getStepPriority(a);
      const pb = this.getStepPriority(b);
      if (pa !== pb) return pa - pb;
      return a.blockedBy.length - b.blockedBy.length;
    });

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
      const workItem = tickets?.find((t) => t.id === step.ticketId);
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
    const workItem = tickets?.find((t) => t.id === step.ticketId);
    return workItem?.priority ?? 4;
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

    // Resolve role config: role definition → stack tools → plan overrides
    const roleId = step.role ?? workItem?.role ?? "engineer";
    const roleDef = await loadRole(roleId);
    const stackBashPatterns = deriveAllowedBashTools(
      { stack: project.stack, testing: project.testing, linting: project.linting },
    ).map((t) => t.replace(/^Bash\(/, "").replace(/\)$/, ""));
    const resolved = resolveRoleConfig(roleDef, stackBashPatterns, this.plan.config);

    // Build allowed tools: merge role bash patterns into Bash() format + role allowedTools
    const allowedBashTools = resolved.allowedBashPatterns.map((p) => `Bash(${p})`);
    const allowedTools = [...allowedBashTools, ...resolved.allowedTools];

    // Build system prompt with role-aware context (and retry feedback if applicable)
    const systemPrompt = contextPacketToMarkdown(contextPacket, resolved, step.previousVerification);

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
    this.sessionToStep.set(session.id, step.ticketId);
    this.stepVerification.set(step.ticketId, { runTests: resolved.runTests, runOracle: resolved.runOracle });

    // Write lock file so cleanupOrphaned() won't remove this worktree
    if (this.plan.config.worktree && session.pid) {
      await this.worktreeManager.writeLock(step.ticketId, session.pid).catch((err) => {
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
    } else {
      this.plan.stages = computeStages(this.plan.steps);
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
   * Check if the current stage is complete. If so, emit stage_completed
   * and either auto-continue or pause for approval.
   * Returns true if a stage just completed (caller should not start new steps).
   */
  private checkStageCompletion(): boolean {
    if (!this.plan.stages || this.plan.currentStage === undefined) return false;

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
    stage.summary = summary;

    this.emit("stage_completed", { planId: this.plan.id, stage, summary });
    this.logPlanEvent("stage_completed", {
      detail: { stageIndex: stage.index, summary },
    });

    // Check if there's a next stage
    const nextIdx = this.plan.currentStage + 1;
    if (nextIdx >= this.plan.stages.length) {
      // No more stages — plan will complete naturally
      return false;
    }

    if (this.plan.config.autoContinue) {
      // Auto-advance to next stage
      this.advanceToNextStage();
      return false; // caller should continue starting steps
    }

    // Pause for user approval
    this.plan.status = "paused";
    savePlan(this.plan).catch(() => {});
    this.emit("plan_paused", { plan: this.plan });
    this.logPlanEvent("plan_paused", { detail: { reason: "stage_gate", stageIndex: stage.index } });
    return true;
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
  private async failStep(step: PlanStep, error: string): Promise<void> {
    step.status = "failed";
    step.error = error;
    step.completedAt = new Date().toISOString();
    if (this.plan.config.ticketTransitions) {
      await this.updateTicketStatusSafe(step, "open");
    }
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
  const vitestMatch = output.match(/Tests\s+(?:(\d+)\s+failed\s+\|\s+)?(\d+)\s+passed\s+\((\d+)\)/);
  if (vitestMatch) {
    const failed = parseInt(vitestMatch[1] ?? "0", 10);
    const passed = parseInt(vitestMatch[2], 10);
    const total = parseInt(vitestMatch[3], 10);
    return { total, passed, failed };
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
