/**
 * Graph service — bridge between @opcom/context-graph and the rest of opcom.
 *
 * Provides:
 * - Background graph builds on project add/scan
 * - Context enrichment for agents (related files, tests, drift signals)
 * - Test result ingestion from the verification pipeline
 * - Drift signal detection
 */

import { existsSync } from "node:fs";
import { join, basename } from "node:path";
import { homedir } from "node:os";
import { createBuilder, GraphDatabase } from "@opcom/context-graph";
import type { DriftSignal, GraphContext } from "@opcom/types";
import { createLogger } from "../logger.js";

const log = createLogger("graph");

/**
 * Build the context graph for a project in the background.
 * Returns a promise that resolves when the build is complete.
 */
export async function buildGraph(
  projectName: string,
  projectPath: string,
): Promise<{ totalNodes: number; totalEdges: number }> {
  const builder = createBuilder(projectName, projectPath);
  try {
    const result = await builder.build();
    return { totalNodes: result.nodes, totalEdges: result.edges };
  } finally {
    builder.close();
  }
}

/**
 * Open the graph database for a project (if it exists).
 * Returns null if no graph has been built yet.
 */
export function openGraphDb(projectName: string): GraphDatabase | null {
  const dbPath = join(homedir(), ".context", projectName, "graph.db");
  if (!existsSync(dbPath)) return null;
  return GraphDatabase.open(dbPath);
}

/**
 * Check if a graph database exists for a project.
 */
export function graphExists(projectName: string): boolean {
  const dbPath = join(homedir(), ".context", projectName, "graph.db");
  return existsSync(dbPath);
}

/**
 * Query the graph for context relevant to a work item.
 * Returns related files, test files, and drift signals.
 */
export function queryGraphContext(
  projectName: string,
  ticketId: string,
  specLinks: string[],
): GraphContext | null {
  const db = openGraphDb(projectName);
  if (!db) return null;

  try {
    const relatedFiles: string[] = [];
    const testFiles: string[] = [];

    // Find files related to the ticket via edges
    const ticketNodeId = `ticket:${ticketId}`;
    const ticketEdges = db.getEdgesFrom(ticketNodeId);
    for (const edge of ticketEdges) {
      if (edge.relation === "implements") {
        // The ticket implements a spec — find files that implement that spec
        const specEdges = db.getEdgesTo(edge.target, "implements");
        for (const se of specEdges) {
          if (se.source !== ticketNodeId) {
            const node = db.getNode(se.source);
            if (node?.path) relatedFiles.push(node.path);
          }
        }
      }
    }

    // Find files linked via spec links
    for (const link of specLinks) {
      const specId = `spec:${link}`;
      // Files that reference this spec
      const edges = db.getEdgesTo(specId, "links_to");
      for (const e of edges) {
        const node = db.getNode(e.source);
        if (node?.path) relatedFiles.push(node.path);
      }

      // Files that implement this spec
      const implEdges = db.getEdgesTo(specId, "implements");
      for (const e of implEdges) {
        const node = db.getNode(e.source);
        if (node?.path && !node.id.startsWith("ticket:")) relatedFiles.push(node.path);
      }
    }

    // Find test files that cover the related source files
    const seen = new Set<string>();
    for (const filePath of relatedFiles) {
      const fileId = `file:${filePath}`;
      const testEdges = db.getEdgesTo(fileId, "tests");
      for (const e of testEdges) {
        const node = db.getNode(e.source);
        if (node?.path && !seen.has(node.path)) {
          seen.add(node.path);
          testFiles.push(node.path);
        }
      }
    }

    // Query drift signals scoped to related files
    const driftSignals = queryDriftSignals(db, relatedFiles);

    // Deduplicate related files
    const uniqueRelated = [...new Set(relatedFiles)];

    return {
      relatedFiles: uniqueRelated,
      testFiles,
      driftSignals,
    };
  } finally {
    db.close();
  }
}

/**
 * Query drift signals for the entire project.
 */
export function queryProjectDrift(projectName: string): DriftSignal[] {
  const db = openGraphDb(projectName);
  if (!db) return [];

  try {
    return queryDriftSignals(db);
  } finally {
    db.close();
  }
}

/**
 * Internal: query drift signals, optionally scoped to a set of file paths.
 */
