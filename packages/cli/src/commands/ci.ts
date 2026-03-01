import {
  loadGlobalConfig,
  loadWorkspace,
  loadProject,
  listProjects,
  GitHubActionsAdapter,
} from "@opcom/core";
import type { Pipeline, DeploymentStatus, PipelineStatus } from "@opcom/types";

const STATUS_ICONS: Record<PipelineStatus, string> = {
  success: "\u2714",
  failure: "\u2716",
  in_progress: "\u25CC",
  queued: "\u25CB",
  cancelled: "\u2013",
  timed_out: "\u2716",
  skipped: "\u2013",
};

function formatDuration(ms?: number): string {
  if (!ms) return "-";
  if (ms < 1000) return `${ms}ms`;
  const secs = Math.floor(ms / 1000);
  if (secs < 60) return `${secs}s`;
  const mins = Math.floor(secs / 60);
  const remSecs = secs % 60;
  return remSecs > 0 ? `${mins}m ${remSecs}s` : `${mins}m`;
}

function formatRelativeTime(dateStr?: string): string {
  if (!dateStr) return "-";
  const diffMs = Date.now() - new Date(dateStr).getTime();
  if (diffMs < 0) return "just now";
  const secs = Math.floor(diffMs / 1000);
  if (secs < 60) return `${secs}s ago`;
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function printPipelines(pipelines: Pipeline[]): void {
  if (pipelines.length === 0) {
    console.log("    No pipelines found.");
    return;
  }

  for (const p of pipelines) {
    const icon = STATUS_ICONS[p.status] ?? "?";
    const time = formatRelativeTime(p.completedAt ?? p.startedAt);
    const duration = formatDuration(p.durationMs);
    console.log(
      `    ${icon} ${p.name.padEnd(30)} ${p.ref.padEnd(15)} ${time.padEnd(12)} ${duration}`,
    );
  }
}

function printDeployments(deployments: DeploymentStatus[]): void {
  if (deployments.length === 0) return;

  console.log("");
  console.log("  DEPLOYMENTS");
  for (const d of deployments) {
    const icon = d.status === "active" ? "\u25CF" : "\u25CB";
    const time = formatRelativeTime(d.updatedAt);
    console.log(
      `    ${icon} ${d.environment.padEnd(15)} ${d.ref.padEnd(15)} ${time}`,
    );
  }
}

async function resolveProject(nameOrId?: string) {
  if (nameOrId) {
    // Try direct load by ID
    const project = await loadProject(nameOrId);
    if (project) return project;

    // Try by name
    const projects = await listProjects();
    const byName = projects.find((p) => p.name === nameOrId);
    if (byName) return byName;

    return null;
  }
  return null;
}

export async function runCI(projectName?: string, opts?: { watch?: boolean }): Promise<void> {
  const adapter = new GitHubActionsAdapter();

  if (projectName) {
    // Single project mode
    const project = await resolveProject(projectName);
    if (!project) {
      console.error(`\n  Project "${projectName}" not found.\n`);
      process.exit(1);
    }

    const hasCI = await adapter.detect(project);
    if (!hasCI) {
      console.log(`\n  No GitHub Actions found for "${project.name}".\n`);
      return;
    }

    if (opts?.watch) {
      // Watch mode: initial print then live updates
      console.log(`\n  Watching CI/CD for ${project.name}...\n`);
      console.log("  PIPELINES");

      const pipelines = await adapter.listPipelines(project, { limit: 5 });
      printPipelines(pipelines);

      const deployments = await adapter.listDeployments(project);
      printDeployments(deployments);

      // Start watching
      const watcher = adapter.watch(project, (event) => {
        if (event.type === "pipeline_updated") {
          const p = event.pipeline;
          const icon = STATUS_ICONS[p.status] ?? "?";
          const time = formatRelativeTime(p.completedAt ?? p.startedAt);
          const duration = formatDuration(p.durationMs);
          console.log(
            `\n  ${icon} ${p.name.padEnd(30)} ${p.ref.padEnd(15)} ${time.padEnd(12)} ${duration}`,
          );
        } else if (event.type === "deployment_updated") {
          const d = event.deployment;
          const icon = d.status === "active" ? "\u25CF" : "\u25CB";
          console.log(
            `\n  ${icon} deploy ${d.environment.padEnd(15)} ${d.ref.padEnd(15)} ${d.status}`,
          );
        }
      });

      // Keep running until Ctrl+C
      process.on("SIGINT", () => {
        watcher.dispose();
        console.log("\n");
        process.exit(0);
      });

      // Keep event loop alive
      await new Promise(() => {});
    } else {
      // One-shot mode
      console.log(`\n  ${project.name} — CI/CD\n`);
      console.log("  PIPELINES");

      const pipelines = await adapter.listPipelines(project, { limit: 10 });
      printPipelines(pipelines);

      const deployments = await adapter.listDeployments(project);
      printDeployments(deployments);

      console.log("");
    }
  } else {
    // All projects mode
    const global = await loadGlobalConfig();
    const workspace = await loadWorkspace(global.defaultWorkspace);

    if (!workspace) {
      console.log("\n  No workspace found. Run 'opcom init' first.\n");
      return;
    }

    console.log("\n  CI/CD Status\n");

    let foundAny = false;
    for (const pid of workspace.projectIds) {
      const project = await loadProject(pid);
      if (!project) continue;

      const hasCI = await adapter.detect(project);
      if (!hasCI) continue;

      foundAny = true;
      try {
        const pipelines = await adapter.listPipelines(project, { limit: 3 });
        const latest = pipelines[0];
        if (latest) {
          const icon = STATUS_ICONS[latest.status] ?? "?";
          const time = formatRelativeTime(latest.completedAt ?? latest.startedAt);
          console.log(
            `  ${project.name.padEnd(18)} ${icon} ${latest.name.padEnd(25)} ${latest.ref.padEnd(12)} ${time}`,
          );
        } else {
          console.log(`  ${project.name.padEnd(18)} - no recent runs`);
        }
      } catch {
        console.log(`  ${project.name.padEnd(18)} ! error fetching pipelines`);
      }
    }

    if (!foundAny) {
      console.log("  No projects with GitHub Actions found.");
    }

    console.log("");
  }
}
