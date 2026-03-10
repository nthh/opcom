import { mkdir, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, dirname } from "node:path";
import type {
  ProposedTicket,
  TicketDecomposition,
  DecompositionAssessment,
  WorkItem,
  Plan,
} from "@opcom/types";
import { assessDecomposition } from "../skills/planning.js";
import { computePlan, type TicketSet } from "./planner.js";

/**
 * Write a proposed sub-ticket to disk as a `.tickets/impl/<id>/README.md` file.
 * Creates the directory if it doesn't exist.
 */
export async function writeSubTicket(
  projectPath: string,
  ticket: ProposedTicket,
): Promise<string> {
  const implDir = join(projectPath, ".tickets", "impl");
  const content = formatTicketFile(ticket);

  if (ticket.parent) {
    // Write as sibling .md file in parent's directory (Folia convention)
    // .tickets/impl/<parent>/<sub-ticket-id>.md
    const parentDir = join(implDir, ticket.parent);
    await mkdir(parentDir, { recursive: true });
    const filePath = join(parentDir, `${ticket.id}.md`);
    await writeFile(filePath, content, "utf-8");
    return filePath;
  }

  // No parent — create its own directory (top-level ticket)
  const ticketDir = join(implDir, ticket.id);
  await mkdir(ticketDir, { recursive: true });
  const filePath = join(ticketDir, "README.md");
  await writeFile(filePath, content, "utf-8");
  return filePath;
}

/**
 * Write multiple sub-tickets from a decomposition to disk.
 * Returns the file paths of all created tickets.
 */
export async function writeSubTickets(
  projectPath: string,
  decomposition: TicketDecomposition,
): Promise<string[]> {
  const paths: string[] = [];
  for (const ticket of decomposition.subTickets) {
    // Ensure parent is set
    if (!ticket.parent) {
      ticket.parent = decomposition.parentTicketId;
    }
    const path = await writeSubTicket(projectPath, ticket);
    paths.push(path);
  }
  return paths;
}

/**
 * Format a ProposedTicket as a ticket markdown file with YAML frontmatter.
 */
export function formatTicketFile(ticket: ProposedTicket): string {
  const lines: string[] = [];

  lines.push("---");
  lines.push(`id: ${ticket.id}`);
  lines.push(`title: "${ticket.title.replace(/"/g, '\\"')}"`);
  lines.push("status: open");
  lines.push(`type: ${ticket.type}`);
  lines.push(`priority: ${ticket.priority}`);

  if (ticket.parent) {
    lines.push(`milestone: ${ticket.parent}`);
  }

  if (ticket.deps.length > 0) {
    lines.push("deps:");
    for (const dep of ticket.deps) {
      lines.push(`  - ${dep}`);
    }
  } else {
    lines.push("deps: []");
  }

  lines.push("links: []");
  lines.push("---");
  lines.push("");
  lines.push(`# ${ticket.title}`);
  lines.push("");

  if (ticket.description) {
    lines.push("## Goal");
    lines.push("");
    lines.push(ticket.description);
    lines.push("");
  }

  return lines.join("\n");
}

/**
 * Assess all tickets in scope for decomposition.
 * Returns assessments indicating which tickets need decomposition and why.
 */
export function assessTicketsForDecomposition(
  tickets: WorkItem[],
  specContents?: Map<string, string>,
): DecompositionAssessment[] {
  return tickets
    .filter((t) => t.status === "open" || t.status === "in-progress")
    .map((ticket) => {
      const spec = specContents?.get(ticket.id);
      return assessDecomposition(ticket, spec, tickets);
    });
}

/**
 * Apply a decomposition to a plan: write sub-tickets, then recompute
 * the plan with the new tickets included.
 *
 * Returns the updated plan and the paths of created ticket files.
 */
export async function applyDecomposition(
  plan: Plan,
  decomposition: TicketDecomposition,
  projectPath: string,
  ticketSets: TicketSet[],
): Promise<{ plan: Plan; createdPaths: string[] }> {
  // Write sub-tickets to disk
  const createdPaths = await writeSubTickets(projectPath, decomposition);

  // Build WorkItems from the proposed tickets
  const newWorkItems: WorkItem[] = decomposition.subTickets.map((pt) => ({
    id: pt.id,
    title: pt.title,
    status: "open" as const,
    priority: pt.priority,
    type: pt.type,
    filePath: join(projectPath, ".tickets", "impl", pt.id, "README.md"),
    parent: pt.parent || decomposition.parentTicketId,
    deps: pt.deps,
    links: [],
    tags: {},
  }));

  // Find the project ID for the parent ticket
  const parentStep = plan.steps.find(
    (s) => s.ticketId === decomposition.parentTicketId,
  );
  const projectId = parentStep?.projectId ?? ticketSets[0]?.projectId ?? "unknown";

  // Add new tickets to the appropriate ticket set
  const updatedSets = ticketSets.map((ts) => {
    if (ts.projectId === projectId) {
      return { ...ts, tickets: [...ts.tickets, ...newWorkItems] };
    }
    return ts;
  });

  // Recompute plan with the new tickets
  const updatedPlan = computePlan(
    updatedSets,
    {
      ...plan.scope,
      // Expand scope to include new ticket IDs
      ticketIds: plan.scope.ticketIds
        ? [...plan.scope.ticketIds, ...newWorkItems.map((t) => t.id)]
        : undefined,
    },
    plan.name,
    plan,
    plan.config,
  );

  // Preserve plan metadata
  updatedPlan.id = plan.id;
  updatedPlan.status = plan.status;
  updatedPlan.context = plan.context;
  updatedPlan.createdAt = plan.createdAt;

  return { plan: updatedPlan, createdPaths };
}

/**
 * Check if a ticket has children (is a parent/epic ticket).
 */
export function hasChildren(ticketId: string, allTickets: WorkItem[]): boolean {
  return allTickets.some((t) => t.parent === ticketId);
}

/**
 * Get all child ticket IDs for a parent ticket.
 */
export function getChildTicketIds(
  parentId: string,
  allTickets: WorkItem[],
): string[] {
  return allTickets
    .filter((t) => t.parent === parentId)
    .map((t) => t.id);
}

/**
 * Check if a parent ticket should be considered "done"
 * (all children are closed).
 */
export function isParentComplete(
  parentId: string,
  allTickets: WorkItem[],
): boolean {
  const children = allTickets.filter((t) => t.parent === parentId);
  if (children.length === 0) return false;
  return children.every((c) => c.status === "closed");
}