function queryDriftSignals(db: GraphDatabase, scopeFiles?: string[]): DriftSignal[] {
  const signals: DriftSignal[] = [];

  // Specs without test coverage
  const uncoveredSpecs = db.query(`
    SELECT id, title FROM nodes WHERE type = 'spec'
    AND id NOT IN (SELECT target FROM edges WHERE relation = 'asserts')
    AND id NOT IN (SELECT target FROM edges WHERE relation = 'implements' AND source LIKE 'ticket:%')
  `);
  for (const row of uncoveredSpecs.rows) {
    signals.push({
      type: "uncovered_spec",
      id: row[0] as string,
      title: (row[1] as string) ?? undefined,
    });
  }

  // Files without tests (optionally scoped)
  if (scopeFiles && scopeFiles.length > 0) {
    for (const filePath of scopeFiles) {
      const fileId = `file:${filePath}`;
      const testEdges = db.getEdgesTo(fileId, "tests");
      if (testEdges.length === 0) {
        signals.push({
          type: "untested_file",
          id: fileId,
          title: filePath,
        });
      }
    }
  } else {
    const untestedFiles = db.query(`
      SELECT id, path FROM nodes WHERE type = 'file'
      AND path NOT LIKE '%/__init__.py'
      AND path NOT LIKE '%/index.ts'
      AND path NOT LIKE '%.test.%'
      AND path NOT LIKE '%.spec.%'
      AND path NOT LIKE '%__tests__%'
      AND id NOT IN (SELECT target FROM edges WHERE relation = 'tests')
    `);
    for (const row of untestedFiles.rows) {
      signals.push({
        type: "untested_file",
        id: row[0] as string,
        title: (row[1] as string) ?? undefined,
      });
    }
  }

  // New failures (from the most recent run)
  try {
    const latestRun = db.query(
      "SELECT run_id FROM run_summary ORDER BY timestamp DESC LIMIT 1",
    );
    if (latestRun.rows.length > 0) {
      const runId = latestRun.rows[0][0] as string;
      const failures = db.newFailures(runId);
      for (const f of failures) {
        signals.push({
          type: "new_failure",
          id: f.testId,
          title: f.testId.replace(/^test:/, ""),
          detail: f.errorMsg ?? undefined,
        });
      }
    }
  } catch {
    // No run data yet
  }

  // Flaky tests
  try {
    const flaky = db.flakyTests(7);
    for (const f of flaky) {
      signals.push({
        type: "flaky_test",
        id: f.testId,
        title: f.testId.replace(/^test:/, ""),
        detail: `${f.passCount} pass / ${f.failCount} fail in last 7 days`,
      });
    }
  } catch {
    // No run data yet
  }

  return signals;
}

/**
 * Ingest test results from the verification pipeline into the context graph.
 */
export function ingestTestResults(
  projectName: string,
  testOutput: string,
  commitHash: string,
  runId: string,
): void {
  const db = openGraphDb(projectName);
  if (!db) {
    log.info("no graph database for project, skipping test ingestion", { projectName });
    return;
  }

  try {
    // Parse test output to extract individual results
    const { passed, failed, total } = parseVerificationOutput(testOutput);

    const now = new Date().toISOString();
    const summary = {
      runId,
      commitHash,
      timestamp: now,
      framework: "vitest" as const,
      total,
      passed,
      failed,
      skipped: total - passed - failed,
    };

    db.insertRunSummary(summary);
    log.info("ingested test gate results", { projectName, runId, total, passed, failed });
  } finally {
    db.close();
  }
}

/**
 * Get graph stats for a project.
 */
export function getGraphStats(projectName: string): {
  totalNodes: number;
  totalEdges: number;
  byType: Record<string, number>;
  byRelation: Record<string, number>;
  lastBuild?: string;
  lastCommit?: string;
} | null {
  const db = openGraphDb(projectName);
  if (!db) return null;

  try {
    const stats = db.stats();
    const lastBuild = db.getMeta("last_build") ?? undefined;
    const lastCommit = db.getMeta("last_commit") ?? undefined;
    return { ...stats, lastBuild, lastCommit };
  } finally {
    db.close();
  }
}

/**
 * Parse test output from the verification pipeline for summary counts.
 * (Reuses the same patterns as executor.ts parseTestOutput)
 */
function parseVerificationOutput(output: string): { total: number; passed: number; failed: number } {
  // Vitest: "Tests  857 passed (857)" or "Tests  3 failed | 854 passed (857)"
  const vitestMatch = output.match(/Tests\s+(?:(\d+)\s+failed\s+\|\s+)?(\d+)\s+passed\s+\((\d+)\)/);
  if (vitestMatch) {
    return {
      failed: parseInt(vitestMatch[1] ?? "0", 10),
      passed: parseInt(vitestMatch[2], 10),
      total: parseInt(vitestMatch[3], 10),
    };
  }

  // Jest: "Tests:  3 failed, 854 passed, 857 total"
  const jestMatch = output.match(/Tests:\s+(?:(\d+)\s+failed,\s+)?(\d+)\s+passed,\s+(\d+)\s+total/);
  if (jestMatch) {
    return {
      failed: parseInt(jestMatch[1] ?? "0", 10),
      passed: parseInt(jestMatch[2], 10),
      total: parseInt(jestMatch[3], 10),
    };
  }

  return { total: 0, passed: 0, failed: 0 };
}
