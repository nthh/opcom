import type { ProjectConfig, WorkSummary } from "@opcom/types";
import { detectGit } from "../detection/git.js";
import { scanTickets, summarizeWorkItems } from "../detection/tickets.js";

export interface ProjectStatus {
  project: ProjectConfig;
  workSummary: WorkSummary | null;
  gitFresh: ProjectConfig["git"];
}

export async function refreshProjectStatus(project: ProjectConfig): Promise<ProjectStatus> {
  const [gitFresh, tickets] = await Promise.all([
    detectGit(project.path),
    scanTickets(project.path),
  ]);

  return {
    project,
    workSummary: tickets.length > 0 ? summarizeWorkItems(tickets) : null,
    gitFresh,
  };
}
