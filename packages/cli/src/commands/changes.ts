import { EventStore } from "@opcom/core";
import type { Changeset } from "@opcom/types";

export async function runChanges(ticketId: string, opts: { session?: string; project?: string }): Promise<void> {
  let store: EventStore;
  try {
    store = new EventStore();
  } catch (err) {
    console.error("  Failed to open event store:", String(err));
    process.exit(1);
  }

  try {
    let changesets: Changeset[];

    if (opts.session) {
      changesets = store.loadChangesets({ sessionId: opts.session });
    } else {
      changesets = store.loadChangesets({ ticketId });
    }

    if (opts.project) {
      changesets = changesets.filter((c) => c.projectId === opts.project);
    }

    if (changesets.length === 0) {
      console.log(`\n  No changesets found for ticket: ${ticketId}\n`);
      return;
    }

    console.log(`\n  Changes for ticket: ${ticketId}\n`);

    for (const cs of changesets) {
      console.log(
        `  ${pad("Session:", 10)} ${cs.sessionId.slice(0, 10)}..  ` +
        `${pad("Time:", 6)} ${cs.timestamp}  ` +
        `Commits: ${cs.commitShas.length}`,
      );
      console.log("");
      console.log(
        "  " +
        pad("Path", 40) +
        pad("Status", 12) +
        pad("+Ins", 8) +
        pad("-Del", 8),
      );
      console.log("  " + "-".repeat(68));

      for (const f of cs.files) {
        const display = f.status === "renamed" && f.oldPath
          ? `${f.oldPath} → ${f.path}`
          : f.path;
        console.log(
          "  " +
          pad(display, 40) +
          pad(f.status, 12) +
          pad(`+${f.insertions}`, 8) +
          pad(`-${f.deletions}`, 8),
        );
      }

      console.log("");
      console.log(
        `  Total: ${cs.files.length} file${cs.files.length === 1 ? "" : "s"}, ` +
        `+${cs.totalInsertions} insertions, -${cs.totalDeletions} deletions`,
      );
      console.log("");
    }
  } finally {
    store.close();
  }
}

function pad(s: string, width: number): string {
  return s.length >= width ? s : s + " ".repeat(width - s.length);
}
