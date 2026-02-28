import type { WorkItem, ProjectConfig } from "@opcom/types";
import { scanTickets } from "../detection/tickets.js";
import { detectGit } from "../detection/git.js";

export interface TriageInput {
  projects: Array<{
    name: string;
    tickets: WorkItem[];
    agentCount: number;
    lastCommitAge: number;
  }>;
}

export interface TriageRecommendation {
  action: string;
  project: string;
  ticketId?: string;
  priority: number;
  reasoning: string;
}

export async function collectTriageSignals(
  projects: ProjectConfig[],
): Promise<TriageInput> {
  const result: TriageInput = { projects: [] };

  for (const project of projects) {
    const tickets = project.workSystem ? await scanTickets(project.path) : [];
    const git = await detectGit(project.path);

    let lastCommitAge = Infinity;
    if (git?.lastCommitAt) {
      const commitDate = new Date(git.lastCommitAt);
      lastCommitAge = (Date.now() - commitDate.getTime()) / (1000 * 60 * 60);
    }

    result.projects.push({
      name: project.name,
      tickets,
      agentCount: 0, // Caller can augment with actual agent count
      lastCommitAge: Math.round(lastCommitAge),
    });
  }

  return result;
}

/**
 * Filter out tickets that are blocked by unresolved dependencies.
 */
export function filterBlockedTickets(
  tickets: WorkItem[],
  allTickets: WorkItem[],
): WorkItem[] {
  const closedIds = new Set(
    allTickets.filter((t) => t.status === "closed").map((t) => t.id),
  );

  return tickets.filter((ticket) => {
    if (ticket.deps.length === 0) return true;
    // A ticket is blocked if any of its deps are NOT closed
    return ticket.deps.every((dep) => closedIds.has(dep));
  });
}

export function formatTriagePrompt(input: TriageInput): string {
  const sections: string[] = [];

  sections.push("Analyze the following workspace state and recommend the top 3-5 actions to take next.");
  sections.push("Consider ticket priorities, dependency chains, project staleness, and agent capacity.");
  sections.push("Do NOT recommend blocked tickets (tickets whose dependencies are still open).");
  sections.push("");
  sections.push("# Workspace State");

  for (const project of input.projects) {
    sections.push("");
    sections.push(`## Project: ${project.name}`);
    sections.push(`- Active agents: ${project.agentCount}`);
    sections.push(`- Hours since last commit: ${project.lastCommitAge === Infinity ? "unknown" : project.lastCommitAge}`);

    // Determine which tickets are blocked
    const allTickets = project.tickets;
    const openTickets = allTickets.filter(
      (t) => t.status === "open" || t.status === "in-progress",
    );
    const unblockedTickets = filterBlockedTickets(openTickets, allTickets);
    const blockedTickets = openTickets.filter(
      (t) => !unblockedTickets.includes(t),
    );

    if (unblockedTickets.length > 0) {
      sections.push("");
      sections.push("### Available Tickets");
      for (const t of unblockedTickets) {
        const depsNote = t.deps.length > 0 ? ` (deps: ${t.deps.join(", ")})` : "";
        sections.push(`- [P${t.priority}] ${t.id}: "${t.title}" (${t.status})${depsNote}`);
      }
    }

    if (blockedTickets.length > 0) {
      sections.push("");
      sections.push("### Blocked Tickets (DO NOT recommend these)");
      for (const t of blockedTickets) {
        sections.push(`- ${t.id}: "${t.title}" blocked by: ${t.deps.join(", ")}`);
      }
    }
  }

  sections.push("");
  sections.push("# Instructions");
  sections.push("");
  sections.push("Respond with a numbered list of 3-5 recommendations. For each:");
  sections.push("");
  sections.push("1. **Action**: What to do");
  sections.push("   - **Project**: Which project");
  sections.push("   - **Ticket**: Which ticket ID (if applicable)");
  sections.push("   - **Priority**: 1 (highest) to 5 (lowest)");
  sections.push("   - **Reasoning**: Why this action, in one sentence");

  return sections.join("\n");
}

export function parseTriageResponse(response: string): TriageRecommendation[] {
  const recommendations: TriageRecommendation[] = [];

  // Parse numbered items like "1. **Action**: ..."
  const itemPattern = /\d+\.\s+\*?\*?Action\*?\*?:\s*(.+)/gi;
  const projectPattern = /\*?\*?Project\*?\*?:\s*(.+)/gi;
  const ticketPattern = /\*?\*?Ticket\*?\*?:\s*(.+)/gi;
  const priorityPattern = /\*?\*?Priority\*?\*?:\s*(\d+)/gi;
  const reasoningPattern = /\*?\*?Reasoning\*?\*?:\s*(.+)/gi;

  // Split by numbered items
  const blocks = response.split(/(?=\d+\.\s+\*?\*?Action\*?\*?:)/i);

  for (const block of blocks) {
    const actionMatch = itemPattern.exec(block);
    if (!actionMatch) continue;

    const projectMatch = projectPattern.exec(block);
    const ticketMatch = ticketPattern.exec(block);
    const priorityMatch = priorityPattern.exec(block);
    const reasoningMatch = reasoningPattern.exec(block);

    const ticketRaw = ticketMatch?.[1]?.trim();
    const ticketId =
      ticketRaw && ticketRaw.toLowerCase() !== "n/a" && ticketRaw !== "-"
        ? ticketRaw
        : undefined;

    recommendations.push({
      action: actionMatch[1].trim(),
      project: projectMatch?.[1]?.trim() ?? "unknown",
      ticketId,
      priority: priorityMatch ? parseInt(priorityMatch[1], 10) : 3,
      reasoning: reasoningMatch?.[1]?.trim() ?? "",
    });

    // Reset regex lastIndex
    itemPattern.lastIndex = 0;
    projectPattern.lastIndex = 0;
    ticketPattern.lastIndex = 0;
    priorityPattern.lastIndex = 0;
    reasoningPattern.lastIndex = 0;
  }

  return recommendations;
}

export async function generateTriage(
  input: TriageInput,
  llmCall: (prompt: string) => Promise<string>,
): Promise<TriageRecommendation[]> {
  const prompt = formatTriagePrompt(input);
  const response = await llmCall(prompt);
  return parseTriageResponse(response);
}
