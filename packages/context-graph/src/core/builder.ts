/**
 * GraphBuilder — orchestrates analyzers to build the context graph.
 *
 * Usage:
 *   const builder = new GraphBuilder("folia", "/Users/nathan/projects/folia");
 *   builder.register(new TypeScriptImportAnalyzer());
 *   builder.register(new MarkdownSpecAnalyzer());
 *   await builder.build();        // full rebuild
 *   await builder.update();       // incremental from git diff
 *   await builder.replay(since);  // replay commit history
 */

import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, relative } from "node:path";
import { execSync } from "node:child_process";
import { GraphDatabase } from "./database.js";
import type { Analyzer, AnalyzerContext } from "./analyzer.js";
import { minimatch } from "../util/minimatch.js";

export class GraphBuilder {
  private analyzers: Analyzer[] = [];
  private db: GraphDatabase;
  private projectPath: string;
  private projectName: string;
  private fileCache: string[] | null = null;

  constructor(projectName: string, projectPath: string, contextDir?: string) {
    this.projectName = projectName;
    this.projectPath = projectPath;
    this.db = new GraphDatabase(projectName, contextDir);
  }

  register(analyzer: Analyzer): this {
    this.analyzers.push(analyzer);
    return this;
  }

  getDb(): GraphDatabase {
    return this.db;
  }

  /** Full rebuild: clear and re-analyze everything. */
  async build(): Promise<{ nodes: number; edges: number; elapsed: number }> {
    const start = Date.now();
    this.db.clear();

    const ctx = await this.createContext();
    const applicable = this.analyzers.filter((a) => a.detect(ctx));

    console.log(`Building context graph for ${this.projectName}...`);
    console.log(`  ${applicable.length}/${this.analyzers.length} analyzers applicable`);

    for (const analyzer of applicable) {
      const result = await analyzer.analyze(ctx);
      this.db.upsertNodes(result.nodes);
      this.db.upsertEdges(result.edges);

      const stats = this.db.stats();
      console.log(`  ${analyzer.name}: ${stats.totalNodes} nodes, ${stats.totalEdges} edges`);
    }

    // Record build metadata
    const commit = this.gitCommand("rev-parse HEAD").trim();
    this.db.setMeta("last_commit", commit);
    this.db.setMeta("last_build", new Date().toISOString());
    this.db.setMeta("project_path", this.projectPath);

    const stats = this.db.stats();
    const elapsed = Date.now() - start;
    console.log(`\nDone in ${(elapsed / 1000).toFixed(1)}s`);
    console.log(`  Nodes: ${stats.totalNodes}`);
    console.log(`  Edges: ${stats.totalEdges}`);
    console.log(`  DB: ${this.db.dbPath}`);

    return { nodes: stats.totalNodes, edges: stats.totalEdges, elapsed };
  }

  /** Incremental update: only process changed files since last build. */
  async update(): Promise<{ changed: number }> {
    const lastCommit = this.db.getMeta("last_commit");
    if (!lastCommit) {
      console.log("No previous build. Running full build.");
      await this.build();
      return { changed: -1 };
    }

    const diff = this.gitCommand(`diff --name-only ${lastCommit} HEAD`).trim();
    const changed = diff ? diff.split("\n").filter(Boolean) : [];

    // Also check unstaged changes
    const unstaged = this.gitCommand("diff --name-only HEAD").trim();
    if (unstaged) {
      for (const f of unstaged.split("\n").filter(Boolean)) {
        if (!changed.includes(f)) changed.push(f);
      }
    }

    if (changed.length === 0) {
      console.log("No changes. Graph is up to date.");
      return { changed: 0 };
    }

    console.log(`Updating ${changed.length} changed file(s)...`);

    // Remove stale nodes for changed files
    for (const f of changed) {
      // Try all possible node ID prefixes
      for (const prefix of ["file:", "test:", "spec:", "adr:", "ticket:", "op:", "benchmark:", "use_case:", "dataset:", "config:"]) {
        this.db.deleteNode(`${prefix}${f}`);
      }
    }

    // Re-run all analyzers (they use upsert, so this is safe)
    const ctx = await this.createContext();
    const applicable = this.analyzers.filter((a) => a.detect(ctx));
    for (const analyzer of applicable) {
      const result = await analyzer.analyze(ctx);
      this.db.upsertNodes(result.nodes);
      this.db.upsertEdges(result.edges);
    }

    const commit = this.gitCommand("rev-parse HEAD").trim();
    this.db.setMeta("last_commit", commit);
    this.db.setMeta("last_build", new Date().toISOString());

    const stats = this.db.stats();
    console.log(`  Updated. ${stats.totalNodes} nodes, ${stats.totalEdges} edges.`);

    return { changed: changed.length };
  }

