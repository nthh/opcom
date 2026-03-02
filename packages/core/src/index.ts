// Logger
export { createLogger, isEnabled } from "./logger.js";
export type { LogLevel, Logger } from "./logger.js";

export { detectProject } from "./detection/detect.js";
export { detectGit } from "./detection/git.js";
export { scanTickets, summarizeWorkItems, parseFrontmatter, parseTicketFile } from "./detection/tickets.js";
export { detectSubProjects } from "./detection/services.js";
export { mergeStacks } from "./detection/stack.js";
export {
  parsePackageJson,
  parsePyprojectData,
  parseRequirementsTxt,
  parseDockerComposeData,
  parseFirebaseJson,
  parseWranglerToml,
  parseMiseData,
  detectPackageManagerFromLockfile,
  detectVersionFiles,
  detectLanguagesBySourceFiles,
  detectMonorepoTools,
} from "./detection/matchers.js";

export {
  loadGlobalConfig,
  saveGlobalConfig,
  loadWorkspace,
  saveWorkspace,
  listWorkspaces,
  loadProject,
  saveProject,
  listProjects,
  ensureOpcomDirs,
} from "./config/loader.js";

export {
  opcomRoot,
  globalConfigPath,
  workspacesDir,
  workspacePath,
  projectsDir,
  projectPath,
} from "./config/paths.js";

export { validateGlobalConfig, validateWorkspaceConfig, validateProjectConfig, emptyStack } from "./config/schema.js";

export { refreshProjectStatus } from "./project/status.js";
export type { ProjectStatus } from "./project/status.js";

// Phase 2: Agents
export { createAdapter, ClaudeCodeAdapter, OpenCodeAdapter } from "./agents/adapter.js";
export { SessionManager } from "./agents/session-manager.js";
export { EventStore } from "./agents/event-store.js";
export type { ToolUsageStat, SessionStat, DailyActivity, PlanEventRecord } from "./agents/event-store.js";
export { buildContextPacket, contextPacketToMarkdown, buildTicketCreationPrompt, buildTicketChatPrompt } from "./agents/context-builder.js";
export { MessageRouter } from "./agents/message-router.js";

// Phase 2: Jira Adapter
export { JiraAdapter, mapJiraStatus, mapJiraPriority, mapJiraType, jiraIssueToWorkItem, extractDeps } from "./adapters/jira.js";
export type { JiraConfig } from "./adapters/jira.js";
export { loadJiraAuth, saveJiraAuth, buildAuthHeader } from "./adapters/jira-auth.js";
export type { JiraAuthConfig } from "./adapters/jira-auth.js";

// Phase 6: LLM Skills
export {
  collectBriefingSignals,
  formatBriefingPrompt,
  parseBriefingResponse,
  generateBriefing,
} from "./skills/briefing.js";
export type { BriefingInput, Briefing } from "./skills/briefing.js";

export {
  collectTriageSignals,
  filterBlockedTickets,
  formatTriagePrompt,
  parseTriageResponse,
  generateTriage,
} from "./skills/triage.js";
export type { TriageInput, TriageRecommendation } from "./skills/triage.js";

export {
  collectOracleInputs,
  extractAcceptanceCriteria,
  extractCriteriaFromMarkdown,
  formatOraclePrompt,
  parseOracleResponse,
  runOracle,
} from "./skills/oracle.js";
export type { OracleInput, OracleResult } from "./skills/oracle.js";

// Phase 3: Server
export { Station } from "./server/station.js";
export { getWebUIHtml } from "./server/web-ui.js";
export { ProcessManager } from "./server/process-manager.js";
export type { ManagedProcess, ProcessEvent } from "./server/process-manager.js";
export { MergeCoordinator } from "./server/merge-coordinator.js";
export type { MergeRequest, MergeEvent, MergeCoordinatorConfig } from "./server/merge-coordinator.js";

// Phase 7: Scheduling
export { Scheduler, parseCron, parseCronField, getNextRunTime } from "./scheduling/scheduler.js";
export type { ScheduledTask, ParsedCron, CronField } from "./scheduling/scheduler.js";
export { HeartbeatMonitor } from "./scheduling/heartbeat.js";
export type { HeartbeatConfig, HeartbeatStatus, HeartbeatResult } from "./scheduling/heartbeat.js";

// Phase 7: Integrations
export { NotificationManager } from "./integrations/notifications.js";
export type {
  NotificationTrigger,
  NotificationBackend,
  NotificationConfig,
  Notification,
} from "./integrations/notifications.js";
export { GitHubIntegration, issueToWorkItem, mapLabelToPriority, mapLabelToType } from "./integrations/github.js";
export type { GitHubConfig, CreatePROptions, CreatePRResult, GitHubIssue } from "./integrations/github.js";

// Phase 8: CI/CD
export {
  GitHubActionsAdapter,
  mapRunStatus,
  mapDeploymentState,
  parseOwnerRepo,
  mapGHRun,
  mapGHJob,
  mapGHStep,
  computeDurationMs,
} from "./integrations/github-actions.js";
export type {
  GHWorkflowRun,
  GHJob,
  GHStep,
  GHDeployment,
  GHDeploymentStatusEntry,
} from "./integrations/github-actions.js";
export { CICDPoller } from "./integrations/cicd-poller.js";
export type { CICDPollerConfig, ProjectCICDState, PollerEventCallback } from "./integrations/cicd-poller.js";

// Cloud Database Adapters
export {
  TursoAdapter,
  detectTurso,
  getTursoStatus,
  parseTursoUrl,
  NeonAdapter,
  detectNeon,
  getNeonStatus,
  parseNeonUrl,
  isNeonUrl,
  detectPrisma,
  parseMigrateStatus,
  getPrismaMigrationStatus,
  runPrismaMigrate,
  augmentWithPrisma,
  detectCloudServices,
  getDatabaseAdapters,
} from "./cloud/index.js";
export type { TursoConfig, NeonConfig, PrismaOverlayConfig, CloudDetectionResult } from "./cloud/index.js";

// Orchestrator
export { computePlan, recomputePlan, computeTracks, resolveScope, detectCycles, applyQuery } from "./orchestrator/planner.js";
export type { TicketSet } from "./orchestrator/planner.js";
export { Executor, updateTicketStatus } from "./orchestrator/executor.js";
export { WorktreeManager } from "./orchestrator/worktree.js";
export type { WorktreeInfo, MergeResult, ExecResult } from "./orchestrator/worktree.js";
export { commitStepChanges } from "./orchestrator/git-ops.js";
export { reconcilePlans } from "./orchestrator/reconcile.js";
export { checkHygiene } from "./orchestrator/hygiene.js";
export {
  savePlan,
  loadPlan,
  listPlans,
  deletePlan,
  loadPlanContext,
  savePlanContext,
  defaultConfig as defaultOrchestratorConfig,
} from "./orchestrator/persistence.js";
export { plansDir, planPath, planContextPath } from "./config/paths.js";

// Phase 3: Channel Adapters
export { parseCommand, formatStatusResponse, formatProjectResponse, formatAgentsResponse, formatAgentCompletedResponse } from "./channels/router.js";
export type { ChannelCommand, ChannelResponse } from "./channels/router.js";
export { SlackChannel } from "./channels/slack.js";
export type { SlackConfig } from "./channels/slack.js";
export { TelegramChannel } from "./channels/telegram.js";
export type { TelegramConfig } from "./channels/telegram.js";
export { DiscordChannel } from "./channels/discord.js";
export type { DiscordConfig } from "./channels/discord.js";
