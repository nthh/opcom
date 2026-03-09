import { loadAllTemplates, findTemplate } from "@opcom/core";

export async function runTemplatesList(): Promise<void> {
  const templates = await loadAllTemplates();

  if (templates.length === 0) {
    console.log("\n  No templates available.\n");
    return;
  }

  console.log("\n  Available templates:\n");
  for (const t of templates) {
    const tags = t.tags?.length ? ` [${t.tags.join(", ")}]` : "";
    console.log(`  ${t.id} — ${t.description}${tags}`);
  }
  console.log("");
}

export async function runTemplatesShow(id: string): Promise<void> {
  const template = await findTemplate(id);

  if (!template) {
    console.error(`  Template "${id}" not found.`);
    process.exit(1);
  }

  console.log(`\n  ${template.name}`);
  console.log(`  ${template.description}\n`);

  if (template.tags?.length) {
    console.log(`  Tags: ${template.tags.join(", ")}`);
  }

  if (template.variables?.length) {
    console.log("  Variables:");
    for (const v of template.variables) {
      const def = v.default ? ` (default: ${v.default})` : "";
      console.log(`    - ${v.name}: ${v.prompt}${def}`);
    }
  }

  if (template.directories?.length) {
    console.log(`  Directories: ${template.directories.join(", ")}`);
  }

  const ticketFiles = Object.keys(template.tickets);
  if (ticketFiles.length > 0) {
    console.log("  Tickets:");
    for (const file of ticketFiles) {
      console.log(`    - ${file}`);
    }
  }

  console.log("");
}
