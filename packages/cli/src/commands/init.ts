import { createInterface } from "node:readline";
import { resolve } from "node:path";
import {
  ensureOpcomDirs,
  saveGlobalConfig,
  saveWorkspace,
  saveProject,
  detectProject,
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

    await saveGlobalConfig({ defaultWorkspace: wsId });

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
