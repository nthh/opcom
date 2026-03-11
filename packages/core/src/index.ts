// Logger
export { createLogger, isEnabled } from "./logger.js";
export type { LogLevel, Logger } from "./logger.js";

export { detectProject } from "./detection/detect.js";
export { detectGit } from "./detection/git.js";
export { scanTickets, summarizeWorkItems, parseFrontmatter, parseTicketFile, applyFieldMappings } from "./detection/tickets.js";
export { detectSubProjects } from "./detection/services.js";
export { mergeStacks } from "./detection/stack.js";
export { detectProfile, detectProfileCommands, detectAgentConstraints, detectFieldMappings, mergeProfiles, parseMakefileTargets, parseJustfileRecipes, parseTaskfileTargets, mapTargetsToCommands, extractForbiddenCommands } from "./detection/profile.js";
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
  rolesDir,
  rolePath,
  skillsDir,
  skillPath,
  summariesDir,
  summaryPath,
  templatesDir,
  templateDir,
  teamsDir,
  teamPath,
} from "./config/paths.js";
export { loadRole, resolveRoleConfig, writeBuiltinRoles, BUILTIN_ROLES, parseRoleYaml } from "./config/roles.js";
export { loadSkill, listSkills, matchSkills, writeBuiltinSkills, createSkill, BUILTIN_SKILLS, parseSkillMd } from "./config/skills.js";
export { loadTeam, listTeams, resolveTeam, matchesTriggers, writeBuiltinTeams, BUILTIN_TEAMS, parseTeamYaml } from "./config/teams.js";
export {
  readProjectSummary,
  writeProjectSummary,
  updateProjectSummary,
  createInitialSummaryFromDescription,
} from "./config/summary.js";
export type { SummaryUpdate } from "./config/summary.js";

export { validateGlobalConfig, validateWorkspaceConfig, validateProjectConfig, emptyStack } from "./config/schema.js";
export {
  settingsDefs,
  defaultSettings,
  getSetting,
  setSetting,
  validateSettings,
} from "./config/settings.js";
export type { SettingDef } from "./config/settings.js";

export { refreshProjectStatus } from "./project/status.js";
export type { ProjectStatus } from "./project/status.js";

// Phase 2: Agents
export { deriveAllowedBashTools, checkForbiddenCommand } from "./agents/allowed-bash.js";
export type { AllowedBashInput } from "./agents/allowed-bash.js";
export { createAdapter, ClaudeCodeAdapter, OpenCodeAdapter } from "./agents/adapter.js";
export { SessionManager } from "./agents/session-manager.js";
export { EventStore } from "./agents/event-store.js";
export type { ToolUsageStat, SessionStat, DailyActivity, PlanEventRecord } from "./agents/event-store.js";
export { buildProjectProfile, buildContextPacket, contextPacketToMarkdown, buildTicketCreationPrompt, buildTicketChatPrompt } from "./agents/context-builder.js";
export { MessageRouter } from "./agents/message-router.js";

// Phase 2: Jira Adapter
export { JiraAdapter, mapJiraStatus, mapJiraPriority, mapJiraType, jiraIssueToWorkItem, extractDeps } from "./adapters/jira.js";
export type { JiraConfig } from "./adapters/jira.js";
export { loadJiraAuth, saveJiraAuth, buildAuthHeader } from "./adapters/jira-auth.js";
export type { JiraAuthConfig } from "./adapters/jira-auth.js";

// Calendar Adapter
export { CalendarAdapter, importICalFile } from "./adapters/calendar.js";
export { parseICalEvents, parseICalToWorkItems, parseICalDate, icalEventToWorkItem, eventToId } from "./adapters/calendar-parser.js";
export type { ICalEvent } from "./adapters/calendar-parser.js";
export { workItemToMarkdown, writeWorkItemsToTickets } from "./adapters/ticket-writer.js";
export type { WriteResult } from "./adapters/ticket-writer.js";
export { parsePastedText, parseLine, pasteEventToId } from "./adapters/paste-parser.js";
export type { ParsedLine } from "./adapters/paste-parser.js";

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

export {
  assessDecomposition,
  formatPlanningPrompt,
  formatDecompositionPrompt,
  parsePlanningResponse,
  parseDecompositionResponse,
  generatePlanningSession,
  generateDecomposition,
} from "./skills/planning.js";

// Phase 3: Server
export { Station } from "./server/station.js";
export { getWebUIHtml } from "./server/web-ui.js";
export { ProcessManager } from "./server/process-manager.js";
export type { ManagedProcess, ProcessEvent } from "./server/process-manager.js";
export { MergeCoordinator } from "./server/merge-coordinator.js";
export type { MergeRequest, MergeEvent, MergeCoordinatorConfig } from "./server/merge-coordinator.js";

// Phase 8: Dev Environments
export { EnvironmentManager, topologicalSort } from "./server/environment-manager.js";
export type { EnvironmentEvent } from "./server/environment-manager.js";
export { defaultHealthCheck, runHealthCheck } from "./server/health-checker.js";
export {
  loadPortRegistry,
  savePortRegistry,
  findConflict,
  allocatePort,
  releasePort,
  findNextAvailablePort,
  isPortInReservedRange,
} from "./config/port-registry.js";
export { portsPath, stateDir, stateFilePath } from "./config/paths.js";

// Phase 7: Scheduling
export { Scheduler, parseCron, parseCronField, getNextRunTime } from "./scheduling/scheduler.js";
export type { ScheduledTask, ParsedCron, CronField } from "./scheduling/scheduler.js";
export { HeartbeatMonitor } from "./scheduling/heartbeat.js";
export type { HeartbeatConfig, HeartbeatStatus, HeartbeatResult } from "./scheduling/heartbeat.js";

