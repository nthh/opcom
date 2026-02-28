import { loadGlobalConfig, loadWorkspace, loadProject, ProcessManager } from "@opcom/core";

const BOLD = "\x1b[1m";
const RESET = "\x1b[0m";
const GREEN = "\x1b[32m";
const RED = "\x1b[31m";
const DIM = "\x1b[2m";

export async function runDev(projectId: string, serviceName?: string): Promise<void> {
  const global = await loadGlobalConfig();
  const workspace = await loadWorkspace(global.defaultWorkspace);
  if (!workspace) {
    console.error("  No workspace found. Run 'opcom init' first.");
    process.exit(1);
  }

  const project = await loadProject(projectId);
  if (!project) {
    console.error(`  Project '${projectId}' not found.`);
    process.exit(1);
  }

  if (project.services.length === 0) {
    console.error(`  No services detected for ${projectId}.`);
    console.error(`  Add services to project config or docker-compose.yml.`);
    process.exit(1);
  }

  const pm = new ProcessManager();

  pm.onEvent((event) => {
    switch (event.type) {
      case "started":
        console.log(`  ${GREEN}✓${RESET} ${event.process.name}${event.process.port ? ` :${event.process.port}` : ""} ${DIM}(PID ${event.process.pid})${RESET}`);
        break;
      case "stopped":
        console.log(`  ${DIM}■${RESET} ${event.name} stopped (exit ${event.code})`);
        break;
      case "error":
        console.log(`  ${RED}✗${RESET} ${event.name}: ${event.message}`);
        break;
      case "output":
        // Show stderr in red
        if (event.stream === "stderr" && event.text.trim()) {
          process.stderr.write(`  ${DIM}[${event.name}]${RESET} ${event.text}`);
        }
        break;
    }
  });

  if (serviceName) {
    // Start specific service
    const service = project.services.find((s) => s.name === serviceName);
    if (!service) {
      console.error(`  Service '${serviceName}' not found.`);
      console.error(`  Available: ${project.services.map((s) => s.name).join(", ")}`);
      process.exit(1);
    }
    console.log(`\n  ${BOLD}Starting ${serviceName}${RESET} for ${projectId}...\n`);
    await pm.startService(project, service);
  } else {
    // Start all services
    console.log(`\n  ${BOLD}Starting services${RESET} for ${projectId}...\n`);
    await pm.startAllServices(project);
  }

  console.log(`\n  Press Ctrl+C to stop all services.\n`);

  const shutdown = async () => {
    console.log("\n  Stopping services...");
    await pm.shutdown();
    console.log("  All services stopped.");
    process.exit(0);
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  await new Promise(() => {});
}

export async function runDevStop(projectId: string): Promise<void> {
  const pm = new ProcessManager();
  await pm.stopAllServices(projectId);
  console.log(`  Stopped all services for ${projectId}`);
}
