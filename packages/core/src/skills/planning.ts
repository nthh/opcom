import type {
  WorkItem,
  PlanningInput,
  PlanningProposal,
  ProposedTicket,
  TicketDecomposition,
  DecompositionAssessment,
  PlanScope,
} from "@opcom/types";

// --- Decomposition Assessment ---

const SPEC_LINE_THRESHOLD = 200;

/**
 * Assess whether a ticket needs decomposition before agent execution.
 * Uses heuristic criteria from the spec:
 *   1. Multiple providers (e.g., "R2 adapter, GCS adapter")
 *   2. Types + implementation + tests all non-trivial
 *   3. TUI + backend in same ticket
 *   4. Linked spec >200 lines
 */
export function assessDecomposition(
  ticket: WorkItem,
  specContent?: string,
  allTickets?: WorkItem[],
): DecompositionAssessment {
  const criteria: string[] = [];

  // Criterion 1: Multiple providers mentioned in title or description
  const providerKeywords = [
    "adapters", "providers", "backends",
    "r2", "gcs", "s3",
    "turso", "neon", "planetscale", "supabase",
    "cloudflare", "firebase", "vercel", "netlify",
    "workers", "functions",
  ];
  const titleLower = ticket.title.toLowerCase();
  const matchedProviders = providerKeywords.filter((kw) => titleLower.includes(kw));
  if (matchedProviders.length >= 2) {
    criteria.push("multiple-providers");
  }

  // Criterion 2: Types + implementation + tests scope
  const scopeKeywords = ["type", "implement", "test", "adapter", "integration"];
  const scopeMatches = scopeKeywords.filter((kw) => titleLower.includes(kw));
  if (scopeMatches.length >= 2) {
    criteria.push("types-impl-tests");
  }

  // Criterion 3: TUI + backend
  const hasTui = titleLower.includes("tui") || titleLower.includes("dashboard") || titleLower.includes("ui");
  const hasBackend = titleLower.includes("backend") || titleLower.includes("api") || titleLower.includes("server") || titleLower.includes("core");
  if (hasTui && hasBackend) {
    criteria.push("tui-plus-backend");
  }

  // Criterion 4: Spec complexity
  if (specContent) {
    const lineCount = specContent.split("\n").length;
    if (lineCount > SPEC_LINE_THRESHOLD) {
      criteria.push("complex-spec");
    }
  }

  // Criterion 5: Has children already → already decomposed
  if (allTickets) {
    const hasChildren = allTickets.some((t) => t.parent === ticket.id);
    if (hasChildren) {
      // Already decomposed, no need
      return {
        ticketId: ticket.id,
        needsDecomposition: false,
        reason: "Already has sub-tickets",
        criteria: [],
      };
    }
  }

  const needsDecomposition = criteria.length > 0;
  const reason = needsDecomposition
    ? `Matches decomposition criteria: ${criteria.join(", ")}`
    : "Ticket appears agent-sized";

  return {
    ticketId: ticket.id,
    needsDecomposition,
    reason,
    criteria,
  };
}

// --- Planning Prompt ---

