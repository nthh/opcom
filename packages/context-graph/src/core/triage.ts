/**
 * LLM Drift Triage Agent.
 *
 * Triages drift signals using an LLM to classify whether gaps are real
 * (actionable) or expected, and produces structured test hints for
 * test generation.
 */

import type { GraphDatabase } from "./database.js";
import type { DriftSignal, DriftSignalType, DriftAction, TestType } from "./drift.js";

// --- Types ---

export interface TriageResult {
  signalId: string;
  signalType: DriftSignalType;
  verdict: "actionable" | "expected" | "deferred" | "duplicate";
  action: DriftAction;
  priority: "P1" | "P2" | "P3";
  reasoning: string;
  testHints: {
    testType: TestType;
    behaviors: string[];
    targetPath: string;
    framework: string;
    userActions?: string[];
    apiContract?: {
      method: string;
      path: string;
      expectedStatuses: number[];
    };
  };
}

export interface TriageOptions {
  model?: string;
  testType?: TestType;
  maxSignals?: number;
  minSeverity?: number;
}

/** Abstraction for the LLM call, enabling mocked tests. */
export interface LLMProvider {
  complete(prompt: string, model: string): Promise<string>;
}

/** Raw LLM response shape for a single signal triage. */
interface LLMTriageResponse {
  verdict: TriageResult["verdict"];
  action: DriftAction;
  priority: "P1" | "P2" | "P3";
  reasoning: string;
  testHints: {
    testType: TestType;
    behaviors: string[];
    targetPath: string;
    framework: string;
    userActions?: string[];
    apiContract?: {
      method: string;
      path: string;
      expectedStatuses: number[];
    };
  };
}

// --- Pre-filter rules (skip LLM for obviously expected files) ---

const EXPECTED_FILE_PATTERNS = [
  /__init__\.py$/,
  /conftest\.py$/,
  /types\.ts$/,
  /types\.py$/,
  /\.d\.ts$/,
  /index\.ts$/,
  /index\.js$/,
  /\.config\.(ts|js|mjs|cjs)$/,
  /migrations?\//,
  /\.generated\./,
  /\.gen\./,
  /package\.json$/,
  /tsconfig\.json$/,
  /\.lock$/,
  /\.yaml$/,
  /\.yml$/,
  /\.env/,
];

function isExpectedUntested(path: string): boolean {
  return EXPECTED_FILE_PATTERNS.some((p) => p.test(path));
}

// --- Prompt building ---

function buildBatchPrompt(signals: DriftSignal[]): string {
  const signalBlocks = signals.map((signal, i) => {
    let block = `### Signal ${i + 1}
ID: ${signal.id}
Type: ${signal.type}
Severity: ${signal.severity}
Test Type Hint: ${signal.testType}
Action Hint: ${signal.action}
Subject: ${signal.subject.path || signal.subject.nodeId}`;

    if (signal.subject.title) {
      block += `\nTitle: ${signal.subject.title}`;
    }
    if (signal.context.specContent) {
      block += `\n\nSpec Content:\n${signal.context.specContent}`;
    }
    if (signal.context.sourceCode) {
      block += `\n\nSource Code:\n${signal.context.sourceCode}`;
    }
    if (signal.context.testCode) {
      block += `\n\nExisting Tests:\n${signal.context.testCode}`;
    }
    if (signal.context.scoringReason) {
      block += `\nScoring: ${signal.context.scoringReason}`;
    }
    return block;
  });

  return `You are triaging test coverage drift signals for a software project.

For each signal, determine:
1. Is this gap real (actionable) or expected (e.g., __init__.py, config files, type-only files)?
2. What kind of test would close this gap?
3. What specifically should the test verify?

## Classification Rules
- \`__init__.py\`, \`conftest.py\`, \`types.py\`, pure type files → verdict: expected
- Config files, migrations, generated code → verdict: expected
- UI spec with no e2e test but existing unit test that covers the logic → verdict: deferred (unit test sufficient for now)
- API endpoint with existing integration test → verdict: expected (already covered)
- Same file flagged by multiple signals → mark duplicates, keep highest severity
- Test regressions and flaky tests → verdict: actionable, priority P1
- High-churn untested files → verdict: actionable
- Orphan code with no spec linkage and low churn → verdict: deferred

## Priority Rules
- P1: Test regressions, flaky tests, API endpoints without tests, high-severity (>= 0.7)
- P2: Specs without tests, UI behavior without e2e, churn-untested files
- P3: Low-severity gaps, orphan code, coupling gaps

## Signals

${signalBlocks.join("\n\n---\n\n")}

## Response Format

Respond with a JSON array of objects, one per signal in the same order. Each object must have:
\`\`\`json
{
  "verdict": "actionable" | "expected" | "deferred" | "duplicate",
  "action": "write_test" | "update_test" | "fix_test" | "update_spec" | "ignore",
  "priority": "P1" | "P2" | "P3",
  "reasoning": "one sentence explaining why",
  "testHints": {
    "testType": "unit" | "integration" | "e2e" | "api",
    "behaviors": ["specific behavior 1", "specific behavior 2"],
    "targetPath": "tests/test_foo.py",
    "framework": "pytest | vitest | jest | playwright | cypress",
    "userActions": ["click save button", "verify toast appears"],
    "apiContract": { "method": "POST", "path": "/api/items", "expectedStatuses": [201, 409, 422] }
  }
}
\`\`\`

For e2e signals, always include \`userActions\`.
For api signals, always include \`apiContract\`.
Omit \`userActions\` and \`apiContract\` when not applicable.

Return ONLY the JSON array, no other text.`;
}

