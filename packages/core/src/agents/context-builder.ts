import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, relative } from "node:path";
import type { ProjectConfig, WorkItem, ContextPacket } from "@opcom/types";
import { scanTickets } from "../detection/tickets.js";

export async function buildContextPacket(
  project: ProjectConfig,
  workItem?: WorkItem,
): Promise<ContextPacket> {
  const packet: ContextPacket = {
    project: {
      name: project.name,
      path: project.path,
      stack: project.stack,
      testing: project.testing,
      linting: project.linting,
      services: project.services,
    },
    git: {
      branch: project.git?.branch ?? "main",
      remote: project.git?.remote ?? null,
      clean: project.git?.clean ?? true,
    },
  };

  // Load agent config (CLAUDE.md, etc.)
  if (project.docs.agentConfig) {
    const configPath = join(project.path, project.docs.agentConfig);
    if (existsSync(configPath)) {
      try {
        packet.agentConfig = await readFile(configPath, "utf-8");
      } catch {
        // Skip unreadable
      }
    }
  }

  // Load work item + spec
  if (workItem) {
    const workItemData: NonNullable<ContextPacket["workItem"]> = {
      ticket: workItem,
    };

    // Try to load linked spec files
    const specParts: string[] = [];
    if (workItem.links.length > 0) {
      for (const link of workItem.links) {
        const specPath = join(project.path, link);
        if (existsSync(specPath)) {
          try {
            specParts.push(await readFile(specPath, "utf-8"));
          } catch {
            // Skip
          }
        }
      }
    }

    // Load relevant ADRs (docs/adr/*.md that reference this ticket or its linked specs)
    const adrDir = join(project.path, "docs", "adr");
    if (existsSync(adrDir)) {
      try {
        const { readdir: readdirAsync } = await import("node:fs/promises");
        const adrFiles = await readdirAsync(adrDir);
        for (const f of adrFiles) {
          if (!f.endsWith(".md")) continue;
          try {
            const adrContent = await readFile(join(adrDir, f), "utf-8");
            // Include ADR if it references this ticket or any linked spec
            const refsTicket = adrContent.includes(workItem.id);
            const refsSpec = workItem.links.some((link) => adrContent.includes(link));
            if (refsTicket || refsSpec) {
              specParts.push(`\n---\n## ADR: ${f}\n${adrContent}`);
            }
          } catch {
            // Skip unreadable ADR
          }
        }
      } catch {
        // ADR dir not listable
      }
    }

    if (specParts.length > 0) {
      workItemData.spec = specParts.join("\n\n---\n\n");
    }

    // Load related tickets (deps)
    if (workItem.deps.length > 0) {
      const allTickets = await scanTickets(project.path);
      workItemData.relatedTickets = allTickets.filter(
        (t) => workItem.deps.includes(t.id),
      );
    }

    packet.workItem = workItemData;
  }

  return packet;
}

export function contextPacketToMarkdown(packet: ContextPacket): string {
  const lines: string[] = [];

  lines.push(`# Project: ${packet.project.name}`);
  lines.push(`Path: ${packet.project.path}`);
  lines.push("");

  // Stack
  const { stack } = packet.project;
  if (stack.languages.length > 0) {
    lines.push(`## Stack`);
    lines.push(`Languages: ${stack.languages.map((l) => l.name + (l.version ? ` ${l.version}` : "")).join(", ")}`);
    if (stack.frameworks.length > 0) {
      lines.push(`Frameworks: ${stack.frameworks.map((f) => f.name).join(", ")}`);
    }
    if (stack.packageManagers.length > 0) {
      lines.push(`Package managers: ${stack.packageManagers.map((p) => p.name).join(", ")}`);
    }
    if (stack.infrastructure.length > 0) {
      lines.push(`Infrastructure: ${stack.infrastructure.map((i) => i.name).join(", ")}`);
    }
    lines.push("");
  }

  // Testing
  if (packet.project.testing) {
    lines.push(`## Testing`);
    lines.push(`Framework: ${packet.project.testing.framework}`);
    if (packet.project.testing.command) {
      lines.push(`Command: \`${packet.project.testing.command}\``);
    }
    lines.push("");
  }

  // Linting
  if (packet.project.linting.length > 0) {
    lines.push(`## Linting`);
    lines.push(packet.project.linting.map((l) => `- ${l.name}`).join("\n"));
    lines.push("");
  }

  // Services
  if (packet.project.services.length > 0) {
    lines.push(`## Services`);
    for (const svc of packet.project.services) {
      const port = svc.port ? `:${svc.port}` : "";
      lines.push(`- ${svc.name}${port}${svc.command ? ` (${svc.command})` : ""}`);
    }
    lines.push("");
  }

  // Git
  lines.push(`## Git`);
  lines.push(`Branch: ${packet.git.branch}`);
  lines.push(`Clean: ${packet.git.clean}`);
  lines.push("");

  // Work item
  if (packet.workItem) {
    const { ticket } = packet.workItem;
    lines.push(`## Task: ${ticket.title}`);
    lines.push(`ID: ${ticket.id}`);
    lines.push(`Type: ${ticket.type} | Priority: P${ticket.priority} | Status: ${ticket.status}`);
    if (ticket.deps.length > 0) {
      lines.push(`Dependencies: ${ticket.deps.join(", ")}`);
    }
    lines.push("");

    if (packet.workItem.spec) {
      lines.push(`## Specification`);
      lines.push(packet.workItem.spec);
      lines.push("");
    }

    if (packet.workItem.relatedTickets && packet.workItem.relatedTickets.length > 0) {
      lines.push(`## Related Tickets`);
      for (const t of packet.workItem.relatedTickets) {
        lines.push(`- ${t.id}: ${t.title} (${t.status})`);
      }
      lines.push("");
    }
  }

  // Requirements
  lines.push(`## Requirements`);
  lines.push(`- All changes MUST include tests. Write tests for new functionality and update existing tests for modified behavior.`);
  if (packet.project.testing) {
    const cmd = packet.project.testing.command ?? "npm test";
    lines.push(`- Run \`${cmd}\` before finishing and ensure all tests pass.`);
  }
  lines.push(`- Do not mark work as complete if tests are failing.`);
  lines.push("");

  // Agent config
  if (packet.agentConfig) {
    lines.push(`## Agent Configuration`);
    lines.push(packet.agentConfig);
    lines.push("");
  }

  return lines.join("\n");
}

