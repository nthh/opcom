// TUI Client — WebSocket connection to station daemon with fallback to direct loading

import { watch, type FSWatcher, existsSync } from "node:fs";
import { join } from "node:path";
import type {
  AgentSession,
  ClientCommand,
  ServerEvent,
  ProjectStatusSnapshot,
  NormalizedEvent,
  WorkItem,
  ProjectConfig,
  Plan,
  PlanSummary,
  CloudService,
  CloudServiceConfig,
  CloudServiceHealth,
  CloudHealthSummary,
  Pipeline,
  DeploymentStatus,
  InfraResource,
  PodDetail,
  InfraHealthSummary,
} from "@opcom/types";
import {
  loadGlobalConfig,
  loadWorkspace,
  loadProject,
  refreshProjectStatus,
  scanTickets,
  Station,
  SessionManager,
  EventStore,
  buildContextPacket,
  buildTicketCreationPrompt,
  buildTicketChatPrompt,
  createLogger,
  listPlans,
  computePlan,
  savePlan,
  deletePlan,
  CICDPoller,
  GitHubActionsAdapter,
} from "@opcom/core";
import type { TicketSet } from "@opcom/core";

const log = createLogger("tui-client");

type EventHandler = (event: ServerEvent) => void;

export class TuiClient {
  private ws: import("ws").default | null = null;
  private handlers: EventHandler[] = [];
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectDelay = 1000;
  private maxReconnectDelay = 30000;
  private _connected = false;
  private _daemonMode = false;
  private destroyed = false;

  // Cached state
  projects: ProjectStatusSnapshot[] = [];
  agents: AgentSession[] = [];
  agentEvents = new Map<string, NormalizedEvent[]>();
  activePlan: Plan | null = null;
  allPlans: PlanSummary[] = [];

  // Direct-loaded data (fallback mode)
  projectConfigs = new Map<string, ProjectConfig>();
  projectTickets = new Map<string, WorkItem[]>();

  // Cloud service status cache per project
  projectCloudServices = new Map<string, CloudService[]>();

  // CI/CD status cache per project
  projectPipelines = new Map<string, Pipeline[]>();
  projectDeployments = new Map<string, DeploymentStatus[]>();

  // Infrastructure resource cache per project
  projectInfraResources = new Map<string, InfraResource[]>();

  // Pod crash events per project (most recent)
  projectInfraCrashes = new Map<string, Array<{ pod: PodDetail; container: string; reason: string; timestamp: string }>>();

  // Local session manager for offline mode
  private localSessionManager: SessionManager | null = null;
  private eventStore: EventStore | null = null;
  private activeExecutorPlanId: string | null = null;
  private activeExecutor: { pause(): void; resume(): void; continueToNextStage?(): void; confirmStep?(ticketId: string): void; rejectStep?(ticketId: string, reason?: string): void } | null = null;

  // CI/CD poller for direct mode (real-time deployment tracking)
  private cicdPoller: CICDPoller | null = null;

  // File watchers for .tickets/ directories
  private ticketWatchers: FSWatcher[] = [];
  private ticketRefreshTimer: ReturnType<typeof setTimeout> | null = null;

  get connected(): boolean {
    return this._connected;
  }

  get daemonMode(): boolean {
    return this._daemonMode;
  }

  async connect(): Promise<void> {
    // Check if daemon is running
    const status = await Station.isRunning();
    if (status.running && status.port) {
      await this.connectWebSocket(status.port);
    } else {
      await this.loadDirect();
    }
  }

  private async connectWebSocket(port: number): Promise<void> {
    try {
      const { default: WebSocket } = await import("ws");
      const url = `ws://localhost:${port}`;

      return new Promise<void>((resolve) => {
        const ws = new WebSocket(url);
        let resolved = false;

        ws.on("open", () => {
          this.ws = ws;
          this._connected = true;
          this._daemonMode = true;
          this.reconnectDelay = 1000;

          // Subscribe to all events
          this.send({ type: "subscribe" });

          if (!resolved) {
            resolved = true;
            resolve();
          }
        });

        ws.on("message", (data: unknown) => {
          try {
            const raw = typeof data === "string" ? data : String(data);
            const event = JSON.parse(raw) as ServerEvent;
            this.handleServerEvent(event);
          } catch {
            // Ignore parse errors
          }
        });

        ws.on("close", () => {
          this._connected = false;
          this.ws = null;
          if (!this.destroyed) {
            this.scheduleReconnect(port);
          }
        });

        ws.on("error", () => {
          if (!resolved) {
            resolved = true;
            // Fall back to direct loading
            this.loadDirect().then(resolve).catch(resolve);
          }
        });

        // Timeout after 3 seconds
        setTimeout(() => {
          if (!resolved) {
            resolved = true;
            ws.close();
            this.loadDirect().then(resolve).catch(resolve);
          }
        }, 3000);
      });
    } catch {
      await this.loadDirect();
    }
  }