// --- Response parsing ---

function parseTriageResponse(raw: string, signals: DriftSignal[]): TriageResult[] {
  // Extract JSON from the response (handle markdown code blocks)
  let jsonStr = raw.trim();
  const fenceMatch = jsonStr.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenceMatch) {
    jsonStr = fenceMatch[1].trim();
  }

  let parsed: LLMTriageResponse[];
  try {
    parsed = JSON.parse(jsonStr);
  } catch {
    throw new Error(`Failed to parse triage response as JSON: ${jsonStr.slice(0, 200)}`);
  }

  if (!Array.isArray(parsed)) {
    throw new Error("Triage response is not an array");
  }

  // Map each parsed response back to its signal
  const results: TriageResult[] = [];
  for (let i = 0; i < Math.min(parsed.length, signals.length); i++) {
    const r = parsed[i];
    const signal = signals[i];

    results.push({
      signalId: signal.id,
      signalType: signal.type,
      verdict: validateVerdict(r.verdict),
      action: validateAction(r.action),
      priority: validatePriority(r.priority),
      reasoning: r.reasoning ?? "No reasoning provided",
      testHints: {
        testType: validateTestType(r.testHints?.testType ?? signal.testType),
        behaviors: Array.isArray(r.testHints?.behaviors) ? r.testHints.behaviors : [],
        targetPath: r.testHints?.targetPath ?? "",
        framework: r.testHints?.framework ?? "vitest",
        userActions: r.testHints?.userActions,
        apiContract: r.testHints?.apiContract,
      },
    });
  }

  return results;
}

function validateVerdict(v: string): TriageResult["verdict"] {
  const valid = ["actionable", "expected", "deferred", "duplicate"];
  return valid.includes(v) ? (v as TriageResult["verdict"]) : "actionable";
}

function validateAction(a: string): DriftAction {
  const valid = ["write_test", "update_test", "fix_test", "update_spec", "ignore"];
  return valid.includes(a) ? (a as DriftAction) : "write_test";
}

function validatePriority(p: string): "P1" | "P2" | "P3" {
  const valid = ["P1", "P2", "P3"];
  return valid.includes(p) ? (p as "P1" | "P2" | "P3") : "P2";
}

function validateTestType(t: string): TestType {
  const valid = ["unit", "integration", "e2e", "api"];
  return valid.includes(t) ? (t as TestType) : "unit";
}

// --- Triage history (SQLite storage) ---

export const TRIAGE_SCHEMA = `
CREATE TABLE IF NOT EXISTS triage_results (
    signal_id   TEXT PRIMARY KEY,
    signal_type TEXT NOT NULL,
    verdict     TEXT NOT NULL,
    action      TEXT NOT NULL,
    priority    TEXT NOT NULL,
    reasoning   TEXT,
    test_hints  TEXT,
    triaged_at  TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_triage_verdict ON triage_results(verdict);
CREATE INDEX IF NOT EXISTS idx_triage_priority ON triage_results(priority);
`;

function storeTriageResults(db: GraphDatabase, results: TriageResult[]): void {
  const now = new Date().toISOString();
  for (const r of results) {
    db.exec(
      `INSERT OR REPLACE INTO triage_results (signal_id, signal_type, verdict, action, priority, reasoning, test_hints, triaged_at)
       VALUES ('${esc(r.signalId)}', '${esc(r.signalType)}', '${esc(r.verdict)}', '${esc(r.action)}', '${esc(r.priority)}', '${esc(r.reasoning)}', '${esc(JSON.stringify(r.testHints))}', '${esc(now)}')`,
    );
  }
}

function getAlreadyTriaged(db: GraphDatabase): Set<string> {
  try {
    const result = db.query("SELECT signal_id FROM triage_results");
    return new Set(result.rows.map((r) => r[0] as string));
  } catch {
    // Table may not exist yet
    return new Set();
  }
}

