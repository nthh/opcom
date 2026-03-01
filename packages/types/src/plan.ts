// Orchestrator plan types

export type PlanStatus = "planning" | "executing" | "paused" | "done" | "failed";
export type StepStatus = "blocked" | "ready" | "in-progress" | "done" | "failed" | "skipped";

export interface Plan {
  id: string;
  name: string;
  status: PlanStatus;
  scope: PlanScope;
  steps: PlanStep[];
  config: OrchestratorConfig;
  context: string;
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
}

export interface PlanScope {
  projectIds?: string[];
  ticketIds?: string[];
  query?: string;
}

export interface PlanStep {
  ticketId: string;
  projectId: string;
  status: StepStatus;
  track?: string;
  blockedBy: string[];
  agentSessionId?: string;
  startedAt?: string;
  completedAt?: string;
  error?: string;
}

export interface OrchestratorConfig {
  maxConcurrentAgents: number;
  autoStart: boolean;
  backend: string;
  worktree: boolean;
  pauseOnFailure: boolean;
  ticketTransitions: boolean;
  autoCommit: boolean;
}

export interface HygieneReport {
  staleTickets: string[];
  orphanDeps: string[];
  cycles: string[][];
  unblockedTickets: string[];
  abandonedTickets: string[];
  issues: HygieneIssue[];
}

export type HygieneSeverity = "error" | "warning" | "info";
export type HygieneCategory = "orphan-dep" | "cycle" | "unblocked" | "abandoned" | "stale";

export interface HygieneIssue {
  severity: HygieneSeverity;
  category: HygieneCategory;
  ticketId: string;
  message: string;
  suggestion: string;
}