export function formatPlanningPrompt(input: PlanningInput): string {
  const sections: string[] = [];

  sections.push("You are a planning agent for opcom, a developer workspace manager.");
  sections.push("Analyze the workspace state and produce an execution plan.");
  sections.push("");
  sections.push("# User Request");
  sections.push(input.userPrompt);
  sections.push("");

  // Current projects + tickets
  sections.push("# Workspace State");

  for (const project of input.projects) {
    sections.push("");
    sections.push(`## Project: ${project.name} (${project.projectId})`);

    const langs = project.stack.languages.map((l) => l.name + (l.version ? ` ${l.version}` : "")).join(", ");
    if (langs) sections.push(`Stack: ${langs}`);

    const frameworks = project.stack.frameworks.map((f) => f.name).join(", ");
    if (frameworks) sections.push(`Frameworks: ${frameworks}`);

    if (project.cloudServices && project.cloudServices.length > 0) {
      const services = project.cloudServices.map((cs) => cs.provider).join(", ");
      sections.push(`Cloud services: ${services}`);
    }

    sections.push(`Tickets: ${project.ticketCount} total`);

    const openTickets = project.tickets.filter(
      (t) => t.status === "open" || t.status === "in-progress",
    );
    const closedTickets = project.tickets.filter((t) => t.status === "closed");

    if (openTickets.length > 0) {
      sections.push("");
      sections.push("### Open Tickets");
      for (const t of openTickets) {
        const deps = t.deps.length > 0 ? ` deps:[${t.deps.join(",")}]` : "";
        const parent = t.parent ? ` parent:${t.parent}` : "";
        const role = t.role ? ` role:${t.role}` : "";
        sections.push(`- [P${t.priority}] ${t.id}: "${t.title}" (${t.status}${deps}${parent}${role})`);
      }
    }

    if (closedTickets.length > 0) {
      sections.push("");
      sections.push("### Recently Closed");
      for (const t of closedTickets.slice(0, 10)) {
        sections.push(`- ${t.id}: "${t.title}" (closed)`);
      }
    }
  }

  // Current plan
  if (input.currentPlan) {
    const plan = input.currentPlan;
    sections.push("");
    sections.push("# Current Plan");
    sections.push(`Name: ${plan.name} (${plan.status})`);
    sections.push(`Steps: ${plan.steps.length}`);

    const done = plan.steps.filter((s) => s.status === "done").length;
    const failed = plan.steps.filter((s) => s.status === "failed").length;
    const inProgress = plan.steps.filter((s) => s.status === "in-progress").length;
    const ready = plan.steps.filter((s) => s.status === "ready").length;
    const blocked = plan.steps.filter((s) => s.status === "blocked").length;

    sections.push(`Progress: ${done} done, ${inProgress} in-progress, ${ready} ready, ${blocked} blocked, ${failed} failed`);
    sections.push("");

    for (const step of plan.steps) {
      const deps = step.blockedBy.length > 0 ? ` after:[${step.blockedBy.join(",")}]` : "";
      const track = step.track ? ` track:${step.track}` : "";
      sections.push(`- ${step.ticketId}: ${step.status}${track}${deps}`);
    }

    if (plan.context) {
      sections.push("");
      sections.push("### Plan Context");
      sections.push(plan.context);
    }
  }

  // Response format
  sections.push("");
  sections.push("# Instructions");
  sections.push("");
  sections.push("Respond with a structured plan proposal. Use these exact section headers:");
  sections.push("");
  sections.push("## Plan Name");
  sections.push("<short descriptive name for the plan>");
  sections.push("");
  sections.push("## Reasoning");
  sections.push("<1-2 paragraphs explaining the overall strategy>");
  sections.push("");
  sections.push("## Scope");
  sections.push("List the ticket IDs to include in this plan, one per line:");
  sections.push("- <ticket-id>");
  sections.push("");
  sections.push("## New Tickets");
  sections.push("If new tickets should be created, describe each:");
  sections.push("");
  sections.push("### <ticket-id>");
  sections.push("- title: <title>");
  sections.push("- type: <feature|bug|chore|refactor>");
  sections.push("- priority: <1-4>");
  sections.push("- deps: [<dep-id>, ...]");
  sections.push("- parent: <parent-id> (if decomposing a larger ticket)");
  sections.push("- description: <brief description>");
  sections.push("");
  sections.push("## Decompositions");
  sections.push("If any existing tickets should be decomposed, list them:");
  sections.push("");
  sections.push("### Decompose: <parent-ticket-id>");
  sections.push("- reason: <why this ticket needs splitting>");
  sections.push("- sub-tickets: <comma-separated list of new ticket IDs proposed above>");
  sections.push("");
  sections.push("## Execution Order");
  sections.push("List ticket IDs in suggested execution order (one per line):");
  sections.push("- <ticket-id>");
  sections.push("");
  sections.push("If no new tickets or decompositions are needed, omit those sections.");

  return sections.join("\n");
}

// --- Decomposition Prompt ---

