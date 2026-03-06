#!/usr/bin/env node
/**
 * context-graph CLI
 *
 * Usage:
 *   context-graph build [path]              # Full rebuild
 *   context-graph update [path]             # Incremental update
 *   context-graph replay [path] [--since N] # Replay commit history
 *   context-graph stats [path]              # Show stats
 *   context-graph query <sql> [path]        # Run SQL query
 *   context-graph drift [path]              # Detect drift
 *   context-graph search <term> [path]      # Full-text search
 *   context-graph install-hooks [path]      # Install git hooks
 */

import { resolve, basename } from "node:path";
import { writeFileSync, chmodSync, existsSync, readFileSync } from "node:fs";
import { execSync } from "node:child_process";
import { createBuilder, GraphDatabase } from "./index.js";
import { parseTestResults, detectFramework, type Framework } from "./parsers/index.js";
import { DriftEngine, type DriftSignalType, type TestType } from "./core/drift.js";
import { TriageEngine, type LLMProvider, type TriageResult } from "./core/triage.js";

const args = process.argv.slice(2);
const command = args[0];

async function main(): Promise<void> {
  if (!command || command === "--help" || command === "-h") {
    console.log(`
context-graph — Build queryable knowledge graphs of codebases

Commands:
  build [path]                Full rebuild of the context graph
  update [path]               Incremental update from git diff
  replay [path] [--since Nm]  Replay commit history (N = months)
  stats [path]                Show graph statistics
  query <sql> [path]          Run SQL query against the graph
  drift [path] [options]      Detect spec/test/code drift
    --json                    Output as JSON (for LLM consumption)
    --type <type>             Filter by signal type
    --min-severity <N>        Only show signals with severity >= N
    --test-type <unit|e2e|api>  Filter by test type
    --context                 Attach source/spec/test content
  triage [path] [options]     LLM triage of drift signals
    --json                    Output as JSON
    --model <model>           LLM model (default: claude-haiku-4-5-20251001)
    --test-type <type>        Only triage signals of a specific test type
    --max <N>                 Max signals to triage (default: 20)
    --min-severity <N>        Only triage signals with severity >= N
    --stored                  Show previously stored triage results
  search <term> [path]        Full-text search across entities
  ingest <file> [path]        Ingest test results (pytest/vitest/junit)
  churn [path] [--since Nd]   Files ranked by change frequency
  coupling [path] [--min N]   File pairs that co-change together
  risk [path] [--since Nd]    Compound risk score (churn × coverage)
  install-hooks [path]        Install git post-commit/pre-push hooks

[path] defaults to the current directory.
Output: ~/.context/<project>/graph.db
`);
    return;
  }

  switch (command) {
    case "build":
      await cmdBuild();
      break;
    case "update":
      await cmdUpdate();
      break;
    case "replay":
      await cmdReplay();
      break;
    case "stats":
      cmdStats();
      break;
    case "query":
      cmdQuery();
      break;
    case "drift":
      await cmdDrift();
      break;
    case "triage":
      await cmdTriage();
      break;
    case "search":
      cmdSearch();
      break;
    case "ingest":
      cmdIngest();
      break;
    case "churn":
      cmdChurn();
      break;
    case "coupling":
      cmdCoupling();
      break;
    case "risk":
      cmdRisk();
      break;
    case "install-hooks":
      cmdInstallHooks();
      break;
    default:
      console.error(`Unknown command: ${command}`);
      process.exit(1);
  }
}

function getProjectPath(): string {
  // Find path argument (skip flags)
  const pathArg = args.slice(1).find((a) => !a.startsWith("-"));
  return resolve(pathArg ?? ".");
}

function getProjectName(projectPath: string): string {
  return basename(projectPath);
}

async function cmdBuild(): Promise<void> {
  const path = getProjectPath();
  const name = getProjectName(path);
  const builder = createBuilder(name, path);
  await builder.build();
  await builder.close();
}

async function cmdUpdate(): Promise<void> {
  const path = getProjectPath();
  const name = getProjectName(path);
  const builder = createBuilder(name, path);
  await builder.update();
  await builder.close();
}

async function cmdReplay(): Promise<void> {
  const path = getProjectPath();
  const name = getProjectName(path);
  const sinceIdx = args.indexOf("--since");
  const since = sinceIdx >= 0 ? args[sinceIdx + 1] : undefined;

  const builder = createBuilder(name, path);
  await builder.build(); // Build current state first
  await builder.replay(since);
  await builder.close();
}

