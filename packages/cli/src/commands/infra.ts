import {
  loadProject,
  listProjects,
  loadGlobalConfig,
  loadWorkspace,
  KubernetesAdapter,
  detectInfrastructure,
  computeInfraHealthSummary,
} from "@opcom/core";
import type { InfraResource, PodDetail, ResourceStatus, InfraLogLine } from "@opcom/types";

const STATUS_ICONS: Record<ResourceStatus, string> = {
  healthy: "\u25CF",      // ●
  degraded: "\u25D0",     // ◐
  unhealthy: "\u25CB",    // ○
  progressing: "\u25CC",  // ◌
  suspended: "\u2013",    // –
  unknown: "?",
};

function formatAge(isoDate: string): string {
  const diffMs = Date.now() - new Date(isoDate).getTime();
  if (diffMs < 0) return "just now";
  const secs = Math.floor(diffMs / 1000);
  if (secs < 60) return `${secs}s`;
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  return `${days}d`;
}

async function resolveProject(nameOrId?: string) {
  if (nameOrId) {
    const project = await loadProject(nameOrId);
    if (project) return project;

    const projects = await listProjects();
    const byName = projects.find((p) => p.name === nameOrId);
    if (byName) return byName;

    return null;
  }
  return null;
}

function printResources(resources: InfraResource[]): void {
  const deployments = resources.filter((r) => r.kind === "deployment" || r.kind === "statefulset" || r.kind === "daemonset");
  const services = resources.filter((r) => r.kind === "service");
  const pods = resources.filter((r) => r.kind === "pod");
  const ingresses = resources.filter((r) => r.kind === "ingress");
  const jobs = resources.filter((r) => r.kind === "job" || r.kind === "cronjob");

  if (deployments.length > 0) {
    console.log("  DEPLOYMENTS");
    for (const d of deployments) {
      const icon = STATUS_ICONS[d.status];
      const replicas = d.replicas ? `${d.replicas.ready}/${d.replicas.desired} ready` : "";
      const age = formatAge(d.age);
      console.log(
        `    ${icon} ${d.name.padEnd(20)} ${replicas.padEnd(14)} ${age}`,
      );
    }
    console.log("");
  }

  if (services.length > 0) {
    console.log("  SERVICES");
    for (const s of services) {
      const ep = s.endpoints?.[0];
      const epStr = ep ? `${ep.type.padEnd(14)} ${ep.address}:${ep.port}` : "";
      console.log(`    ${s.name.padEnd(20)} ${epStr}`);
    }
    console.log("");
  }

  if (ingresses.length > 0) {
    console.log("  INGRESSES");
    for (const i of ingresses) {
      const ep = i.endpoints?.[0];
      const epStr = ep ? `${ep.address}:${ep.port}` : "";
      console.log(`    ${i.name.padEnd(20)} ${epStr}`);
    }
    console.log("");
  }

  if (pods.length > 0) {
    console.log("  PODS");
    for (const p of pods) {
      const pod = p as PodDetail;
      const icon = STATUS_ICONS[p.status];
      const phase = pod.phase ?? "";
      const restarts = pod.restarts !== undefined ? `${pod.restarts} restarts` : "";
      const age = formatAge(p.age);
      console.log(
        `    ${icon} ${p.name.padEnd(28)} ${phase.padEnd(12)} ${restarts.padEnd(14)} ${age}`,
      );
    }
    console.log("");
  }

  if (jobs.length > 0) {
    console.log("  JOBS");
    for (const j of jobs) {
      const icon = STATUS_ICONS[j.status];
      const age = formatAge(j.age);
      console.log(`    ${icon} ${j.name.padEnd(28)} ${j.kind.padEnd(10)} ${age}`);
    }
    console.log("");
  }
}

export async function runInfra(
  projectName?: string,
  subcommand?: string,
  target?: string,
  opts?: { follow?: boolean; container?: string },
): Promise<void> {
  if (!projectName) {
    // All projects mode — show health summary
    const global = await loadGlobalConfig();
    const workspace = await loadWorkspace(global.defaultWorkspace);

    if (!workspace) {
      console.log("\n  No workspace found. Run 'opcom init' first.\n");
      return;
    }

    console.log("\n  Infrastructure Status\n");

    let foundAny = false;
    for (const pid of workspace.projectIds) {
      const project = await loadProject(pid);
      if (!project) continue;

      const { adapters } = await detectInfrastructure(project);
      if (adapters.length === 0) continue;

      foundAny = true;
      try {
        const resources = await adapters[0].listResources(project, {
          kinds: ["deployment", "statefulset", "daemonset"],
        });
        const summary = computeInfraHealthSummary(resources);
        const dots = resources.map((r) => STATUS_ICONS[r.status]).join("");
        console.log(`  ${project.name.padEnd(18)} ${dots} K8s  (${summary.healthy}/${summary.total} healthy)`);
      } catch {
        console.log(`  ${project.name.padEnd(18)} ! error querying cluster`);
      }
    }

    if (!foundAny) {
      console.log("  No projects with Kubernetes infrastructure found.");
    }

    console.log("");
    return;
  }

  const project = await resolveProject(projectName);
  if (!project) {
    console.error(`\n  Project "${projectName}" not found.\n`);
    process.exit(1);
  }

  const { adapters } = await detectInfrastructure(project);
  if (adapters.length === 0) {
    console.log(`\n  No infrastructure adapters found for "${project.name}".\n`);
    return;
  }

  const adapter = adapters[0];

  // Sub-commands
  if (subcommand === "pods") {
    console.log(`\n  ${project.name} — Pods\n`);
    const pods = await adapter.listResources(project, { kinds: ["pod"] });
    printResources(pods);
    return;
  }

  if (subcommand === "logs" && target) {
    const ns = project.overrides?.infrastructure?.kubernetes?.namespace ?? project.name;
    const resourceId = target.includes("/") ? target : `${ns}/${target}`;

    if (opts?.follow) {
      console.log(`\n  Streaming logs for ${target}${opts.container ? ` (container: ${opts.container})` : ""}...\n`);
      for await (const line of adapter.streamLogs(project, resourceId, {
        follow: true,
        tailLines: 100,
        container: opts.container,
      })) {
        console.log(`  ${line.timestamp}  ${line.text}`);
      }
    } else {
      console.log(`\n  Logs for ${target}${opts?.container ? ` (container: ${opts.container})` : ""}\n`);
      for await (const line of adapter.streamLogs(project, resourceId, {
        tailLines: 100,
        container: opts?.container,
      })) {
        console.log(`  ${line.timestamp}  ${line.text}`);
      }
      console.log("");
    }
    return;
  }

  if (subcommand === "restart" && target) {
    const k8sAdapter = adapter as KubernetesAdapter;
    const ns = project.overrides?.infrastructure?.kubernetes?.namespace ?? project.name;
    const resourceId = target.includes("/") ? target : `${ns}/${target}`;

    try {
      await k8sAdapter.rolloutRestart(project, resourceId);
      console.log(`\n  Rollout restart triggered for ${target}.\n`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to restart";
      console.error(`\n  Error: ${msg}\n`);
      process.exit(1);
    }
    return;
  }

  // Default: show all resources
  console.log(`\n  ${project.name} — Infrastructure\n`);
  try {
    const resources = await adapter.listResources(project);
    if (resources.length === 0) {
      console.log("  No resources found.\n");
      return;
    }
    printResources(resources);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Failed to list resources";
    console.error(`\n  Error: ${msg}\n`);
    process.exit(1);
  }
}
