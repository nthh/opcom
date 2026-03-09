import type { Plan, PlanStep, StallSignal, StallConfig, VerificationResult } from "@opcom/types";

/**
 * Detects stalled agents, steps, and plans.
 *
 * Stall signals:
 * - long-running: agent active beyond threshold with no commits
 * - repeated-failure: same verification failure across retries
 * - plan-stall: no step transitions for a long period
 * - repeated-action: identical failure reason across 2+ retries
 */
export class StallDetector {
  private config: StallConfig;
  /** Tracks the last time any step transitioned (for plan-stall detection). */
  private lastStepTransitionAt: number;

  constructor(config: StallConfig) {
    this.config = config;
    this.lastStepTransitionAt = Date.now();
  }

  /** Call when any step changes status (started, completed, failed, etc.). */
  recordStepTransition(): void {
    this.lastStepTransitionAt = Date.now();
  }

  /**
   * Check if an in-progress agent is stalled (running too long without commits).
   * Returns a signal if the agent exceeds the timeout threshold.
   */
  checkAgentStall(step: PlanStep): StallSignal | null {
    if (!this.config.enabled) return null;
    if (step.status !== "in-progress") return null;
    if (!step.startedAt) return null;

    const elapsed = Date.now() - new Date(step.startedAt).getTime();
    if (elapsed < this.config.agentTimeoutMs) return null;

    const minutes = Math.round(elapsed / 60_000);
    return {
      type: "long-running",
      stepId: step.ticketId,
      sessionId: step.agentSessionId,
      message: `Agent has been running for ${minutes}m without producing commits`,
      suggestion: "Consider stopping the agent and retrying with a different approach, or check if it's stuck in a loop.",
      durationMs: elapsed,
    };
  }

  /**
   * Check if a step has the same failure pattern across retries.
   * Compares the current verification failure with the previous attempt.
   */
  checkStepStall(step: PlanStep): StallSignal | null {
    if (!this.config.enabled) return null;
    if (!step.previousVerification || !step.verification) return null;

    const prev = step.previousVerification;
    const curr = step.verification;

    // Only check if both failed
    if (prev.passed || curr.passed) return null;

    const identicalFailures = this.areFailuresSimilar(prev, curr);
    if (!identicalFailures) return null;

    const attempt = step.attempt ?? 1;
    return {
      type: "repeated-failure",
      stepId: step.ticketId,
      sessionId: step.agentSessionId,
      message: `Step has failed ${attempt} times with the same error pattern`,
      suggestion: "The agent is repeating the same mistake. Consider skipping this step, modifying the ticket, or manually intervening.",
      durationMs: step.startedAt ? Date.now() - new Date(step.startedAt).getTime() : 0,
    };
  }

  /**
   * Check if the plan as a whole is stalled (no step transitions for too long).
   */
  checkPlanStall(plan: Plan): StallSignal | null {
    if (!this.config.enabled) return null;
    if (plan.status !== "executing") return null;

    // Only flag plan stall if there are active steps (otherwise the plan is just idle)
    const hasActive = plan.steps.some(
      (s) => s.status === "in-progress" || s.status === "verifying",
    );
    if (!hasActive) return null;

    const elapsed = Date.now() - this.lastStepTransitionAt;
    if (elapsed < this.config.planStallTimeoutMs) return null;

    const minutes = Math.round(elapsed / 60_000);
    return {
      type: "plan-stall",
      message: `No step has progressed in ${minutes}m`,
      suggestion: "Consider pausing the plan, checking agent logs, or skipping stuck steps.",
      durationMs: elapsed,
    };
  }

  /**
   * Build a stall warning section for injection into retry context.
   * This tells the agent it's repeating itself and should try a different approach.
   */
  buildStallWarning(step: PlanStep): string | null {
    if (!this.config.enabled) return null;
    if (!step.previousVerification) return null;

    const prev = step.previousVerification;
    const curr = step.verification;

    // Check for repeated action pattern (same failure across retries)
    if (curr && !curr.passed && !prev.passed && this.areFailuresSimilar(prev, curr)) {
      const attempt = step.attempt ?? 1;
      const lines: string[] = [];
      lines.push("## Stall Warning");
      lines.push("");
      lines.push(`You have attempted this step ${attempt} times with the same failure pattern.`);
      lines.push("");

      if (curr.testGate && !curr.testGate.passed) {
        lines.push("Previous failing tests:");
        lines.push("```");
        lines.push(curr.testGate.output.slice(0, 2000));
        lines.push("```");
        lines.push("");
      }

      lines.push("You are repeating the same mistake. Try a fundamentally different approach:");
      lines.push("- Re-read the relevant source code before making changes.");
      lines.push("- Check if the API has changed since the spec was written.");
      lines.push("- Consider whether the ticket's approach needs revision.");
      lines.push("");
      return lines.join("\n");
    }

    return null;
  }

  /**
   * Run all stall checks for the current plan state.
   * Returns an array of detected stall signals.
   */
  checkAll(plan: Plan): StallSignal[] {
    if (!this.config.enabled) return [];

    const signals: StallSignal[] = [];

    // Check each in-progress step for agent stalls
    for (const step of plan.steps) {
      if (step.status === "in-progress") {
        const agentStall = this.checkAgentStall(step);
        if (agentStall) signals.push(agentStall);
      }
    }

    // Check plan-level stall
    const planStall = this.checkPlanStall(plan);
    if (planStall) signals.push(planStall);

    return signals;
  }

  /**
   * Compare two failed verification results to see if they have the same failure pattern.
   * Uses failure reason strings for comparison.
   */
  private areFailuresSimilar(a: VerificationResult, b: VerificationResult): boolean {
    if (a.failureReasons.length === 0 || b.failureReasons.length === 0) return false;

    // Check if the failure reason sets are similar
    // Normalize by sorting and comparing
    const aSorted = [...a.failureReasons].sort();
    const bSorted = [...b.failureReasons].sort();

    if (aSorted.length !== bSorted.length) return false;
    return aSorted.every((reason, i) => reason === bSorted[i]);
  }
}
