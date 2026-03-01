import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { readFile, writeFile, unlink } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import type {
  AgentSession,
  ClientCommand,
  ServerEvent,
  NormalizedEvent,
  ProjectStatusSnapshot,
  Plan,
} from "@opcom/types";
import { SessionManager } from "../agents/session-manager.js";
import { MessageRouter } from "../agents/message-router.js";
import { buildContextPacket } from "../agents/context-builder.js";
import { getWebUIHtml } from "./web-ui.js";
import { loadGlobalConfig, loadWorkspace, loadProject, listProjects } from "../config/loader.js";
import { opcomRoot } from "../config/paths.js";
import { refreshProjectStatus, type ProjectStatus } from "../project/status.js";
import { scanTickets } from "../detection/tickets.js";
import { Executor } from "../orchestrator/executor.js";
import { computePlan } from "../orchestrator/planner.js";
import type { TicketSet } from "../orchestrator/planner.js";
import { savePlan, loadPlan, listPlans, deletePlan } from "../orchestrator/persistence.js";
import { checkHygiene } from "../orchestrator/hygiene.js";
import { reconcilePlans } from "../orchestrator/reconcile.js";
import { GitHubActionsAdapter } from "../integrations/github-actions.js";
import { CICDPoller } from "../integrations/cicd-poller.js";
import type { ProjectCICDState } from "../integrations/cicd-poller.js";

interface WebSocketLike {
  send(data: string): void;
  on(event: string, handler: (...args: unknown[]) => void): void;
  close(): void;
  readyState: number;
}

interface WsServerLike {
  on(event: string, handler: (...args: unknown[]) => void): void;
  close(cb?: () => void): void;
  handleUpgrade(
    request: IncomingMessage,
    socket: unknown,
    head: unknown,
    cb: (ws: WebSocketLike) => void,
  ): void;
}

export class Station {
  private httpServer: ReturnType<typeof createServer> | null = null;
  private wsServer: WsServerLike | null = null;
  private clients = new Set<WebSocketLike>();
  private subscriptions = new Map<WebSocketLike, Set<string>>(); // client -> subscribed agent IDs

  readonly sessionManager = new SessionManager();
  readonly messageRouter = new MessageRouter();
  private projectStatuses = new Map<string, ProjectStatus>();
  private executors = new Map<string, Executor>(); // planId → running Executor
  private cicdPoller: CICDPoller | null = null;
  private port: number;
  private options?: { skipCICD?: boolean };

  constructor(port = 4700, options?: { skipCICD?: boolean }) {
    this.port = port;
    this.options = options;
  }

  async start(): Promise<void> {
    await this.sessionManager.init();

    // Reconcile stale plans from previous runs
    const allSessions = await this.sessionManager.loadAllPersistedSessions();
    const reconciled = await reconcilePlans(allSessions);
    if (reconciled > 0) {
      console.log(`  Reconciled ${reconciled} stale plan(s) from previous run`);
    }

    // Load project statuses
    await this.refreshAllProjects();

    // Initialize CI/CD polling for GitHub Actions projects (skip in test)
    if (!this.options?.skipCICD) {
      await this.initCICDPoller();
    }

    // Wire up session events to broadcast
    this.sessionManager.on("session_created", (session) => {
      this.broadcast({ type: "agent_started", session });
    });

    this.sessionManager.on("session_stopped", (session) => {
      this.broadcast({ type: "agent_stopped", sessionId: session.id, reason: "stopped" });
    });

    this.sessionManager.on("state_change", ({ sessionId, newState }) => {
      this.broadcast({ type: "agent_status", sessionId, state: newState });

      // Update message router state
      if (newState === "idle" || newState === "streaming") {
        this.messageRouter.setAgentState(sessionId, newState);
      }
    });

    this.sessionManager.on("agent_event", ({ sessionId, event }) => {
      // Send to subscribed clients
      for (const [client, subs] of this.subscriptions) {
        if (subs.has(sessionId) || subs.has("*")) {
          this.sendToClient(client, { type: "agent_event", sessionId, event });
        }
      }
    });

    // Create HTTP server
    this.httpServer = createServer((req, res) => this.handleHttp(req, res));

    // Try to set up WebSocket server
    try {
      const { WebSocketServer } = await import("ws");
      this.wsServer = new WebSocketServer({ noServer: true }) as unknown as WsServerLike;

      this.httpServer.on("upgrade", (request: IncomingMessage, socket: unknown, head: unknown) => {
        this.wsServer!.handleUpgrade(request, socket, head, (ws: WebSocketLike) => {
          this.handleWsConnection(ws);
        });
      });
    } catch {
      console.warn("  ws package not installed. WebSocket support disabled.");
      console.warn("  Install with: npm install ws @types/ws");
    }

    return new Promise<void>((resolve) => {
      this.httpServer!.listen(this.port, () => {
        // Write PID file
        this.writePidFile().catch(() => {});
        resolve();
      });
    });
  }

