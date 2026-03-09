// Append-only JSONL state files separated by concern: decisions, metrics, artifacts

import { appendFile, readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import type {
  DecisionEntry,
  MetricEntry,
  ArtifactEntry,
  DecisionFilter,
  MetricFilter,
  ArtifactFilter,
} from "@opcom/types";
import { stateDir, stateFilePath } from "../config/paths.js";

// --- Writer ---

export interface StateWriter {
  appendDecision(entry: DecisionEntry): Promise<void>;
  appendMetric(entry: MetricEntry): Promise<void>;
  appendArtifact(entry: ArtifactEntry): Promise<void>;
}

export interface StateReader {
  readDecisions(filter?: DecisionFilter): Promise<DecisionEntry[]>;
  readMetrics(filter?: MetricFilter): Promise<MetricEntry[]>;
  readArtifacts(filter?: ArtifactFilter): Promise<ArtifactEntry[]>;
}

/**
 * Append a single JSON line to a JSONL file atomically (per-line).
 * Ensures the parent directory exists before writing.
 */
async function appendJsonl(filePath: string, entry: unknown): Promise<void> {
  await mkdir(dirname(filePath), { recursive: true });
  const line = JSON.stringify(entry) + "\n";
  await appendFile(filePath, line, "utf-8");
}

/**
 * Read all lines from a JSONL file and parse each as JSON.
 * Returns empty array if file does not exist.
 */
async function readJsonl<T>(filePath: string): Promise<T[]> {
  if (!existsSync(filePath)) return [];
  const content = await readFile(filePath, "utf-8");
  const lines = content.split("\n").filter((l) => l.trim().length > 0);
  const results: T[] = [];
  for (const line of lines) {
    try {
      results.push(JSON.parse(line) as T);
    } catch {
      // Skip malformed lines
    }
  }
  return results;
}

/**
 * Apply common filter fields (planId, stepId) to an entry.
 */
function matchesBase(entry: { planId: string; stepId?: string }, filter: { planId?: string; stepId?: string }): boolean {
  if (filter.planId && entry.planId !== filter.planId) return false;
  if (filter.stepId && entry.stepId !== filter.stepId) return false;
  return true;
}

// --- StateStore (combined writer + reader) ---

export class StateStore implements StateWriter, StateReader {
  private basePath: string;

  constructor(basePath?: string) {
    this.basePath = basePath ?? stateDir();
  }

  private filePath(concern: "decisions" | "metrics" | "artifacts"): string {
    if (this.basePath !== stateDir()) {
      // Custom base path (for testing)
      return `${this.basePath}/${concern}.jsonl`;
    }
    return stateFilePath(concern);
  }

  async appendDecision(entry: DecisionEntry): Promise<void> {
    await appendJsonl(this.filePath("decisions"), entry);
  }

  async appendMetric(entry: MetricEntry): Promise<void> {
    await appendJsonl(this.filePath("metrics"), entry);
  }

  async appendArtifact(entry: ArtifactEntry): Promise<void> {
    await appendJsonl(this.filePath("artifacts"), entry);
  }

  async readDecisions(filter?: DecisionFilter): Promise<DecisionEntry[]> {
    const all = await readJsonl<DecisionEntry>(this.filePath("decisions"));
    if (!filter) return all;
    return all.filter((e) => matchesBase(e, filter));
  }

  async readMetrics(filter?: MetricFilter): Promise<MetricEntry[]> {
    const all = await readJsonl<MetricEntry>(this.filePath("metrics"));
    if (!filter) return all;
    return all.filter((e) => {
      if (!matchesBase(e, filter)) return false;
      if (filter.metric && e.metric !== filter.metric) return false;
      return true;
    });
  }

  async readArtifacts(filter?: ArtifactFilter): Promise<ArtifactEntry[]> {
    const all = await readJsonl<ArtifactEntry>(this.filePath("artifacts"));
    if (!filter) return all;
    return all.filter((e) => {
      if (!matchesBase(e, filter)) return false;
      if (filter.type && e.type !== filter.type) return false;
      return true;
    });
  }
}
