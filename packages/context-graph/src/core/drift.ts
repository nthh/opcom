/**
 * Composite Drift Detection Engine.
 *
 * Scans the context graph for drift signals — gaps between specs, code,
 * and tests. Each signal is scored by severity combining base weight,
 * churn, spec importance, and recency.
 */

import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { existsSync } from "node:fs";
import type { GraphDatabase } from "./database.js";
import type { GraphNode } from "./schema.js";

// --- Types ---

export type DriftSignalType =
  // Phase 1 (existing)
  | "spec_no_tests"
  | "file_no_tests"
  | "orphan_code"
  | "ticket_no_spec"
  // Phase 2 (test quality)
  | "test_regression"
  | "flaky_test"
  | "stale_assertion"
  | "coupling_gap"
  | "churn_untested"
  // UI behavior
  | "ui_spec_no_e2e"
  | "component_no_e2e"
  // API contract
  | "api_spec_no_test"
  | "route_no_test";

export type TestType = "unit" | "integration" | "e2e" | "api";
export type DriftAction = "write_test" | "update_test" | "fix_test" | "update_spec" | "ignore";

export interface DriftSignal {
  id: string;
  type: DriftSignalType;
  severity: number;
  testType: TestType;
  action: DriftAction;
  subject: {
    nodeId: string;
    path: string;
    title?: string;
  };
  context: {
    specContent?: string;
    sourceCode?: string;
    testCode?: string;
    scoringReason: string;
  };
}

export interface DriftOptions {
  type?: DriftSignalType;
  testType?: TestType;
  minSeverity?: number;
  attachContext?: boolean;
  projectPath?: string;
}

// --- Constants ---

const BASE_SEVERITY: Record<DriftSignalType, number> = {
  test_regression: 1.0,
  flaky_test: 0.8,
  api_spec_no_test: 0.7,
  ui_spec_no_e2e: 0.7,
  spec_no_tests: 0.6,
  churn_untested: 0.5,
  stale_assertion: 0.5,
  coupling_gap: 0.4,
  file_no_tests: 0.3,
  ticket_no_spec: 0.3,
  component_no_e2e: 0.3,
  route_no_test: 0.3,
  orphan_code: 0.2,
};

const UI_KEYWORDS = [
  "click", "button", "form", "modal", "dialog", "navigate",
  "page", "tab", "toggle", "dropdown", "select", "input",
  "checkbox", "drag", "hover", "tooltip", "sidebar", "panel",
];

const UI_HEADING_KEYWORDS = ["ui", "interface", "interaction", "user flow", "workbench"];

const COMPONENT_EXTENSIONS = [".tsx", ".vue", ".svelte"];

const INTERACTION_HANDLERS = [
  "onClick", "onSubmit", "onChange", "onKeyDown", "onKeyUp",
  "onMouseDown", "onMouseUp", "onFocus", "onBlur",
  "@click", "@submit", "v-on:", "on:click", "on:submit",
];

const API_HTTP_METHODS = ["GET", "POST", "PUT", "DELETE", "PATCH"];

const API_URL_PATTERNS = ["/api/", "/v1/", "/v2/", "endpoint"];

const API_STATUS_CODES = ["200", "201", "400", "401", "403", "404", "409", "422", "500"];

const ROUTE_PATTERNS = [
  "@app.get", "@app.post", "@app.put", "@app.delete", "@app.patch",
  "@router.get", "@router.post", "@router.put", "@router.delete",
  "@app.route",
  ".get(", ".post(", ".put(", ".delete(", ".patch(",
  "app.route(",
];

const ROUTE_PATH_PATTERNS = ["routes/", "api/", "handlers/", "endpoints/"];

// --- Engine ---

export class DriftEngine {
  constructor(
    private db: GraphDatabase,
    private options: DriftOptions = {},
  ) {}