  private scheduleReconnect(port: number): void {
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = setTimeout(() => {
      if (!this.destroyed) {
        this.connectWebSocket(port).catch(() => {});
      }
    }, this.reconnectDelay);
    this.reconnectDelay = Math.min(this.reconnectDelay * 2, this.maxReconnectDelay);
  }

  private async loadDirect(): Promise<void> {
    this._daemonMode = false;
    this._connected = false;

    // Create event store for persistence
    try {
      this.eventStore = new EventStore();
    } catch (err) {
      log.warn("failed to create event store", { error: String(err) });
    }

    // Create local session manager for offline agent execution
    this.localSessionManager = new SessionManager();
    try {
      await this.localSessionManager.init({ eventStore: this.eventStore ?? undefined });

      // Import existing session YAMLs into DB on first run
      const persisted = await this.localSessionManager.loadAllPersistedSessions();
      if (this.eventStore) {
        this.eventStore.importSessions(persisted);
      }

      // Load sessions from DB (includes both YAML-imported and event-tracked)
      const dbSessions = this.eventStore?.loadAllSessions() ?? persisted;
      for (const session of dbSessions) {
        this.agents.push(session);
      }
    } catch (err) {
      log.warn("failed to init local session manager", { error: String(err) });
    }

    // Wire session manager events into handleServerEvent — same code path as WebSocket
    this.localSessionManager.on("session_created", (session) => {
      log.info("local session created", { sessionId: session.id });
      this.handleServerEvent({ type: "agent_started", session });
    });
    this.localSessionManager.on("session_stopped", (session) => {
      log.info("local session stopped", { sessionId: session.id });
      this.handleServerEvent({ type: "agent_stopped", sessionId: session.id, reason: "stopped" });
      this.syncBackendSessionId(session.id);
    });
    this.localSessionManager.on("state_change", ({ sessionId, newState }) => {
      this.handleServerEvent({ type: "agent_status", sessionId, state: newState });
      this.syncBackendSessionId(sessionId);
    });
    this.localSessionManager.on("agent_event", ({ sessionId, event }) => {
      this.handleServerEvent({ type: "agent_event", sessionId, event });
      if (event.type === "agent_start") {
        this.syncBackendSessionId(sessionId);
      }
    });

    try {
      const global = await loadGlobalConfig();
      const workspace = await loadWorkspace(global.defaultWorkspace);
      if (!workspace) return;

      const projects: ProjectStatusSnapshot[] = [];
      for (const pid of workspace.projectIds) {
        const project = await loadProject(pid);
        if (!project) continue;
        this.projectConfigs.set(pid, project);

        const status = await refreshProjectStatus(project);

        // Build cloud health summary from detected cloud configs
        const cloudHealthSummary = project.cloudServices.length > 0
          ? { total: project.cloudServices.length, healthy: 0, degraded: 0, unreachable: 0, unknown: project.cloudServices.length }
          : undefined;

        projects.push({
          id: project.id,
          name: project.name,
          path: project.path,
          git: status.gitFresh,
          workSummary: status.workSummary,
          cloudHealthSummary,
        });

        // Load tickets (always scan — tickets may be added after initial detection)
        try {
          const tickets = await scanTickets(project.path);
          this.projectTickets.set(pid, tickets);
        } catch {
          // Skip failed ticket scans
        }
      }

      this.projects = projects;

      // Load active plan
      await this.loadActivePlan();

      // Watch .tickets/ dirs for changes so new tickets appear automatically
      this.watchTicketDirs();

      // Start CI/CD polling for real-time deployment status updates
      this.initCICDPoller().catch((err) => {
        log.warn("CI/CD poller init failed", { error: String(err) });
      });
    } catch (err) {
      log.error("loadDirect failed", { error: String(err) });
    }
  }

