// SQLite-backed event store for agent session persistence and analytics

import { join } from "node:path";
import { createRequire } from "node:module";
import type { AgentSession, NormalizedEvent, Changeset, ChangesetQuery } from "@opcom/types";
import { opcomRoot } from "../config/paths.js";
import { createLogger } from "../logger.js";

const log = createLogger("event-store");

// Use createRequire for ESM compat with better-sqlite3 (native addon)
const require = createRequire(import.meta.url);

export interface ToolUsageStat {
  toolName: string;
  count: number;
  successCount: number;
  failureCount: number;
  successRate: number;
}

export interface SessionStat {
  sessionId: string;
  backend: string;
  projectId: string;
  state: string;
  startedAt: string;
  stoppedAt: string | null;
  durationMinutes: number | null;
  eventCount: number;
  toolCount: number;
}

export interface DailyActivity {
  date: string;
  sessions: number;
  events: number;
  tools: number;
}

type BetterSqlite3Database = {
  pragma(source: string): unknown;
  exec(source: string): void;
  prepare(source: string): {
    run(...params: unknown[]): { changes: number; lastInsertRowid: number | bigint };
    get(...params: unknown[]): unknown;
    all(...params: unknown[]): unknown[];
  };
  close(): void;
};

export interface PlanEventRecord {
  id: number;
  planId: string;
  stepTicketId: string | null;
  eventType: string;
  agentSessionId: string | null;
  detailJson: string | null;
  timestamp: string;
}

export class EventStore {
  private db: BetterSqlite3Database;
  private lastToolName = new Map<string, string>();

  // Prepared statements
  private stmtInsertEvent!: ReturnType<BetterSqlite3Database["prepare"]>;
  private stmtUpsertSession!: ReturnType<BetterSqlite3Database["prepare"]>;
  private stmtUpdateSessionState!: ReturnType<BetterSqlite3Database["prepare"]>;
  private stmtLoadSessionEvents!: ReturnType<BetterSqlite3Database["prepare"]>;
  private stmtLoadAllSessions!: ReturnType<BetterSqlite3Database["prepare"]>;
  private stmtLoadSessionsByProject!: ReturnType<BetterSqlite3Database["prepare"]>;
  private stmtLoadSessionsByState!: ReturnType<BetterSqlite3Database["prepare"]>;
  private stmtLoadSessionsByProjectAndState!: ReturnType<BetterSqlite3Database["prepare"]>;
  private stmtInsertPlanEvent!: ReturnType<BetterSqlite3Database["prepare"]>;
  private stmtLoadPlanEvents!: ReturnType<BetterSqlite3Database["prepare"]>;
  private stmtInsertChangeset!: ReturnType<BetterSqlite3Database["prepare"]>;
  private stmtLoadChangesetsByTicket!: ReturnType<BetterSqlite3Database["prepare"]>;
  private stmtLoadChangesetsBySession!: ReturnType<BetterSqlite3Database["prepare"]>;
  private stmtInsertFileTicket!: ReturnType<BetterSqlite3Database["prepare"]>;
  private stmtQueryFileTickets!: ReturnType<BetterSqlite3Database["prepare"]>;
  private stmtQueryTicketFiles!: ReturnType<BetterSqlite3Database["prepare"]>;

  constructor(dbPath?: string) {
    const Database = require("better-sqlite3");
    const resolvedPath = dbPath ?? join(opcomRoot(), "events.db");
    this.db = new Database(resolvedPath) as BetterSqlite3Database;

    // WAL mode + relaxed sync for write performance
    this.db.pragma("journal_mode = WAL");
    this.db.pragma("synchronous = NORMAL");

    this.migrate();
    this.prepareStatements();
  }