  async detect(): Promise<DriftSignal[]> {
    const signals: DriftSignal[] = [];

    // Run all detectors
    signals.push(...this.detectSpecNoTests());
    signals.push(...this.detectFileNoTests());
    signals.push(...this.detectOrphanCode());
    signals.push(...this.detectTicketNoSpec());
    signals.push(...this.detectTestRegression());
    signals.push(...this.detectFlakyTests());
    signals.push(...this.detectStaleAssertions());
    signals.push(...this.detectCouplingGaps());
    signals.push(...this.detectChurnUntested());
    signals.push(...this.detectUiSpecNoE2e());
    signals.push(...this.detectComponentNoE2e());
    signals.push(...this.detectApiSpecNoTest());
    signals.push(...this.detectRouteNoTest());

    // Score all signals
    for (const signal of signals) {
      signal.severity = this.scoreSeverity(signal);
    }

    // Sort by severity descending
    signals.sort((a, b) => b.severity - a.severity);

    // Apply filters
    let filtered = signals;
    if (this.options.type) {
      filtered = filtered.filter((s) => s.type === this.options.type);
    }
    if (this.options.testType) {
      filtered = filtered.filter((s) => s.testType === this.options.testType);
    }
    if (this.options.minSeverity != null) {
      filtered = filtered.filter((s) => s.severity >= this.options.minSeverity!);
    }

    // Attach context if requested
    if (this.options.attachContext && this.options.projectPath) {
      await this.attachContext(filtered);
    }

    return filtered;
  }

  // --- Detectors ---

  private detectSpecNoTests(): DriftSignal[] {
    const rows = this.db.query(`
      SELECT n.id, n.title, n.path, n.meta FROM nodes n
      WHERE n.type = 'spec'
        AND n.id NOT IN (SELECT target FROM edges WHERE relation = 'asserts')
    `);

    return rows.rows.map((row) => {
      const [id, title, path, meta] = row as [string, string | null, string | null, string | null];
      const specContent = meta ? tryParseJson(meta) : undefined;

      // Check if this spec mentions UI or API behavior
      const content = (title ?? "") + " " + (specContent?.content ?? "");
      let testType: TestType = "unit";
      if (hasUiBehavior(content, title ?? "")) testType = "e2e";
      else if (hasApiBehavior(content)) testType = "api";

      return this.makeSignal("spec_no_tests", id, path ?? "", title ?? undefined, "write_test", testType);
    });
  }

  private detectFileNoTests(): DriftSignal[] {
    const rows = this.db.query(`
      SELECT n.id, n.path, n.title FROM nodes n
      WHERE n.type = 'file'
        AND n.path NOT LIKE '%/__init__.py'
        AND n.path NOT LIKE '%/index.ts'
        AND n.path NOT LIKE '%.test.%'
        AND n.path NOT LIKE '%.spec.%'
        AND n.path NOT LIKE '%_test.%'
        AND n.path NOT LIKE '%test_%'
        AND n.id NOT IN (SELECT target FROM edges WHERE relation = 'tests')
    `);

    return rows.rows.map((row) => {
      const [id, path, title] = row as [string, string | null, string | null];
      return this.makeSignal("file_no_tests", id, path ?? "", title ?? undefined, "write_test", "unit");
    });
  }

  private detectOrphanCode(): DriftSignal[] {
    const rows = this.db.query(`
      SELECT n.id, n.path, n.title FROM nodes n
      WHERE n.type = 'file'
        AND n.path NOT LIKE '%.test.%'
        AND n.path NOT LIKE '%.spec.%'
        AND n.path NOT LIKE '%_test.%'
        AND n.id NOT IN (SELECT source FROM edges WHERE relation = 'implements')
        AND n.id NOT IN (SELECT target FROM edges WHERE relation = 'implements')
    `);

    return rows.rows.map((row) => {
      const [id, path, title] = row as [string, string | null, string | null];
      return this.makeSignal("orphan_code", id, path ?? "", title ?? undefined, "update_spec", "unit");
    });
  }

  private detectTicketNoSpec(): DriftSignal[] {
    const rows = this.db.query(`
      SELECT n.id, n.title, n.path FROM nodes n
      WHERE n.type = 'ticket'
        AND n.id NOT IN (SELECT source FROM edges WHERE relation = 'links_to')
        AND n.id NOT IN (SELECT source FROM edges WHERE relation = 'implements')
    `);

    return rows.rows.map((row) => {
      const [id, title, path] = row as [string, string | null, string | null];
      return this.makeSignal("ticket_no_spec", id, path ?? "", title ?? undefined, "update_spec", "unit");
    });
  }