  private async initCICDPoller(): Promise<void> {
    const adapter = new GitHubActionsAdapter();
    this.cicdPoller = new CICDPoller(adapter);

    // Forward CI/CD events into the same handler pipeline as WebSocket events
    this.cicdPoller.onEvent((projectId, event) => {
      if (event.type === "pipeline_updated") {
        this.handleServerEvent({ type: "pipeline_updated", projectId, pipeline: event.pipeline });
      } else if (event.type === "deployment_updated") {
        this.handleServerEvent({ type: "deployment_updated", projectId, deployment: event.deployment });
      }
    });

    // Track all projects that have CI/CD configured
    for (const [, project] of this.projectConfigs) {
      try {
        const hasCI = await adapter.detect(project);
        if (hasCI) {
          const state = await this.cicdPoller.track(project);
          // Seed initial data into caches
          if (state.pipelines.length > 0) {
            this.projectPipelines.set(project.id, state.pipelines);
          }
          if (state.deployments.length > 0) {
            this.projectDeployments.set(project.id, state.deployments);
          }
        }
      } catch (err) {
        log.warn("CI/CD tracking failed for project", { projectId: project.id, error: String(err) });
      }
    }
  }

  private async loadActivePlan(): Promise<void> {
    try {
      const plans = await listPlans();
      // Build plan summaries for the switcher
      this.allPlans = plans.map((p) => ({
        id: p.id,
        name: p.name,
        status: p.status,
        stepsDone: p.steps.filter((s) => s.status === "done" || s.status === "skipped").length,
        stepsTotal: p.steps.length,
        updatedAt: p.updatedAt,
      }));
      // Find the most recent active plan (executing/paused/planning)
      const active = plans.find((p) =>
        p.status === "executing" || p.status === "paused" || p.status === "planning",
      );
      // Only fall back to non-terminal plans — skip cancelled/done/failed
      const fallback = plans.find((p) =>
        p.status !== "cancelled" && p.status !== "done" && p.status !== "failed",
      );
      this.activePlan = active ?? fallback ?? null;
    } catch {
      // Plans dir may not exist yet
    }
  }

