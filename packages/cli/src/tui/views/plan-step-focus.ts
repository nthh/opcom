// TUI Plan Step Focus View (Level 3)
// Shows full detail for a single plan step: status, ticket, blockers, agent, timing, errors

import type { PlanStep, Plan, WorkItem, AgentSession, VerificationResult } from "@opcom/types";
import type { Panel } from "../layout.js";
import {
  ScreenBuffer,
  ANSI,
  bold,
  dim,
  color,
  truncate,
  wrapText,
} from "../renderer.js";

export interface PlanStepFocusState {
  step: PlanStep;
  plan: Plan;
  ticket: WorkItem | null;
  agent: AgentSession | null;
  /** Map of blocker ticketId → its current step status (from the plan) */
  blockerStatuses: Map<string, { status: string; ticket: WorkItem | null }>;
  verification: VerificationResult | null;
  showTestOutput: boolean;
  scrollOffset: number;
  displayLines: string[];
  wrapWidth: number;
}

export function createPlanStepFocusState(
  step: PlanStep,
  plan: Plan,
  ticket: WorkItem | null,
  agent: AgentSession | null,
  allTickets: WorkItem[],
  allAgents: AgentSession[],
  verification?: VerificationResult | null,
): PlanStepFocusState {
  // Resolve blocker statuses from the plan's steps
  const blockerStatuses = new Map<string, { status: string; ticket: WorkItem | null }>();
  for (const blockerId of step.blockedBy) {
    const blockerStep = plan.steps.find((s) => s.ticketId === blockerId);
    const blockerTicket = allTickets.find((t) => t.id === blockerId) ?? null;
    blockerStatuses.set(blockerId, {
      status: blockerStep?.status ?? "unknown",
      ticket: blockerTicket,
    });
  }

  // Resolve assigned agent
  const resolvedAgent = step.agentSessionId
    ? allAgents.find((a) => a.id === step.agentSessionId) ?? agent
    : agent;

  const state: PlanStepFocusState = {
    step,
    plan,
    ticket,
    agent: resolvedAgent,
    blockerStatuses,
    verification: verification ?? null,
    showTestOutput: false,
    scrollOffset: 0,
    displayLines: [],
    wrapWidth: 0,
  };

  rebuildDisplayLines(state);
  return state;
}

function stepStatusIcon(status: string): string {
  switch (status) {
    case "blocked": return "\u25cc"; // ◌
    case "ready": return "\u25cb";   // ○
    case "in-progress": return "\u25cf"; // ●
    case "verifying": return "\u25ce";   // ◎
    case "done": return "\u2713";    // ✓
    case "failed": return "\u2717";  // ✗
    case "skipped": return "\u2298"; // ⊘
    case "needs-rebase": return "\u21c4"; // ⇄
    case "rebasing": return "\u27f3"; // ⟳
    default: return "?";
  }
}

function stepStatusColor(status: string): string {
  switch (status) {
    case "in-progress": return ANSI.yellow;
    case "verifying": return ANSI.orange;
    case "ready": return ANSI.cyan;
    case "done": return ANSI.green;
    case "failed": return ANSI.red;
    case "needs-rebase": return ANSI.red;
    case "rebasing": return ANSI.yellow;
    case "skipped": return ANSI.dim;
    case "blocked": return ANSI.dim;
    default: return ANSI.white;
  }
}

