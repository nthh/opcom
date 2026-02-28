import {
  loadGlobalConfig,
  loadWorkspace,
  loadProject,
  refreshProjectStatus,
  SessionManager,
} from "@opcom/core";
import type { ProjectStatus } from "@opcom/core";
import { formatStatusDashboard } from "../ui/format.js";

export async function runStatus(): Promise<void> {
  const global = await loadGlobalConfig();
  const workspace = await loadWorkspace(global.defaultWorkspace);

  if (!workspace) {
    console.log("\n  No workspace found. Run 'opcom init' first.\n");
    return;
  }

  const statuses: ProjectStatus[] = [];

  for (const pid of workspace.projectIds) {
    const project = await loadProject(pid);
    if (!project) continue;
    const status = await refreshProjectStatus(project);
    statuses.push(status);
  }

  // Load active agent sessions
  const sm = new SessionManager();
  await sm.init();
  const agents = sm.listSessions();

  console.log("");
  console.log(formatStatusDashboard(workspace.name, statuses, agents));
  console.log("");
}