function cmdStats(): void {
  const path = getProjectPath();
  const name = getProjectName(path);
  const dbPath = resolve(process.env.HOME ?? "~", ".context", name, "graph.db");

  if (!existsSync(dbPath)) {
    console.error(`No graph found at ${dbPath}. Run 'context-graph build' first.`);
    process.exit(1);
  }

  const db = GraphDatabase.open(dbPath);
  const stats = db.stats();

  console.log(`Context Graph: ${dbPath}`);
  console.log(`  Nodes: ${stats.totalNodes}`);
  for (const [type, count] of Object.entries(stats.byType).sort((a, b) => b[1] - a[1])) {
    console.log(`    ${type}: ${count}`);
  }
  console.log(`  Edges: ${stats.totalEdges}`);
  for (const [rel, count] of Object.entries(stats.byRelation).sort((a, b) => b[1] - a[1])) {
    console.log(`    ${rel}: ${count}`);
  }

  const lastBuild = db.getMeta("last_build");
  const lastCommit = db.getMeta("last_commit");
  if (lastBuild) console.log(`  Last build: ${lastBuild}`);
  if (lastCommit) console.log(`  Last commit: ${lastCommit.slice(0, 8)}`);

  db.close();
}

function cmdQuery(): void {
  const sql = args[1];
  if (!sql) {
    console.error("Usage: context-graph query <sql> [path]");
    process.exit(1);
  }

  const path = args[2] ? resolve(args[2]) : resolve(".");
  const name = getProjectName(path);
  const dbPath = resolve(process.env.HOME ?? "~", ".context", name, "graph.db");

  if (!existsSync(dbPath)) {
    console.error(`No graph found at ${dbPath}. Run 'context-graph build' first.`);
    process.exit(1);
  }

  const db = GraphDatabase.open(dbPath);
  try {
    const result = db.query(sql);
    if (result.columns.length > 0) {
      console.log(result.columns.join("\t"));
      console.log(result.columns.map((c) => "-".repeat(c.length)).join("\t"));
    }
    for (const row of result.rows) {
      console.log(row.map((v) => (v != null ? String(v) : "")).join("\t"));
    }
    console.log(`\n(${result.rows.length} rows)`);
  } catch (err) {
    console.error(`Error: ${err instanceof Error ? err.message : err}`);
  }
  db.close();
}

async function cmdDrift(): Promise<void> {
  const path = getProjectPath();
  const name = getProjectName(path);
  const dbPath = resolve(process.env.HOME ?? "~", ".context", name, "graph.db");

  if (!existsSync(dbPath)) {
    console.error(`No graph found at ${dbPath}. Run 'context-graph build' first.`);
    process.exit(1);
  }

  // Parse flags
  const jsonOutput = args.includes("--json");
  const typeIdx = args.indexOf("--type");
  const typeFilter = typeIdx >= 0 ? (args[typeIdx + 1] as DriftSignalType) : undefined;
  const minSevIdx = args.indexOf("--min-severity");
  const minSeverity = minSevIdx >= 0 ? parseFloat(args[minSevIdx + 1]) : undefined;
  const testTypeIdx = args.indexOf("--test-type");
  const testTypeFilter = testTypeIdx >= 0 ? (args[testTypeIdx + 1] as TestType) : undefined;
  const attachContext = args.includes("--context");

  const db = GraphDatabase.open(dbPath);
  const engine = new DriftEngine(db, {
    type: typeFilter,
    testType: testTypeFilter,
    minSeverity,
    attachContext,
    projectPath: path,
  });

  const signals = await engine.detect();

  if (jsonOutput) {
    console.log(JSON.stringify(signals, null, 2));
  } else {
    if (signals.length === 0) {
      console.log("No drift signals detected.");
    } else {
      console.log(`DRIFT SIGNALS (${signals.length})`);
      console.log(`${"severity".padStart(9)}  ${"type".padEnd(20)}  ${"test".padEnd(6)}  ${"action".padEnd(12)}  subject`);
      console.log(`${"--------".padStart(9)}  ${"----".padEnd(20)}  ${"----".padEnd(6)}  ${"------".padEnd(12)}  -------`);

      for (const s of signals) {
        const sev = s.severity.toFixed(2).padStart(9);
        const type = s.type.padEnd(20);
        const test = s.testType.padEnd(6);
        const action = s.action.padEnd(12);
        const subject = s.subject.title ?? s.subject.path ?? s.subject.nodeId;
        console.log(`${sev}  ${type}  ${test}  ${action}  ${subject}`);
      }
    }
    console.log(`\nTotal: ${signals.length} drift signals`);
  }

  db.close();
}

/** LLM provider using the Anthropic API via fetch. */
class AnthropicProvider implements LLMProvider {
  private apiKey: string;

