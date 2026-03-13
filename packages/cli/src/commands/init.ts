import { createInterface } from "node:readline";
import { basename, resolve } from "node:path";
import { mkdir, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import {
  ensureOpcomDirs,
  saveGlobalConfig,
  saveWorkspace,
  defaultSettings,
  detectProject,
  loadAllTemplates,
  scaffoldFromTemplate,
} from "@opcom/core";
import type { WorkspaceConfig, ProjectTemplate } from "@opcom/types";
import { formatDetectionResult } from "../ui/format.js";
import {
  resolvePath,
  initPipeline,
  configureProject,
  persistProject,
  addToWorkspace,
} from "./init-pipeline.js";

function prompt(rl: ReturnType<typeof createInterface>, question: string): Promise<string> {
  return new Promise((resolve) => rl.question(question, resolve));
}

export async function runInit(): Promise<void> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });

  try {
    console.log("\n  opcom init — workspace setup\n");

    await ensureOpcomDirs();

    const wsName = (await prompt(rl, "  Workspace name [personal]: ")).trim() || "personal";
    const wsId = wsName.toLowerCase().replace(/\s+/g, "-");

    const workspace: WorkspaceConfig = {
      id: wsId,
      name: wsName,
      description: `${wsName} workspace`,
      projectIds: [],
      createdAt: new Date().toISOString(),
    };

    await saveGlobalConfig({ defaultWorkspace: wsId, settings: defaultSettings() });
    await saveWorkspace(workspace);

    console.log("");

    const ask = (q: string) => prompt(rl, q);

    // Loop adding projects
    let addMore = true;
    while (addMore) {
      const pathInput = (await prompt(rl, "  Add project path (empty to finish): ")).trim();
      if (!pathInput) {
        addMore = false;
        continue;
      }

      const projectPath = resolvePath(pathInput);
      console.log(`\n  Scanning ${projectPath}...\n`);

      try {
        const result = await detectProject(projectPath);
        console.log(formatDetectionResult(result));
        console.log("");

        const confirm = (await prompt(rl, "  Add this project? [Y/n]: ")).trim().toLowerCase();
        if (confirm === "" || confirm === "y" || confirm === "yes") {
          const config = await configureProject(result, "interactive", { ask });
          await persistProject(config);
          await addToWorkspace(config.id);
          console.log(`  Added ${config.name}\n`);
        } else {
          console.log("  Skipped\n");
        }
      } catch (err) {
        console.error(`  Error scanning: ${err instanceof Error ? err.message : err}\n`);
      }
    }

    // Reload workspace to get all added projects
    const { loadWorkspace: loadWs } = await import("@opcom/core");
    const finalWorkspace = await loadWs(wsId);

    console.log(`\n  Workspace "${wsName}" created with ${finalWorkspace?.projectIds.length ?? 0} project(s).`);
    console.log("  Run 'opcom status' to see your dashboard.\n");
  } finally {
    rl.close();
  }
}

export interface InitFolderOptions {
  folder: string;
  /** For testing: override readline with scripted answers */
  promptFn?: (question: string) => Promise<string>;
}

export async function runInitFolder(opts: InitFolderOptions): Promise<void> {
  const rl = opts.promptFn
    ? null
    : createInterface({ input: process.stdin, output: process.stdout });

  const ask = opts.promptFn ?? ((question: string) => prompt(rl!, question));

  try {
    const folderPath = resolvePath(opts.folder);
    const folderName = basename(folderPath);

    // 1. Create folder if it doesn't exist
    if (!existsSync(folderPath)) {
      await mkdir(folderPath, { recursive: true });
      console.log(`  Created ${folderPath}`);
    }

    // 2. Prompt for project name
    const name = (await ask(`  Project name [${folderName}]: `)).trim() || folderName;
    const id = name.toLowerCase().replace(/\s+/g, "-");

    // 3. Prompt for description
    const description = (await ask("  What is this project about? ")).trim();

    // 4. Run detection
    console.log(`\n  Scanning ${folderPath}...\n`);
    const result = await detectProject(folderPath);

    const hasStack = result.stack.languages.length > 0 ||
      result.stack.frameworks.length > 0 ||
      result.stack.infrastructure.length > 0;

    if (hasStack) {
      console.log(formatDetectionResult(result));
    } else {
      console.log("  No code detected — that's fine, not every project has code.\n");
    }

    // 4b. Profile confirmation via pipeline helper
    const configuredConfig = await configureProject(result, "interactive", {
      ask,
      description: description || undefined,
      overrides: { id, name },
    });

    // 5. Template selection
    const templates = await loadAllTemplates();
    let selectedTemplate: ProjectTemplate | null = null;

    if (templates.length > 0) {
      console.log("  Use a template?");
      templates.forEach((t, i) => {
        console.log(`  [${i + 1}] ${t.id} — ${t.description}`);
      });
      console.log(`  [${templates.length + 1}] none — Start empty`);
      console.log("");

      const templateChoice = (await ask("  > ")).trim();
      const choiceNum = parseInt(templateChoice, 10);

      if (choiceNum >= 1 && choiceNum <= templates.length) {
        selectedTemplate = templates[choiceNum - 1];
      }
      console.log("");
    }

    // 6. Prompt for template variables and scaffold
    const templateVars: Record<string, string> = { name, description: description || `Project: ${name}` };

    if (selectedTemplate) {
      if (selectedTemplate.variables) {
        for (const v of selectedTemplate.variables) {
          const defaultHint = v.default ? ` [${v.default}]` : "";
          const answer = (await ask(`  ${v.prompt}${defaultHint} `)).trim();
          templateVars[v.name] = answer || v.default || "";
        }
        console.log("");
      }

      const scaffoldResult = await scaffoldFromTemplate({
        projectDir: folderPath,
        template: selectedTemplate,
        variables: templateVars,
      });

      if (scaffoldResult.directoriesCreated.length > 0) {
        for (const dir of scaffoldResult.directoriesCreated) {
          console.log(`  Created ${dir}/`);
        }
      }
      if (scaffoldResult.ticketCount > 0) {
        console.log(`  ${scaffoldResult.ticketCount} ticket(s) created from template`);
      }
      if (scaffoldResult.agentsMdWritten) {
        console.log("  Created AGENTS.md");
      }
    } else {
      // No template — create minimal scaffolding
      const ticketsDir = resolve(folderPath, ".tickets/impl");
      if (!existsSync(ticketsDir)) {
        await mkdir(ticketsDir, { recursive: true });
        console.log("  Created .tickets/impl/");
      }

      const agentsMdPath = resolve(folderPath, "AGENTS.md");
      if (!existsSync(agentsMdPath)) {
        const agentsContent = `# ${name}\n\n${description || `Project: ${name}`}\n`;
        await writeFile(agentsMdPath, agentsContent, "utf-8");
        console.log("  Created AGENTS.md");
      }
    }

    // 7. Persist project config + summary
    await ensureOpcomDirs();
    await persistProject(configuredConfig);

    // 8. Add to workspace
    await addToWorkspace(id);

    console.log(`\n  Project "${name}" initialized.`);
    console.log("  Run 'opcom status' to see your dashboard.\n");
  } finally {
    rl?.close();
  }
}