  /**
   * Replay commit history to build temporal data.
   *
   * Walks git log and records:
   * - commit_log: hash, timestamp, author, message, stats
   * - file_history: which files changed in each commit
   *
   * This enables queries like:
   * - "Which files change most often?" (churn)
   * - "Which files change together?" (coupling)
   * - "When was this file last modified?"
   * - "What's the velocity of ticket closures?"
   */
  async replay(since?: string): Promise<{ commits: number }> {
    const sinceArg = since ? `--since="${since}"` : "";
    const log = this.gitCommand(
      `log --format="%H|%aI|%an|%s" --numstat ${sinceArg}`,
    );

    let currentCommit: { hash: string; timestamp: string; author: string; message: string } | null = null;
    let files = 0;
    let insertions = 0;
    let deletions = 0;
    let commitCount = 0;

    const lines = log.split("\n");

    for (const line of lines) {
      // Commit header line: hash|timestamp|author|message
      const headerMatch = line.match(/^([0-9a-f]{40})\|(.+?)\|(.+?)\|(.+)$/);
      if (headerMatch) {
        // Flush previous commit
        if (currentCommit) {
          this.db.insertCommit(
            currentCommit.hash,
            currentCommit.timestamp,
            currentCommit.author,
            currentCommit.message,
            { files, insertions, deletions },
          );
          commitCount++;
        }

        currentCommit = {
          hash: headerMatch[1],
          timestamp: headerMatch[2],
          author: headerMatch[3],
          message: headerMatch[4],
        };
        files = 0;
        insertions = 0;
        deletions = 0;
        continue;
      }

      // Numstat line: insertions\tdeletions\tfilepath
      const statMatch = line.match(/^(\d+|-)\t(\d+|-)\t(.+)$/);
      if (statMatch && currentCommit) {
        const ins = statMatch[1] === "-" ? 0 : parseInt(statMatch[1], 10);
        const del = statMatch[2] === "-" ? 0 : parseInt(statMatch[2], 10);
        const filePath = statMatch[3];
        insertions += ins;
        deletions += del;
        files++;

        // Detect renames (format: old => new)
        const renameMatch = filePath.match(/^(.+?)\{(.+?) => (.+?)\}(.*)$/);
        if (renameMatch) {
          const prefix = renameMatch[1];
          const oldSuffix = renameMatch[2];
          const newSuffix = renameMatch[3];
          const suffix = renameMatch[4];
          const oldPath = `${prefix}${oldSuffix}${suffix}`;
          const newPath = `${prefix}${newSuffix}${suffix}`;
          this.db.insertFileHistory(newPath, currentCommit.hash, "renamed", oldPath);
        } else {
          this.db.insertFileHistory(filePath, currentCommit.hash, "modified");
        }
      }
    }

    // Flush last commit
    if (currentCommit) {
      this.db.insertCommit(
        currentCommit.hash,
        currentCommit.timestamp,
        currentCommit.author,
        currentCommit.message,
        { files, insertions, deletions },
      );
      commitCount++;
    }

    this.db.setMeta("replay_since", since ?? "all");
    this.db.setMeta("replay_commits", String(commitCount));

    console.log(`Replayed ${commitCount} commits.`);
    return { commits: commitCount };
  }

  close(): void {
    this.db.close();
  }

  // --- Internal ---

  private async createContext(): Promise<AnalyzerContext> {
    if (!this.fileCache) {
      this.fileCache = this.listFiles();
    }

    const projectPath = this.projectPath;
    const files = this.fileCache;

    return {
      projectPath,
      projectName: this.projectName,
      files,
      readFile: async (relativePath: string) => {
        const fullPath = join(projectPath, relativePath);
        return readFile(fullPath, "utf-8");
      },
      fileExists: (relativePath: string) => {
        return existsSync(join(projectPath, relativePath));
      },
      glob: (pattern: string) => {
        return files.filter((f) => minimatch(f, pattern));
      },
    };
  }

  private listFiles(): string[] {
    // Use git ls-files for tracked files (respects .gitignore)
    try {
      const output = this.gitCommand("ls-files");
      return output.trim().split("\n").filter(Boolean);
    } catch {
      // Fallback: walk directory (much slower)
      return [];
    }
  }

  private gitCommand(cmd: string): string {
    return execSync(`git ${cmd}`, {
      cwd: this.projectPath,
      encoding: "utf-8",
      maxBuffer: 50 * 1024 * 1024, // 50MB for large repos
    });
  }
}