  private handleServerEvent(event: ServerEvent): void {
    switch (event.type) {
      case "projects_snapshot":
        this.projects = event.projects;
        break;

      case "agents_snapshot":
        this.agents = event.sessions;
        break;

      case "agent_started":
        this.agents = this.agents.filter((a) => a.id !== event.session.id);
        this.agents.push(event.session);
        // Only initialize if no events exist yet — avoids wiping events
        // that arrived before agent_started due to ordering
        if (!this.agentEvents.has(event.session.id)) {
          this.agentEvents.set(event.session.id, []);
        }
        break;

      case "agent_stopped":
        this.agents = this.agents.map((a) =>
          a.id === event.sessionId ? { ...a, state: "stopped" as const, stoppedAt: new Date().toISOString() } : a,
        );
        break;

      case "agent_status":
        this.agents = this.agents.map((a) =>
          a.id === event.sessionId
            ? {
                ...a,
                state: event.state,
                contextUsage: event.contextUsage !== undefined
                  ? { tokensUsed: event.contextUsage, maxTokens: 200000, percentage: (event.contextUsage / 200000) * 100 }
                  : a.contextUsage,
              }
            : a,
        );
        break;

      case "agent_event": {
        const events = this.agentEvents.get(event.sessionId) ?? [];
        events.push(event.event);
        // Keep last 2000 events per agent
        if (events.length > 2000) events.splice(0, events.length - 2000);
        this.agentEvents.set(event.sessionId, events);
        break;
      }

      case "project_status":
        this.projects = this.projects.map((p) =>
          p.id === event.projectId
            ? { ...p, git: event.git, workSummary: event.workSummary }
            : p,
        );
        break;

      case "plan_updated":
      case "plan_completed":
      case "plan_paused":
        this.activePlan = event.plan;
        break;

      case "plan_cancelled":
        if (this.activePlan?.id === event.planId) {
          this.activePlan = null;
          this.loadActivePlan().catch(() => {});
        }
        break;

      case "plan_deleted":
        if (this.activePlan?.id === event.planId) {
          this.activePlan = null;
          this.loadActivePlan().catch(() => {});
        }
        break;

      case "plans_list":
        this.allPlans = event.plans;
        break;

      case "cloud_service_updated": {
        const existing = this.projectCloudServices.get(event.projectId) ?? [];
        const idx = existing.findIndex((s) => s.id === event.service.id);
        if (idx >= 0) {
          existing[idx] = event.service;
        } else {
          existing.push(event.service);
        }
        this.projectCloudServices.set(event.projectId, existing);
        // Update health summary on project snapshot
        const summary = this.buildHealthSummary(existing);
        this.projects = this.projects.map((p) =>
          p.id === event.projectId ? { ...p, cloudHealthSummary: summary } : p,
        );
        break;
      }

      case "pipeline_updated": {
        const pipelines = this.projectPipelines.get(event.projectId) ?? [];
        const pIdx = pipelines.findIndex((p) => p.id === event.pipeline.id);
        if (pIdx >= 0) {
          pipelines[pIdx] = event.pipeline;
        } else {
          pipelines.unshift(event.pipeline);
          // Keep last 20 pipelines per project
          if (pipelines.length > 20) pipelines.pop();
        }
        this.projectPipelines.set(event.projectId, pipelines);
        break;
      }

      case "deployment_updated": {
        const deployments = this.projectDeployments.get(event.projectId) ?? [];
        const dIdx = deployments.findIndex((d) => d.id === event.deployment.id);
        if (dIdx >= 0) {
          deployments[dIdx] = event.deployment;
        } else {
          deployments.unshift(event.deployment);
        }
        this.projectDeployments.set(event.projectId, deployments);
        break;
      }

      case "infra_resource_updated": {
        const resources = this.projectInfraResources.get(event.projectId) ?? [];
        const rIdx = resources.findIndex((r) => r.id === event.resource.id);
        if (rIdx >= 0) {
          resources[rIdx] = event.resource;
        } else {
          resources.push(event.resource);
        }
        this.projectInfraResources.set(event.projectId, resources);
        // Update infra health summary
        const infraSummary = this.buildInfraHealthSummary(resources);
        this.projects = this.projects.map((p) =>
          p.id === event.projectId ? { ...p, infraHealthSummary: infraSummary } : p,
        );
        break;
      }

      case "infra_resource_deleted": {
        const resources = this.projectInfraResources.get(event.projectId) ?? [];
        const filtered = resources.filter((r) => r.id !== event.resourceId);
        this.projectInfraResources.set(event.projectId, filtered);
        const infraSummary = this.buildInfraHealthSummary(filtered);
        this.projects = this.projects.map((p) =>
          p.id === event.projectId ? { ...p, infraHealthSummary: infraSummary } : p,
        );
        break;
      }

      case "pod_crash": {
        const crashes = this.projectInfraCrashes.get(event.projectId) ?? [];
        crashes.push({
          pod: event.pod,
          container: event.container,
          reason: event.reason,
          timestamp: new Date().toISOString(),
        });
        // Keep last 20 crash events per project
        if (crashes.length > 20) crashes.splice(0, crashes.length - 20);
        this.projectInfraCrashes.set(event.projectId, crashes);
        break;
      }
    }

    // Notify handlers
    for (const handler of this.handlers) {
      try {
        handler(event);
      } catch {
        // Ignore handler errors
      }
    }
  }

  send(command: ClientCommand): void {
    if (this.ws && this._connected) {
      try {
        this.ws.send(JSON.stringify(command));
      } catch {
        // Connection broken
      }
    } else if (this.localSessionManager) {
      // Offline mode — handle commands locally
      this.handleLocalCommand(command).catch((err) => {
        log.error("local command failed", { type: command.type, error: String(err) });
      });
    } else {
      log.warn("send() called with no connection and no local session manager", { type: command.type });
    }
  }

