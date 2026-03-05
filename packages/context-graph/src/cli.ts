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
import { writeFileSync, chmodSync, existsSync } from "node:fs";
import { createBuilder, GraphDatabase } from "./index.js";

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
  drift [path]                Detect spec/test/code drift
  search <term> [path]        Full-text search across entities
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
      cmdDrift();
      break;
    case "search":
      cmdSearch();
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

function cmdDrift(): void {
  const path = getProjectPath();
  const name = getProjectName(path);
  const dbPath = resolve(process.env.HOME ?? "~", ".context", name, "graph.db");

  if (!existsSync(dbPath)) {
    console.error(`No graph found at ${dbPath}. Run 'context-graph build' first.`);
    process.exit(1);
  }

  const db = GraphDatabase.open(dbPath);

  // Specs without test coverage
  const uncoveredSpecs = db.query(`
    SELECT id, title FROM nodes WHERE type = 'spec'
    AND id NOT IN (SELECT target FROM edges WHERE relation = 'asserts')
    AND id NOT IN (SELECT target FROM edges WHERE relation = 'implements' AND source LIKE 'ticket:%')
  `);

  // Files without tests
  const untestedFiles = db.query(`
    SELECT path FROM nodes WHERE type = 'file'
    AND path NOT LIKE '%/__init__.py'
    AND path NOT LIKE '%/index.ts'
    AND id NOT IN (SELECT target FROM edges WHERE relation = 'tests')
  `);

  if (uncoveredSpecs.rows.length > 0) {
    console.log(`SPECS WITHOUT COVERAGE (${uncoveredSpecs.rows.length})`);
    for (const row of uncoveredSpecs.rows) {
      console.log(`  ${row[1]} (${row[0]})`);
    }
  }

  if (untestedFiles.rows.length > 0) {
    console.log(`\nUNTESTED FILES (${untestedFiles.rows.length})`);
    for (const row of untestedFiles.rows.slice(0, 30)) {
      console.log(`  ${row[0]}`);
    }
    if (untestedFiles.rows.length > 30) {
      console.log(`  ... and ${untestedFiles.rows.length - 30} more`);
    }
  }

  const total = uncoveredSpecs.rows.length + untestedFiles.rows.length;
  console.log(`\nTotal drift signals: ${total}`);
  db.close();
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
