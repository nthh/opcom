import { Scheduler } from "@opcom/core";

export async function runScheduleList(): Promise<void> {
  const scheduler = new Scheduler();
  await scheduler.loadSchedules();
  const tasks = scheduler.listTasks();

  if (tasks.length === 0) {
    console.log("\n  No scheduled tasks.\n");
    return;
  }

  console.log("\n  Scheduled Tasks:");
  console.log("  " + "-".repeat(80));

  for (const task of tasks) {
    const status = task.enabled ? "enabled" : "disabled";
    const lastRun = task.lastRunAt
      ? new Date(task.lastRunAt).toLocaleString()
      : "never";
    const nextRun = task.nextRunAt
      ? new Date(task.nextRunAt).toLocaleString()
      : "—";

    console.log(`  ${task.name}`);
    console.log(`    ID:       ${task.id}`);
    console.log(`    Cron:     ${task.cron}`);
    console.log(`    Command:  opcom ${task.command}${task.projectId ? " " + task.projectId : ""}`);
    console.log(`    Status:   ${status}`);
    console.log(`    Last run: ${lastRun}`);
    console.log(`    Next run: ${nextRun}`);
    console.log("");
  }
}

export async function runScheduleAdd(
  name: string,
  cron: string,
  command: string,
): Promise<void> {
  const scheduler = new Scheduler();
  await scheduler.loadSchedules();

  try {
    const task = scheduler.addTask({
      name,
      cron,
      command,
      enabled: true,
    });
    await scheduler.saveSchedules();

    console.log(`\n  Added scheduled task: ${task.name}`);
    console.log(`    ID:   ${task.id}`);
    console.log(`    Cron: ${task.cron}`);
    console.log(`    Cmd:  opcom ${task.command}\n`);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`\n  Error: ${message}\n`);
    process.exit(1);
  }
}

export async function runScheduleRemove(id: string): Promise<void> {
  const scheduler = new Scheduler();
  await scheduler.loadSchedules();

  const removed = scheduler.removeTask(id);
  if (!removed) {
    console.error(`\n  No task found with ID: ${id}\n`);
    process.exit(1);
  }

  await scheduler.saveSchedules();
  console.log(`\n  Removed scheduled task: ${id}\n`);
}
