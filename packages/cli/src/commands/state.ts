import { StateStore } from "@opcom/core";
import type { DecisionEntry, MetricEntry, ArtifactEntry } from "@opcom/types";

export async function runState(
  subcommand: string,
  opts: { planId?: string; stepId?: string; metric?: string; type?: string },
): Promise<void> {
  const store = new StateStore();

  switch (subcommand) {
    case "decisions": {
      const entries = await store.readDecisions({
        planId: opts.planId,
        stepId: opts.stepId,
      });
      printDecisions(entries);
      break;
    }
    case "metrics": {
      const entries = await store.readMetrics({
        planId: opts.planId,
        stepId: opts.stepId,
        metric: opts.metric,
      });
      printMetrics(entries);
      break;
    }
    case "artifacts": {
      const entries = await store.readArtifacts({
        planId: opts.planId,
        stepId: opts.stepId,
        type: opts.type,
      });
      printArtifacts(entries);
      break;
    }
    default:
      console.error("  Usage: opcom state <decisions|metrics|artifacts>");
      console.error("  Options: --plan <id>  --step <id>  --metric <name>  --type <type>");
      process.exit(1);
  }
}

function printDecisions(entries: DecisionEntry[]): void {
  if (entries.length === 0) {
    console.log("\n  No decisions recorded yet.\n");
    return;
  }

  console.log("\n  Decisions\n");
  for (const e of entries) {
    const step = e.stepId ? ` [${e.stepId}]` : "";
    const conf = e.confidence != null ? ` (${(e.confidence * 100).toFixed(0)}%)` : "";
    console.log(`  ${e.timestamp}  ${e.planId}${step}  ${e.agent}${conf}`);
    console.log(`    ${e.decision}`);
    console.log(`    ${e.rationale}`);
    console.log("");
  }
}

function printMetrics(entries: MetricEntry[]): void {
  if (entries.length === 0) {
    console.log("\n  No metrics recorded yet.\n");
    return;
  }

  console.log("\n  Metrics\n");
  console.log(
    "  " +
    pad("Timestamp", 26) +
    pad("Plan", 16) +
    pad("Step", 20) +
    pad("Metric", 22) +
    pad("Value", 12) +
    "Detail",
  );
  console.log("  " + "-".repeat(100));

  for (const e of entries) {
    console.log(
      "  " +
      pad(e.timestamp, 26) +
      pad(e.planId, 16) +
      pad(e.stepId ?? "-", 20) +
      pad(e.metric, 22) +
      pad(formatValue(e.metric, e.value), 12) +
      (e.detail ?? ""),
    );
  }
  console.log("");
}

function printArtifacts(entries: ArtifactEntry[]): void {
  if (entries.length === 0) {
    console.log("\n  No artifacts recorded yet.\n");
    return;
  }

  console.log("\n  Artifacts\n");
  console.log(
    "  " +
    pad("Timestamp", 26) +
    pad("Plan", 16) +
    pad("Step", 20) +
    pad("Type", 12) +
    pad("Ref", 14) +
    "Path",
  );
  console.log("  " + "-".repeat(92));

  for (const e of entries) {
    console.log(
      "  " +
      pad(e.timestamp, 26) +
      pad(e.planId, 16) +
      pad(e.stepId ?? "-", 20) +
      pad(e.type, 12) +
      pad(e.ref ?? "-", 14) +
      (e.path ?? ""),
    );
  }
  console.log("");
}

function formatValue(metric: string, value: number): string {
  if (metric.endsWith("_ms")) {
    const secs = value / 1000;
    return secs >= 60 ? `${(secs / 60).toFixed(1)}m` : `${secs.toFixed(1)}s`;
  }
  if (metric.includes("rate") || metric === "plan_progress") {
    return `${(value * 100).toFixed(1)}%`;
  }
  return String(value);
}

function pad(s: string, width: number): string {
  return s.length >= width ? s : s + " ".repeat(width - s.length);
}