  private migrate(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS sessions (
        id TEXT PRIMARY KEY,
        backend TEXT NOT NULL,
        project_id TEXT NOT NULL,
        work_item_id TEXT,
        state TEXT NOT NULL,
        started_at TEXT NOT NULL,
        stopped_at TEXT,
        last_activity TEXT,
        pid INTEGER,
        backend_session_id TEXT,
        context_tokens_used INTEGER,
        context_max_tokens INTEGER
      );

      CREATE TABLE IF NOT EXISTS events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id TEXT NOT NULL,
        type TEXT NOT NULL,
        timestamp TEXT NOT NULL,
        text TEXT,
        role TEXT,
        tool_name TEXT,
        tool_input TEXT,
        tool_output TEXT,
        tool_success INTEGER,
        reason TEXT,
        context_tokens INTEGER,
        data_json TEXT
      );

      CREATE INDEX IF NOT EXISTS idx_events_session_id ON events(session_id);
      CREATE INDEX IF NOT EXISTS idx_events_type ON events(type);
      CREATE INDEX IF NOT EXISTS idx_events_timestamp ON events(timestamp);
      CREATE INDEX IF NOT EXISTS idx_events_tool_name ON events(tool_name);

      CREATE TABLE IF NOT EXISTS plan_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        plan_id TEXT NOT NULL,
        step_ticket_id TEXT,
        event_type TEXT NOT NULL,
        agent_session_id TEXT,
        detail_json TEXT,
        timestamp TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_plan_events_plan_id ON plan_events(plan_id, timestamp);

