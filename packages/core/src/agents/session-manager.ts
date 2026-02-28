import { readFile, writeFile, mkdir, readdir, unlink } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";
import type {
  AgentSession,
  AgentBackend,
  AgentState,
  NormalizedEvent,
  AgentStartConfig,
  ContextPacket,
} from "@opcom/types";
import { opcomRoot } from "../config/paths.js";
import { createAdapter } from "./adapter.js";
import type { ClaudeCodeAdapter } from "./claude-code.js";
import { createLogger } from "../logger.js";
import type { EventStore } from "./event-store.js";

const log = createLogger("session-manager");

export interface SessionManagerEvents {
  session_created: AgentSession;
  session_stopped: AgentSession;
  state_change: { sessionId: string; oldState: AgentState; newState: AgentState };
  agent_event: { sessionId: string; event: NormalizedEvent };
}

type EventHandler<T> = (data: T) => void;

export class SessionManager {
  private sessions = new Map<string, AgentSession>();
  private adapters = new Map<string, ReturnType<typeof createAdapter>>();
  private eventSubscriptions = new Map<string, AsyncIterable<NormalizedEvent>>();
  private listeners = new Map<string, Set<EventHandler<unknown>>>();
  private eventStore: EventStore | null = null;

  sessionsDir(): string {
    return join(opcomRoot(), "sessions");
  }

  memoryDir(): string {
    return join(opcomRoot(), "memory");
  }

  async init(opts?: { eventStore?: EventStore }): Promise<void> {
    if (opts?.eventStore) {
      this.eventStore = opts.eventStore;
    }

    await mkdir(this.sessionsDir(), { recursive: true });
    await mkdir(this.memoryDir(), { recursive: true });

    // Load persisted sessions and clean up stale ones
    await this.loadPersistedSessions();
  }

  async startSession(
    projectId: string,
    backend: AgentBackend,
    config: AgentStartConfig,
    workItemId?: string,
  ): Promise<AgentSession> {
    const adapter = createAdapter(backend);
    const session = await adapter.start(config);
    session.projectId = projectId;
    session.workItemId = workItemId;

    this.sessions.set(session.id, session);
    this.adapters.set(session.id, adapter);

    // Persist session descriptor
    await this.persistSession(session);
    this.eventStore?.upsertSession(session);

    // Emit session_created BEFORE consuming events — otherwise buffered events
    // arrive at the TUI before agent_started, then agent_started wipes them
    this.emit("session_created", session);

    // Start consuming events
    this.consumeEvents(session.id, adapter);

    return session;
  }

  async stopSession(sessionId: string): Promise<void> {
    const adapter = this.adapters.get(sessionId);
    if (adapter) {
      await adapter.stop(sessionId);
    }

    const session = this.sessions.get(sessionId);
    if (session) {
      session.state = "stopped";
      session.stoppedAt = new Date().toISOString();
      await this.persistSession(session);
      this.eventStore?.updateSessionState(sessionId, "stopped", session.stoppedAt);
      this.emit("session_stopped", session);
    }

    this.adapters.delete(sessionId);
    this.sessions.delete(sessionId);
  }

  async promptSession(sessionId: string, message: string): Promise<void> {
    const adapter = this.adapters.get(sessionId);
    if (!adapter) throw new Error(`No active session: ${sessionId}`);
    await adapter.prompt(sessionId, message);
  }

  getSession(sessionId: string): AgentSession | undefined {
    return this.sessions.get(sessionId);
  }

  listSessions(): AgentSession[] {
    return Array.from(this.sessions.values());
  }

  getActiveSessions(): AgentSession[] {
    return this.listSessions().filter((s) => s.state !== "stopped");
  }

  getSessionsByProject(projectId: string): AgentSession[] {
    return this.listSessions().filter((s) => s.projectId === projectId);
  }

  subscribeToSession(sessionId: string): AsyncIterable<NormalizedEvent> | undefined {
    const adapter = this.adapters.get(sessionId);
    if (!adapter) return undefined;
    return adapter.subscribe(sessionId);
  }

  async getMemory(sessionId: string): Promise<string | null> {
    const memPath = join(this.memoryDir(), `${sessionId}.md`);
    if (!existsSync(memPath)) return null;
    return readFile(memPath, "utf-8");
  }