  constructor() {
    const key = process.env.ANTHROPIC_API_KEY;
    if (!key) {
      throw new Error("ANTHROPIC_API_KEY environment variable is required for triage");
    }
    this.apiKey = key;
  }

  async complete(prompt: string, model: string): Promise<string> {
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": this.apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model,
        max_tokens: 4096,
        messages: [{ role: "user", content: prompt }],
      }),
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`Anthropic API error ${response.status}: ${body}`);
    }

    const data = (await response.json()) as { content: Array<{ type: string; text: string }> };
    const textBlock = data.content.find((b) => b.type === "text");
    return textBlock?.text ?? "";
  }
}

async function cmdTriage(): Promise<void> {
  const path = getProjectPath();
  const name = getProjectName(path);
  const dbPath = resolve(process.env.HOME ?? "~", ".context", name, "graph.db");

  if (!existsSync(dbPath)) {
    console.error(`No graph found at ${dbPath}. Run 'context-graph build' first.`);
    process.exit(1);
  }

  const jsonOutput = args.includes("--json");
  const showStored = args.includes("--stored");
  const modelIdx = args.indexOf("--model");
  const model = modelIdx >= 0 ? args[modelIdx + 1] : undefined;
  const testTypeIdx = args.indexOf("--test-type");
  const testTypeFilter = testTypeIdx >= 0 ? (args[testTypeIdx + 1] as TestType) : undefined;
  const maxIdx = args.indexOf("--max");
  const maxSignals = maxIdx >= 0 ? parseInt(args[maxIdx + 1], 10) : undefined;
  const minSevIdx = args.indexOf("--min-severity");
  const minSeverity = minSevIdx >= 0 ? parseFloat(args[minSevIdx + 1]) : undefined;

  const db = GraphDatabase.open(dbPath);

  if (showStored) {
    // Just show stored results, no LLM call
    const engine = new TriageEngine(db, { complete: async () => "" }, {});
    const stored = engine.getStoredResults();
    if (jsonOutput) {
      console.log(JSON.stringify(stored, null, 2));
    } else {
      printTriageResults(stored);
    }
    db.close();
    return;
  }

  // First, detect drift signals with context attached
  const driftEngine = new DriftEngine(db, {
    attachContext: true,
    projectPath: path,
  });
  const signals = await driftEngine.detect();

  if (signals.length === 0) {
    console.log("No drift signals to triage.");
    db.close();
    return;
  }

  const llm = new AnthropicProvider();
  const triageEngine = new TriageEngine(db, llm, {
    model,
    testType: testTypeFilter,
    maxSignals,
    minSeverity,
  });

  const results = await triageEngine.triage(signals);

  if (jsonOutput) {
    console.log(JSON.stringify(results, null, 2));
  } else {
    printTriageResults(results);
  }

  db.close();
}

function printTriageResults(results: TriageResult[]): void {
  if (results.length === 0) {
    console.log("No triage results.");
    return;
  }

  const actionable = results.filter((r) => r.verdict === "actionable");
  const expected = results.filter((r) => r.verdict === "expected");
  const deferred = results.filter((r) => r.verdict === "deferred");
  const duplicate = results.filter((r) => r.verdict === "duplicate");

  console.log(`TRIAGE RESULTS (${results.length} signals)`);
  console.log(`  Actionable: ${actionable.length}  Expected: ${expected.length}  Deferred: ${deferred.length}  Duplicate: ${duplicate.length}`);
  console.log();

  if (actionable.length > 0) {
    console.log("ACTIONABLE:");
    console.log(`${"pri".padEnd(4)}  ${"action".padEnd(12)}  ${"test".padEnd(6)}  ${"signal".padEnd(25)}  reasoning`);
    console.log(`${"---".padEnd(4)}  ${"------".padEnd(12)}  ${"----".padEnd(6)}  ${"------".padEnd(25)}  ---------`);
    for (const r of actionable) {
      console.log(
        `${r.priority.padEnd(4)}  ${r.action.padEnd(12)}  ${r.testHints.testType.padEnd(6)}  ${r.signalType.padEnd(25)}  ${r.reasoning}`,
      );
      if (r.testHints.behaviors.length > 0) {
        for (const b of r.testHints.behaviors) {
          console.log(`      → ${b}`);
        }
      }
      if (r.testHints.userActions && r.testHints.userActions.length > 0) {
        console.log(`      🖱 ${r.testHints.userActions.join(" → ")}`);
      }
      if (r.testHints.apiContract) {
        const c = r.testHints.apiContract;
        console.log(`      🌐 ${c.method} ${c.path} → [${c.expectedStatuses.join(", ")}]`);
      }
    }
  }

  console.log(`\nTotal: ${results.length} signals triaged`);
}

