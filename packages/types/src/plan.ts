// Orchestrator plan types

export type PlanStatus = "planning" | "executing" | "paused" | "done" | "failed";
export type StepStatus = "blocked" | "ready" | "in-progress" | "verifying" | "done" | "failed" | "skipped" | "needs-rebase";

export interface Plan {
  id: string;
  name: string;
  status: PlanStatus;
  scope: PlanScope;
  steps: PlanStep[];
  stages?: PlanStage[];
  currentStage?: number;
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
  worktreePath?: string;
  worktreeBranch?: string;
  verification?: VerificationResult;
  role?: string;
  attempt?: number;                      // current attempt (1 = first try, 2+ = retry)
  previousVerification?: VerificationResult;  // feedback from last failed attempt
}

export interface VerificationConfig {
  runTests: boolean;
  runOracle: boolean;
  oracleModel?: string;
  maxRetries?: number;  // default 2 — retries on verification failure (0 = fail immediately)
}

export interface OrchestratorConfig {
  maxConcurrentAgents: number;
  autoStart: boolean;
  backend: string;
  worktree: boolean;
  pauseOnFailure: boolean;
  ticketTransitions: boolean;
  autoCommit: boolean;
  verification: VerificationConfig;
  allowedBashPatterns?: string[];
  autoContinue?: boolean;
  stages?: string[][];
}

export interface TestGateResult {
  passed: boolean;
  testCommand: string;
  totalTests: number;
  passedTests: number;
  failedTests: number;
  output: string;
  durationMs: number;
}

export interface VerificationResult {
  stepTicketId: string;
  testGate?: TestGateResult;
  oracle?: {
    passed: boolean;
    criteria: Array<{ criterion: string; met: boolean; reasoning: string }>;
    concerns: string[];
  };
  passed: boolean;
  failureReasons: string[];
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

// --- Planning Session Types ---

export interface PlanningInput {
  projects: Array<{
    name: string;
    projectId: string;
    stack: import("./project.js").StackInfo;
    tickets: import("./work-items.js").WorkItem[];
    ticketCount: number;
    cloudServices?: import("./cloud-services.js").CloudServiceConfig[];
  }>;
  currentPlan?: Plan;
  userPrompt: string;
}

export interface ProposedTicket {
  id: string;
  title: string;
  type: string;
  priority: number;
  deps: string[];
  parent?: string;
  description: string;
}

export interface TicketDecomposition {
  parentTicketId: string;
  reason: string;
  subTickets: ProposedTicket[];
}

export interface PlanningProposal {
  name: string;
  scope: PlanScope;
  newTickets: ProposedTicket[];
  decompositions: TicketDecomposition[];
  ordering: string[];
  reasoning: string;
}

export interface DecompositionAssessment {
  ticketId: string;
  needsDecomposition: boolean;
  reason: string;
  criteria: string[];
}

// --- Stage Types ---

export type StageStatus = "pending" | "executing" | "completed" | "failed";

export interface PlanStage {
  index: number;
  stepTicketIds: string[];
  status: StageStatus;
  startedAt?: string;
  completedAt?: string;
  summary?: StageSummary;
}

export interface StageSummary {
  completed: number;
  failed: number;
  skipped: number;
  durationMs: number;
  testResults?: { passed: number; failed: number };
}