function formatTimestamp(iso: string | undefined): string {
  if (!iso) return dim("—");
  const d = new Date(iso);
  return d.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatDuration(startedAt?: string, completedAt?: string): string {
  if (!startedAt) return "";
  const start = new Date(startedAt).getTime();
  const end = completedAt ? new Date(completedAt).getTime() : Date.now();
  const diffMs = end - start;

  const seconds = Math.floor(diffMs / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);

  if (hours > 0) return `${hours}h${minutes % 60}m`;
  if (minutes > 0) return `${minutes}m${seconds % 60}s`;
  return `${seconds}s`;
}

export function toggleTestOutput(state: PlanStepFocusState): void {
  if (!state.verification?.testGate?.output) return;
  state.showTestOutput = !state.showTestOutput;
  rebuildDisplayLines(state, state.wrapWidth || 80);
}

export function rebuildDisplayLines(state: PlanStepFocusState, width = 80): void {
  const { step, ticket, agent, blockerStatuses, verification } = state;
  const lines: string[] = [];

  // --- Status ---
  const displayStatus = step.rebaseConflict ? "rebasing" : step.status;
  const icon = stepStatusIcon(displayStatus);
  const sColor = stepStatusColor(displayStatus);
  const phaseDetail = displayStatus === "verifying" && step.verifyingPhase
    ? ` (${step.verifyingPhase === "testing" ? "running tests" : "oracle evaluation"})`
    : "";
  lines.push(`${dim("Status:")}    ${color(sColor, `${icon} ${displayStatus}`)}${phaseDetail}`);
  if (step.rebaseConflict) {
    lines.push(`${dim("Conflicts:")} ${step.rebaseConflict.files.join(", ")}`);
  }
  lines.push("");

  // --- Ticket summary ---
  lines.push(bold("Ticket"));
  if (ticket) {
    const priorityColors = [ANSI.red, ANSI.red, ANSI.yellow, ANSI.cyan, ANSI.dim];
    const pColor = priorityColors[ticket.priority] ?? ANSI.dim;

    lines.push(`  ${dim("ID:")}       ${ticket.id}`);
    lines.push(`  ${dim("Title:")}    ${ticket.title}`);
    lines.push(`  ${dim("Priority:")} ${color(pColor, `P${ticket.priority}`)}`);
    lines.push(`  ${dim("Status:")}   ${ticket.status}`);
    if (ticket.type) {
      lines.push(`  ${dim("Type:")}     ${ticket.type}`);
    }
  } else {
    lines.push(`  ${dim("ID:")}       ${step.ticketId}`);
    lines.push(`  ${dim("(ticket not found)")}`);
  }
  lines.push("");

  // --- Blockers ---
  if (step.blockedBy.length > 0) {
    lines.push(bold("Blocked By"));
    for (const blockerId of step.blockedBy) {
      const blocker = blockerStatuses.get(blockerId);
      if (blocker) {
        const bIcon = stepStatusIcon(blocker.status);
        const bColor = stepStatusColor(blocker.status);
        const bStatus = color(bColor, `${bIcon} ${blocker.status}`);
        const bTitle = blocker.ticket ? dim(` — ${blocker.ticket.title}`) : "";
        lines.push(`  ${blockerId} ${bStatus}${bTitle}`);
      } else {
        lines.push(`  ${blockerId} ${dim("(unknown)")}`);
      }
    }
    lines.push("");
  }

  // --- Agent ---
  lines.push(bold("Agent"));
  if (agent) {
    lines.push(`  ${dim("ID:")}      ${agent.id.slice(0, 12)}`);
    lines.push(`  ${dim("Backend:")} ${agent.backend}`);
    const stateColorCode = agent.state === "streaming" ? ANSI.green :
      agent.state === "idle" ? ANSI.yellow :
      agent.state === "error" ? ANSI.red :
      agent.state === "stopped" ? ANSI.red : ANSI.cyan;
    lines.push(`  ${dim("State:")}   ${color(stateColorCode, agent.state)}`);
    if (agent.contextUsage) {
      const pct = Math.round(agent.contextUsage.percentage);
      lines.push(`  ${dim("Context:")} ${pct}%`);
    }
  } else {
    lines.push(`  ${dim("No agent assigned")}`);
  }
  lines.push("");

  // --- Timing ---
  lines.push(bold("Timing"));
  lines.push(`  ${dim("Started:")}   ${formatTimestamp(step.startedAt)}`);
  lines.push(`  ${dim("Completed:")} ${formatTimestamp(step.completedAt)}`);
  if (step.startedAt) {
    const dur = formatDuration(step.startedAt, step.completedAt);
    lines.push(`  ${dim("Duration:")}  ${dur}`);
  }
  lines.push("");

  // --- Error ---
  if (step.error) {
    lines.push(bold(color(ANSI.red, "Error")));
    const errorLines = step.error.split("\n");
    for (const el of errorLines) {
      lines.push(...wrapText(`  ${color(ANSI.red, el)}`, width));
    }
    lines.push("");
  }

  // --- Verification ---
  if (verification) {
    lines.push(bold("Verification"));
    const vIcon = verification.passed ? color(ANSI.green, "\u2713 passed") : color(ANSI.red, "\u2717 failed");
    lines.push(`  ${dim("Result:")} ${vIcon}`);

    if (verification.testGate) {
      const tg = verification.testGate;
      const tgIcon = tg.passed ? color(ANSI.green, "\u2713") : color(ANSI.red, "\u2717");
      lines.push(`  ${dim("Tests:")}  ${tgIcon} ${tg.passedTests}/${tg.totalTests} passed (${tg.durationMs}ms)`);
      if (!tg.passed) {
        lines.push(`  ${dim("Failed:")} ${tg.failedTests}`);
      }
      if (tg.output) {
        if (state.showTestOutput) {
          lines.push(`  ${dim("Output:")} ${dim("(press o to hide)")}`);
          const outputLines = tg.output.split("\n");
          for (const ol of outputLines) {
            lines.push(`    ${dim(ol)}`);
          }
        } else {
          lines.push(`  ${dim("Output:")} ${dim("(press o to show)")}`);
        }
      }
    }

    if (verification.oracle) {
      const orc = verification.oracle;
      const oIcon = orc.passed ? color(ANSI.green, "\u2713") : color(ANSI.red, "\u2717");
      lines.push(`  ${dim("Oracle:")} ${oIcon}`);
      for (const c of orc.criteria) {
        const cIcon = c.met ? color(ANSI.green, "\u2713") : color(ANSI.red, "\u2717");
        lines.push(`    ${cIcon} ${c.criterion}`);
      }
      if (orc.concerns.length > 0) {
        lines.push(`  ${dim("Concerns:")}`);
        for (const concern of orc.concerns) {
          lines.push(...wrapText(`    ${color(ANSI.yellow, concern)}`, width));
        }
      }
    } else if (verification.oracleError) {
      lines.push(`  ${dim("Oracle:")} ${color(ANSI.yellow, "\u26a0 " + verification.oracleError)}`);
    }

    if (verification.failureReasons.length > 0) {
      lines.push(`  ${dim("Failure reasons:")}`);
      for (const reason of verification.failureReasons) {
        lines.push(...wrapText(`    ${color(ANSI.red, reason)}`, width));
      }
    }
    lines.push("");
  }

  // --- Track ---
  if (step.track) {
    lines.push(`${dim("Track:")} ${step.track}`);
    lines.push("");
  }

  state.displayLines = lines;
  state.wrapWidth = width;
}

export function renderPlanStepFocus(
  buf: ScreenBuffer,
  panel: Panel,
  state: PlanStepFocusState,
): void {
  const headerHeight = 1;
  const footerHeight = 1;
  const contentHeight = panel.height - headerHeight - footerHeight;
  const contentWidth = panel.width - 2;

  // Header
  const stepTitle = state.ticket?.title ?? state.step.ticketId;
  const header = truncate(
    `${bold("Plan Step:")} ${state.step.ticketId} — ${stepTitle}`,
    contentWidth,
  );
  buf.writeLine(panel.y, panel.x + 1, header, contentWidth);

  // Re-wrap if panel width changed
  if (state.wrapWidth !== contentWidth) {
    rebuildDisplayLines(state, contentWidth);
  }

  const totalLines = state.displayLines.length;

  // Clamp scroll
  state.scrollOffset = Math.max(
    0,
    Math.min(state.scrollOffset, Math.max(0, totalLines - contentHeight)),
  );

  // Content
  for (let i = 0; i < contentHeight; i++) {
    const lineIdx = i + state.scrollOffset;
    const row = panel.y + headerHeight + i;

    if (lineIdx >= totalLines) break;
    buf.writeLine(row, panel.x + 1, state.displayLines[lineIdx], contentWidth);
  }

  // Scroll indicator
  if (totalLines > contentHeight) {
    const scrollPct = totalLines > contentHeight
      ? Math.round((state.scrollOffset / (totalLines - contentHeight)) * 100)
      : 100;
    const indicator = dim(`[${scrollPct}%]`);
    buf.writeLine(panel.y + headerHeight, panel.x + panel.width - 8, indicator, 7);
  }

  // Footer
  const footerY = panel.y + panel.height - 1;
  const agentKey = state.agent ? "a:agent  " : "";
  const startKey = state.step.status === "ready" ? "w:start agent  " : "";
  const outputKey = state.verification?.testGate?.output ? "o:output  " : "";
  const keys = dim(`j/k:scroll  ${startKey}${agentKey}${outputKey}t:ticket  Esc:back`);
  buf.writeLine(footerY, panel.x + 1, keys, contentWidth);
}

// --- Navigation ---

export function scrollUp(state: PlanStepFocusState, amount = 1): void {
  state.scrollOffset = Math.max(0, state.scrollOffset - amount);
}

export function scrollDown(state: PlanStepFocusState, amount = 1, viewHeight = 20): void {
  const maxScroll = Math.max(0, state.displayLines.length - viewHeight);
  state.scrollOffset = Math.min(maxScroll, state.scrollOffset + amount);
}

export function scrollToTop(state: PlanStepFocusState): void {
  state.scrollOffset = 0;
}

export function scrollToBottom(state: PlanStepFocusState, viewHeight = 20): void {
  state.scrollOffset = Math.max(0, state.displayLines.length - viewHeight);
}