  async stop(): Promise<void> {
    // Stop CI/CD polling
    if (this.cicdPoller) {
      this.cicdPoller.dispose();
      this.cicdPoller = null;
    }

    // Stop all running executors
    for (const executor of this.executors.values()) {
      executor.stop();
    }
    this.executors.clear();

    await this.sessionManager.shutdown();

    // Close all WebSocket connections
    for (const client of this.clients) {
      try { client.close(); } catch {}
    }
    this.clients.clear();

    // Close servers
    if (this.wsServer) {
      await new Promise<void>((resolve) => this.wsServer!.close(() => resolve()));
    }

    if (this.httpServer) {
      await new Promise<void>((resolve) => this.httpServer!.close(() => resolve()));
    }

    // Remove PID file
    await this.removePidFile();
  }

  getPort(): number {
    return this.port;
  }

  // --- HTTP handler ---

  private async handleHttp(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url ?? "/", `http://localhost:${this.port}`);
    const method = req.method ?? "GET";

    // CORS headers
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, PATCH, DELETE, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");

    if (method === "OPTIONS") {
      res.writeHead(204);
      res.end();
      return;
    }

    // Serve web UI at / and /web
    if (method === "GET" && (url.pathname === "/" || url.pathname === "/web")) {
      const html = getWebUIHtml(this.port);
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(html);
      return;
    }

    // Proxy /web/api/* to the corresponding API route
    let apiPath = url.pathname;
    if (apiPath.startsWith("/web/api/")) {
      apiPath = apiPath.slice("/web/api".length); // e.g. /web/api/projects -> /projects
    }

