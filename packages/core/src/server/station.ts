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
} from "@opcom/types";
import { SessionManager } from "../agents/session-manager.js";
import { MessageRouter } from "../agents/message-router.js";
import { buildContextPacket } from "../agents/context-builder.js";
import { getWebUIHtml } from "./web-ui.js";
import { loadGlobalConfig, loadWorkspace, loadProject, listProjects } from "../config/loader.js";
import { opcomRoot } from "../config/paths.js";
import { refreshProjectStatus, type ProjectStatus } from "../project/status.js";
import { scanTickets } from "../detection/tickets.js";

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
  private port: number;

  constructor(port = 4700) {
    this.port = port;
  }

  async start(): Promise<void> {
    await this.sessionManager.init();

    // Load project statuses
    await this.refreshAllProjects();

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
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
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
    }
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