  private detectTestRegression(): DriftSignal[] {
    // Find the latest run
    const latestRun = this.db.query(`
      SELECT run_id FROM run_summary ORDER BY timestamp DESC LIMIT 1
    `);
    if (latestRun.rows.length === 0) return [];

    const runId = latestRun.rows[0][0] as string;
    const failures = this.db.newFailures(runId);

    return failures.map((f) => {
      const node = this.db.getNode(f.testId);
      return this.makeSignal(
        "test_regression",
        f.testId,
        node?.path ?? "",
        node?.title ?? f.testId,
        "fix_test",
        "unit",
        f.errorMsg ? `Regression: ${f.errorMsg}` : undefined,
      );
    });
  }

  private detectFlakyTests(): DriftSignal[] {
    const flaky = this.db.flakyTests(30);

    return flaky.map((f) => {
      const node = this.db.getNode(f.testId);
      return this.makeSignal(
        "flaky_test",
        f.testId,
        node?.path ?? "",
        node?.title ?? f.testId,
        "fix_test",
        "unit",
        `Flaky: ${f.passCount} passes, ${f.failCount} failures in last 30 days`,
      );
    });
  }

  private detectStaleAssertions(): DriftSignal[] {
    // Tests where the asserted spec was modified after the test was last seen
    const rows = this.db.query(`
      SELECT e.source as test_id, e.target as spec_id,
             n_test.last_seen as test_last_seen,
             n_spec.last_seen as spec_last_seen,
             n_test.path as test_path, n_test.title as test_title,
             n_spec.title as spec_title
      FROM edges e
      JOIN nodes n_test ON n_test.id = e.source
      JOIN nodes n_spec ON n_spec.id = e.target
      WHERE e.relation = 'asserts'
        AND n_spec.last_seen > n_test.last_seen
    `);

    return rows.rows.map((row) => {
      const [testId, specId, , , testPath, testTitle, specTitle] = row as string[];
      return this.makeSignal(
        "stale_assertion",
        testId,
        testPath ?? "",
        testTitle ?? testId,
        "update_test",
        "unit",
        `Spec "${specTitle}" was modified after test was last updated`,
      );
    });
  }

  private detectCouplingGaps(): DriftSignal[] {
    const coupling = this.db.couplingAnalysis(3);
    return coupling
      .filter((c) => !c.sharedTests)
      .map((c) => {
        return this.makeSignal(
          "coupling_gap",
          `file:${c.file1}`,
          c.file1,
          `${c.file1} <-> ${c.file2}`,
          "write_test",
          "integration",
          `${c.cochanges} co-changes without shared tests`,
        );
      });
  }

  private detectChurnUntested(): DriftSignal[] {
    const churn = this.db.churnAnalysis(90);
    return churn
      .filter((c) => !c.hasCoverage && c.changes >= 3)
      .map((c) => {
        return this.makeSignal(
          "churn_untested",
          `file:${c.filePath}`,
          c.filePath,
          c.filePath,
          "write_test",
          "unit",
          `${c.changes} changes in last 90 days with no test coverage`,
        );
      });
  }

  private detectUiSpecNoE2e(): DriftSignal[] {
    // Spec nodes that mention UI behavior but have no e2e test coverage
    const specs = this.db.getNodesByType("spec");
    const signals: DriftSignal[] = [];

    for (const spec of specs) {
      const content = (spec.title ?? "") + " " + (spec.meta?.content ?? "");
      if (!hasUiBehavior(content, spec.title ?? "")) continue;

      // Check if any test with e2e-like name asserts this spec
      const edges = this.db.getEdgesTo(spec.id, "asserts");
      const hasE2e = edges.some((e) => {
        const testNode = this.db.getNode(e.source);
        return testNode && isE2eTest(testNode);
      });

      if (!hasE2e) {
        signals.push(
          this.makeSignal(
            "ui_spec_no_e2e",
            spec.id,
            spec.path ?? "",
            spec.title,
            "write_test",
            "e2e",
            "Spec describes UI behavior but has no e2e test",
          ),
        );
      }
    }

    return signals;
  }

  private detectComponentNoE2e(): DriftSignal[] {
    const files = this.db.getNodesByType("file");
    const signals: DriftSignal[] = [];

    for (const file of files) {
      const path = file.path ?? "";
      if (!COMPONENT_EXTENSIONS.some((ext) => path.endsWith(ext))) continue;

      // Check if it has interaction handlers in metadata
      const hasInteractions = file.meta?.hasInteractions === true;
      if (!hasInteractions) continue;

      // Check if any e2e test covers this component
      const edges = this.db.getEdgesTo(file.id, "tests");
      const hasE2e = edges.some((e) => {
        const testNode = this.db.getNode(e.source);
        return testNode && isE2eTest(testNode);
      });

      if (!hasE2e) {
        signals.push(
          this.makeSignal(
            "component_no_e2e",
            file.id,
            path,
            file.title,
            "write_test",
            "e2e",
            "Component has interaction handlers but no e2e test",
          ),
        );
      }
    }

    return signals;
  }

