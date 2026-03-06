/**
 * SQLite schema for the context graph.
 *
 * Node types are extensible — analyzers register their own types.
 * Edge relations are also extensible. The schema doesn't constrain
 * what types/relations exist — that's the analyzers' job.
 */

export const SCHEMA = `
CREATE TABLE IF NOT EXISTS nodes (
    id          TEXT PRIMARY KEY,
    type        TEXT NOT NULL,
    path        TEXT,
    title       TEXT,
    status      TEXT,
    meta        TEXT,
    first_seen  TEXT,
    last_seen   TEXT
);

CREATE TABLE IF NOT EXISTS edges (
    source      TEXT NOT NULL,
    target      TEXT NOT NULL,
    relation    TEXT NOT NULL,
    meta        TEXT,
    first_seen  TEXT,
    last_seen   TEXT,
    PRIMARY KEY (source, target, relation)
);

CREATE TABLE IF NOT EXISTS build_meta (
    key         TEXT PRIMARY KEY,
    value       TEXT
);

CREATE TABLE IF NOT EXISTS commit_log (
    hash        TEXT PRIMARY KEY,
    timestamp   TEXT NOT NULL,
    author      TEXT,
    message     TEXT,
    files_changed INTEGER,
    insertions  INTEGER,
    deletions   INTEGER
);

CREATE TABLE IF NOT EXISTS file_history (
    file_path   TEXT NOT NULL,
    commit_hash TEXT NOT NULL,
    action      TEXT NOT NULL,  -- added, modified, deleted, renamed
    old_path    TEXT,           -- for renames
    PRIMARY KEY (file_path, commit_hash)
);

CREATE INDEX IF NOT EXISTS idx_edges_source ON edges(source);
CREATE INDEX IF NOT EXISTS idx_edges_target ON edges(target);
CREATE INDEX IF NOT EXISTS idx_edges_relation ON edges(relation);
CREATE INDEX IF NOT EXISTS idx_nodes_type ON nodes(type);
CREATE TABLE IF NOT EXISTS test_results (
    test_id     TEXT NOT NULL,
    commit_hash TEXT NOT NULL,
    run_id      TEXT NOT NULL,
    status      TEXT NOT NULL,
    duration_ms INTEGER,
    error_msg   TEXT,
    timestamp   TEXT NOT NULL,
    PRIMARY KEY (test_id, commit_hash, run_id)
);

CREATE TABLE IF NOT EXISTS run_summary (
    run_id      TEXT PRIMARY KEY,
    commit_hash TEXT NOT NULL,
    timestamp   TEXT NOT NULL,
    framework   TEXT,
    total       INTEGER,
    passed      INTEGER,
    failed      INTEGER,
    skipped     INTEGER,
    duration_ms INTEGER,
    meta        TEXT
);

CREATE INDEX IF NOT EXISTS idx_file_history_path ON file_history(file_path);
CREATE INDEX IF NOT EXISTS idx_file_history_commit ON file_history(commit_hash);
CREATE INDEX IF NOT EXISTS idx_test_results_test ON test_results(test_id);
CREATE INDEX IF NOT EXISTS idx_test_results_commit ON test_results(commit_hash);
CREATE INDEX IF NOT EXISTS idx_test_results_run ON test_results(run_id);
CREATE INDEX IF NOT EXISTS idx_test_results_status ON test_results(status);
CREATE INDEX IF NOT EXISTS idx_run_summary_commit ON run_summary(commit_hash);

CREATE VIRTUAL TABLE IF NOT EXISTS nodes_fts USING fts5(id, title, path, content=nodes, content_rowid=rowid);

CREATE TRIGGER IF NOT EXISTS nodes_ai AFTER INSERT ON nodes BEGIN
    INSERT INTO nodes_fts(rowid, id, title, path) VALUES (new.rowid, new.id, new.title, new.path);
END;
CREATE TRIGGER IF NOT EXISTS nodes_ad AFTER DELETE ON nodes BEGIN
    INSERT INTO nodes_fts(nodes_fts, rowid, id, title, path) VALUES('delete', old.rowid, old.id, old.title, old.path);
END;
CREATE TRIGGER IF NOT EXISTS nodes_au AFTER UPDATE ON nodes BEGIN
    INSERT INTO nodes_fts(nodes_fts, rowid, id, title, path) VALUES('delete', old.rowid, old.id, old.title, old.path);
    INSERT INTO nodes_fts(rowid, id, title, path) VALUES (new.rowid, new.id, new.title, new.path);
END;
`;

/** Standard node types. Analyzers can add their own. */
export type NodeType =
  | "file"
  | "test"
  | "spec"
  | "adr"
  | "ticket"
  | "benchmark"
  | "use_case"
  | "op"
  | "domain"
  | "dataset"
  | "backend"
  | "config"
  | "module"
  | string;

/** Standard edge relations. Analyzers can add their own. */
export type EdgeRelation =
  | "imports"
  | "tests"
  | "implements"
  | "supersedes"
  | "belongs_to"
  | "links_to"
  | "asserts"
  | "benchmarks"
  | "requires"
  | string;

export interface GraphNode {
  id: string;
  type: NodeType;
  path?: string;
  title?: string;
  status?: string;
  meta?: Record<string, unknown>;
  firstSeen?: string;
  lastSeen?: string;
}

export interface GraphEdge {
  source: string;
  target: string;
  relation: EdgeRelation;
  meta?: Record<string, unknown>;
  firstSeen?: string;
  lastSeen?: string;
}

/** A single test result from a CI or local run. */
export interface TestResult {
  testId: string;
  commitHash: string;
  runId: string;
  status: "pass" | "fail" | "skip" | "error";
  durationMs?: number;
  errorMsg?: string;
  timestamp: string;
}

/** Summary of an entire test run. */
export interface RunSummary {
  runId: string;
  commitHash: string;
  timestamp: string;
  framework?: string;
  total: number;
  passed: number;
  failed: number;
  skipped: number;
  durationMs?: number;
  meta?: Record<string, unknown>;
}

/** Normalized output from a test result parser. */
export interface ParsedTestRun {
  framework: string;
  results: TestResult[];
  summary: Omit<RunSummary, "runId" | "commitHash" | "timestamp">;
}