  async saveMemory(sessionId: string, content: string): Promise<void> {
    const memPath = join(this.memoryDir(), `${sessionId}.md`);
    await writeFile(memPath, content, "utf-8");
  }

  // --- Event system ---

  on<K extends keyof SessionManagerEvents>(
    event: K,
    handler: EventHandler<SessionManagerEvents[K]>,
  ): void {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
    }
    this.listeners.get(event)!.add(handler as EventHandler<unknown>);
  }

  off<K extends keyof SessionManagerEvents>(
    event: K,
    handler: EventHandler<SessionManagerEvents[K]>,
  ): void {
    this.listeners.get(event)?.delete(handler as EventHandler<unknown>);
  }

  private emit<K extends keyof SessionManagerEvents>(
    event: K,
    data: SessionManagerEvents[K],
  ): void {
    const handlers = this.listeners.get(event);
    if (handlers) {
      for (const h of handlers) h(data);
    }
  }

  // --- Persistence ---

  private async persistSession(session: AgentSession): Promise<void> {
    const filePath = join(this.sessionsDir(), `${session.id}.yaml`);
    const data = stringifyYaml(session, { lineWidth: 120 });
    await writeFile(filePath, data, "utf-8");
  }

  async loadAllPersistedSessions(): Promise<AgentSession[]> {
    const dir = this.sessionsDir();
    if (!existsSync(dir)) return [];

    const sessions: AgentSession[] = [];
    const files = await readdir(dir);
    for (const f of files) {
      if (!f.endsWith(".yaml")) continue;
      try {
        const content = await readFile(join(dir, f), "utf-8");
        const session = parseYaml(content) as AgentSession;

        // Mark stale sessions as stopped
        if (session.state !== "stopped" && session.pid) {
          if (!processIsAlive(session.pid)) {
            session.state = "stopped";
            session.stoppedAt = new Date().toISOString();
          }
        }
        sessions.push(session);
      } catch {
        // Skip unreadable files
      }
    }
    return sessions;
  }

  private async loadPersistedSessions(): Promise<void> {
    const dir = this.sessionsDir();
    if (!existsSync(dir)) return;

    const files = await readdir(dir);
    for (const f of files) {
      if (!f.endsWith(".yaml")) continue;
      try {
        const content = await readFile(join(dir, f), "utf-8");
        const session = parseYaml(content) as AgentSession;

        // Clean up stale sessions (process not running)
        if (session.state !== "stopped" && session.pid) {
          const isAlive = processIsAlive(session.pid);
          if (!isAlive) {
            session.state = "stopped";
            session.stoppedAt = new Date().toISOString();
            await this.persistSession(session);
          }
        }

        // Only track non-stopped sessions (they can be reconnected)
        if (session.state !== "stopped") {
          this.sessions.set(session.id, session);
        }
      } catch (err) {
        log.warn("failed to load session file", { file: f, error: String(err) });
      }
    }
  }

  private async consumeEvents(
    sessionId: string,
    adapter: ReturnType<typeof createAdapter>,
  ): Promise<void> {
    log.debug("consumeEvents started", { sessionId });
    try {
      for await (const event of adapter.subscribe(sessionId)) {
        const session = this.sessions.get(sessionId);
        if (!session) break;

        log.debug("event received", { sessionId, type: event.type });

        // Track state changes
        const oldState = session.state;
        if (event.type === "message_start" || event.type === "message_delta"
            || event.type === "tool_start" || event.type === "tool_end") {
          session.state = "streaming";
        } else if (event.type === "turn_end") {
          session.state = "idle";
        } else if (event.type === "error") {
          session.state = "error";
        } else if (event.type === "agent_end") {
          session.state = "stopped";
          session.stoppedAt = new Date().toISOString();
        }

        if (oldState !== session.state) {
          log.info("state change", { sessionId, oldState, newState: session.state });
          this.emit("state_change", {
            sessionId,
            oldState,
            newState: session.state,
          });
        }

        session.lastActivity = event.timestamp;
        this.eventStore?.insertEvent(sessionId, event);
        this.emit("agent_event", { sessionId, event });
      }
    } catch (err) {
      log.warn("consumeEvents stream ended", { sessionId, error: String(err) });
    }
  }

  async shutdown(): Promise<void> {
    const sessions = this.getActiveSessions();
    await Promise.all(sessions.map((s) => this.stopSession(s.id)));
  }
}

function processIsAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}
