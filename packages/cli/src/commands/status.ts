import {
  loadGlobalConfig,
  loadWorkspace,
  loadProject,
  refreshProjectStatus,
  scanTickets,
  SessionManager,
} from "@opcom/core";
import type { ProjectStatus } from "@opcom/core";
import type { WorkItem } from "@opcom/types";
import { formatStatusDashboard } from "../ui/format.js";

export interface StatusOptions {
  projectFilter?: string;
}

export async function runStatus(opts: StatusOptions = {}): Promise<void> {
  const global = await loadGlobalConfig();
  const workspace = await loadWorkspace(global.defaultWorkspace);

  if (!workspace) {
    console.log("\n  No workspace found. Run 'opcom init' first.\n");
    return;
  }

  const statuses: ProjectStatus[] = [];
  const projectTickets = new Map<string, WorkItem[]>();

  for (const pid of workspace.projectIds) {
    const project = await loadProject(pid);
    if (!project) continue;
    const status = await refreshProjectStatus(project);
    statuses.push(status);

    // Scan full tickets for the work queue
    const tickets = await scanTickets(project.path);
    if (tickets.length > 0) {
      projectTickets.set(pid, tickets);
    }
  }

  // Filter to single project if --project flag provided
  const filteredStatuses = opts.projectFilter
    ? statuses.filter(
        (s) =>
          s.project.name === opts.projectFilter ||
          s.project.id === opts.projectFilter,
      )
    : statuses;

  if (opts.projectFilter && filteredStatuses.length === 0) {
    console.log(`\n  No project found matching '${opts.projectFilter}'.\n`);
    return;
  }

  // Load active agent sessions
  const sm = new SessionManager();
  await sm.init();
  const agents = sm.listSessions();

  console.log("");
  console.log(
    formatStatusDashboard(workspace.name, filteredStatuses, agents, {
      projectTickets,
      projectFilter: opts.projectFilter ?? null,
    }),
  );
  console.log("");
}