// Integration Registry
export { IntegrationRegistry } from "./integrations/registry.js";
export type { IntegrationInfo } from "./integrations/registry.js";
export { builtinModules, defaultIntegrationsConfig } from "./integrations/builtins.js";
export { validateIntegrationsConfig } from "./config/schema.js";

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

// Cloud Storage Adapters
export {
  R2Adapter,
  detectR2,
  getR2Status,
  parseR2Buckets,
  GCSAdapter,
  detectGCS,
  getGCSStatus,
  parseGsutilSize,
  parseFirebaseStorageBucket,
  getStorageAdapters,
} from "./cloud/index.js";
export type { R2Config, GCSConfig } from "./cloud/index.js";

// Cloud Serverless Adapters
export {
  CloudflareWorkersAdapter,
  detectWorkers,
  getWorkersStatus,
  parseWranglerRoutes,
  parseWranglerCrons,
  parseWranglerName,
  FirebaseFunctionsAdapter,
  detectFirebaseFunctions,
  getFirebaseFunctionsStatus,
  parseFirebaseFunctions,
  readFirebaseProject,
  detectScheduledFunctions,
  getServerlessAdapters,
} from "./cloud/index.js";
export type { WorkersConfig, FirebaseFunctionsConfig } from "./cloud/index.js";

// Cloud Hosting Adapters
export {
  FirebaseHostingAdapter,
  detectFirebaseHosting,
  getFirebaseHostingStatus,
  parseFirebaseHosting,
  detectHostingFramework,
  getHostingAdapters,
} from "./cloud/index.js";
export type { FirebaseHostingConfig } from "./cloud/index.js";

// Cloud Mobile Adapters
export {
  ExpoEASAdapter,
  detectExpoEAS,
  getExpoEASStatus,
  parseAppJson,
  parseEasJson,
  detectPublishCommand,
  getMobileAdapters,
} from "./cloud/index.js";
export type { ExpoEASConfig } from "./cloud/index.js";

// Context Graph Integration
export { buildGraph, openGraphDb, graphExists, queryGraphContext, queryProjectDrift, ingestTestResults, ingestFieldMappingEdges, getGraphStats } from "./graph/graph-service.js";

// Orchestrator
export { computePlan, recomputePlan, computeTracks, resolveScope, detectCycles, applyQuery, findParentTicketIds, computeStages, computeDepthStages, buildExplicitStages, validateExplicitStages, computeStageSummary, expandTeamSteps, expandSubtaskSteps, extractSubtasks, baseTicketId, applyStrategy } from "./orchestrator/planner.js";
export type { TicketSet } from "./orchestrator/planner.js";
export {
  writeSubTicket,
  writeSubTickets,
  formatTicketFile,
  assessTicketsForDecomposition,
  applyDecomposition,
  hasChildren,
  getChildTicketIds,
  isParentComplete,
} from "./orchestrator/decomposition.js";
export { Executor, updateTicketStatus, stampTicketFiles, isSwarmSubtask, isFinalSwarmSubtask, getSwarmVerificationMode, findSwarmWorktree } from "./orchestrator/executor.js";
export { WorktreeManager } from "./orchestrator/worktree.js";
export type { WorktreeInfo, MergeResult, ExecResult } from "./orchestrator/worktree.js";
export { commitStepChanges, captureChangeset, getTicketDiff, parseNumstat } from "./orchestrator/git-ops.js";
export { reconcilePlans } from "./orchestrator/reconcile.js";
export { checkHygiene } from "./orchestrator/hygiene.js";
export type { HygieneOptions } from "./orchestrator/hygiene.js";
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

// State Store
export { StateStore } from "./state/state-store.js";
export type { StateWriter, StateReader } from "./state/state-store.js";

// Templates
export { BUILTIN_TEMPLATES } from "./templates/builtins.js";
export { substituteVariables } from "./templates/substitution.js";
export { loadTemplateFromDir, loadUserTemplates, loadAllTemplates, findTemplate } from "./templates/loader.js";
export { scaffoldFromTemplate } from "./templates/scaffold.js";
export type { ScaffoldOptions, ScaffoldResult } from "./templates/scaffold.js";

// Phase 3: Channel Adapters
export { parseCommand, formatStatusResponse, formatProjectResponse, formatAgentsResponse, formatAgentCompletedResponse } from "./channels/router.js";
export type { ChannelCommand, ChannelResponse } from "./channels/router.js";
export { SlackChannel } from "./channels/slack.js";
export type { SlackConfig } from "./channels/slack.js";
export { TelegramChannel } from "./channels/telegram.js";
export type { TelegramConfig } from "./channels/telegram.js";
export { DiscordChannel } from "./channels/discord.js";
export type { DiscordConfig } from "./channels/discord.js";

// Infrastructure Monitoring
export {
  KubernetesAdapter,
  mapDeploymentStatus,
  mapStatefulSetStatus,
  mapDaemonSetStatus,
  mapPodStatus,
  mapJobStatus,
  mapCronJobStatus,
  mapServiceStatus,
  mapIngressStatus,
  mapConditions,
  mapContainerStatus,
  parseLogLine,
  resolveK8sConfig,
  resolveNamespace,
  resolveLabelSelector,
  detectInfrastructure,
  getInfraAdapters,
  getInfraAdapter,
  computeInfraHealthSummary,
} from "./infra/index.js";
export type { InfraDetectionResult } from "./infra/index.js";
