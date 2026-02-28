import { readFile, writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";
import { opcomRoot } from "../config/paths.js";

const execFileAsync = promisify(execFile);

// --- Cron Parsing ---

export interface CronField {
  type: "wildcard" | "value" | "step";
  value?: number;   // for "value" type
  step?: number;    // for "step" type (*/N)
}

export interface ParsedCron {
  minute: CronField;
  hour: CronField;
  dayOfMonth: CronField;
  month: CronField;
  dayOfWeek: CronField;
}

export function parseCronField(field: string): CronField {
  if (field === "*") {
    return { type: "wildcard" };
  }
  if (field.startsWith("*/")) {
    const step = parseInt(field.slice(2), 10);
    if (isNaN(step) || step <= 0) {
      throw new Error(`Invalid cron step: ${field}`);
    }
    return { type: "step", step };
  }
  const value = parseInt(field, 10);
  if (isNaN(value)) {
    throw new Error(`Invalid cron field: ${field}`);
  }
  return { type: "value", value };
}

export function parseCron(expression: string): ParsedCron {
  const parts = expression.trim().split(/\s+/);
  if (parts.length !== 5) {
    throw new Error(`Invalid cron expression: expected 5 fields, got ${parts.length}`);
  }
  return {
    minute: parseCronField(parts[0]),
    hour: parseCronField(parts[1]),
    dayOfMonth: parseCronField(parts[2]),
    month: parseCronField(parts[3]),
    dayOfWeek: parseCronField(parts[4]),
  };
}

function fieldMatches(field: CronField, value: number): boolean {
  switch (field.type) {
    case "wildcard":
      return true;
    case "value":
      return value === field.value;
    case "step":
      return value % field.step! === 0;
  }
}

function cronMatchesDate(parsed: ParsedCron, date: Date): boolean {
  return (
    fieldMatches(parsed.minute, date.getMinutes()) &&
    fieldMatches(parsed.hour, date.getHours()) &&
    fieldMatches(parsed.dayOfMonth, date.getDate()) &&
    fieldMatches(parsed.month, date.getMonth() + 1) &&
    fieldMatches(parsed.dayOfWeek, date.getDay())
  );
}

/**
 * Calculate the next run time from `from` for a given cron expression.
 * Advances minute-by-minute from the next full minute until a match is found.
 * Safety cap: 2 years of minutes to avoid infinite loops on pathological expressions.
 */
export function getNextRunTime(parsed: ParsedCron, from: Date): Date {
  // Start from the next full minute
  const next = new Date(from.getTime());
  next.setSeconds(0, 0);
  next.setMinutes(next.getMinutes() + 1);

  const maxIterations = 2 * 365 * 24 * 60; // ~2 years of minutes
  for (let i = 0; i < maxIterations; i++) {
    if (cronMatchesDate(parsed, next)) {
      return next;
    }
    next.setMinutes(next.getMinutes() + 1);
  }

  throw new Error("Could not find next run time within 2 years");
}

// --- Scheduled Task ---

export interface ScheduledTask {
  id: string;
  name: string;
  cron: string;
  command: string;
  projectId?: string;
  enabled: boolean;
  lastRunAt?: string;
  nextRunAt?: string;
}

// --- Default Schedules ---

const DEFAULT_SCHEDULES: Omit<ScheduledTask, "id">[] = [
  {
    name: "Project rescan",
    cron: "0 */6 * * *",
    command: "scan",
    enabled: true,
  },
  {
    name: "Git state refresh",
    cron: "*/30 * * * *",
    command: "scan",
    enabled: true,
  },
];

// --- Scheduler ---

export class Scheduler {
  private tasks: ScheduledTask[] = [];
  private timers = new Map<string, ReturnType<typeof setTimeout>>();
  private running = false;

  private schedulesPath(): string {
    return join(opcomRoot(), "schedules.yaml");
  }

  async loadSchedules(): Promise<void> {
    const filePath = this.schedulesPath();
    if (!existsSync(filePath)) {
      // Initialize with defaults
      this.tasks = DEFAULT_SCHEDULES.map((t) => ({
        ...t,
        id: randomUUID(),
      }));
      await this.saveSchedules();
      return;
    }

    const content = await readFile(filePath, "utf-8");
    const data = parseYaml(content) as unknown;
    if (Array.isArray(data)) {
      this.tasks = data as ScheduledTask[];
    } else {
      this.tasks = [];
    }
  }

  async saveSchedules(): Promise<void> {
    const dir = opcomRoot();
    if (!existsSync(dir)) {
      await mkdir(dir, { recursive: true });
    }
    const content = stringifyYaml(this.tasks, { lineWidth: 120 });
    await writeFile(this.schedulesPath(), content, "utf-8");
  }

  addTask(task: Omit<ScheduledTask, "id">): ScheduledTask {
    // Validate the cron expression
    parseCron(task.cron);

    const newTask: ScheduledTask = {
      ...task,
      id: randomUUID(),
    };
    this.tasks.push(newTask);

    // If scheduler is running, schedule this task
    if (this.running) {
      this.scheduleNext(newTask);
    }

    return newTask;
  }

  removeTask(id: string): boolean {
    const index = this.tasks.findIndex((t) => t.id === id);
    if (index === -1) return false;

    this.tasks.splice(index, 1);

    // Clear any pending timer
    const timer = this.timers.get(id);
    if (timer) {
      clearTimeout(timer);
      this.timers.delete(id);
    }

    return true;
  }

  enableTask(id: string): void {
    const task = this.tasks.find((t) => t.id === id);
    if (!task) throw new Error(`Task not found: ${id}`);
    task.enabled = true;

    if (this.running) {
      this.scheduleNext(task);
    }
  }

  disableTask(id: string): void {
    const task = this.tasks.find((t) => t.id === id);
    if (!task) throw new Error(`Task not found: ${id}`);
    task.enabled = false;

    const timer = this.timers.get(id);
    if (timer) {
      clearTimeout(timer);
      this.timers.delete(id);
    }
  }

  listTasks(): ScheduledTask[] {
    return [...this.tasks];
  }

  start(): void {
    this.running = true;
    for (const task of this.tasks) {
      if (task.enabled) {
        this.scheduleNext(task);
      }
    }
  }

  stop(): void {
    this.running = false;
    for (const [id, timer] of this.timers) {
      clearTimeout(timer);
    }
    this.timers.clear();
  }

  private scheduleNext(task: ScheduledTask): void {
    // Clear any existing timer for this task
    const existing = this.timers.get(task.id);
    if (existing) {
      clearTimeout(existing);
    }

    const parsed = parseCron(task.cron);
    const now = new Date();
    const nextRun = getNextRunTime(parsed, now);
    task.nextRunAt = nextRun.toISOString();

    const delayMs = nextRun.getTime() - now.getTime();

    const timer = setTimeout(() => {
      this.execute(task).catch((err: unknown) => {
        const message = err instanceof Error ? err.message : String(err);
        console.error(`[scheduler] Error executing task "${task.name}": ${message}`);
      });
    }, delayMs);

    this.timers.set(task.id, timer);
  }

  private async execute(task: ScheduledTask): Promise<void> {
    task.lastRunAt = new Date().toISOString();

    try {
      const cmdArgs = task.projectId
        ? [task.command, task.projectId]
        : [task.command];

      await execFileAsync("npx", ["opcom", ...cmdArgs], {
        timeout: 120_000,
      });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[scheduler] Task "${task.name}" failed: ${message}`);
    }

    // Re-schedule for the next run
    if (this.running && task.enabled) {
      this.scheduleNext(task);
    }

    // Persist updated lastRunAt / nextRunAt
    await this.saveSchedules().catch(() => {
      // Non-fatal: we'll persist next time
    });
  }
}
