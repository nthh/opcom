/**
 * Workspace Engine — cross-project analysis and shared pattern detection.
 *
 * When opcom manages multiple projects, this engine aggregates their
 * individual context graphs to enable:
 * - Cross-project drift analysis (signals ranked across all projects)
 * - Shared pattern detection (same drift pattern across projects)
 * - Workspace-level health dashboard
 * - Cross-project graph linking (project A depends on project B's types)
 */

import type { GraphDatabase } from "./database.js";
import { DriftEngine, type DriftSignal, type DriftOptions, type DriftSignalType } from "./drift.js";

// --- Types ---

/** Reference to a project's graph database. */
export interface ProjectGraphRef {
  projectName: string;
  projectPath: string;
  db: GraphDatabase;
}

/** A drift signal annotated with its source project. */
export interface WorkspaceSignal extends DriftSignal {
  projectName: string;
}

/** A drift pattern that appears across multiple projects. */
export interface SharedPattern {
  /** Unique identifier for the pattern (e.g., "file_no_tests:connector"). */
  patternId: string;
  /** The drift signal type shared across projects. */
  type: DriftSignalType;
  /** Human-readable description of the pattern. */
  description: string;
  /** Projects where this pattern was observed. */
  projects: string[];
  /** Number of signals matching this pattern. */
  signalCount: number;
  /** Suggested action to address the pattern. */
  suggestedAction: string;
}

/** Health summary for a single project. */
export interface ProjectHealth {
  projectName: string;
  totalNodes: number;
  totalEdges: number;
  driftSignalCount: number;
  topDriftType: DriftSignalType | null;
  testHealth: {
    total: number;
    passed: number;
    failed: number;
    flaky: number;
  };
  lastBuild?: string;
}

/** Aggregated health across the entire workspace. */
export interface WorkspaceHealth {
  projects: ProjectHealth[];
  totalSignals: number;
  sharedPatterns: SharedPattern[];
}

/** A cross-project edge linking nodes across different project graphs. */
export interface CrossProjectEdge {
  sourceProject: string;
  sourceNodeId: string;
  targetProject: string;
  targetNodeId: string;
  relation: string;
}

// --- Pattern detection helpers ---

/**
 * Common path segments that indicate a functional category.
 * Used to detect patterns like "all connector files are untested".
 */