  private async handleLocalCommand(command: ClientCommand): Promise<void> {
    if (!this.localSessionManager) return;

    switch (command.type) {
      case "start_agent": {
        const project = this.projectConfigs.get(command.projectId);
        if (!project) {
          log.error("start_agent: project not found", { projectId: command.projectId });
          return;
        }

        // Find work item if specified
        let workItem: WorkItem | undefined;
        if (command.workItemId) {
          const tickets = this.projectTickets.get(command.projectId) ?? [];
          workItem = tickets.find((t) => t.id === command.workItemId);
        }

        const contextPacket = await buildContextPacket(project, workItem);
        const backend = (command.backend ?? "claude-code") as import("@opcom/types").AgentBackend;

        log.info("starting local agent", { projectId: command.projectId, backend });
        await this.localSessionManager.startSession(
          command.projectId,
          backend,
          { projectPath: project.path, contextPacket, workItemId: command.workItemId },
          command.workItemId,
        );
        break;
      }

      case "stop_agent":
        await this.localSessionManager.stopSession(command.agentId);
        break;

      case "create_ticket": {
        const ticketProject = this.projectConfigs.get(command.projectId);
        if (!ticketProject) {
          log.error("create_ticket: project not found", { projectId: command.projectId });
          return;
        }

        const existingTickets = this.projectTickets.get(command.projectId) ?? [];
        const systemPrompt = buildTicketCreationPrompt(ticketProject, command.description, existingTickets);
        const contextPacket = await buildContextPacket(ticketProject);

        log.info("starting ticket creation agent", { projectId: command.projectId });
        const ticketSession = await this.localSessionManager.startSession(
          command.projectId,
          "claude-code",
          {
            projectPath: ticketProject.path,
            contextPacket,
            systemPrompt,
            allowedTools: ["Bash", "Write"],
          },
        );

        // When agent finishes, rescan tickets
        const onStopped = (event: ServerEvent) => {
          if (event.type === "agent_stopped" && event.sessionId === ticketSession.id) {
            this.handlers = this.handlers.filter((h) => h !== onStopped);
            this.reloadProjectData().catch(() => {});
          }
        };
        this.handlers.push(onStopped);
        break;
      }

      case "chat_ticket": {
        const chatProject = this.projectConfigs.get(command.projectId);
        if (!chatProject) {
          log.error("chat_ticket: project not found", { projectId: command.projectId });
          return;
        }

        const tickets = this.projectTickets.get(command.projectId) ?? [];
        const ticket = tickets.find((t) => t.id === command.workItemId);
        if (!ticket) {
          log.error("chat_ticket: ticket not found", { workItemId: command.workItemId });
          return;
        }

        const chatPrompt = buildTicketChatPrompt(chatProject, ticket, command.message);
        const chatContext = await buildContextPacket(chatProject, ticket);

        log.info("starting ticket chat agent", { projectId: command.projectId, workItemId: command.workItemId });
        const chatSession = await this.localSessionManager.startSession(
          command.projectId,
          "claude-code",
          {
            projectPath: chatProject.path,
            contextPacket: chatContext,
            systemPrompt: chatPrompt,
            workItemId: command.workItemId,
            allowedTools: ["Read", "Glob", "Grep", "Bash", "Write", "Edit"],
          },
          command.workItemId,
        );

        // When agent finishes, rescan tickets (it may have edited the ticket)
        const onChatStopped = (event: ServerEvent) => {
          if (event.type === "agent_stopped" && event.sessionId === chatSession.id) {
            this.handlers = this.handlers.filter((h) => h !== onChatStopped);
            this.reloadProjectData().catch(() => {});
          }
        };
        this.handlers.push(onChatStopped);
        break;
      }

      case "prompt": {
        // If the agent is stopped but has a backend session ID, resume it
        const agentSession = this.agents.find((a) => a.id === command.agentId);
        if (agentSession?.state === "stopped" && agentSession.backendSessionId) {
          const project = this.projectConfigs.get(agentSession.projectId);
          if (project) {
            const ctx = await buildContextPacket(project);
            log.info("resuming agent via --resume", { backendSessionId: agentSession.backendSessionId });
            await this.localSessionManager.startSession(
              agentSession.projectId,
              "claude-code",
              {
                projectPath: project.path,
                contextPacket: ctx,
                systemPrompt: command.text,
                resumeSessionId: agentSession.backendSessionId,
                workItemId: agentSession.workItemId,
                allowedTools: ["Read", "Glob", "Grep", "Bash", "Write", "Edit"],
              },
              agentSession.workItemId,
            );
          }
        } else {
          await this.localSessionManager.promptSession(command.agentId, command.text);
        }
        break;
      }

      case "pause_plan":
        if (this.activeExecutor) {
          this.activeExecutor.pause();
        } else if (this.activePlan && this.activePlan.id === command.planId && this.activePlan.status === "executing") {
          // No live executor — plan was left executing from a previous session.
          // Update status directly so user can resume cleanly.
          this.activePlan.status = "paused";
          await savePlan(this.activePlan);
          this.handleServerEvent({ type: "plan_paused", plan: this.activePlan } as ServerEvent);
        }
        break;

      case "resume_plan":
        if (this.activeExecutor) {
          this.activeExecutor.resume();
        } else if (this.activePlan && this.activePlan.id === command.planId && this.activePlan.status === "paused") {
          // No live executor — plan was paused in a previous session or executor exited.
          // Re-create the executor to resume execution.
          await this.executePlan(this.activePlan.id);
        }
        break;

      case "advance_stage":
        this.activeExecutor?.continueToNextStage?.();
        break;

      case "confirm_step":
        this.activeExecutor?.confirmStep?.(command.ticketId);
        break;

      case "reject_step":
        this.activeExecutor?.rejectStep?.(command.ticketId, command.reason);
        break;

      case "cancel_plan": {
        if (this.activePlan && this.activePlan.id === command.planId) {
          // Stop executor if running
          if (this.activeExecutorPlanId === command.planId && this.activeExecutor) {
            // The executor stop is handled by the run() promise .finally()
            this.activeExecutorPlanId = null;
            this.activeExecutor = null;
          }
          this.activePlan.status = "cancelled";
          this.activePlan.updatedAt = new Date().toISOString();
          await savePlan(this.activePlan);
          this.handleServerEvent({ type: "plan_cancelled", planId: command.planId } as ServerEvent);
          // Reload to pick up next active plan
          await this.loadActivePlan();
        }
        break;
      }

      case "delete_plan": {
        if (this.activePlan && this.activePlan.id === command.planId) {
          // Stop executor if running
          if (this.activeExecutorPlanId === command.planId && this.activeExecutor) {
            this.activeExecutorPlanId = null;
            this.activeExecutor = null;
          }
          await deletePlan(command.planId);
          this.handleServerEvent({ type: "plan_deleted", planId: command.planId } as ServerEvent);
          // Reload to pick up next active plan
          await this.loadActivePlan();
        } else {
          // Deleting a non-active plan
          await deletePlan(command.planId);
          this.handleServerEvent({ type: "plan_deleted", planId: command.planId } as ServerEvent);
        }
        break;
      }

      case "list_plans": {
        await this.loadActivePlan();
        this.handleServerEvent({ type: "plans_list", plans: this.allPlans } as ServerEvent);
        break;
      }

      case "refresh_status":
        await this.reloadProjectData();
        break;

      default:
        // subscribe, ping — no-ops in offline mode
        break;
    }
  }