export function buildTicketCreationPrompt(
  project: ProjectConfig,
  description: string,
  existingTickets: WorkItem[],
): string {
  const ticketDir = project.workSystem?.ticketDir ?? ".tickets";
  const absTicketDir = join(project.path, ticketDir);

  const lines: string[] = [];

  lines.push(`# Task: Create a new ticket for project "${project.name}"`);
  lines.push("");
  lines.push("## User request");
  lines.push(description);
  lines.push("");

  lines.push("## Instructions");
  lines.push(`Create a new ticket by writing a file at: ${absTicketDir}/<id>/README.md`);
  lines.push("");
  lines.push("1. Pick a short, descriptive kebab-case ID for the ticket (e.g. \"add-rate-limiting\", \"fix-login-bug\").");
  lines.push(`2. Create the directory ${absTicketDir}/<id>/ and write README.md inside it.`);
  lines.push("3. The file MUST start with YAML frontmatter in this exact format:");
  lines.push("");
  lines.push("```");
  lines.push("---");
  lines.push("id: <kebab-case-id>");
  lines.push("title: <Short descriptive title>");
  lines.push("status: open");
  lines.push("type: <feature|bug|chore|refactor>");
  lines.push("priority: <1-4, where 1=critical, 2=high, 3=medium, 4=low>");
  lines.push("deps: []");
  lines.push("links: []");
  lines.push("---");
  lines.push("```");
  lines.push("");
  lines.push("4. After the frontmatter, write a description with these sections:");
  lines.push("");
  lines.push("```markdown");
  lines.push("## Goal");
  lines.push("<What this ticket aims to accomplish>");
  lines.push("");
  lines.push("## Tasks");
  lines.push("- [ ] <Concrete implementation step>");
  lines.push("- [ ] <Another step>");
  lines.push("");
  lines.push("## Acceptance Criteria");
  lines.push("- <Criterion that defines done>");
  lines.push("```");
  lines.push("");
  lines.push("5. Infer the type, priority, and details from the user's description. If the user mentions a priority (P1, P2, etc.), use it.");
  lines.push("6. Do NOT modify any existing files — only create the new ticket directory and README.md.");

  if (existingTickets.length > 0) {
    lines.push("");
    lines.push("## Existing tickets (for dependency awareness)");
    for (const t of existingTickets) {
      lines.push(`- ${t.id}: ${t.title} (${t.status}, P${t.priority}, ${t.type})`);
    }
    lines.push("");
    lines.push("If the new ticket depends on any existing ticket, add their IDs to the `deps` list.");
  }

  return lines.join("\n");
}

export function buildTicketChatPrompt(
  project: ProjectConfig,
  ticket: WorkItem,
  message: string,
): string {
  const lines: string[] = [];

  lines.push(`# Project: ${project.name}`);
  lines.push(`Path: ${project.path}`);
  lines.push("");

  lines.push(`## Ticket: ${ticket.title}`);
  lines.push(`- ID: ${ticket.id}`);
  lines.push(`- Status: ${ticket.status}`);
  lines.push(`- Type: ${ticket.type}`);
  lines.push(`- Priority: P${ticket.priority}`);
  if (ticket.deps.length > 0) {
    lines.push(`- Dependencies: ${ticket.deps.join(", ")}`);
  }
  lines.push(`- File: ${ticket.filePath}`);
  lines.push("");

  lines.push("## Instructions");
  lines.push("You are working on the ticket above. Read the ticket file first to understand the full context.");
  lines.push("This is a multi-turn conversation. After you respond, the user can reply.");
  lines.push("");
  lines.push("Response rules:");
  lines.push("- If the request is clear and actionable, do it immediately (edit the ticket, write code, etc.).");
  lines.push("- If you need to clarify something or present options, ask using numbered choices:");
  lines.push("");
  lines.push("  1) Option A — brief description");
  lines.push("  2) Option B — brief description");
  lines.push("  3) Option C — brief description");
  lines.push("");
  lines.push("  The user will reply with a number or their own answer.");
  lines.push("- If proposing changes, list what you'd do then end with:");
  lines.push("  Reply 'go' to proceed, or tell me what to adjust.");
  lines.push("- Never just give commentary. Always either take action or present clear options to move forward.");
  lines.push("- You can edit the ticket file (frontmatter, description, tasks), write code, or both.");
  lines.push("");

  lines.push("## User request");
  lines.push(message);

  return lines.join("\n");
}
