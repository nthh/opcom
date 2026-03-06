import { EventStore, loadProject, getTicketDiff } from "@opcom/core";
import type { Changeset } from "@opcom/types";

export async function runDiff(ticketId: string, opts: { session?: string }): Promise<void> {
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

    if (changesets.length === 0) {
      console.error(`  No changesets found for ticket: ${ticketId}`);
      process.exit(1);
    }

    // Use the most recent changeset
    const cs = changesets[changesets.length - 1];

    const project = await loadProject(cs.projectId);
    if (!project) {
      console.error(`  Project '${cs.projectId}' not found.`);
      process.exit(1);
    }

    // Build diff args from commit SHAs
    const diffOpts: { commitSha?: string; commitShas?: string[] } = {};
    if (cs.commitShas.length === 1) {
      diffOpts.commitSha = cs.commitShas[0];
    } else if (cs.commitShas.length > 1) {
      diffOpts.commitShas = cs.commitShas;
    }

    const diff = await getTicketDiff(project.path, diffOpts);

    if (!diff) {
      console.error("  No diff output available.");
      process.exit(1);
    }

    process.stdout.write(diff);
  } finally {
    store.close();
  }
}