export function formatDecompositionPrompt(
  ticket: WorkItem,
  specContent: string | undefined,
  allTickets: WorkItem[],
): string {
  const sections: string[] = [];

  sections.push("You are a planning agent decomposing a large ticket into agent-sized sub-tickets.");
  sections.push("");
  sections.push("# Ticket to Decompose");
  sections.push(`ID: ${ticket.id}`);
  sections.push(`Title: ${ticket.title}`);
  sections.push(`Type: ${ticket.type}`);
  sections.push(`Priority: P${ticket.priority}`);
  if (ticket.deps.length > 0) {
    sections.push(`Dependencies: ${ticket.deps.join(", ")}`);
  }
  sections.push("");

  if (specContent) {
    sections.push("## Linked Specification");
    sections.push(specContent);
    sections.push("");
  }

  // Show existing tickets for dep awareness
  const related = allTickets.filter(
    (t) => t.id !== ticket.id && (t.status === "open" || t.status === "in-progress"),
  );
  if (related.length > 0) {
    sections.push("## Existing Tickets (for dependency awareness)");
    for (const t of related) {
      sections.push(`- ${t.id}: "${t.title}" (${t.status}, P${t.priority})`);
    }
    sections.push("");
  }

  sections.push("# Decomposition Criteria");
  sections.push("- One ticket per provider (e.g., R2 adapter, GCS adapter)");
  sections.push("- Separate types/interfaces from implementation from tests if each is non-trivial");
  sections.push("- Separate TUI/frontend from backend/core logic");
  sections.push("- Each sub-ticket should be completable by a single agent session");
  sections.push("");

  sections.push("# Parallelism");
  sections.push("Sub-tickets default to parallel (no deps). Only add deps when ordering genuinely matters.");
  sections.push("Think about which sub-tickets touch independent files/subsystems — those can run concurrently.");
  sections.push("Common patterns:");
  sections.push("- Types/interfaces first → implementation depends on types");
  sections.push("- Multiple providers are parallel with each other (both depend on types)");
  sections.push("- Tests depend on the code they test");
  sections.push("- TUI and backend are parallel if they don't share types");
  sections.push("Maximize parallelism — only add deps for genuine data/API dependencies.");
  sections.push("");

  sections.push("# Instructions");
  sections.push("");
  sections.push("Respond with sub-tickets using this format for each:");
  sections.push("");
  sections.push("### <ticket-id>");
  sections.push("- title: <title>");
  sections.push("- type: <feature|bug|chore|refactor>");
  sections.push("- priority: <1-4>");
  sections.push("- deps: [<dep-id>, ...]");
  sections.push("- description: <what this sub-ticket covers>");
  sections.push("");
  sections.push(`All sub-tickets should have parent: ${ticket.id}`);
  sections.push("Ensure sub-ticket deps form a valid DAG (no cycles).");
  sections.push("Use the parent ticket's deps as starting deps for the first sub-ticket(s).");
  sections.push("Only add deps between sub-tickets when one genuinely needs the other's output.");
  sections.push("");
  sections.push("# Task List Deps");
  sections.push("Each sub-ticket should have a ## Tasks section with task lines.");
  sections.push("Tasks default to PARALLEL — all run concurrently in a shared worktree.");
  sections.push("Tasks that build on each other MUST have (deps: <slugified-task-id>) markers.");
  sections.push("Example:");
  sections.push("- [ ] Define types");
  sections.push("- [ ] Implement logic (deps: define-types)");
  sections.push("- [ ] Wire into CLI (deps: implement-logic)");
  sections.push("- [ ] Tests (deps: wire-into-cli)");
  sections.push("Without deps, agents will run all tasks simultaneously and conflict.");

  return sections.join("\n");
}

// --- Response Parsing ---

export function parsePlanningResponse(response: string): PlanningProposal {
  const name = extractSection(response, "Plan Name")?.trim() ?? "untitled-plan";
  const reasoning = extractSection(response, "Reasoning")?.trim() ?? "";

  // Parse scope
  const scopeText = extractSection(response, "Scope") ?? "";
  const scopeIds = extractBulletItems(scopeText);
  const scope: PlanScope = scopeIds.length > 0 ? { ticketIds: scopeIds } : {};

  // Parse new tickets
  const newTicketsText = extractSection(response, "New Tickets") ?? "";
  const newTickets = parseProposedTickets(newTicketsText);

  // Parse decompositions
  const decompositionsText = extractSection(response, "Decompositions") ?? "";
  const decompositions = parseDecompositions(decompositionsText, newTickets);

  // Parse execution order
  const orderText = extractSection(response, "Execution Order") ?? "";
  const ordering = extractBulletItems(orderText);

  return {
    name,
    scope,
    newTickets,
    decompositions,
    ordering,
    reasoning,
  };
}

export function parseDecompositionResponse(
  response: string,
  parentTicketId: string,
): TicketDecomposition {
  const subTickets = parseProposedTickets(response);

  // Ensure all sub-tickets have parent set
  for (const ticket of subTickets) {
    if (!ticket.parent) {
      ticket.parent = parentTicketId;
    }
  }

  return {
    parentTicketId,
    reason: `Decomposed into ${subTickets.length} sub-tickets`,
    subTickets,
  };
}

// --- End-to-End ---

