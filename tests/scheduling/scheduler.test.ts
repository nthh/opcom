import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  Scheduler,
  parseCron,
  parseCronField,
  getNextRunTime,
} from "@opcom/core";

describe("parseCronField", () => {
  it("parses wildcard", () => {
    expect(parseCronField("*")).toEqual({ type: "wildcard" });
  });

  it("parses a specific value", () => {
    expect(parseCronField("30")).toEqual({ type: "value", value: 30 });
  });

  it("parses a step expression", () => {
    expect(parseCronField("*/5")).toEqual({ type: "step", step: 5 });
  });

  it("rejects invalid step", () => {
    expect(() => parseCronField("*/0")).toThrow("Invalid cron step");
  });

  it("rejects non-numeric value", () => {
    expect(() => parseCronField("abc")).toThrow("Invalid cron field");
  });
});

describe("parseCron", () => {
  it("parses a full 5-field expression", () => {
    const parsed = parseCron("30 9 * * 1");
    expect(parsed.minute).toEqual({ type: "value", value: 30 });
    expect(parsed.hour).toEqual({ type: "value", value: 9 });
    expect(parsed.dayOfMonth).toEqual({ type: "wildcard" });
    expect(parsed.month).toEqual({ type: "wildcard" });
    expect(parsed.dayOfWeek).toEqual({ type: "value", value: 1 });
  });

  it("parses step expressions in multiple fields", () => {
    const parsed = parseCron("*/15 */6 * * *");
    expect(parsed.minute).toEqual({ type: "step", step: 15 });
    expect(parsed.hour).toEqual({ type: "step", step: 6 });
  });

  it("rejects expression with wrong number of fields", () => {
    expect(() => parseCron("* * *")).toThrow("expected 5 fields");
  });

  it("parses every-30-minutes schedule", () => {
    const parsed = parseCron("*/30 * * * *");
    expect(parsed.minute).toEqual({ type: "step", step: 30 });
    expect(parsed.hour).toEqual({ type: "wildcard" });
  });

  it("parses daily-at-9am schedule", () => {
    const parsed = parseCron("0 9 * * *");
    expect(parsed.minute).toEqual({ type: "value", value: 0 });
    expect(parsed.hour).toEqual({ type: "value", value: 9 });
  });
});

describe("getNextRunTime", () => {
  it("finds next occurrence for a specific time", () => {
    // Cron: minute=30, hour=14, every day (uses local time)
    const parsed = parseCron("30 14 * * *");
    // From: local time noon today
    const from = new Date();
    from.setHours(12, 0, 0, 0);
    const next = getNextRunTime(parsed, from);

    // Should be 14:30 local time today
    expect(next.getHours()).toBe(14);
    expect(next.getMinutes()).toBe(30);
  });

  it("advances to the next day if the time has passed", () => {
    const parsed = parseCron("30 9 * * *");
    // From: local time 10:00 today (past 9:30)
    const from = new Date();
    from.setHours(10, 0, 0, 0);
    const next = getNextRunTime(parsed, from);

    // Should be 9:30 tomorrow
    expect(next.getHours()).toBe(9);
    expect(next.getMinutes()).toBe(30);
    const tomorrow = new Date(from);
    tomorrow.setDate(tomorrow.getDate() + 1);
    expect(next.getDate()).toBe(tomorrow.getDate());
  });

  it("finds next run for step-based minute", () => {
    // Every 15 minutes
    const parsed = parseCron("*/15 * * * *");
    const from = new Date();
    from.setMinutes(2, 0, 0);
    const next = getNextRunTime(parsed, from);

    // Next minute divisible by 15 after :02 → :15
    expect(next.getMinutes()).toBe(15);
  });

  it("finds next run for every-30-minutes schedule", () => {
    const parsed = parseCron("*/30 * * * *");
    const from = new Date();
    from.setMinutes(31, 0, 0);
    const next = getNextRunTime(parsed, from);

    // Next: :00 of the following hour
    expect(next.getMinutes()).toBe(0);
    expect(next.getHours()).toBe((from.getHours() + 1) % 24);
  });

  it("respects day-of-week constraint", () => {
    // Every Monday at 09:00
    const parsed = parseCron("0 9 * * 1");
    // Start from a Wednesday
    const from = new Date();
    // Set to a known Wednesday: find the next Wednesday from now
    while (from.getDay() !== 3) {
      from.setDate(from.getDate() + 1);
    }
    from.setHours(10, 0, 0, 0);
    const next = getNextRunTime(parsed, from);

    // Should land on Monday
    expect(next.getDay()).toBe(1);
    expect(next.getHours()).toBe(9);
    expect(next.getMinutes()).toBe(0);
  });
});

describe("Scheduler", () => {
  let scheduler: Scheduler;

  beforeEach(() => {
    scheduler = new Scheduler();
  });

  afterEach(() => {
    scheduler.stop();
  });

  it("starts with no tasks", () => {
    expect(scheduler.listTasks()).toHaveLength(0);
  });

  it("adds a task and assigns an ID", () => {
    const task = scheduler.addTask({
      name: "test-scan",
      cron: "0 9 * * *",
      command: "scan",
      enabled: true,
    });

    expect(task.id).toBeDefined();
    expect(task.name).toBe("test-scan");
    expect(task.cron).toBe("0 9 * * *");
    expect(scheduler.listTasks()).toHaveLength(1);
  });

  it("rejects a task with an invalid cron expression", () => {
    expect(() =>
      scheduler.addTask({
        name: "bad-cron",
        cron: "invalid",
        command: "scan",
        enabled: true,
      }),
    ).toThrow();
  });

  it("removes a task", () => {
    const task = scheduler.addTask({
      name: "to-remove",
      cron: "0 9 * * *",
      command: "scan",
      enabled: true,
    });

    expect(scheduler.removeTask(task.id)).toBe(true);
    expect(scheduler.listTasks()).toHaveLength(0);
  });

  it("returns false when removing non-existent task", () => {
    expect(scheduler.removeTask("nonexistent")).toBe(false);
  });

  it("enables and disables a task", () => {
    const task = scheduler.addTask({
      name: "toggle-me",
      cron: "0 9 * * *",
      command: "scan",
      enabled: true,
    });

    scheduler.disableTask(task.id);
    const tasks = scheduler.listTasks();
    expect(tasks[0].enabled).toBe(false);

    scheduler.enableTask(task.id);
    const tasks2 = scheduler.listTasks();
    expect(tasks2[0].enabled).toBe(true);
  });

  it("throws when enabling non-existent task", () => {
    expect(() => scheduler.enableTask("nope")).toThrow("Task not found");
  });

  it("throws when disabling non-existent task", () => {
    expect(() => scheduler.disableTask("nope")).toThrow("Task not found");
  });

  it("starts and stops without error", () => {
    scheduler.addTask({
      name: "periodic",
      cron: "*/5 * * * *",
      command: "scan",
      enabled: true,
    });

    // Should not throw
    scheduler.start();
    scheduler.stop();
  });

  it("does not schedule disabled tasks on start", () => {
    scheduler.addTask({
      name: "disabled",
      cron: "0 9 * * *",
      command: "scan",
      enabled: false,
    });

    scheduler.start();
    // The task should not have nextRunAt set by scheduleNext
    // (since it's disabled, scheduleNext is not called)
    const tasks = scheduler.listTasks();
    expect(tasks[0].nextRunAt).toBeUndefined();

    scheduler.stop();
  });
});
