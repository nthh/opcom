import {
  detectProject,
  loadProject,
  saveProject,
  listProjects,
} from "@opcom/core";
import { formatDetectionResult } from "../ui/format.js";
import { detectionToProjectConfig } from "./add.js";

export async function runScan(projectId?: string): Promise<void> {
  if (projectId) {
    const existing = await loadProject(projectId);
    if (!existing) {
      console.error(`  Project "${projectId}" not found.`);
      process.exit(1);
      return; // unreachable, helps TS narrow
    }

    console.log(`\n  Re-scanning ${existing.name}...\n`);
    const result = await detectProject(existing.path);
    console.log(formatDetectionResult(result));

    const updated = detectionToProjectConfig(result);
    updated.overrides = existing.overrides;
    await saveProject(updated);
    console.log(`\n  Updated.\n`);
  } else {
    const projects = await listProjects();
    if (projects.length === 0) {
      console.log("\n  No projects registered. Run 'opcom init' first.\n");
      return;
    }

    console.log(`\n  Scanning ${projects.length} project(s)...\n`);
    for (const project of projects) {
      console.log(`  ${project.name}...`);
      const result = await detectProject(project.path);
      const updated = detectionToProjectConfig(result);
      updated.overrides = project.overrides;
      await saveProject(updated);
    }
    console.log(`\n  All projects re-scanned.\n`);
  }
}
