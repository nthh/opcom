import { EventStore } from "@opcom/core";
import type { ToolUsageStat, SessionStat, DailyActivity } from "@opcom/core";

export async function runAnalytics(subcommand: string, opts: { project?: string; days?: number }): Promise<void> {
  let store: EventStore;
  try {
    store = new EventStore();
  } catch (err) {
    console.error("  Failed to open event store:", String(err));
    process.exit(1);
  }

  try {
    switch (subcommand) {
      case "tools":
        printToolUsage(store.toolUsageStats({ projectId: opts.project }));
        break;
      case "sessions":
        printSessionStats(store.sessionStats({ projectId: opts.project }));
        break;
      case "daily":
        printDailyActivity(store.dailyActivity({ projectId: opts.project, days: opts.days }));
        break;
      default:
        console.error("  Usage: opcom analytics <tools|sessions|daily>");
        console.error("  Options: --project <id>  --days <n>");
        process.exit(1);
    }
  } finally {
    store.close();
  }
}

function printToolUsage(stats: ToolUsageStat[]): void {
  if (stats.length === 0) {
    console.log("\n  No tool usage data yet.\n");
    return;
  }

  console.log("\n  Tool Usage Statistics\n");
  console.log(
    "  " +
    pad("Tool", 25) +
    pad("Count", 8) +
    pad("Success", 10) +
    pad("Failure", 10) +
    pad("Rate", 8),
  );
  console.log("  " + "-".repeat(61));

  for (const s of stats) {
    console.log(
      "  " +
      pad(s.toolName, 25) +
      pad(String(s.count), 8) +
      pad(String(s.successCount), 10) +
      pad(String(s.failureCount), 10) +
      pad((s.successRate * 100).toFixed(0) + "%", 8),
    );
  }
  console.log("");
}

function printSessionStats(stats: SessionStat[]): void {
  if (stats.length === 0) {
    console.log("\n  No session data yet.\n");
    return;
  }

  console.log("\n  Session Statistics\n");
  console.log(
    "  " +
    pad("Session", 12) +
    pad("Backend", 14) +
    pad("State", 10) +
    pad("Duration", 10) +
    pad("Events", 8) +
    pad("Tools", 8),
  );
  console.log("  " + "-".repeat(62));

  for (const s of stats) {
    const dur = s.durationMinutes != null ? s.durationMinutes.toFixed(1) + "m" : "-";
    console.log(
      "  " +
      pad(s.sessionId.slice(0, 10) + "..", 12) +
      pad(s.backend, 14) +
      pad(s.state, 10) +
      pad(dur, 10) +
      pad(String(s.eventCount), 8) +
      pad(String(s.toolCount), 8),
    );
  }
  console.log("");
}

function printDailyActivity(stats: DailyActivity[]): void {
  if (stats.length === 0) {
    console.log("\n  No activity data yet.\n");
    return;
  }

  console.log("\n  Daily Activity\n");
  console.log(
    "  " +
    pad("Date", 14) +
    pad("Sessions", 10) +
    pad("Events", 10) +
    pad("Tools", 10),
  );
  console.log("  " + "-".repeat(44));

  for (const s of stats) {
    console.log(
      "  " +
      pad(s.date, 14) +
      pad(String(s.sessions), 10) +
      pad(String(s.events), 10) +
      pad(String(s.tools), 10),
    );
  }
  console.log("");
}

function pad(s: string, width: number): string {
  return s.length >= width ? s : s + " ".repeat(width - s.length);
}