      CREATE TABLE IF NOT EXISTS changesets (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id TEXT NOT NULL,
        ticket_id TEXT NOT NULL,
        project_id TEXT NOT NULL,
        commit_shas TEXT NOT NULL,
        files_json TEXT NOT NULL,
        total_insertions INTEGER NOT NULL,
        total_deletions INTEGER NOT NULL,
        timestamp TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_changesets_ticket_id ON changesets(ticket_id);
      CREATE INDEX IF NOT EXISTS idx_changesets_session_id ON changesets(session_id);

      CREATE TABLE IF NOT EXISTS file_ticket_map (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        file_path TEXT NOT NULL,
        ticket_id TEXT NOT NULL,
        project_id TEXT NOT NULL,
        change_status TEXT NOT NULL,
        timestamp TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_ftm_file_path ON file_ticket_map(file_path);
      CREATE INDEX IF NOT EXISTS idx_ftm_ticket_id ON file_ticket_map(ticket_id);
    `);
  }

  private prepareStatements(): void {
    this.stmtInsertEvent = this.db.prepare(`
      INSERT INTO events (session_id, type, timestamp, text, role, tool_name, tool_input, tool_output, tool_success, reason, context_tokens, data_json)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    this.stmtUpsertSession = this.db.prepare(`
      INSERT INTO sessions (id, backend, project_id, work_item_id, state, started_at, stopped_at, last_activity, pid, backend_session_id, context_tokens_used, context_max_tokens)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        state = excluded.state,
        stopped_at = excluded.stopped_at,
        last_activity = excluded.last_activity,
        pid = excluded.pid,
        backend_session_id = excluded.backend_session_id,
        context_tokens_used = excluded.context_tokens_used,
        context_max_tokens = excluded.context_max_tokens
    `);

    this.stmtUpdateSessionState = this.db.prepare(`
      UPDATE sessions SET state = ?, stopped_at = ?, last_activity = ? WHERE id = ?
    `);

    this.stmtLoadSessionEvents = this.db.prepare(`
      SELECT * FROM events WHERE session_id = ? ORDER BY id ASC LIMIT ? OFFSET ?
    `);

    this.stmtLoadAllSessions = this.db.prepare(`
      SELECT * FROM sessions ORDER BY started_at DESC
    `);

    this.stmtLoadSessionsByProject = this.db.prepare(`
      SELECT * FROM sessions WHERE project_id = ? ORDER BY started_at DESC
    `);

    this.stmtLoadSessionsByState = this.db.prepare(`
      SELECT * FROM sessions WHERE state = ? ORDER BY started_at DESC
    `);

    this.stmtLoadSessionsByProjectAndState = this.db.prepare(`
      SELECT * FROM sessions WHERE project_id = ? AND state = ? ORDER BY started_at DESC
    `);

    this.stmtInsertPlanEvent = this.db.prepare(`
      INSERT INTO plan_events (plan_id, step_ticket_id, event_type, agent_session_id, detail_json, timestamp)
      VALUES (?, ?, ?, ?, ?, ?)
    `);

    this.stmtLoadPlanEvents = this.db.prepare(`
      SELECT * FROM plan_events WHERE plan_id = ? ORDER BY id ASC LIMIT ? OFFSET ?
    `);

    this.stmtInsertChangeset = this.db.prepare(`
      INSERT INTO changesets (session_id, ticket_id, project_id, commit_shas, files_json, total_insertions, total_deletions, timestamp)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);

    this.stmtLoadChangesetsByTicket = this.db.prepare(`
      SELECT * FROM changesets WHERE ticket_id = ? ORDER BY id ASC
    `);

    this.stmtLoadChangesetsBySession = this.db.prepare(`
      SELECT * FROM changesets WHERE session_id = ? ORDER BY id ASC
    `);

    this.stmtInsertFileTicket = this.db.prepare(`
      INSERT INTO file_ticket_map (file_path, ticket_id, project_id, change_status, timestamp)
      VALUES (?, ?, ?, ?, ?)
    `);

    this.stmtQueryFileTickets = this.db.prepare(`
      SELECT DISTINCT ticket_id, project_id, change_status, MAX(timestamp) as latest
      FROM file_ticket_map
      WHERE file_path = ?
      GROUP BY ticket_id
      ORDER BY latest DESC
    `);

    this.stmtQueryTicketFiles = this.db.prepare(`
      SELECT file_path, change_status, MAX(timestamp) as latest
      FROM file_ticket_map
      WHERE ticket_id = ?
      GROUP BY file_path
      ORDER BY file_path ASC
    `);
  }

  insertEvent(sessionId: string, event: NormalizedEvent): void {
    const data = event.data;

    // Track tool_name: on tool_start, remember the name; on tool_end, carry it forward
    let toolName = data?.toolName ?? null;
    if (event.type === "tool_start" && toolName) {
      this.lastToolName.set(sessionId, toolName);
    } else if (event.type === "tool_end" && !toolName) {
      toolName = this.lastToolName.get(sessionId) ?? null;
    }

    try {
      this.stmtInsertEvent.run(
        sessionId,
        event.type,
        event.timestamp,
        data?.text ?? null,
        data?.role ?? null,
        toolName,
        data?.toolInput ?? null,
        data?.toolOutput ?? null,
        data?.toolSuccess != null ? (data.toolSuccess ? 1 : 0) : null,
        data?.reason ?? null,
        data?.contextTokens ?? null,
        data ? JSON.stringify(data) : null,
      );
    } catch (err) {
      log.warn("failed to insert event", { sessionId, type: event.type, error: String(err) });
    }
  }

  upsertSession(session: AgentSession): void {
    try {
      this.stmtUpsertSession.run(
        session.id,
        session.backend,
        session.projectId,
        session.workItemId ?? null,
        session.state,
        session.startedAt,
        session.stoppedAt ?? null,
        session.lastActivity ?? null,
        session.pid ?? null,
        session.backendSessionId ?? null,
        session.contextUsage?.tokensUsed ?? null,
        session.contextUsage?.maxTokens ?? null,
      );
    } catch (err) {
      log.warn("failed to upsert session", { sessionId: session.id, error: String(err) });
    }
  }

  updateSessionState(sessionId: string, state: string, stoppedAt?: string): void {
    try {
      this.stmtUpdateSessionState.run(
        state,
        stoppedAt ?? null,
        new Date().toISOString(),
        sessionId,
      );
    } catch (err) {
      log.warn("failed to update session state", { sessionId, error: String(err) });
    }
  }

  loadSessionEvents(
    sessionId: string,
    opts?: { limit?: number; offset?: number },
  ): NormalizedEvent[] {
    const limit = opts?.limit ?? 10000;
    const offset = opts?.offset ?? 0;
    const rows = this.stmtLoadSessionEvents.all(sessionId, limit, offset) as Array<{
      session_id: string;
      type: string;
      timestamp: string;
      text: string | null;
      role: string | null;
      tool_name: string | null;
      tool_input: string | null;
      tool_output: string | null;
      tool_success: number | null;
      reason: string | null;
      context_tokens: number | null;
      data_json: string | null;
    }>;

    return rows.map((row) => {
      const event: NormalizedEvent = {
        type: row.type as NormalizedEvent["type"],
        sessionId: row.session_id,
        timestamp: row.timestamp,
      };

      // Rebuild data from columns (prefer columns over data_json for queryability)
      const data: NormalizedEvent["data"] = {};
      let hasData = false;

      if (row.text != null) { data.text = row.text; hasData = true; }
      if (row.role != null) { data.role = row.role as "assistant" | "user" | "system"; hasData = true; }
      if (row.tool_name != null) { data.toolName = row.tool_name; hasData = true; }
      if (row.tool_input != null) { data.toolInput = row.tool_input; hasData = true; }
      if (row.tool_output != null) { data.toolOutput = row.tool_output; hasData = true; }
      if (row.tool_success != null) { data.toolSuccess = row.tool_success === 1; hasData = true; }
      if (row.reason != null) { data.reason = row.reason; hasData = true; }
      if (row.context_tokens != null) { data.contextTokens = row.context_tokens; hasData = true; }

      if (hasData) {
        event.data = data;
      }

      return event;
    });
  }

  loadAllSessions(opts?: { projectId?: string; state?: string }): AgentSession[] {
    let rows: unknown[];

    if (opts?.projectId && opts?.state) {
      rows = this.stmtLoadSessionsByProjectAndState.all(opts.projectId, opts.state);
    } else if (opts?.projectId) {
      rows = this.stmtLoadSessionsByProject.all(opts.projectId);
    } else if (opts?.state) {
      rows = this.stmtLoadSessionsByState.all(opts.state);
    } else {
      rows = this.stmtLoadAllSessions.all();
    }

    return (rows as Array<{
      id: string;
      backend: string;
      project_id: string;
      work_item_id: string | null;
      state: string;
      started_at: string;
      stopped_at: string | null;
      last_activity: string | null;
      pid: number | null;
      backend_session_id: string | null;
      context_tokens_used: number | null;
      context_max_tokens: number | null;
    }>).map((row) => {
      const session: AgentSession = {
        id: row.id,
        backend: row.backend as AgentSession["backend"],
        projectId: row.project_id,
        state: row.state as AgentSession["state"],
        startedAt: row.started_at,
      };
      if (row.work_item_id) session.workItemId = row.work_item_id;
      if (row.stopped_at) session.stoppedAt = row.stopped_at;
      if (row.last_activity) session.lastActivity = row.last_activity;
      if (row.pid != null) session.pid = row.pid;
      if (row.backend_session_id) session.backendSessionId = row.backend_session_id;
      if (row.context_tokens_used != null && row.context_max_tokens != null) {
        session.contextUsage = {
          tokensUsed: row.context_tokens_used,
          maxTokens: row.context_max_tokens,
          percentage: (row.context_tokens_used / row.context_max_tokens) * 100,
        };
      }
      return session;
    });
  }

  // --- Analytics ---

  toolUsageStats(opts?: { projectId?: string }): ToolUsageStat[] {
    let query = `
      SELECT
        tool_name,
        COUNT(*) as count,
        SUM(CASE WHEN tool_success = 1 THEN 1 ELSE 0 END) as success_count,
        SUM(CASE WHEN tool_success = 0 THEN 1 ELSE 0 END) as failure_count
      FROM events
      WHERE type = 'tool_end' AND tool_name IS NOT NULL
    `;
    const params: unknown[] = [];

    if (opts?.projectId) {
      query += ` AND session_id IN (SELECT id FROM sessions WHERE project_id = ?)`;
      params.push(opts.projectId);
    }

    query += ` GROUP BY tool_name ORDER BY count DESC`;

    const rows = this.db.prepare(query).all(...params) as Array<{
      tool_name: string;
      count: number;
      success_count: number;
      failure_count: number;
    }>;

    return rows.map((row) => ({
      toolName: row.tool_name,
      count: row.count,
      successCount: row.success_count,
      failureCount: row.failure_count,
      successRate: row.count > 0 ? row.success_count / row.count : 0,
    }));
  }

  toolSuccessRates(opts?: { projectId?: string }): ToolUsageStat[] {
    // Same as toolUsageStats but sorted by success rate
    const stats = this.toolUsageStats(opts);
    return stats.sort((a, b) => a.successRate - b.successRate);
  }

  sessionStats(opts?: { projectId?: string }): SessionStat[] {
    let query = `
      SELECT
        s.id as session_id,
        s.backend,
        s.project_id,
        s.state,
        s.started_at,
        s.stopped_at,
        CASE
          WHEN s.stopped_at IS NOT NULL
          THEN ROUND((julianday(s.stopped_at) - julianday(s.started_at)) * 24 * 60, 1)
          ELSE NULL
        END as duration_minutes,
        (SELECT COUNT(*) FROM events e WHERE e.session_id = s.id) as event_count,
        (SELECT COUNT(*) FROM events e WHERE e.session_id = s.id AND e.type IN ('tool_start', 'tool_end')) as tool_count
      FROM sessions s
    `;
    const params: unknown[] = [];

    if (opts?.projectId) {
      query += ` WHERE s.project_id = ?`;
      params.push(opts.projectId);
    }

    query += ` ORDER BY s.started_at DESC`;

    const rows = this.db.prepare(query).all(...params) as Array<{
      session_id: string;
      backend: string;
      project_id: string;
      state: string;
      started_at: string;
      stopped_at: string | null;
      duration_minutes: number | null;
      event_count: number;
      tool_count: number;
    }>;

    return rows.map((row) => ({
      sessionId: row.session_id,
      backend: row.backend,
      projectId: row.project_id,
      state: row.state,
      startedAt: row.started_at,
      stoppedAt: row.stopped_at,
      durationMinutes: row.duration_minutes,
      eventCount: row.event_count,
      toolCount: row.tool_count,
    }));
  }

  dailyActivity(opts?: { projectId?: string; days?: number }): DailyActivity[] {
    const days = opts?.days ?? 30;

    let query = `
      SELECT
        date(e.timestamp) as date,
        COUNT(DISTINCT e.session_id) as sessions,
        COUNT(*) as events,
        SUM(CASE WHEN e.type IN ('tool_start', 'tool_end') THEN 1 ELSE 0 END) as tools
      FROM events e
      WHERE e.timestamp >= date('now', '-' || ? || ' days')
    `;
    const params: unknown[] = [days];

    if (opts?.projectId) {
      query += ` AND e.session_id IN (SELECT id FROM sessions WHERE project_id = ?)`;
      params.push(opts.projectId);
    }

    query += ` GROUP BY date(e.timestamp) ORDER BY date ASC`;

    const rows = this.db.prepare(query).all(...params) as Array<{
      date: string;
      sessions: number;
      events: number;
      tools: number;
    }>;

    return rows.map((row) => ({
      date: row.date,
      sessions: row.sessions,
      events: row.events,
      tools: row.tools,
    }));
  }

  // --- Plan events ---

  insertPlanEvent(
    planId: string,
    eventType: string,
    opts?: { stepTicketId?: string; agentSessionId?: string; detail?: Record<string, unknown> },
  ): void {
    try {
      this.stmtInsertPlanEvent.run(
        planId,
        opts?.stepTicketId ?? null,
        eventType,
        opts?.agentSessionId ?? null,
        opts?.detail ? JSON.stringify(opts.detail) : null,
        new Date().toISOString(),
      );
    } catch (err) {
      log.warn("failed to insert plan event", { planId, eventType, error: String(err) });
    }
  }

  loadPlanEvents(
    planId: string,
    opts?: { limit?: number; offset?: number },
  ): PlanEventRecord[] {
    const limit = opts?.limit ?? 10000;
    const offset = opts?.offset ?? 0;
    const rows = this.stmtLoadPlanEvents.all(planId, limit, offset) as Array<{
      id: number;
      plan_id: string;
      step_ticket_id: string | null;
      event_type: string;
      agent_session_id: string | null;
      detail_json: string | null;
      timestamp: string;
    }>;

    return rows.map((row) => ({
      id: row.id,
      planId: row.plan_id,
      stepTicketId: row.step_ticket_id,
      eventType: row.event_type,
      agentSessionId: row.agent_session_id,
      detailJson: row.detail_json,
      timestamp: row.timestamp,
    }));
  }

  // --- Changesets ---

  insertChangeset(changeset: Changeset): void {
    try {
      this.stmtInsertChangeset.run(
        changeset.sessionId,
        changeset.ticketId,
        changeset.projectId,
        JSON.stringify(changeset.commitShas),
        JSON.stringify(changeset.files),
        changeset.totalInsertions,
        changeset.totalDeletions,
        changeset.timestamp,
      );

      // Populate file_ticket_map for reverse lookups
      for (const file of changeset.files) {
        this.stmtInsertFileTicket.run(
          file.path,
          changeset.ticketId,
          changeset.projectId,
          file.status,
          changeset.timestamp,
        );
      }
    } catch (err) {
      log.warn("failed to insert changeset", { ticketId: changeset.ticketId, error: String(err) });
    }
  }

  loadChangesets(query: ChangesetQuery): Changeset[] {
    let rows: unknown[];

    if (query.sessionId) {
      rows = this.stmtLoadChangesetsBySession.all(query.sessionId);
    } else if (query.ticketId) {
      rows = this.stmtLoadChangesetsByTicket.all(query.ticketId);
    } else {
      // Fallback: load all (filtered by projectId if given)
      const q = query.projectId
        ? `SELECT * FROM changesets WHERE project_id = ? ORDER BY id ASC`
        : `SELECT * FROM changesets ORDER BY id ASC`;
      rows = query.projectId
        ? this.db.prepare(q).all(query.projectId)
        : this.db.prepare(q).all();
    }

    return (rows as Array<{
      id: number;
      session_id: string;
      ticket_id: string;
      project_id: string;
      commit_shas: string;
      files_json: string;
      total_insertions: number;
      total_deletions: number;
      timestamp: string;
    }>).map((row) => ({
      sessionId: row.session_id,
      ticketId: row.ticket_id,
      projectId: row.project_id,
      commitShas: JSON.parse(row.commit_shas),
      files: JSON.parse(row.files_json),
      totalInsertions: row.total_insertions,
      totalDeletions: row.total_deletions,
      timestamp: row.timestamp,
    }));
  }

  // --- File-ticket reverse index ---

  queryFileTickets(filePath: string): Array<{ ticketId: string; projectId: string; changeStatus: string; latest: string }> {
    const rows = this.stmtQueryFileTickets.all(filePath) as Array<{
      ticket_id: string;
      project_id: string;
      change_status: string;
      latest: string;
    }>;
    return rows.map((row) => ({
      ticketId: row.ticket_id,
      projectId: row.project_id,
      changeStatus: row.change_status,
      latest: row.latest,
    }));
  }

  queryTicketFiles(ticketId: string): Array<{ filePath: string; changeStatus: string; latest: string }> {
    const rows = this.stmtQueryTicketFiles.all(ticketId) as Array<{
      file_path: string;
      change_status: string;
      latest: string;
    }>;
    return rows.map((row) => ({
      filePath: row.file_path,
      changeStatus: row.change_status,
      latest: row.latest,
    }));
  }

  /** Import existing session YAML data (events will be empty for old sessions) */
  importSessions(sessions: AgentSession[]): void {
    for (const session of sessions) {
      this.upsertSession(session);
    }
  }

  close(): void {
    try {
      this.db.close();
    } catch (err) {
      log.warn("failed to close event store", { error: String(err) });
    }
  }
}