const CATEGORY_PATTERNS: Array<{ pattern: RegExp; label: string }> = [
  { pattern: /connectors?\//i, label: "connector" },
  { pattern: /adapters?\//i, label: "adapter" },
  { pattern: /handlers?\//i, label: "handler" },
  { pattern: /middleware\//i, label: "middleware" },
  { pattern: /controllers?\//i, label: "controller" },
  { pattern: /services?\//i, label: "service" },
  { pattern: /utils?\//i, label: "util" },
  { pattern: /helpers?\//i, label: "helper" },
  { pattern: /hooks?\//i, label: "hook" },
  { pattern: /components?\//i, label: "component" },
  { pattern: /routes?\//i, label: "route" },
  { pattern: /models?\//i, label: "model" },
  { pattern: /config\//i, label: "config" },
  { pattern: /plugins?\//i, label: "plugin" },
  { pattern: /parsers?\//i, label: "parser" },
];

const PATTERN_ACTIONS: Record<string, string> = {
  file_no_tests: "Consider creating a shared test template for these files",
  spec_no_tests: "Write assertion tests for these spec sections",
  orphan_code: "Link orphan code to specs or mark as internal utilities",
  churn_untested: "Prioritize test coverage for frequently-changed files",
  coupling_gap: "Add integration tests for tightly-coupled file pairs",
  route_no_test: "Add API endpoint tests using a shared test harness",
  component_no_e2e: "Add e2e tests for interactive components",
};

// --- Engine ---

export class WorkspaceEngine {
  private graphs: ProjectGraphRef[];

  constructor(graphs: ProjectGraphRef[]) {
    this.graphs = graphs;
  }

  /**
   * Aggregate drift signals from all projects into a single ranked list.
   * Each signal is annotated with its source project name.
   */
  async aggregateDrift(options?: DriftOptions): Promise<WorkspaceSignal[]> {
    const allSignals: WorkspaceSignal[] = [];

    for (const ref of this.graphs) {
      const engine = new DriftEngine(ref.db, {
        ...options,
        projectPath: options?.projectPath ?? ref.projectPath,
      });
      const signals = await engine.detect();

      for (const signal of signals) {
        allSignals.push({
          ...signal,
          projectName: ref.projectName,
        });
      }
    }

    // Sort by severity descending
    allSignals.sort((a, b) => b.severity - a.severity);

    return allSignals;
  }

  /**
   * Detect shared patterns — drift signals of the same type affecting
   * similar file categories across multiple projects.
   *
   * A shared pattern requires:
   * 1. The same drift signal type in 2+ projects
   * 2. Signals affecting files in the same functional category (e.g., "connector", "handler")
   */
  detectSharedPatterns(signals: WorkspaceSignal[]): SharedPattern[] {
    // Group signals by (type, category)
    const groups = new Map<string, { type: DriftSignalType; category: string; signals: WorkspaceSignal[] }>();

    for (const signal of signals) {
      const category = categorize(signal.subject.path);
      const key = `${signal.type}:${category}`;

      if (!groups.has(key)) {
        groups.set(key, { type: signal.type, category, signals: [] });
      }
      groups.get(key)!.signals.push(signal);
    }

    // Filter to patterns that span 2+ projects
    const patterns: SharedPattern[] = [];
    for (const [key, group] of groups) {
      const projects = [...new Set(group.signals.map((s) => s.projectName))];
      if (projects.length < 2) continue;

      patterns.push({
        patternId: key,
        type: group.type,
        description: describePattern(group.type, group.category, projects),
        projects,
        signalCount: group.signals.length,
        suggestedAction: PATTERN_ACTIONS[group.type] ?? "Review and address drift signals",
      });
    }

    // Sort by signal count descending
    patterns.sort((a, b) => b.signalCount - a.signalCount);

    return patterns;
  }

  /**
   * Get workspace-level health: per-project stats + shared patterns.
   */
  async getHealth(): Promise<WorkspaceHealth> {
    const projects: ProjectHealth[] = [];
    const allSignals: WorkspaceSignal[] = [];

    for (const ref of this.graphs) {
      const stats = ref.db.stats();
      const engine = new DriftEngine(ref.db, { projectPath: ref.projectPath });
      const signals = await engine.detect();

      // Count drift types
      const typeCounts = new Map<DriftSignalType, number>();
      for (const s of signals) {
        typeCounts.set(s.type, (typeCounts.get(s.type) ?? 0) + 1);
      }

      let topDriftType: DriftSignalType | null = null;
      let topCount = 0;
      for (const [type, count] of typeCounts) {
        if (count > topCount) {
          topDriftType = type;
          topCount = count;
        }
      }

      // Test health from latest run
      const testHealth = getTestHealth(ref.db);

      const lastBuild = ref.db.getMeta("last_build") ?? undefined;

      projects.push({
        projectName: ref.projectName,
        totalNodes: stats.totalNodes,
        totalEdges: stats.totalEdges,
        driftSignalCount: signals.length,
        topDriftType,
        testHealth,
        lastBuild,
      });

      // Collect signals for shared pattern detection
      for (const signal of signals) {
        allSignals.push({ ...signal, projectName: ref.projectName });
      }
    }

    const sharedPatterns = this.detectSharedPatterns(allSignals);

    return {
      projects,
      totalSignals: allSignals.length,
      sharedPatterns,
    };
  }

  /**
   * Detect cross-project edges by finding import references
   * in one project that correspond to files in another project.
   *
   * Scans each project's "imports" edges for external references
   * that match known nodes in other projects' graphs.
   */
  linkProjects(): CrossProjectEdge[] {
    const edges: CrossProjectEdge[] = [];

    // Build an index of all node paths across projects
    const pathIndex = new Map<string, { projectName: string; nodeId: string }[]>();
    for (const ref of this.graphs) {
      const allNodes = ref.db.getNodesByType("file");
      for (const node of allNodes) {
        if (!node.path) continue;
        // Index by the file's basename and relative path
        const entries = pathIndex.get(node.path) ?? [];
        entries.push({ projectName: ref.projectName, nodeId: node.id });
        pathIndex.set(node.path, entries);
      }
    }

    // For each project, look at import edges that reference external paths
    for (const ref of this.graphs) {
      const importEdges = ref.db.query(
        `SELECT source, target, meta FROM edges WHERE relation = 'imports'`,
      );

      for (const row of importEdges.rows) {
        const [source, target, metaStr] = row as [string, string, string | null];
        const meta = metaStr ? tryParseJson(metaStr) : undefined;
        const importPath = meta?.importPath as string | undefined;
        if (!importPath) continue;

        // Check if the import resolves to a file in another project
        for (const [nodePath, entries] of pathIndex) {
          for (const entry of entries) {
            if (entry.projectName === ref.projectName) continue;

            // Match if the import path ends with a segment of the target path
            if (nodePath.endsWith(importPath) || importPath.includes(nodePath)) {
              edges.push({
                sourceProject: ref.projectName,
                sourceNodeId: source,
                targetProject: entry.projectName,
                targetNodeId: entry.nodeId,
                relation: "imports",
              });
            }
          }
        }
      }
    }

    // Deduplicate
    const seen = new Set<string>();
    return edges.filter((e) => {
      const key = `${e.sourceProject}:${e.sourceNodeId}->${e.targetProject}:${e.targetNodeId}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  /** Close all underlying database connections. */
  close(): void {
    for (const ref of this.graphs) {
      ref.db.close();
    }
  }
}

// --- Helpers ---

/** Categorize a file path into a functional category. */
function categorize(path: string): string {
  for (const { pattern, label } of CATEGORY_PATTERNS) {
    if (pattern.test(path)) return label;
  }
  return "other";
}

/** Generate a human-readable description for a shared pattern. */
function describePattern(type: DriftSignalType, category: string, projects: string[]): string {
  const typeLabel = type.replace(/_/g, " ");
  if (category === "other") {
    return `"${typeLabel}" appears across ${projects.length} projects: ${projects.join(", ")}`;
  }
  return `${category} files have "${typeLabel}" across ${projects.length} projects: ${projects.join(", ")}`;
}

/** Extract test health from the latest run summary + flaky test data. */
function getTestHealth(db: GraphDatabase): ProjectHealth["testHealth"] {
  try {
    const latestRun = db.query(
      "SELECT total, passed, failed FROM run_summary ORDER BY timestamp DESC LIMIT 1",
    );
    if (latestRun.rows.length === 0) {
      return { total: 0, passed: 0, failed: 0, flaky: 0 };
    }

    const [total, passed, failed] = latestRun.rows[0] as [number, number, number];
    const flaky = db.flakyTests(30);

    return {
      total,
      passed,
      failed,
      flaky: flaky.length,
    };
  } catch {
    return { total: 0, passed: 0, failed: 0, flaky: 0 };
  }
}

function tryParseJson(str: string): Record<string, unknown> | undefined {
  try {
    return JSON.parse(str);
  } catch {
    return undefined;
  }
}