  async switchToPlan(planId: string): Promise<void> {
    const { loadPlan } = await import("@opcom/core");
    const plan = await loadPlan(planId);
    if (plan) {
      this.activePlan = plan;
      for (const handler of this.handlers) {
        try {
          handler({ type: "plan_updated", plan } as ServerEvent);
        } catch { /* ignore */ }
      }
    }
  }

  cancelPlan(planId: string): void {
    this.send({ type: "cancel_plan", planId });
  }

  deletePlanById(planId: string): void {
    this.send({ type: "delete_plan", planId });
  }

  async createPlan(projectId: string): Promise<Plan | null> {
    try {
      const tickets = this.projectTickets.get(projectId);
      if (!tickets || tickets.length === 0) {
        log.warn("createPlan: no tickets for project", { projectId });
        return null;
      }

      const ticketSets: TicketSet[] = [{ projectId, tickets }];
      const scope = { projectIds: [projectId], query: "status:open" };
      const project = this.projectConfigs.get(projectId);
      const name = project?.name ?? projectId;
      const plan = computePlan(ticketSets, scope, name);

      if (plan.steps.length === 0) {
        log.warn("createPlan: no open tickets after filter");
        return null;
      }

      await savePlan(plan);
      this.activePlan = plan;

      // Notify handlers so TUI re-renders
      for (const handler of this.handlers) {
        try {
          handler({ type: "plan_updated", plan } as ServerEvent);
        } catch { /* ignore */ }
      }

      return plan;
    } catch (err) {
      log.error("createPlan failed", { error: String(err) });
      return null;
    }
  }

  async executePlan(planId: string): Promise<void> {
    if (!this.activePlan || this.activePlan.id !== planId) return;
    if (this.activeExecutorPlanId) {
      log.warn("executor already running", { activePlanId: this.activeExecutorPlanId, requestedPlanId: planId });
      return;
    }

    this.activePlan.status = "executing";
    await savePlan(this.activePlan);

    // In daemon mode, send command; in offline mode, start the executor locally
    if (this.ws && this._connected) {
      this.send({ type: "execute_plan", planId } as ClientCommand);
    } else if (this.localSessionManager) {
      this.activeExecutorPlanId = planId;
      const { Executor } = await import("@opcom/core");
      const executor = new Executor(this.activePlan, this.localSessionManager, this.eventStore ?? undefined);
      this.activeExecutor = executor;

      executor.on("plan_updated", ({ plan }) => {
        this.activePlan = plan;
        this.handleServerEvent({ type: "plan_updated", plan } as ServerEvent);
      });
      executor.on("plan_paused", ({ plan }) => {
        this.activePlan = plan;
        this.handleServerEvent({ type: "plan_paused", plan } as ServerEvent);
      });
      executor.on("plan_completed", ({ plan }) => {
        this.activePlan = plan;
        this.handleServerEvent({ type: "plan_completed", plan } as ServerEvent);
      });

      // Run in background — don't block the TUI
      executor.run()
        .catch((err) => {
          log.error("executor run failed", { error: String(err) });
        })
        .finally(() => {
          this.activeExecutorPlanId = null;
          this.activeExecutor = null;
        });
    }
  }

