import {
  loadProject,
  listProjects,
  buildGraph,
  getGraphStats,
  queryProjectDrift,
  graphExists,
} from "@opcom/core";

export async function runGraphBuild(projectId?: string): Promise<void> {
  if (projectId) {
    const project = await loadProject(projectId);
    if (!project) {
      console.error(`  Project "${projectId}" not found.`);
      process.exit(1);
      return;
    }
    console.log(`\n  Building graph for ${project.name}...`);
    const stats = await buildGraph(project.name, project.path);
    console.log(`  Done. ${stats.totalNodes} nodes, ${stats.totalEdges} edges.\n`);
  } else {
    const projects = await listProjects();
    if (projects.length === 0) {
      console.log("\n  No projects registered. Run 'opcom init' first.\n");
      return;
    }
    console.log(`\n  Building graphs for ${projects.length} project(s)...\n`);
    for (const project of projects) {
      console.log(`  ${project.name}...`);
      try {
        const stats = await buildGraph(project.name, project.path);
        console.log(`    ${stats.totalNodes} nodes, ${stats.totalEdges} edges`);
      } catch (err) {
        console.error(`    Failed: ${err instanceof Error ? err.message : err}`);
      }
    }
    console.log("");
  }
}

export async function runGraphStats(projectId?: string): Promise<void> {
  if (projectId) {
    const project = await loadProject(projectId);
    if (!project) {
      console.error(`  Project "${projectId}" not found.`);
      process.exit(1);
      return;
    }
    printStats(project.name);
  } else {
    const projects = await listProjects();
    for (const project of projects) {
      if (graphExists(project.name)) {
        console.log(`\n  --- ${project.name} ---`);
        printStats(project.name);
      }
    }
    if (projects.length === 0) {
      console.log("\n  No projects registered.\n");
    }
  }
}

function printStats(projectName: string): void {
  const stats = getGraphStats(projectName);
  if (!stats) {
    console.log(`  No graph built for "${projectName}". Run 'opcom graph build ${projectName}'.`);
    return;
  }

  console.log(`  Nodes: ${stats.totalNodes}`);
  for (const [type, count] of Object.entries(stats.byType).sort((a, b) => b[1] - a[1])) {
    console.log(`    ${type}: ${count}`);
  }
  console.log(`  Edges: ${stats.totalEdges}`);
  for (const [rel, count] of Object.entries(stats.byRelation).sort((a, b) => b[1] - a[1])) {
    console.log(`    ${rel}: ${count}`);
  }
  if (stats.lastBuild) console.log(`  Last build: ${stats.lastBuild}`);
  if (stats.lastCommit) console.log(`  Last commit: ${stats.lastCommit.slice(0, 8)}`);
  console.log("");
}

export async function runGraphDrift(projectId?: string): Promise<void> {
  if (projectId) {
    const project = await loadProject(projectId);
    if (!project) {
      console.error(`  Project "${projectId}" not found.`);
      process.exit(1);
      return;
    }
    printDrift(project.name);
  } else {
    const projects = await listProjects();
    for (const project of projects) {
      if (graphExists(project.name)) {
        console.log(`\n  --- ${project.name} ---`);
        printDrift(project.name);
      }
    }
    if (projects.length === 0) {
      console.log("\n  No projects registered.\n");
    }
  }
}

function printDrift(projectName: string): void {
  const signals = queryProjectDrift(projectName);
  if (signals.length === 0) {
    console.log("  No drift signals detected.");
    console.log("");
    return;
  }

  const uncovered = signals.filter((s) => s.type === "uncovered_spec");
  const untested = signals.filter((s) => s.type === "untested_file");
  const failures = signals.filter((s) => s.type === "new_failure");
  const flaky = signals.filter((s) => s.type === "flaky_test");

  if (uncovered.length > 0) {
    console.log(`  SPECS WITHOUT COVERAGE (${uncovered.length})`);
    for (const s of uncovered.slice(0, 10)) {
      console.log(`    ${s.title ?? s.id}`);
    }
    if (uncovered.length > 10) console.log(`    ... and ${uncovered.length - 10} more`);
  }

  if (untested.length > 0) {
    console.log(`  UNTESTED FILES (${untested.length})`);
    for (const s of untested.slice(0, 10)) {
      console.log(`    ${s.title ?? s.id}`);
    }
    if (untested.length > 10) console.log(`    ... and ${untested.length - 10} more`);
  }

  if (failures.length > 0) {
    console.log(`  NEW FAILURES (${failures.length})`);
    for (const s of failures) {
      console.log(`    ${s.title ?? s.id}${s.detail ? ` — ${s.detail}` : ""}`);
    }
  }

  if (flaky.length > 0) {
    console.log(`  FLAKY TESTS (${flaky.length})`);
    for (const s of flaky) {
      console.log(`    ${s.title ?? s.id}${s.detail ? ` — ${s.detail}` : ""}`);
    }
  }

  console.log(`\n  Total drift signals: ${signals.length}\n`);
}