function cmdSearch(): void {
  const term = args[1];
  if (!term) {
    console.error("Usage: context-graph search <term> [path]");
    process.exit(1);
  }

  const path = args[2] ? resolve(args[2]) : resolve(".");
  const name = getProjectName(path);
  const dbPath = resolve(process.env.HOME ?? "~", ".context", name, "graph.db");

  if (!existsSync(dbPath)) {
    console.error(`No graph found at ${dbPath}. Run 'context-graph build' first.`);
    process.exit(1);
  }

  const db = GraphDatabase.open(dbPath);
  const results = db.search(term);

  if (results.length === 0) {
    console.log(`No results for "${term}"`);
  } else {
    console.log(`Results for "${term}" (${results.length}):`);
    for (const node of results) {
      console.log(`  [${node.type}] ${node.title ?? node.id} — ${node.path ?? ""}`);
    }
  }
  db.close();
}

function cmdIngest(): void {
  const file = args[1];
  if (!file) {
    console.error("Usage: context-graph ingest <results-file> [path] [--framework pytest|vitest|jest|junit] [--commit <hash>] [--run-id <id>]");
    process.exit(1);
  }

  const resultsPath = resolve(file);
  if (!existsSync(resultsPath)) {
    console.error(`File not found: ${resultsPath}`);
    process.exit(1);
  }

  // Parse flags
  const frameworkIdx = args.indexOf("--framework");
  const framework = frameworkIdx >= 0 ? (args[frameworkIdx + 1] as Framework) : undefined;
  const commitIdx = args.indexOf("--commit");
  let commitHash = commitIdx >= 0 ? args[commitIdx + 1] : undefined;
  const runIdIdx = args.indexOf("--run-id");
  let runId = runIdIdx >= 0 ? args[runIdIdx + 1] : undefined;

  // Find project path (skip flags and file arg)
  const pathArg = args.slice(2).find((a) => !a.startsWith("-") && args[args.indexOf(a) - 1] !== "--framework" && args[args.indexOf(a) - 1] !== "--commit" && args[args.indexOf(a) - 1] !== "--run-id");
  const path = resolve(pathArg ?? ".");
  const name = getProjectName(path);

  // Auto-detect commit hash from git
  if (!commitHash) {
    try {
      commitHash = execSync("git rev-parse HEAD", { cwd: path, encoding: "utf-8" }).trim();
    } catch {
      commitHash = "unknown";
    }
  }

  // Auto-generate run ID
  const now = new Date().toISOString();
  if (!runId) {
    runId = `${commitHash.slice(0, 8)}-${now.replace(/[:.]/g, "-")}`;
  }

  // Read and parse
  const content = readFileSync(resultsPath, "utf-8");
  const parsed = parseTestResults(content, framework);

  // Open or create database
  const dbPath = resolve(process.env.HOME ?? "~", ".context", name, "graph.db");
  const db = existsSync(dbPath)
    ? GraphDatabase.open(dbPath)
    : new GraphDatabase(name);

  // Fill in commit hash, run ID, and timestamp
  const results = parsed.results.map((r) => ({
    ...r,
    commitHash,
    runId: runId!,
    timestamp: now,
  }));

  const summary = {
    runId: runId!,
    commitHash,
    timestamp: now,
    ...parsed.summary,
  };

  // Ingest
  db.ingestTestRun(results, summary);

  console.log(`Ingested ${results.length} test results from ${parsed.framework}`);
  console.log(`  Run: ${runId}`);
  console.log(`  Commit: ${commitHash.slice(0, 8)}`);
  console.log(`  Passed: ${summary.passed}, Failed: ${summary.failed}, Skipped: ${summary.skipped}`);

  db.close();
}

function cmdChurn(): void {
  const path = getProjectPath();
  const name = getProjectName(path);
  const dbPath = resolve(process.env.HOME ?? "~", ".context", name, "graph.db");

  if (!existsSync(dbPath)) {
    console.error(`No graph found at ${dbPath}. Run 'context-graph build' first.`);
    process.exit(1);
  }

  const sinceIdx = args.indexOf("--since");
  const sinceArg = sinceIdx >= 0 ? args[sinceIdx + 1] : undefined;
  const days = sinceArg ? parseInt(sinceArg, 10) : undefined;

  const db = GraphDatabase.open(dbPath);
  const results = db.churnAnalysis(days);

  if (results.length === 0) {
    console.log("No churn data. Run 'context-graph replay' first.");
  } else {
    console.log(`FILE CHURN${days ? ` (last ${days} days)` : ""}`);
    console.log(`${"changes".padStart(8)}  ${"coverage".padEnd(10)}  file`);
    console.log(`${"-------".padStart(8)}  ${"--------".padEnd(10)}  ----`);
    for (const r of results.slice(0, 50)) {
      const cov = r.hasCoverage ? "tested" : "UNTESTED";
      console.log(`${String(r.changes).padStart(8)}  ${cov.padEnd(10)}  ${r.filePath}`);
    }
    if (results.length > 50) {
      console.log(`  ... and ${results.length - 50} more files`);
    }
    console.log(`\nTotal: ${results.length} files with changes`);
  }

  db.close();
}