  onEvent(handler: EventHandler): () => void {
    this.handlers.push(handler);
    return () => {
      this.handlers = this.handlers.filter((h) => h !== handler);
    };
  }

  isConnected(): boolean {
    return this._connected;
  }

  private syncBackendSessionId(sessionId: string): void {
    if (!this.localSessionManager) return;
    const liveSession = this.localSessionManager.getSession(sessionId);
    if (!liveSession?.backendSessionId) return;
    const cached = this.agents.find((a) => a.id === sessionId);
    if (cached && !cached.backendSessionId) {
      cached.backendSessionId = liveSession.backendSessionId;
    }
  }

  async refreshDirect(): Promise<void> {
    if (this._daemonMode) {
      this.send({ type: "refresh_status" });
    } else {
      // Reload project data WITHOUT recreating the session manager
      // (loadDirect would destroy the event pipeline for running agents)
      await this.reloadProjectData();
    }
  }

  private async reloadProjectData(): Promise<void> {
    try {
      const global = await loadGlobalConfig();
      const workspace = await loadWorkspace(global.defaultWorkspace);
      if (!workspace) return;

      const projects: ProjectStatusSnapshot[] = [];
      for (const pid of workspace.projectIds) {
        const project = await loadProject(pid);
        if (!project) continue;
        this.projectConfigs.set(pid, project);

        const status = await refreshProjectStatus(project);

        // Preserve existing cloud health summary or build from configs
        const existingCloud = this.projectCloudServices.get(pid);
        const cloudHealthSummary = existingCloud
          ? this.buildHealthSummary(existingCloud)
          : project.cloudServices.length > 0
            ? { total: project.cloudServices.length, healthy: 0, degraded: 0, unreachable: 0, unknown: project.cloudServices.length }
            : undefined;

        projects.push({
          id: project.id,
          name: project.name,
          path: project.path,
          git: status.gitFresh,
          workSummary: status.workSummary,
          cloudHealthSummary,
        });

        try {
          const tickets = await scanTickets(project.path);
          this.projectTickets.set(pid, tickets);
        } catch {
          // Skip failed ticket scans
        }
      }

      this.projects = projects;

      // Reload active plan
      await this.loadActivePlan();

      // Notify handlers so TUI re-renders with updated data
      for (const handler of this.handlers) {
        try {
          handler({ type: "projects_snapshot", projects: this.projects });
        } catch { /* ignore */ }
      }
    } catch (err) {
      log.error("reloadProjectData failed", { error: String(err) });
    }
  }

  loadHistoricalEvents(sessionId: string): NormalizedEvent[] {
    if (!this.eventStore) return [];
    return this.eventStore.loadSessionEvents(sessionId);
  }

  async getProjectConfig(projectId: string): Promise<ProjectConfig | null> {
    const cached = this.projectConfigs.get(projectId);
    if (cached) return cached;

    try {
      const project = await loadProject(projectId);
      if (project) {
        this.projectConfigs.set(projectId, project);
      }
      return project;
    } catch {
      return null;
    }
  }

  async getTickets(projectId: string): Promise<WorkItem[]> {
    const cached = this.projectTickets.get(projectId);
    if (cached) return cached;

    try {
      const project = await this.getProjectConfig(projectId);
      if (!project) return [];
      const tickets = await scanTickets(project.path);
      this.projectTickets.set(projectId, tickets);
      return tickets;
    } catch {
      return [];
    }
  }