function esc(s: string): string {
  return s.replace(/'/g, "''");
}

// --- Engine ---

export class TriageEngine {
  constructor(
    private db: GraphDatabase,
    private llm: LLMProvider,
    private options: TriageOptions = {},
  ) {}

  /**
   * Triage drift signals. Returns only new results (skips already-triaged).
   * Pre-filters obviously expected files before calling the LLM.
   */
  async triage(signals: DriftSignal[]): Promise<TriageResult[]> {
    // Ensure triage_results table exists
    this.ensureSchema();

    // Filter by options
    let filtered = signals;
    if (this.options.testType) {
      filtered = filtered.filter((s) => s.testType === this.options.testType);
    }
    if (this.options.minSeverity != null) {
      filtered = filtered.filter((s) => s.severity >= this.options.minSeverity!);
    }

    // Skip already-triaged signals
    const triaged = getAlreadyTriaged(this.db);
    filtered = filtered.filter((s) => !triaged.has(s.id));

    // Cap the number of signals to triage
    const maxSignals = this.options.maxSignals ?? 20;
    filtered = filtered.slice(0, maxSignals);

    if (filtered.length === 0) {
      return [];
    }

    // Phase 1: Pre-filter obviously expected files (no LLM needed)
    const preFilterResults: TriageResult[] = [];
    const llmSignals: DriftSignal[] = [];

    for (const signal of filtered) {
      const path = signal.subject.path;
      if (path && isExpectedUntested(path)) {
        preFilterResults.push({
          signalId: signal.id,
          signalType: signal.type,
          verdict: "expected",
          action: "ignore",
          priority: "P3",
          reasoning: `File matches expected-untested pattern: ${path}`,
          testHints: {
            testType: signal.testType,
            behaviors: [],
            targetPath: "",
            framework: "vitest",
          },
        });
      } else {
        llmSignals.push(signal);
      }
    }

    // Phase 2: LLM triage for remaining signals
    let llmResults: TriageResult[] = [];
    if (llmSignals.length > 0) {
      const prompt = buildBatchPrompt(llmSignals);
      const model = this.options.model ?? "claude-haiku-4-5-20251001";
      const response = await this.llm.complete(prompt, model);
      llmResults = parseTriageResponse(response, llmSignals);
    }

    // Phase 3: Deduplicate — if multiple signals target the same file, mark lower-severity as duplicate
    const allResults = [...preFilterResults, ...llmResults];
    deduplicateByFile(allResults, filtered);

    // Store results
    storeTriageResults(this.db, allResults);

    return allResults;
  }

  /** Load previously stored triage results. */
  getStoredResults(): TriageResult[] {
    this.ensureSchema();
    try {
      const result = this.db.query(
        "SELECT signal_id, signal_type, verdict, action, priority, reasoning, test_hints FROM triage_results ORDER BY priority ASC",
      );
      return result.rows.map((row) => ({
        signalId: row[0] as string,
        signalType: row[1] as DriftSignalType,
        verdict: row[2] as TriageResult["verdict"],
        action: row[3] as DriftAction,
        priority: row[4] as "P1" | "P2" | "P3",
        reasoning: row[5] as string,
        testHints: JSON.parse((row[6] as string) || "{}"),
      }));
    } catch {
      return [];
    }
  }

  private ensureSchema(): void {
    try {
      this.db.query("SELECT 1 FROM triage_results LIMIT 1");
    } catch {
      // Table doesn't exist — create it
      this.db.exec(
        `CREATE TABLE IF NOT EXISTS triage_results (
          signal_id   TEXT PRIMARY KEY,
          signal_type TEXT NOT NULL,
          verdict     TEXT NOT NULL,
          action      TEXT NOT NULL,
          priority    TEXT NOT NULL,
          reasoning   TEXT,
          test_hints  TEXT,
          triaged_at  TEXT NOT NULL
        )`,
      );
      this.db.exec("CREATE INDEX IF NOT EXISTS idx_triage_verdict ON triage_results(verdict)");
      this.db.exec("CREATE INDEX IF NOT EXISTS idx_triage_priority ON triage_results(priority)");
    }
  }
}

/** Mark signals targeting the same file as duplicates, keeping the highest-severity one. */
function deduplicateByFile(results: TriageResult[], signals: DriftSignal[]): void {
  const signalMap = new Map(signals.map((s) => [s.id, s]));
  const fileMap = new Map<string, { result: TriageResult; severity: number }>();

  for (const result of results) {
    if (result.verdict === "expected") continue; // Don't deduplicate expected

    const signal = signalMap.get(result.signalId);
    if (!signal) continue;

    const path = signal.subject.path;
    if (!path) continue;

    const existing = fileMap.get(path);
    if (existing) {
      // Keep the higher-severity one, mark the other as duplicate
      if (signal.severity > existing.severity) {
        existing.result.verdict = "duplicate";
        existing.result.reasoning = `Duplicate of higher-severity signal for ${path}`;
        fileMap.set(path, { result, severity: signal.severity });
      } else {
        result.verdict = "duplicate";
        result.reasoning = `Duplicate of higher-severity signal for ${path}`;
      }
    } else {
      fileMap.set(path, { result, severity: signal.severity });
    }
  }
}

// --- Exported utilities ---

export { buildBatchPrompt, parseTriageResponse, isExpectedUntested };
