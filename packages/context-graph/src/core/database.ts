/**
 * Database wrapper for the context graph.
 *
 * Handles SQLite connection, schema init, and CRUD for nodes/edges.
 * Uses better-sqlite3 for synchronous access (fast, no async overhead).
 */

import Database from "better-sqlite3";
import { join } from "node:path";
import { mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { SCHEMA, type GraphNode, type GraphEdge, type TestResult, type RunSummary } from "./schema.js";

export class GraphDatabase {
  private db: Database.Database;
  readonly dbPath: string;

  constructor(projectName: string, contextDir?: string) {
    const baseDir = contextDir ?? join(homedir(), ".context");
    const projectDir = join(baseDir, projectName);
    mkdirSync(projectDir, { recursive: true });
    this.dbPath = join(projectDir, "graph.db");
    this.db = new Database(this.dbPath);
    this.db.pragma("journal_mode = WAL");
    this.db.exec(SCHEMA);
  }

  /** Open an existing graph database directly by path. */
  static open(dbPath: string): GraphDatabase {
    const instance = Object.create(GraphDatabase.prototype) as GraphDatabase;
    (instance as { dbPath: string }).dbPath = dbPath;
    (instance as unknown as { db: Database.Database }).db = new Database(dbPath);
    instance.db.pragma("journal_mode = WAL");
    return instance;
  }

  // --- Node operations ---

  upsertNode(node: GraphNode): void {
    const now = new Date().toISOString();
    this.db
      .prepare(
        `INSERT INTO nodes (id, type, path, title, status, meta, first_seen, last_seen)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           type = excluded.type,
           path = excluded.path,
           title = excluded.title,
           status = excluded.status,
           meta = excluded.meta,
           last_seen = excluded.last_seen`,
      )
      .run(
        node.id,
        node.type,
        node.path ?? null,
        node.title ?? null,
        node.status ?? null,
        node.meta ? JSON.stringify(node.meta) : null,
        node.firstSeen ?? now,
        now,
      );
  }

  upsertNodes(nodes: GraphNode[]): void {
    const tx = this.db.transaction(() => {
      for (const node of nodes) {
        this.upsertNode(node);
      }
    });
    tx();
  }

  deleteNode(id: string): void {
    this.db.prepare("DELETE FROM edges WHERE source = ? OR target = ?").run(id, id);
    this.db.prepare("DELETE FROM nodes WHERE id = ?").run(id);
  }

  getNode(id: string): GraphNode | undefined {
    const row = this.db.prepare("SELECT * FROM nodes WHERE id = ?").get(id) as Record<string, unknown> | undefined;
    if (!row) return undefined;
    return rowToNode(row);
  }

  getNodesByType(type: string): GraphNode[] {
    const rows = this.db.prepare("SELECT * FROM nodes WHERE type = ?").all(type) as Record<string, unknown>[];
    return rows.map(rowToNode);
  }

  // --- Edge operations ---

  upsertEdge(edge: GraphEdge): void {
    const now = new Date().toISOString();
    this.db
      .prepare(
        `INSERT INTO edges (source, target, relation, meta, first_seen, last_seen)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(source, target, relation) DO UPDATE SET
           meta = excluded.meta,
           last_seen = excluded.last_seen`,
      )
      .run(
        edge.source,
        edge.target,
        edge.relation,
        edge.meta ? JSON.stringify(edge.meta) : null,
        edge.firstSeen ?? now,
        now,
      );
  }

  upsertEdges(edges: GraphEdge[]): void {
    const tx = this.db.transaction(() => {
      for (const edge of edges) {
        this.upsertEdge(edge);
      }
    });
    tx();
  }

  getEdgesFrom(nodeId: string, relation?: string): GraphEdge[] {
    const sql = relation
      ? "SELECT * FROM edges WHERE source = ? AND relation = ?"
      : "SELECT * FROM edges WHERE source = ?";
    const rows = (relation
      ? this.db.prepare(sql).all(nodeId, relation)
      : this.db.prepare(sql).all(nodeId)) as Record<string, unknown>[];
    return rows.map(rowToEdge);
  }

  getEdgesTo(nodeId: string, relation?: string): GraphEdge[] {
    const sql = relation
      ? "SELECT * FROM edges WHERE target = ? AND relation = ?"
      : "SELECT * FROM edges WHERE target = ?";
    const rows = (relation
      ? this.db.prepare(sql).all(nodeId, relation)
      : this.db.prepare(sql).all(nodeId)) as Record<string, unknown>[];
    return rows.map(rowToEdge);
  }

  // --- Bulk operations ---

  clear(): void {
    this.db.exec("DELETE FROM edges; DELETE FROM nodes; DELETE FROM nodes_fts;");
  }

  // --- Metadata ---

  setMeta(key: string, value: string): void {
    this.db.prepare("INSERT OR REPLACE INTO build_meta (key, value) VALUES (?, ?)").run(key, value);
  }

  getMeta(key: string): string | undefined {
    const row = this.db.prepare("SELECT value FROM build_meta WHERE key = ?").get(key) as { value: string } | undefined;
    return row?.value;
  }

  // --- Commit history ---

  insertCommit(hash: string, timestamp: string, author: string, message: string, stats: { files: number; insertions: number; deletions: number }): void {
    this.db
      .prepare(
        `INSERT OR IGNORE INTO commit_log (hash, timestamp, author, message, files_changed, insertions, deletions)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(hash, timestamp, author, message, stats.files, stats.insertions, stats.deletions);
  }

  insertFileHistory(filePath: string, commitHash: string, action: string, oldPath?: string): void {
    this.db
      .prepare(
        `INSERT OR IGNORE INTO file_history (file_path, commit_hash, action, old_path)
         VALUES (?, ?, ?, ?)`,
      )
      .run(filePath, commitHash, action, oldPath ?? null);
  }

  // --- Test results ---

  insertTestResult(result: TestResult): void {
    this.db
      .prepare(
        `INSERT INTO test_results (test_id, commit_hash, run_id, status, duration_ms, error_msg, timestamp)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(test_id, commit_hash, run_id) DO UPDATE SET
           status = excluded.status,
           duration_ms = excluded.duration_ms,
           error_msg = excluded.error_msg,
           timestamp = excluded.timestamp`,
      )
      .run(
        result.testId,
        result.commitHash,
        result.runId,
        result.status,
        result.durationMs ?? null,
        result.errorMsg ?? null,
        result.timestamp,
      );
  }

  insertTestResults(results: TestResult[]): void {
    const tx = this.db.transaction(() => {
      for (const result of results) {
        this.insertTestResult(result);
      }
    });
    tx();
  }

  insertRunSummary(summary: RunSummary): void {
    this.db
      .prepare(
        `INSERT INTO run_summary (run_id, commit_hash, timestamp, framework, total, passed, failed, skipped, duration_ms, meta)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(run_id) DO UPDATE SET
           commit_hash = excluded.commit_hash,
           timestamp = excluded.timestamp,
           framework = excluded.framework,
           total = excluded.total,
           passed = excluded.passed,
           failed = excluded.failed,
           skipped = excluded.skipped,
           duration_ms = excluded.duration_ms,
           meta = excluded.meta`,
      )
      .run(
        summary.runId,
        summary.commitHash,
        summary.timestamp,
        summary.framework ?? null,
        summary.total,
        summary.passed,
        summary.failed,
        summary.skipped,
        summary.durationMs ?? null,
        summary.meta ? JSON.stringify(summary.meta) : null,
      );
  }

  /** Ingest a full test run: stores results, summary, and upserts test nodes. */
  ingestTestRun(results: TestResult[], summary: RunSummary): void {
    const tx = this.db.transaction(() => {
      // Insert run summary
      this.insertRunSummary(summary);

      // Insert individual results and upsert test nodes
      const now = new Date().toISOString();
      for (const result of results) {
        this.insertTestResult(result);

        // Upsert a test node so it exists in the graph
        this.upsertNode({
          id: result.testId,
          type: "test",
          title: result.testId.replace(/^test:/, ""),
          status: result.status,
          meta: {
            lastRunId: result.runId,
            lastDurationMs: result.durationMs,
          },
        });
      }
    });
    tx();
  }

  // --- Test result queries ---

  /** Tests that started failing in a given run but passed in the previous run. */
  newFailures(runId: string): Array<{ testId: string; errorMsg: string | null }> {
    const rows = this.db
      .prepare(
        `SELECT tr.test_id, tr.error_msg
         FROM test_results tr
         WHERE tr.run_id = ? AND tr.status IN ('fail', 'error')
         AND tr.test_id NOT IN (
           SELECT test_id FROM test_results
           WHERE run_id = (
             SELECT run_id FROM run_summary
             WHERE timestamp < (SELECT timestamp FROM run_summary WHERE run_id = ?)
             ORDER BY timestamp DESC LIMIT 1
           ) AND status IN ('fail', 'error')
         )`,
      )
      .all(runId, runId) as Array<{ test_id: string; error_msg: string | null }>;
    return rows.map((r) => ({ testId: r.test_id, errorMsg: r.error_msg }));
  }

  /** Tests with both pass and fail in recent runs (within last N days, default 7). */
  flakyTests(days = 7): Array<{ testId: string; passCount: number; failCount: number }> {
    const rows = this.db
      .prepare(
        `SELECT test_id,
                SUM(CASE WHEN status = 'pass' THEN 1 ELSE 0 END) as pass_count,
                SUM(CASE WHEN status IN ('fail', 'error') THEN 1 ELSE 0 END) as fail_count
         FROM test_results
         WHERE timestamp > datetime('now', ?)
         GROUP BY test_id
         HAVING pass_count > 0 AND fail_count > 0
         ORDER BY fail_count DESC`,
      )
      .all(`-${days} days`) as Array<{ test_id: string; pass_count: number; fail_count: number }>;

    return rows.map((r) => ({
      testId: r.test_id,
      passCount: r.pass_count,
      failCount: r.fail_count,
    }));
  }

  /** Slowest tests by average duration. */
  slowestTests(limit = 20): Array<{ testId: string; avgMs: number; maxMs: number; runs: number }> {
    const rows = this.db
      .prepare(
        `SELECT test_id,
                AVG(duration_ms) as avg_ms,
                MAX(duration_ms) as max_ms,
                COUNT(*) as runs
         FROM test_results
         WHERE duration_ms IS NOT NULL
         GROUP BY test_id
         ORDER BY avg_ms DESC
         LIMIT ?`,
      )
      .all(limit) as Array<{ test_id: string; avg_ms: number; max_ms: number; runs: number }>;

    return rows.map((r) => ({
      testId: r.test_id,
      avgMs: Math.round(r.avg_ms),
      maxMs: r.max_ms,
      runs: r.runs,
    }));
  }

  /** Coverage trend: test pass counts per run. */
  coverageTrend(limit = 20): Array<{ runId: string; timestamp: string; total: number; passed: number; failed: number }> {
    const rows = this.db
      .prepare(
        `SELECT run_id, timestamp, total, passed, failed
         FROM run_summary
         ORDER BY timestamp DESC
         LIMIT ?`,
      )
      .all(limit) as Array<{ run_id: string; timestamp: string; total: number; passed: number; failed: number }>;
    return rows.map((r) => ({ runId: r.run_id, timestamp: r.timestamp, total: r.total, passed: r.passed, failed: r.failed }));
  }

  // --- Stats ---

  stats(): { totalNodes: number; totalEdges: number; byType: Record<string, number>; byRelation: Record<string, number> } {
    const totalNodes = (this.db.prepare("SELECT COUNT(*) as c FROM nodes").get() as { c: number }).c;
    const totalEdges = (this.db.prepare("SELECT COUNT(*) as c FROM edges").get() as { c: number }).c;

    const byType: Record<string, number> = {};
    for (const row of this.db.prepare("SELECT type, COUNT(*) as c FROM nodes GROUP BY type").all() as Array<{ type: string; c: number }>) {
      byType[row.type] = row.c;
    }

    const byRelation: Record<string, number> = {};
    for (const row of this.db.prepare("SELECT relation, COUNT(*) as c FROM edges GROUP BY relation").all() as Array<{ relation: string; c: number }>) {
      byRelation[row.relation] = row.c;
    }

    return { totalNodes, totalEdges, byType, byRelation };
  }

  // --- Query ---

  query(sql: string): { columns: string[]; rows: unknown[][] } {
    const stmt = this.db.prepare(sql);
    const rows = stmt.all() as Record<string, unknown>[];
    const columns = rows.length > 0 ? Object.keys(rows[0]) : [];
    return { columns, rows: rows.map((r) => columns.map((c) => r[c])) };
  }

  // --- Search ---

  search(query: string, limit = 20): GraphNode[] {
    const rows = this.db
      .prepare("SELECT n.* FROM nodes_fts f JOIN nodes n ON n.id = f.id WHERE nodes_fts MATCH ? LIMIT ?")
      .all(query, limit) as Record<string, unknown>[];
    return rows.map(rowToNode);
  }

  close(): void {
    this.db.close();
  }
}

function rowToNode(row: Record<string, unknown>): GraphNode {
  return {
    id: row.id as string,
    type: row.type as string,
    path: row.path as string | undefined,
    title: row.title as string | undefined,
    status: row.status as string | undefined,
    meta: row.meta ? JSON.parse(row.meta as string) : undefined,
    firstSeen: row.first_seen as string | undefined,
    lastSeen: row.last_seen as string | undefined,
  };
}

function rowToEdge(row: Record<string, unknown>): GraphEdge {
  return {
    source: row.source as string,
    target: row.target as string,
    relation: row.relation as string,
    meta: row.meta ? JSON.parse(row.meta as string) : undefined,
    firstSeen: row.first_seen as string | undefined,
    lastSeen: row.last_seen as string | undefined,
  };
}