  private detectApiSpecNoTest(): DriftSignal[] {
    const specs = this.db.getNodesByType("spec");
    const signals: DriftSignal[] = [];

    for (const spec of specs) {
      const content = (spec.title ?? "") + " " + (spec.meta?.content ?? "");
      if (!hasApiBehavior(content)) continue;

      // Check for API tests
      const edges = this.db.getEdgesTo(spec.id, "asserts");
      const hasApiTest = edges.some((e) => {
        const testNode = this.db.getNode(e.source);
        return testNode && isApiTest(testNode);
      });

      if (!hasApiTest) {
        signals.push(
          this.makeSignal(
            "api_spec_no_test",
            spec.id,
            spec.path ?? "",
            spec.title,
            "write_test",
            "api",
            "Spec describes API behavior but has no API test",
          ),
        );
      }
    }

    return signals;
  }

  private detectRouteNoTest(): DriftSignal[] {
    const files = this.db.getNodesByType("file");
    const signals: DriftSignal[] = [];

    for (const file of files) {
      const path = file.path ?? "";
      if (!isRouteFile(path, file.meta)) continue;

      // Check if any test covers this route handler
      const edges = this.db.getEdgesTo(file.id, "tests");
      if (edges.length === 0) {
        signals.push(
          this.makeSignal(
            "route_no_test",
            file.id,
            path,
            file.title,
            "write_test",
            "api",
            "Route handler file has no test coverage",
          ),
        );
      }
    }

    return signals;
  }

  // --- Scoring ---

  private scoreSeverity(signal: DriftSignal): number {
    const base = BASE_SEVERITY[signal.type];

    // Churn multiplier: 1.0 + (changes_last_90d / 10), capped at 3.0
    const churnMultiplier = this.getChurnMultiplier(signal.subject.nodeId, signal.subject.path);

    // Spec importance: 1.0 + (0.1 × edge count)
    const specImportance = this.getSpecImportance(signal.subject.nodeId);

    // Recency multiplier
    const recencyMultiplier = this.getRecencyMultiplier(signal.subject.nodeId);

    const raw = base * churnMultiplier * specImportance * recencyMultiplier;
    return Math.min(1.0, Math.max(0.0, Math.round(raw * 100) / 100));
  }

  private getChurnMultiplier(nodeId: string, path: string): number {
    // Check file_history for changes
    try {
      const result = this.db.query(`
        SELECT COUNT(DISTINCT fh.commit_hash) as changes
        FROM file_history fh
        JOIN commit_log cl ON cl.hash = fh.commit_hash
        WHERE fh.file_path = '${escapeSql(path)}'
          AND cl.timestamp > datetime('now', '-90 days')
      `);
      const changes = (result.rows[0]?.[0] as number) ?? 0;
      return Math.min(3.0, 1.0 + changes / 10);
    } catch {
      return 1.0;
    }
  }

  private getSpecImportance(nodeId: string): number {
    try {
      const fromEdges = this.db.getEdgesFrom(nodeId);
      const toEdges = this.db.getEdgesTo(nodeId);
      const totalEdges = fromEdges.length + toEdges.length;
      return 1.0 + 0.1 * totalEdges;
    } catch {
      return 1.0;
    }
  }

  private getRecencyMultiplier(nodeId: string): number {
    const node = this.db.getNode(nodeId);
    if (!node?.lastSeen) return 1.0;

    const daysSince = (Date.now() - new Date(node.lastSeen).getTime()) / (1000 * 60 * 60 * 24);
    if (daysSince <= 7) return 1.5;
    if (daysSince <= 30) return 1.2;
    return 1.0;
  }

  // --- Context attachment ---