function cmdCoupling(): void {
  const path = getProjectPath();
  const name = getProjectName(path);
  const dbPath = resolve(process.env.HOME ?? "~", ".context", name, "graph.db");

  if (!existsSync(dbPath)) {
    console.error(`No graph found at ${dbPath}. Run 'context-graph build' first.`);
    process.exit(1);
  }

  const minIdx = args.indexOf("--min");
  const minArg = minIdx >= 0 ? args[minIdx + 1] : undefined;
  const minCochanges = minArg ? parseInt(minArg, 10) : 3;

  const db = GraphDatabase.open(dbPath);
  const results = db.couplingAnalysis(minCochanges);

  if (results.length === 0) {
    console.log(`No file pairs with >= ${minCochanges} co-changes. Run 'context-graph replay' first.`);
  } else {
    console.log(`FILE COUPLING (min ${minCochanges} co-changes)`);
    console.log(`${"co-changes".padStart(11)}  ${"shared-tests".padEnd(13)}  files`);
    console.log(`${"----------".padStart(11)}  ${"------------".padEnd(13)}  -----`);
    for (const r of results.slice(0, 50)) {
      const shared = r.sharedTests ? "yes" : "NO";
      console.log(`${String(r.cochanges).padStart(11)}  ${shared.padEnd(13)}  ${r.file1} <-> ${r.file2}`);
    }
    if (results.length > 50) {
      console.log(`  ... and ${results.length - 50} more pairs`);
    }
    console.log(`\nTotal: ${results.length} coupled file pairs`);
  }

  db.close();
}

function cmdRisk(): void {
  const path = getProjectPath();
  const name = getProjectName(path);
  const dbPath = resolve(process.env.HOME ?? "~", ".context", name, "graph.db");

  if (!existsSync(dbPath)) {
    console.error(`No graph found at ${dbPath}. Run 'context-graph build' first.`);
    process.exit(1);
  }

  const sinceIdx = args.indexOf("--since");
  const sinceArg = sinceIdx >= 0 ? args[sinceIdx + 1] : undefined;
  const days = sinceArg ? parseInt(sinceArg, 10) : 90;

  const db = GraphDatabase.open(dbPath);
  const results = db.riskScore(days);

  if (results.length === 0) {
    console.log("No risk data. Run 'context-graph replay' first.");
  } else {
    console.log(`RISK SCORE (last ${days} days)`);
    console.log(`${"score".padStart(8)}  ${"changes".padStart(8)}  file`);
    console.log(`${"-----".padStart(8)}  ${"-------".padStart(8)}  ----`);
    for (const r of results.slice(0, 30)) {
      console.log(`${r.riskScore.toFixed(2).padStart(8)}  ${String(r.changes).padStart(8)}  ${r.filePath}`);
    }
    if (results.length > 30) {
      console.log(`  ... and ${results.length - 30} more files`);
    }
    console.log(`\nTotal: ${results.length} files scored`);
  }

  db.close();
}

function cmdInstallHooks(): void {
  const path = getProjectPath();
  const hooksDir = resolve(path, ".git", "hooks");

  if (!existsSync(hooksDir)) {
    console.error(`Not a git repo: ${path}`);
    process.exit(1);
  }

  const postCommit = resolve(hooksDir, "post-commit");
  const prePush = resolve(hooksDir, "pre-push");

  const postCommitScript = `#!/bin/sh
# context-graph: incremental update after commit
npx context-graph update "$(git rev-parse --show-toplevel)" 2>/dev/null &
`;

  const prePushScript = `#!/bin/sh
# context-graph: full rebuild before push
npx context-graph build "$(git rev-parse --show-toplevel)" 2>/dev/null
`;

  writeFileSync(postCommit, postCommitScript);
  chmodSync(postCommit, 0o755);
  writeFileSync(prePush, prePushScript);
  chmodSync(prePush, 0o755);

  console.log(`Installed git hooks in ${hooksDir}/`);
  console.log(`  post-commit: incremental graph update`);
  console.log(`  pre-push: full graph rebuild`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