  /**
   * Load cloud service statuses for a project using its detected cloud configs.
   * Uses the adapter registry to check each service's status.
   */
  async getCloudServices(projectId: string): Promise<CloudService[]> {
    const cached = this.projectCloudServices.get(projectId);
    if (cached) return cached;

    const project = this.projectConfigs.get(projectId);
    if (!project || project.cloudServices.length === 0) return [];

    try {
      const { getDatabaseAdapters, getStorageAdapters, getServerlessAdapters } = await import("@opcom/core");
      const allAdapters = [...getDatabaseAdapters(), ...getStorageAdapters(), ...getServerlessAdapters()];

      const services: CloudService[] = [];
      for (const config of project.cloudServices) {
        const adapter = allAdapters.find((a) => a.provider === config.provider);
        if (adapter) {
          try {
            const svc = await adapter.status(config);
            services.push(svc);
          } catch {
            // Adapter status check failed — create an unreachable placeholder
            services.push(this.buildPlaceholderService(config, projectId, "unreachable"));
          }
        } else {
          // No adapter for this provider — show as unknown
          services.push(this.buildPlaceholderService(config, projectId, "unknown"));
        }
      }

      this.projectCloudServices.set(projectId, services);

      // Update project snapshot with health summary
      const summary = this.buildHealthSummary(services);
      this.projects = this.projects.map((p) =>
        p.id === projectId ? { ...p, cloudHealthSummary: summary } : p,
      );

      return services;
    } catch (err) {
      log.warn("getCloudServices failed", { projectId, error: String(err) });
      return [];
    }
  }

  private buildPlaceholderService(
    config: CloudServiceConfig,
    projectId: string,
    status: CloudServiceHealth,
  ): CloudService {
    return {
      id: `${config.provider}:${config.name}`,
      projectId,
      provider: config.provider,
      kind: config.kind,
      name: config.name,
      status,
      detail: this.buildPlaceholderDetail(config.kind),
      capabilities: [],
      lastCheckedAt: new Date().toISOString(),
    };
  }

  private buildPlaceholderDetail(kind: string): CloudService["detail"] {
    switch (kind) {
      case "database": return { kind: "database", engine: "postgres" };
      case "storage": return { kind: "storage", buckets: [] };
      case "serverless": return { kind: "serverless", functions: [] };
      case "hosting": return { kind: "hosting", domains: [] };
      case "mobile": return { kind: "mobile", platform: "both", distribution: "ota" };
      default: return { kind: "database", engine: "postgres" };
    }
  }

  private buildHealthSummary(services: CloudService[]): CloudHealthSummary {
    const summary: CloudHealthSummary = { total: services.length, healthy: 0, degraded: 0, unreachable: 0, unknown: 0 };
    for (const svc of services) {
      summary[svc.status]++;
    }
    return summary;
  }

  private buildInfraHealthSummary(resources: InfraResource[]): InfraHealthSummary {
    const summary: InfraHealthSummary = { total: resources.length, healthy: 0, degraded: 0, unhealthy: 0, progressing: 0, suspended: 0, unknown: 0 };
    for (const r of resources) {
      summary[r.status]++;
    }
    return summary;
  }

  private watchTicketDirs(): void {
    // Clean up any existing watchers
    for (const w of this.ticketWatchers) {
      try { w.close(); } catch { /* ignore */ }
    }
    this.ticketWatchers = [];

    for (const [, project] of this.projectConfigs) {
      // Watch the ticket impl dir if it exists, otherwise .tickets/
      const implDir = join(project.path, ".tickets", "impl");
      const ticketsDir = join(project.path, ".tickets");
      const watchDir = existsSync(implDir) ? implDir : existsSync(ticketsDir) ? ticketsDir : null;
      if (!watchDir) continue;

      try {
        const watcher = watch(watchDir, { recursive: true }, () => {
          // Debounce: coalesce rapid changes into one rescan
          if (this.ticketRefreshTimer) clearTimeout(this.ticketRefreshTimer);
          this.ticketRefreshTimer = setTimeout(() => {
            this.reloadProjectData().catch(() => {});
          }, 500);
        });
        this.ticketWatchers.push(watcher);
      } catch {
        // fs.watch may fail on some platforms/paths — not critical
      }
    }
  }

  destroy(): void {
    this.destroyed = true;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.ticketRefreshTimer) {
      clearTimeout(this.ticketRefreshTimer);
      this.ticketRefreshTimer = null;
    }
    for (const w of this.ticketWatchers) {
      try { w.close(); } catch { /* ignore */ }
    }
    this.ticketWatchers = [];
    if (this.ws) {
      try {
        this.ws.close();
      } catch {
        // Ignore
      }
      this.ws = null;
    }
    if (this.cicdPoller) {
      this.cicdPoller.dispose();
      this.cicdPoller = null;
    }
    if (this.localSessionManager) {
      this.localSessionManager.shutdown().catch(() => {});
      this.localSessionManager = null;
    }
    if (this.eventStore) {
      this.eventStore.close();
      this.eventStore = null;
    }
    this._connected = false;
    this.handlers = [];
  }
}