  private async attachContext(signals: DriftSignal[]): Promise<void> {
    const projectPath = this.options.projectPath!;

    for (const signal of signals) {
      // Read source/spec content
      if (signal.subject.path) {
        const fullPath = join(projectPath, signal.subject.path);
        if (existsSync(fullPath)) {
          try {
            const content = await readFile(fullPath, "utf-8");
            if (signal.type.includes("spec") || signal.type === "stale_assertion") {
              signal.context.specContent = truncate(content, 2000);
            } else {
              signal.context.sourceCode = truncate(content, 2000);
            }
          } catch {
            // Ignore read errors
          }
        }
      }

      // Read associated test code
      const testEdges = [
        ...this.db.getEdgesTo(signal.subject.nodeId, "asserts"),
        ...this.db.getEdgesTo(signal.subject.nodeId, "tests"),
      ];
      for (const edge of testEdges) {
        const testNode = this.db.getNode(edge.source);
        if (testNode?.path) {
          const testPath = join(projectPath, testNode.path);
          if (existsSync(testPath)) {
            try {
              signal.context.testCode = truncate(await readFile(testPath, "utf-8"), 2000);
              break;
            } catch {
              // Ignore
            }
          }
        }
      }
    }
  }

  // --- Helpers ---

  private makeSignal(
    type: DriftSignalType,
    nodeId: string,
    path: string,
    title: string | undefined,
    action: DriftAction,
    testType: TestType,
    extraReason?: string,
  ): DriftSignal {
    const base = BASE_SEVERITY[type];
    return {
      id: `${type}:${nodeId}`,
      type,
      severity: base, // Will be overwritten by scoreSeverity
      testType,
      action,
      subject: { nodeId, path, title },
      context: {
        scoringReason: extraReason ?? `Base severity for ${type}: ${base}`,
      },
    };
  }
}

// --- Heuristic helpers ---

export function hasUiBehavior(content: string, heading: string): boolean {
  const lower = content.toLowerCase();
  const headingLower = heading.toLowerCase();

  // Check heading keywords
  if (UI_HEADING_KEYWORDS.some((k) => headingLower.includes(k))) return true;

  // Check content keywords (need at least 2 matches to reduce false positives)
  const matches = UI_KEYWORDS.filter((k) => lower.includes(k));
  return matches.length >= 2;
}

export function hasApiBehavior(content: string): boolean {
  const upper = content.toUpperCase();
  const lower = content.toLowerCase();

  // Check HTTP methods
  const hasMethod = API_HTTP_METHODS.some((m) => upper.includes(m));
  // Check URL patterns
  const hasUrl = API_URL_PATTERNS.some((p) => lower.includes(p));
  // Check status codes
  const hasStatus = API_STATUS_CODES.some((c) => content.includes(c));

  // Need at least 2 of the 3 indicators
  const score = (hasMethod ? 1 : 0) + (hasUrl ? 1 : 0) + (hasStatus ? 1 : 0);
  return score >= 2;
}

export function hasInteractionHandlers(content: string): boolean {
  return INTERACTION_HANDLERS.some((h) => content.includes(h));
}

export function isRouteFile(path: string, meta?: Record<string, unknown>): boolean {
  // Check path patterns
  if (ROUTE_PATH_PATTERNS.some((p) => path.includes(p))) return true;

  // Check meta for route indicators
  if (meta?.hasRoutes === true) return true;

  return false;
}

function isE2eTest(node: GraphNode): boolean {
  const id = node.id.toLowerCase();
  const title = (node.title ?? "").toLowerCase();
  const path = (node.path ?? "").toLowerCase();
  return (
    id.includes("e2e") ||
    title.includes("e2e") ||
    path.includes("e2e") ||
    path.includes("playwright") ||
    path.includes("cypress")
  );
}

function isApiTest(node: GraphNode): boolean {
  const id = node.id.toLowerCase();
  const title = (node.title ?? "").toLowerCase();
  const path = (node.path ?? "").toLowerCase();
  return (
    id.includes("api") ||
    title.includes("api") ||
    path.includes("api") ||
    id.includes("endpoint") ||
    title.includes("endpoint")
  );
}

function escapeSql(str: string): string {
  return str.replace(/'/g, "''");
}

function truncate(content: string, maxLen: number): string {
  if (content.length <= maxLen) return content;
  return content.slice(0, maxLen) + "\n... (truncated)";
}

function tryParseJson(str: string): Record<string, unknown> | undefined {
  try {
    return JSON.parse(str);
  } catch {
    return undefined;
  }
}
