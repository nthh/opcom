/**
 * Analyzer interface — the extension point for language/framework-specific analysis.
 *
 * Each analyzer knows how to extract nodes and edges from a specific type of file
 * or project structure. Analyzers are registered with the GraphBuilder, which
 * calls them during build.
 *
 * Inspired by Cloud Native Buildpacks: each analyzer "detects" whether it applies,
 * then "analyzes" the relevant files.
 */

import type { GraphNode, GraphEdge } from "./schema.js";

export interface AnalyzerContext {
  /** Absolute path to project root. */
  projectPath: string;
  /** Project name (basename of path). */
  projectName: string;
  /** All files in the project (relative paths). */
  files: string[];
  /** Read a file's content. Throws if file doesn't exist. */
  readFile(relativePath: string): Promise<string>;
  /** Check if a file exists. */
  fileExists(relativePath: string): boolean;
  /** Get files matching a glob pattern. */
  glob(pattern: string): string[];
}

export interface AnalyzerResult {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

export interface Analyzer {
  /** Unique name for this analyzer. */
  name: string;

  /**
   * Detection: does this analyzer apply to this project?
   * Should be fast — check for marker files, not parse content.
   */
  detect(ctx: AnalyzerContext): boolean;

  /**
   * Analysis: extract nodes and edges from the project.
   * Called only if detect() returned true.
   */
  analyze(ctx: AnalyzerContext): Promise<AnalyzerResult>;
}

/**
 * Built-in analyzer names. Custom analyzers can use any string.
 */
export const BUILTIN_ANALYZERS = [
  "typescript-imports",
  "python-imports",
  "go-imports",
  "rust-imports",
  "test-mapping",
  "markdown-specs",
  "markdown-adrs",
  "tickets",
  "git-history",
] as const;
