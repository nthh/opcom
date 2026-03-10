import {
  listProjects,
  openGraphDb,
  graphExists,
} from "@opcom/core";
import {
  WorkspaceEngine,
  type ProjectGraphRef,
  type WorkspaceHealth,
  type WorkspaceSignal,
  type SharedPattern,
} from "@opcom/context-graph";

/** Load all registered projects that have built graphs into ProjectGraphRefs. */
async function loadWorkspaceGraphs(): Promise<ProjectGraphRef[]> {
  const projects = await listProjects();
  const refs: ProjectGraphRef[] = [];

  for (const project of projects) {
    if (!graphExists(project.name)) continue;
    const db = openGraphDb(project.name);
    if (!db) continue;
    refs.push({ projectName: project.name, projectPath: project.path, db });
  }

  return refs;
}

export async function runWorkspaceHealth(): Promise<void> {
  const refs = await loadWorkspaceGraphs();

  if (refs.length === 0) {
    console.log("\n  No project graphs found. Run 'opcom graph build' first.\n");
    return;
  }

  const engine = new WorkspaceEngine(refs);
  try {
    const health = await engine.getHealth();
    printHealth(health);
  } finally {
    engine.close();
  }
}

export async function runWorkspaceDrift(): Promise<void> {
  const refs = await loadWorkspaceGraphs();

  if (refs.length === 0) {
    console.log("\n  No project graphs found. Run 'opcom graph build' first.\n");
    return;
  }

  const engine = new WorkspaceEngine(refs);
  try {
    const signals = await engine.aggregateDrift();
    printDrift(signals);
  } finally {
    engine.close();
  }
}

export async function runWorkspacePatterns(): Promise<void> {
  const refs = await loadWorkspaceGraphs();

  if (refs.length === 0) {
    console.log("\n  No project graphs found. Run 'opcom graph build' first.\n");
    return;
  }

  const engine = new WorkspaceEngine(refs);
  try {
    const signals = await engine.aggregateDrift();
    const patterns = engine.detectSharedPatterns(signals);
    printPatterns(patterns);
  } finally {
    engine.close();
  }
}

// --- Formatters ---

function printHealth(health: WorkspaceHealth): void {
  console.log(`\n  WORKSPACE HEALTH (${health.projects.length} projects)\n`);

  // Per-project summary
  for (const p of health.projects) {
    const driftLabel = p.driftSignalCount > 0
      ? `${p.driftSignalCount} drift signals`
      : "no drift";
    const testLabel = p.testHealth.total > 0
      ? `${p.testHealth.passed}/${p.testHealth.total} tests pass`
      : "no test data";
    const topDrift = p.topDriftType ? ` (top: ${p.topDriftType.replace(/_/g, " ")})` : "";

    console.log(`  ${p.projectName}`);
    console.log(`    Nodes: ${p.totalNodes}  Edges: ${p.totalEdges}`);
    console.log(`    Drift: ${driftLabel}${topDrift}`);
    console.log(`    Tests: ${testLabel}`);
    if (p.testHealth.flaky > 0) {
      console.log(`    Flaky: ${p.testHealth.flaky}`);
    }
    if (p.lastBuild) {
      console.log(`    Last build: ${p.lastBuild}`);
    }
    console.log("");
  }

  // Shared patterns
  if (health.sharedPatterns.length > 0) {
    console.log(`  SHARED PATTERNS (${health.sharedPatterns.length})\n`);
    for (const p of health.sharedPatterns) {
      console.log(`    ${p.description}`);
      console.log(`      ${p.signalCount} signals — ${p.suggestedAction}`);
    }
    console.log("");
  }

  console.log(`  Total drift signals: ${health.totalSignals}\n`);
}

function printDrift(signals: WorkspaceSignal[]): void {
  if (signals.length === 0) {
    console.log("\n  No cross-project drift signals detected.\n");
    return;
  }

  console.log(`\n  CROSS-PROJECT DRIFT (${signals.length} signals)\n`);

  // Group by project
  const byProject = new Map<string, WorkspaceSignal[]>();
  for (const s of signals) {
    if (!byProject.has(s.projectName)) byProject.set(s.projectName, []);
    byProject.get(s.projectName)!.push(s);
  }

  for (const [projectName, projectSignals] of byProject) {
    console.log(`  --- ${projectName} (${projectSignals.length}) ---`);

    // Group within project by type
    const byType = new Map<string, WorkspaceSignal[]>();
    for (const s of projectSignals) {
      if (!byType.has(s.type)) byType.set(s.type, []);
      byType.get(s.type)!.push(s);
    }

    for (const [type, typeSignals] of byType) {
      const label = type.replace(/_/g, " ").toUpperCase();
      console.log(`    ${label} (${typeSignals.length})`);
      for (const s of typeSignals.slice(0, 5)) {
        const title = s.subject?.path ?? s.id;
        console.log(`      [${s.severity.toFixed(1)}] ${title}`);
      }
      if (typeSignals.length > 5) {
        console.log(`      ... and ${typeSignals.length - 5} more`);
      }
    }
    console.log("");
  }
}

function printPatterns(patterns: SharedPattern[]): void {
  if (patterns.length === 0) {
    console.log("\n  No shared patterns detected across projects.\n");
    return;
  }

  console.log(`\n  SHARED PATTERNS (${patterns.length})\n`);

  for (const p of patterns) {
    console.log(`  ${p.patternId}`);
    console.log(`    ${p.description}`);
    console.log(`    Signals: ${p.signalCount}  Projects: ${p.projects.join(", ")}`);
    console.log(`    Action: ${p.suggestedAction}`);
    console.log("");
  }
}
