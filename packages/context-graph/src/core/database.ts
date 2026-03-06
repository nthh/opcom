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
import { SCHEMA, type GraphNode, type GraphEdge } from "./schema.js";

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
