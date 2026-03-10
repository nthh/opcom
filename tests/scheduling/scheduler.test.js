"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const core_1 = require("@opcom/core");
(0, vitest_1.describe)("parseCronField", () => {
    (0, vitest_1.it)("parses wildcard", () => {
        (0, vitest_1.expect)((0, core_1.parseCronField)("*")).toEqual({ type: "wildcard" });
    });
    (0, vitest_1.it)("parses a specific value", () => {
        (0, vitest_1.expect)((0, core_1.parseCronField)("30")).toEqual({ type: "value", value: 30 });
    });
    (0, vitest_1.it)("parses a step expression", () => {
        (0, vitest_1.expect)((0, core_1.parseCronField)("*/5")).toEqual({ type: "step", step: 5 });
    });
    (0, vitest_1.it)("rejects invalid step", () => {
        (0, vitest_1.expect)(() => (0, core_1.parseCronField)("*/0")).toThrow("Invalid cron step");
    });
    (0, vitest_1.it)("rejects non-numeric value", () => {
        (0, vitest_1.expect)(() => (0, core_1.parseCronField)("abc")).toThrow("Invalid cron field");
    });
});
(0, vitest_1.describe)("parseCron", () => {
    (0, vitest_1.it)("parses a full 5-field expression", () => {
        const parsed = (0, core_1.parseCron)("30 9 * * 1");
        (0, vitest_1.expect)(parsed.minute).toEqual({ type: "value", value: 30 });
        (0, vitest_1.expect)(parsed.hour).toEqual({ type: "value", value: 9 });
        (0, vitest_1.expect)(parsed.dayOfMonth).toEqual({ type: "wildcard" });
        (0, vitest_1.expect)(parsed.month).toEqual({ type: "wildcard" });
        (0, vitest_1.expect)(parsed.dayOfWeek).toEqual({ type: "value", value: 1 });
    });
    (0, vitest_1.it)("parses step expressions in multiple fields", () => {
        const parsed = (0, core_1.parseCron)("*/15 */6 * * *");
        (0, vitest_1.expect)(parsed.minute).toEqual({ type: "step", step: 15 });
        (0, vitest_1.expect)(parsed.hour).toEqual({ type: "step", step: 6 });
    });
    (0, vitest_1.it)("rejects expression with wrong number of fields", () => {
        (0, vitest_1.expect)(() => (0, core_1.parseCron)("* * *")).toThrow("expected 5 fields");
    });
    (0, vitest_1.it)("parses every-30-minutes schedule", () => {
        const parsed = (0, core_1.parseCron)("*/30 * * * *");
        (0, vitest_1.expect)(parsed.minute).toEqual({ type: "step", step: 30 });
        (0, vitest_1.expect)(parsed.hour).toEqual({ type: "wildcard" });
    });
    (0, vitest_1.it)("parses daily-at-9am schedule", () => {
        const parsed = (0, core_1.parseCron)("0 9 * * *");
        (0, vitest_1.expect)(parsed.minute).toEqual({ type: "value", value: 0 });
        (0, vitest_1.expect)(parsed.hour).toEqual({ type: "value", value: 9 });
    });
});
(0, vitest_1.describe)("getNextRunTime", () => {
    (0, vitest_1.it)("finds next occurrence for a specific time", () => {
        // Cron: minute=30, hour=14, every day (uses local time)
        const parsed = (0, core_1.parseCron)("30 14 * * *");
        // From: local time noon today
        const from = new Date();
        from.setHours(12, 0, 0, 0);
        const next = (0, core_1.getNextRunTime)(parsed, from);
        // Should be 14:30 local time today
        (0, vitest_1.expect)(next.getHours()).toBe(14);
        (0, vitest_1.expect)(next.getMinutes()).toBe(30);
    });
    (0, vitest_1.it)("advances to the next day if the time has passed", () => {
        const parsed = (0, core_1.parseCron)("30 9 * * *");
        // From: local time 10:00 today (past 9:30)
        const from = new Date();
        from.setHours(10, 0, 0, 0);
        const next = (0, core_1.getNextRunTime)(parsed, from);
        // Should be 9:30 tomorrow
        (0, vitest_1.expect)(next.getHours()).toBe(9);
        (0, vitest_1.expect)(next.getMinutes()).toBe(30);
        const tomorrow = new Date(from);
        tomorrow.setDate(tomorrow.getDate() + 1);
        (0, vitest_1.expect)(next.getDate()).toBe(tomorrow.getDate());
    });
    (0, vitest_1.it)("finds next run for step-based minute", () => {
        // Every 15 minutes
        const parsed = (0, core_1.parseCron)("*/15 * * * *");
        const from = new Date();
        from.setMinutes(2, 0, 0);
        const next = (0, core_1.getNextRunTime)(parsed, from);
        // Next minute divisible by 15 after :02 → :15
        (0, vitest_1.expect)(next.getMinutes()).toBe(15);
    });
    (0, vitest_1.it)("finds next run for every-30-minutes schedule", () => {
        const parsed = (0, core_1.parseCron)("*/30 * * * *");
        const from = new Date();
        from.setMinutes(31, 0, 0);
        const next = (0, core_1.getNextRunTime)(parsed, from);
        // Next: :00 of the following hour
        (0, vitest_1.expect)(next.getMinutes()).toBe(0);
        (0, vitest_1.expect)(next.getHours()).toBe((from.getHours() + 1) % 24);
    });
    (0, vitest_1.it)("respects day-of-week constraint", () => {
        // Every Monday at 09:00
        const parsed = (0, core_1.parseCron)("0 9 * * 1");
        // Start from a Wednesday
        const from = new Date();
        // Set to a known Wednesday: find the next Wednesday from now
        while (from.getDay() !== 3) {
            from.setDate(from.getDate() + 1);
        }
        from.setHours(10, 0, 0, 0);
        const next = (0, core_1.getNextRunTime)(parsed, from);
        // Should land on Monday
        (0, vitest_1.expect)(next.getDay()).toBe(1);
        (0, vitest_1.expect)(next.getHours()).toBe(9);
        (0, vitest_1.expect)(next.getMinutes()).toBe(0);
    });
});
(0, vitest_1.describe)("Scheduler", () => {
    let scheduler;
    (0, vitest_1.beforeEach)(() => {
        scheduler = new core_1.Scheduler();
    });
    (0, vitest_1.afterEach)(() => {
        scheduler.stop();
    });
    (0, vitest_1.it)("starts with no tasks", () => {
        (0, vitest_1.expect)(scheduler.listTasks()).toHaveLength(0);
    });
    (0, vitest_1.it)("adds a task and assigns an ID", () => {
        const task = scheduler.addTask({
            name: "test-scan",
            cron: "0 9 * * *",
            command: "scan",
            enabled: true,
        });
        (0, vitest_1.expect)(task.id).toBeDefined();
        (0, vitest_1.expect)(task.name).toBe("test-scan");
        (0, vitest_1.expect)(task.cron).toBe("0 9 * * *");
        (0, vitest_1.expect)(scheduler.listTasks()).toHaveLength(1);
    });
    (0, vitest_1.it)("rejects a task with an invalid cron expression", () => {
        (0, vitest_1.expect)(() => scheduler.addTask({
            name: "bad-cron",
            cron: "invalid",
            command: "scan",
            enabled: true,
        })).toThrow();
    });
    (0, vitest_1.it)("removes a task", () => {
        const task = scheduler.addTask({
            name: "to-remove",
            cron: "0 9 * * *",
            command: "scan",
            enabled: true,
        });
        (0, vitest_1.expect)(scheduler.removeTask(task.id)).toBe(true);
        (0, vitest_1.expect)(scheduler.listTasks()).toHaveLength(0);
    });
    (0, vitest_1.it)("returns false when removing non-existent task", () => {
        (0, vitest_1.expect)(scheduler.removeTask("nonexistent")).toBe(false);
    });
    (0, vitest_1.it)("enables and disables a task", () => {
        const task = scheduler.addTask({
            name: "toggle-me",
            cron: "0 9 * * *",
            command: "scan",
            enabled: true,
        });
        scheduler.disableTask(task.id);
        const tasks = scheduler.listTasks();
        (0, vitest_1.expect)(tasks[0].enabled).toBe(false);
        scheduler.enableTask(task.id);
        const tasks2 = scheduler.listTasks();
        (0, vitest_1.expect)(tasks2[0].enabled).toBe(true);
    });
    (0, vitest_1.it)("throws when enabling non-existent task", () => {
        (0, vitest_1.expect)(() => scheduler.enableTask("nope")).toThrow("Task not found");
    });
    (0, vitest_1.it)("throws when disabling non-existent task", () => {
        (0, vitest_1.expect)(() => scheduler.disableTask("nope")).toThrow("Task not found");
    });
    (0, vitest_1.it)("starts and stops without error", () => {
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
    (0, vitest_1.it)("does not schedule disabled tasks on start", () => {
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
        (0, vitest_1.expect)(tasks[0].nextRunAt).toBeUndefined();
        scheduler.stop();
    });
});
//# sourceMappingURL=scheduler.test.js.map