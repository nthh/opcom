import { createInterface } from "node:readline";
import { basename, resolve } from "node:path";
import { mkdir, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import {
  ensureOpcomDirs,
  saveGlobalConfig,
  saveWorkspace,
  saveProject,
  loadGlobalConfig,
  loadWorkspace,
  detectProject,
  defaultSettings,
  emptyStack,
  writeProjectSummary,
  createInitialSummaryFromDescription,
} from "@opcom/core";
import type { WorkspaceConfig, ProjectConfig } from "@opcom/types";
import { formatDetectionResult } from "../ui/format.js";
import { detectionToProjectConfig } from "./add.js";

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

    console.log("");

    // Loop adding projects
    let addMore = true;
    while (addMore) {
      const pathInput = (await prompt(rl, "  Add project path (empty to finish): ")).trim();
      if (!pathInput) {
        addMore = false;
        continue;
      }

      const projectPath = resolve(pathInput.replace(/^~/, process.env.HOME ?? "~"));
      console.log(`\n  Scanning ${projectPath}...\n`);

      try {
        const result = await detectProject(projectPath);
        console.log(formatDetectionResult(result));
        console.log("");

        const confirm = (await prompt(rl, "  Add this project? [Y/n]: ")).trim().toLowerCase();
        if (confirm === "" || confirm === "y" || confirm === "yes") {
          const config = detectionToProjectConfig(result);
          await saveProject(config);
          await writeProjectSummary(
            config.id,
            createInitialSummaryFromDescription(config.name),
          );
          workspace.projectIds.push(config.id);
          console.log(`  Added ${config.name}\n`);
        } else {
          console.log("  Skipped\n");
        }
      } catch (err) {
        console.error(`  Error scanning: ${err instanceof Error ? err.message : err}\n`);
      }
    }

    await saveWorkspace(workspace);

    console.log(`\n  Workspace "${wsName}" created with ${workspace.projectIds.length} project(s).`);
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
    const folderPath = resolve(opts.folder.replace(/^~/, process.env.HOME ?? "~"));
    const folderName = basename(folderPath);

    // 1. Create folder if it doesn't exist
    const folderExisted = existsSync(folderPath);
    if (!folderExisted) {
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

    // 5. Create .tickets/ directory
    const ticketsDir = resolve(folderPath, ".tickets/impl");
    if (!existsSync(ticketsDir)) {
      await mkdir(ticketsDir, { recursive: true });
      console.log("  Created .tickets/impl/");
    }

    // 6. Create minimal AGENTS.md if none exists
    const agentsMdPath = resolve(folderPath, "AGENTS.md");
    if (!existsSync(agentsMdPath)) {
      const agentsContent = `# ${name}\n\n${description || `Project: ${name}`}\n`;
      await writeFile(agentsMdPath, agentsContent, "utf-8");
      console.log("  Created AGENTS.md");
    }

    // 7. Build and save project config
    await ensureOpcomDirs();

    const config: ProjectConfig = {
      ...detectionToProjectConfig(result, { description: description || undefined }),
      id,
      name,
    };
    await saveProject(config);
    await writeProjectSummary(
      config.id,
      createInitialSummaryFromDescription(config.name, description || undefined),
    );

    // 8. Add to workspace
    const global = await loadGlobalConfig();
    let workspace = await loadWorkspace(global.defaultWorkspace);
    if (!workspace) {
      workspace = {
        id: global.defaultWorkspace,
        name: global.defaultWorkspace,
        description: `${global.defaultWorkspace} workspace`,
        projectIds: [],
        createdAt: new Date().toISOString(),
      };
    }
    if (!workspace.projectIds.includes(id)) {
      workspace.projectIds.push(id);
      await saveWorkspace(workspace);
    }

    console.log(`\n  Project "${name}" initialized.`);
    console.log("  Run 'opcom status' to see your dashboard.\n");
  } finally {
    rl?.close();
  }
}
