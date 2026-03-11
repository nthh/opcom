// Orchestrator plan types

export type PlanStatus = "planning" | "executing" | "paused" | "done" | "failed" | "cancelled";
export type StepStatus = "blocked" | "ready" | "in-progress" | "verifying" | "done" | "failed" | "skipped" | "needs-rebase" | "pending-confirmation";
export type VerificationMode = "test-gate" | "oracle" | "confirmation" | "output-exists" | "none";
export type PlanStrategy = "spread" | "swarm" | "mixed";

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
  smokeTestResult?: IntegrationTestResult;
}

export interface PlanSummary {
  id: string;
  name: string;
  status: PlanStatus;
  stepsDone: number;
  stepsTotal: number;
  updatedAt: string;
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
  rebaseAttempts?: number;               // count of auto-rebase attempts (capped at 3)
  previousVerification?: VerificationResult;  // feedback from last failed attempt
  rebaseConflict?: RebaseConflict;       // set when agent needs to resolve merge conflicts
  verifyingPhase?: "testing" | "oracle"; // which verification sub-phase is active
  verifyingPhaseStartedAt?: string;      // ISO timestamp when current sub-phase started
  stallSignal?: StallSignal;             // active stall warning (cleared when step progresses)
  verificationMode?: VerificationMode;   // per-step override from work item frontmatter
  testSuites?: string[];                 // per-step override: force these named suites to run
  teamId?: string;                       // team definition that expanded this step
  teamStepRole?: string;                 // role within the team sequence (e.g. "engineer", "qa")
  deniedWriteCount?: number;             // count of write attempts blocked by denyPaths
  swarm?: boolean;                       // true when step was created by expandSubtaskSteps
}

export interface RebaseConflict {
  files: string[];       // conflicting file paths
  baseBranch: string;    // branch being rebased onto
}

export interface RebaseResult {
  rebased: boolean;      // true if rebase completed cleanly
  conflict: boolean;     // true if rebase hit conflicts (aborted)
  conflictFiles?: string[];
  error?: string;
}

export interface VerificationConfig {
  runTests: boolean;
  runOracle: boolean;
  oracleModel?: string;
  maxRetries?: number;  // default 2 — retries on verification failure (0 = fail immediately)
  autoRebase?: boolean; // default true — attempt auto-rebase on merge conflict
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
  stall: StallConfig;
  allowedBashPatterns?: string[];
  autoContinue?: boolean;
  stages?: string[][];
  maxStageSize?: number;
  strategy?: PlanStrategy;
  testCommand?: string;            // plan-level override for test command
}

export interface TestGateResult {
  passed: boolean;
  testCommand: string;
  totalTests: number;
  passedTests: number;
  failedTests: number;
  output: string;
  durationMs: number;
  suiteResults?: SuiteTestResult[];     // per-suite breakdown (when multiple suites ran)
}

export interface SuiteTestResult {
  suiteName: string;
  passed: boolean;
  testCommand: string;
  totalTests: number;
  passedTests: number;
  failedTests: number;
  output: string;
  durationMs: number;
  screenshotDir?: string;    // path to screenshot artifacts (e.g. playwright test-results/)
}

export interface VerificationResult {
  stepTicketId: string;
  testGate?: TestGateResult;
  oracle?: {
    passed: boolean;
    criteria: Array<{ criterion: string; met: boolean; reasoning: string }>;
    concerns: string[];
  };
  oracleError?: string;
  oracleSessionId?: string;
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
  name?: string;
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
  smokeTest?: IntegrationTestResult;
}

export interface IntegrationTestResult {
  passed: boolean;
  buildPassed: boolean;
  testsPassed: boolean;
  buildOutput: string;
  testOutput: string;
  durationMs: number;
}

// --- Stall Detection Types ---

export type StallSignalType = "long-running" | "repeated-failure" | "plan-stall" | "repeated-action";

export interface StallSignal {
  type: StallSignalType;
  stepId?: string;
  sessionId?: string;
  message: string;
  suggestion: string;
  durationMs: number;
}

export interface StallConfig {
  enabled: boolean;              // default true
  agentTimeoutMs: number;        // default 20 * 60 * 1000 (20 min)
  planStallTimeoutMs: number;    // default 30 * 60 * 1000 (30 min)
  maxIdenticalFailures: number;  // default 2 — same error pattern = stall
}