    try {
      const body = await readBody(req);
      const result = await this.routeRequest(method, apiPath, body);
      res.writeHead(result.status, { "Content-Type": "application/json" });
      res.end(JSON.stringify(result.data));
    } catch (err) {
      const message = err instanceof Error ? err.message : "Internal error";
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: message }));
    }
  }

  private async routeRequest(
    method: string,
    path: string,
    body: unknown,
  ): Promise<{ status: number; data: unknown }> {
    // GET /health
    if (method === "GET" && path === "/health") {
      return {
        status: 200,
        data: {
          status: "ok",
          uptime: process.uptime(),
          agents: this.sessionManager.getActiveSessions().length,
          clients: this.clients.size,
        },
      };
    }

    // GET /projects
    if (method === "GET" && path === "/projects") {
      const projects = await listProjects();
      const statuses: ProjectStatusSnapshot[] = [];
      for (const p of projects) {
        const cached = this.projectStatuses.get(p.id);
        statuses.push({
          id: p.id,
          name: p.name,
          path: p.path,
          git: cached?.gitFresh ?? p.git,
          workSummary: cached?.workSummary ?? null,
        });
      }
      return { status: 200, data: statuses };
    }

    // GET /projects/:id
    const projectMatch = path.match(/^\/projects\/([^/]+)$/);
    if (method === "GET" && projectMatch) {
      const project = await loadProject(projectMatch[1]);
      if (!project) return { status: 404, data: { error: "Project not found" } };
      return { status: 200, data: project };
    }

    // POST /projects/:id/scan
    const scanMatch = path.match(/^\/projects\/([^/]+)\/scan$/);
    if (method === "POST" && scanMatch) {
      const { detectProject } = await import("../detection/detect.js");
      const project = await loadProject(scanMatch[1]);
      if (!project) return { status: 404, data: { error: "Project not found" } };
      const result = await detectProject(project.path);
      return { status: 200, data: result };
    }

    // GET /projects/:id/work-items
    const workItemsMatch = path.match(/^\/projects\/([^/]+)\/work-items$/);
    if (method === "GET" && workItemsMatch) {
      const project = await loadProject(workItemsMatch[1]);
      if (!project) return { status: 404, data: { error: "Project not found" } };
      const tickets = await scanTickets(project.path);
      return { status: 200, data: tickets.sort((a, b) => a.priority - b.priority) };
    }

    // GET /agents
    if (method === "GET" && path === "/agents") {
      return { status: 200, data: this.sessionManager.listSessions() };
    }

    // POST /agents
    if (method === "POST" && path === "/agents") {
      const data = body as Record<string, unknown>;
      const projectId = data.projectId as string;
      const workItemId = data.workItemId as string | undefined;
      const backend = (data.backend as string) ?? "claude-code";

      const project = await loadProject(projectId);
      if (!project) return { status: 404, data: { error: "Project not found" } };

      let workItem;
      if (workItemId) {
        const tickets = await scanTickets(project.path);
        workItem = tickets.find((t) => t.id === workItemId);
      }

      const contextPacket = await buildContextPacket(project, workItem);
      const session = await this.sessionManager.startSession(
        projectId,
        backend as "claude-code" | "opencode",
        {
          projectPath: project.path,
          workItemId,
          contextPacket,
          model: data.model as string | undefined,
        },
        workItemId,
      );

      return { status: 201, data: session };
    }

    // DELETE /agents/:id
    const agentMatch = path.match(/^\/agents\/([^/]+)$/);
    if (method === "DELETE" && agentMatch) {
      await this.sessionManager.stopSession(agentMatch[1]);
      return { status: 200, data: { stopped: true } };
    }

    // POST /agents/:id/prompt
    const promptMatch = path.match(/^\/agents\/([^/]+)\/prompt$/);
    if (method === "POST" && promptMatch) {
      const data = body as Record<string, unknown>;
      await this.sessionManager.promptSession(promptMatch[1], data.text as string);
      return { status: 200, data: { sent: true } };
    }

    // --- Plan endpoints ---

    // GET /plans
    if (method === "GET" && path === "/plans") {
      const plans = await listPlans();
      return { status: 200, data: plans };
    }

    // GET /plans/:id
    const planGetMatch = path.match(/^\/plans\/([^/]+)$/);
    if (method === "GET" && planGetMatch) {
      const plan = await loadPlan(planGetMatch[1]);
      if (!plan) return { status: 404, data: { error: "Plan not found" } };
      return { status: 200, data: plan };
    }

    // POST /plans
    if (method === "POST" && path === "/plans") {
      const data = body as Record<string, unknown>;
      const ticketSets = await this.loadAllTickets();
      const plan = computePlan(
        ticketSets,
        (data.scope ?? {}) as import("@opcom/types").PlanScope,
        (data.name as string) ?? "Untitled Plan",
        undefined,
        data.config as Partial<import("@opcom/types").OrchestratorConfig> | undefined,
      );
      await savePlan(plan);
      return { status: 201, data: plan };
    }

    // PATCH /plans/:id
    const planPatchMatch = path.match(/^\/plans\/([^/]+)$/);
    if (method === "PATCH" && planPatchMatch) {
      const plan = await loadPlan(planPatchMatch[1]);
      if (!plan) return { status: 404, data: { error: "Plan not found" } };
      const data = body as Record<string, unknown>;
      if (data.context) {
        const executor = this.executors.get(plan.id);
        if (executor) {
          await executor.injectContext(data.context as string);
        } else {
          plan.context += (plan.context ? "\n" : "") + (data.context as string);
          await savePlan(plan);
        }
      }
      return { status: 200, data: plan };
    }

    // POST /plans/:id/execute
    const planExecMatch = path.match(/^\/plans\/([^/]+)\/execute$/);
    if (method === "POST" && planExecMatch) {
      const plan = await loadPlan(planExecMatch[1]);
      if (!plan) return { status: 404, data: { error: "Plan not found" } };
      if (this.executors.has(plan.id)) {
        return { status: 409, data: { error: "Plan already executing" } };
      }
      await this.startExecutor(plan);
      return { status: 200, data: { executing: true } };
    }

    // POST /plans/:id/pause
    const planPauseMatch = path.match(/^\/plans\/([^/]+)\/pause$/);
    if (method === "POST" && planPauseMatch) {
      const executor = this.executors.get(planPauseMatch[1]);
      if (!executor) return { status: 404, data: { error: "No running executor" } };
      executor.pause();
      return { status: 200, data: { paused: true } };
    }

    // POST /plans/:id/resume
    const planResumeMatch = path.match(/^\/plans\/([^/]+)\/resume$/);
    if (method === "POST" && planResumeMatch) {
      const executor = this.executors.get(planResumeMatch[1]);
      if (!executor) return { status: 404, data: { error: "No running executor" } };
      executor.resume();
      return { status: 200, data: { resumed: true } };
    }

    // POST /plans/:id/steps/:ticketId/skip
    const planSkipMatch = path.match(/^\/plans\/([^/]+)\/steps\/([^/]+)\/skip$/);
    if (method === "POST" && planSkipMatch) {
      const executor = this.executors.get(planSkipMatch[1]);
      if (!executor) return { status: 404, data: { error: "No running executor" } };
      executor.skipStep(planSkipMatch[2]);
      return { status: 200, data: { skipped: true } };
    }

    // DELETE /plans/:id
    const planDeleteMatch = path.match(/^\/plans\/([^/]+)$/);
    if (method === "DELETE" && planDeleteMatch) {
      await deletePlan(planDeleteMatch[1]);
      return { status: 200, data: { deleted: true } };
    }

    // GET /plans/:id/hygiene
    const planHygieneMatch = path.match(/^\/plans\/([^/]+)\/hygiene$/);
    if (method === "GET" && planHygieneMatch) {
      const ticketSets = await this.loadAllTickets();
      const report = checkHygiene(ticketSets, this.sessionManager.listSessions());
      return { status: 200, data: report };
    }

    // --- CI/CD endpoints ---

    // GET /projects/:id/pipelines
    const pipelinesMatch = path.match(/^\/projects\/([^/]+)\/pipelines$/);
    if (method === "GET" && pipelinesMatch) {
      const project = await loadProject(pipelinesMatch[1]);
      if (!project) return { status: 404, data: { error: "Project not found" } };
      const state = this.cicdPoller?.getState(project.id);
      return { status: 200, data: state?.pipelines ?? [] };
    }

    // GET /projects/:id/pipelines/:runId
    const pipelineDetailMatch = path.match(/^\/projects\/([^/]+)\/pipelines\/([^/]+)$/);
    if (method === "GET" && pipelineDetailMatch) {
      const project = await loadProject(pipelineDetailMatch[1]);
      if (!project) return { status: 404, data: { error: "Project not found" } };
      try {
        const adapter = new GitHubActionsAdapter();
        const pipeline = await adapter.getPipeline(project, pipelineDetailMatch[2]);
        return { status: 200, data: pipeline };
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Failed to fetch pipeline";
        return { status: 502, data: { error: msg } };
      }
    }

    // GET /projects/:id/deployments
    const deploymentsMatch = path.match(/^\/projects\/([^/]+)\/deployments$/);
    if (method === "GET" && deploymentsMatch) {
      const project = await loadProject(deploymentsMatch[1]);
      if (!project) return { status: 404, data: { error: "Project not found" } };
      const state = this.cicdPoller?.getState(project.id);
      return { status: 200, data: state?.deployments ?? [] };
    }

    // POST /projects/:id/pipelines/:runId/rerun
    const rerunMatch = path.match(/^\/projects\/([^/]+)\/pipelines\/([^/]+)\/rerun$/);
    if (method === "POST" && rerunMatch) {
      const project = await loadProject(rerunMatch[1]);
      if (!project) return { status: 404, data: { error: "Project not found" } };
      try {
        const adapter = new GitHubActionsAdapter();
        const pipeline = await adapter.rerunPipeline(project, rerunMatch[2]);
        return { status: 200, data: pipeline };
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Failed to rerun pipeline";
        return { status: 502, data: { error: msg } };
      }
    }

    // POST /projects/:id/pipelines/:runId/cancel
    const cancelMatch = path.match(/^\/projects\/([^/]+)\/pipelines\/([^/]+)\/cancel$/);
    if (method === "POST" && cancelMatch) {
      const project = await loadProject(cancelMatch[1]);
      if (!project) return { status: 404, data: { error: "Project not found" } };
      try {
        const adapter = new GitHubActionsAdapter();
        await adapter.cancelPipeline(project, cancelMatch[2]);
        return { status: 200, data: { cancelled: true } };
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Failed to cancel pipeline";
        return { status: 502, data: { error: msg } };
      }
    }

    return { status: 404, data: { error: "Not found" } };
  }

  // --- WebSocket handler ---

  private handleWsConnection(ws: WebSocketLike): void {
    this.clients.add(ws);
    this.subscriptions.set(ws, new Set(["*"])); // Subscribe to everything by default

    // Send ready event
    this.sendToClient(ws, { type: "ready", serverTime: new Date().toISOString() });

    // Send snapshots
    this.sendToClient(ws, {
      type: "agents_snapshot",
      sessions: this.sessionManager.listSessions(),
    });

    const projectSnapshots: ProjectStatusSnapshot[] = [];
    for (const [id, status] of this.projectStatuses) {
      projectSnapshots.push({
        id,
        name: status.project.name,
        path: status.project.path,
        git: status.gitFresh,
        workSummary: status.workSummary,
      });
    }
    this.sendToClient(ws, {
      type: "projects_snapshot",
      projects: projectSnapshots,
    });

    ws.on("message", async (data: unknown) => {
      try {
        const raw = typeof data === "string" ? data : String(data);
        const command = JSON.parse(raw) as ClientCommand;
        await this.handleCommand(ws, command);
      } catch {
        this.sendToClient(ws, { type: "error", code: "PARSE_ERROR", message: "Invalid command" });
      }
    });

    ws.on("close", () => {
      this.clients.delete(ws);
      this.subscriptions.delete(ws);
    });
  }

  private async handleCommand(ws: WebSocketLike, command: ClientCommand): Promise<void> {
    switch (command.type) {
      case "ping":
        this.sendToClient(ws, { type: "pong" });
        break;

      case "subscribe": {
        const subs = this.subscriptions.get(ws) ?? new Set();
        if (command.agentId) {
          subs.add(command.agentId);
        } else {
          subs.add("*");
        }
        this.subscriptions.set(ws, subs);
        break;
      }

      case "start_agent": {
        const project = await loadProject(command.projectId);
        if (!project) {
          this.sendToClient(ws, { type: "error", code: "NOT_FOUND", message: "Project not found" });
          return;
        }

        let workItem;
        if (command.workItemId) {
          const tickets = await scanTickets(project.path);
          workItem = tickets.find((t) => t.id === command.workItemId);
        }

        const ctx = await buildContextPacket(project, workItem);
        const backend = (command.backend ?? "claude-code") as "claude-code" | "opencode";
        await this.sessionManager.startSession(
          command.projectId,
          backend,
          { projectPath: project.path, workItemId: command.workItemId, contextPacket: ctx },
          command.workItemId,
        );
        break;
      }

      case "stop_agent":
        await this.sessionManager.stopSession(command.agentId);
        break;

      case "prompt": {
        await this.sessionManager.promptSession(command.agentId, command.text);
        if (command.delivery) {
          this.messageRouter.send("user", command.agentId, command.text, command.delivery);
        }
        break;
      }

      case "refresh_status":
        await this.refreshAllProjects();
        for (const [id, status] of this.projectStatuses) {
          this.broadcast({
            type: "project_status",
            projectId: id,
            git: status.gitFresh ?? { branch: "unknown", clean: true, remote: null },
            workSummary: status.workSummary ?? { total: 0, open: 0, inProgress: 0, closed: 0, deferred: 0 },
          });
        }
        break;

      case "create_plan": {
        const ticketSets = await this.loadAllTickets();
        const plan = computePlan(ticketSets, command.scope ?? {}, command.name, undefined, command.config);
        await savePlan(plan);
        this.broadcast({ type: "plan_updated", plan });
        break;
      }

      case "execute_plan": {
        const plan = await loadPlan(command.planId);
        if (!plan) {
          this.sendToClient(ws, { type: "error", code: "NOT_FOUND", message: "Plan not found" });
          return;
        }
        if (this.executors.has(plan.id)) {
          this.sendToClient(ws, { type: "error", code: "CONFLICT", message: "Plan already executing" });
          return;
        }
        await this.startExecutor(plan);
        break;
      }

      case "pause_plan": {
        const executor = this.executors.get(command.planId);
        if (executor) {
          executor.pause();
        } else {
          this.sendToClient(ws, { type: "error", code: "NOT_FOUND", message: "No running executor for plan" });
        }
        break;
      }

      case "resume_plan": {
        const executor = this.executors.get(command.planId);
        if (executor) {
          executor.resume();
        } else {
          this.sendToClient(ws, { type: "error", code: "NOT_FOUND", message: "No running executor for plan" });
        }
        break;
      }

      case "skip_step": {
        const executor = this.executors.get(command.planId);
        if (executor) {
          executor.skipStep(command.ticketId);
        } else {
          this.sendToClient(ws, { type: "error", code: "NOT_FOUND", message: "No running executor for plan" });
        }
        break;
      }

      case "inject_context": {
        const executor = this.executors.get(command.planId);
        if (executor) {
          await executor.injectContext(command.text);
          this.broadcast({ type: "plan_updated", plan: executor.getPlan() });
        } else {
          this.sendToClient(ws, { type: "error", code: "NOT_FOUND", message: "No running executor for plan" });
        }
        break;
      }

      case "run_hygiene": {
        const ticketSets = await this.loadAllTickets();
        const report = checkHygiene(ticketSets, this.sessionManager.listSessions());
        this.sendToClient(ws, { type: "hygiene_report", report });
        break;
      }
    }
  }

  // --- Executor management ---

  private async startExecutor(plan: Plan): Promise<void> {
    const executor = new Executor(plan, this.sessionManager);
    this.executors.set(plan.id, executor);

    // Wire executor events to WebSocket broadcasts
    executor.on("plan_updated", ({ plan: p }) => this.broadcast({ type: "plan_updated", plan: p }));
    executor.on("step_started", ({ step, session }) =>
      this.broadcast({ type: "step_started", step, sessionId: session.id }),
    );
    executor.on("step_completed", ({ step }) => this.broadcast({ type: "step_completed", step }));
    executor.on("step_failed", ({ step, error }) => this.broadcast({ type: "step_failed", step, error }));
    executor.on("plan_completed", ({ plan: p }) => {
      this.broadcast({ type: "plan_completed", plan: p });
      this.executors.delete(p.id);
    });
    executor.on("plan_paused", ({ plan: p }) => this.broadcast({ type: "plan_paused", plan: p }));

    // Run in background (don't await — the loop runs until done/stopped)
    executor.run().catch(() => {
      this.executors.delete(plan.id);
    });
  }

  private async initCICDPoller(): Promise<void> {
    const adapter = new GitHubActionsAdapter();
    this.cicdPoller = new CICDPoller(adapter);

    // Subscribe to CI/CD events and broadcast to WebSocket clients
    this.cicdPoller.onEvent((projectId, event) => {
      if (event.type === "pipeline_updated") {
        this.broadcast({ type: "pipeline_updated", projectId, pipeline: event.pipeline });
      } else if (event.type === "deployment_updated") {
        this.broadcast({ type: "deployment_updated", projectId, deployment: event.deployment });
      }
    });

    // Track all projects that have GitHub Actions
    const projects = await listProjects();
    for (const project of projects) {
      try {
        const hasCI = await adapter.detect(project);
        if (hasCI) {
          await this.cicdPoller.track(project);
        }
      } catch {
        // Skip projects where detection fails (no git remote, etc.)
      }
    }
  }

  /** Get CI/CD state for a project (used by CLI). */
  getCICDState(projectId: string): ProjectCICDState | undefined {
    return this.cicdPoller?.getState(projectId);
  }

  private async loadAllTickets(): Promise<TicketSet[]> {
    const projects = await listProjects();
    const ticketSets: TicketSet[] = [];
    for (const project of projects) {
      try {
        const tickets = await scanTickets(project.path);
        ticketSets.push({ projectId: project.id, tickets });
      } catch {
        // Skip failed scans
      }
    }
    return ticketSets;
  }

  // --- Broadcasting ---

  private broadcast(event: ServerEvent): void {
    const data = JSON.stringify(event);
    for (const client of this.clients) {
      try {
        if (client.readyState === 1) { // OPEN
          client.send(data);
        }
      } catch {
        // Skip broken connections
      }
    }
  }

  private sendToClient(ws: WebSocketLike, event: ServerEvent): void {
    try {
      ws.send(JSON.stringify(event));
    } catch {
      // Skip
    }
  }

  // --- Project refresh ---

  private async refreshAllProjects(): Promise<void> {
    const projects = await listProjects();
    for (const project of projects) {
      try {
        const status = await refreshProjectStatus(project);
        this.projectStatuses.set(project.id, status);
      } catch {
        // Skip failed projects
      }
    }
  }

  // --- PID file ---

  private pidFilePath(): string {
    return join(opcomRoot(), "station.pid");
  }

  private async writePidFile(): Promise<void> {
    await writeFile(this.pidFilePath(), String(process.pid), "utf-8");
  }

  private async removePidFile(): Promise<void> {
    try {
      await unlink(this.pidFilePath());
    } catch {}
  }

  static async isRunning(): Promise<{ running: boolean; port?: number; pid?: number }> {
    const pidPath = join(opcomRoot(), "station.pid");
    if (!existsSync(pidPath)) return { running: false };

    try {
      const content = await readFile(pidPath, "utf-8");
      const pid = parseInt(content.trim(), 10);
      process.kill(pid, 0); // Check if process is alive
      return { running: true, pid, port: 4700 };
    } catch {
      return { running: false };
    }
  }
}

function readBody(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk) => chunks.push(chunk as Buffer));
    req.on("end", () => {
      const raw = Buffer.concat(chunks).toString("utf-8");
      if (!raw) { resolve({}); return; }
      try { resolve(JSON.parse(raw)); }
      catch { resolve({}); }
    });
  });
}