export async function generatePlanningSession(
  input: PlanningInput,
  llmCall: (prompt: string) => Promise<string>,
): Promise<PlanningProposal> {
  const prompt = formatPlanningPrompt(input);
  const response = await llmCall(prompt);
  return parsePlanningResponse(response);
}

export async function generateDecomposition(
  ticket: WorkItem,
  specContent: string | undefined,
  allTickets: WorkItem[],
  llmCall: (prompt: string) => Promise<string>,
): Promise<TicketDecomposition> {
  const prompt = formatDecompositionPrompt(ticket, specContent, allTickets);
  const response = await llmCall(prompt);
  return parseDecompositionResponse(response, ticket.id);
}

// --- Internal Helpers ---

function extractSection(text: string, heading: string): string | null {
  // Match ## Heading (with optional leading whitespace)
  const pattern = new RegExp(
    `^##\\s+${escapeRegExp(heading)}\\s*$`,
    "mi",
  );
  const match = pattern.exec(text);
  if (!match) return null;

  const start = match.index + match[0].length;

  // Find the next ## heading or end of text
  const nextHeading = /^##\s+/m;
  const rest = text.slice(start);
  const nextMatch = nextHeading.exec(rest);
  const end = nextMatch ? start + nextMatch.index : text.length;

  return text.slice(start, end).trim();
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function extractBulletItems(text: string): string[] {
  return text
    .split("\n")
    .map((line) => line.replace(/^\s*[-*]\s+/, "").trim())
    .filter((line) => line.length > 0 && !line.startsWith("#"));
}

function parseProposedTickets(text: string): ProposedTicket[] {
  const tickets: ProposedTicket[] = [];

  // Split by ### headings (ticket IDs)
  const blocks = text.split(/^###\s+/m).filter((b) => b.trim().length > 0);

  for (const block of blocks) {
    const lines = block.split("\n");
    const headerLine = lines[0].trim();

    // Skip decomposition headers (handled separately)
    if (headerLine.toLowerCase().startsWith("decompose:")) continue;

    // The header line is the ticket ID
    const id = headerLine.replace(/[^a-zA-Z0-9_-]/g, "");
    if (!id) continue;

    const title = extractField(block, "title") ?? id;
    const type = extractField(block, "type") ?? "feature";
    const priorityStr = extractField(block, "priority");
    const priority = priorityStr ? parseInt(priorityStr, 10) : 2;
    const depsStr = extractField(block, "deps");
    const deps = parseBracketList(depsStr);
    const parent = extractField(block, "parent");
    const description = extractField(block, "description") ?? "";

    tickets.push({
      id,
      title,
      type,
      priority: isNaN(priority) ? 2 : priority,
      deps,
      parent: parent || undefined,
      description,
    });
  }

  return tickets;
}

function parseDecompositions(
  text: string,
  allProposedTickets: ProposedTicket[],
): TicketDecomposition[] {
  const decompositions: TicketDecomposition[] = [];

  // Split by ### Decompose: <id>
  const blocks = text.split(/^###\s+Decompose:\s*/mi).filter((b) => b.trim().length > 0);

  for (const block of blocks) {
    const lines = block.split("\n");
    const parentId = lines[0].trim();
    if (!parentId) continue;

    const reason = extractField(block, "reason") ?? "Ticket too large for single agent";
    const subTicketStr = extractField(block, "sub-tickets");
    const subTicketIds = subTicketStr
      ? subTicketStr.split(",").map((s) => s.trim()).filter(Boolean)
      : [];

    // Find the proposed tickets that match these IDs
    const subTickets = subTicketIds
      .map((id) => allProposedTickets.find((t) => t.id === id))
      .filter((t): t is ProposedTicket => t !== undefined);

    if (subTickets.length > 0 || subTicketIds.length > 0) {
      decompositions.push({
        parentTicketId: parentId,
        reason,
        subTickets,
      });
    }
  }

  return decompositions;
}

function extractField(block: string, field: string): string | null {
  const pattern = new RegExp(`^\\s*-?\\s*${field}:\\s*(.+)$`, "mi");
  const match = pattern.exec(block);
  return match ? match[1].trim() : null;
}

function parseBracketList(str: string | null): string[] {
  if (!str) return [];
  // Handle [a, b, c] or a, b, c
  const cleaned = str.replace(/^\[/, "").replace(/\]$/, "").trim();
  if (!cleaned) return [];
  return cleaned.split(",").map((s) => s.trim()).filter(Boolean);
}
