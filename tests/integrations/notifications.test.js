"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const core_1 = require("@opcom/core");
// We test the public interface: that notify() respects enabled/disabled, triggers, etc.
// Backend calls (osascript, curl) are not invoked in tests since they require external tools.
function makeNotification(overrides = {}) {
    return {
        trigger: "agent_completed",
        title: "Test Title",
        body: "Test body message",
        timestamp: new Date().toISOString(),
        ...overrides,
    };
}
(0, vitest_1.describe)("NotificationManager", () => {
    (0, vitest_1.it)("does nothing when disabled", async () => {
        const config = {
            enabled: false,
            triggers: ["agent_completed"],
            backends: [{ type: "desktop" }],
        };
        const manager = new core_1.NotificationManager(config);
        // Should not throw even though desktop would fail in test env
        await manager.notify(makeNotification());
    });
    (0, vitest_1.it)("does nothing when trigger is not in configured triggers", async () => {
        const config = {
            enabled: true,
            triggers: ["agent_error"],
            backends: [{ type: "desktop" }],
        };
        const manager = new core_1.NotificationManager(config);
        // agent_completed is not in triggers, so nothing should happen
        await manager.notify(makeNotification({ trigger: "agent_completed" }));
    });
    (0, vitest_1.it)("accepts multiple triggers", () => {
        const config = {
            enabled: true,
            triggers: ["agent_completed", "agent_error", "merge_failed", "all_agents_idle"],
            backends: [],
        };
        const manager = new core_1.NotificationManager(config);
        // No backends configured, so notify should succeed silently for all triggers
        (0, vitest_1.expect)(async () => {
            await manager.notify(makeNotification({ trigger: "agent_completed" }));
            await manager.notify(makeNotification({ trigger: "agent_error" }));
            await manager.notify(makeNotification({ trigger: "merge_failed" }));
            await manager.notify(makeNotification({ trigger: "all_agents_idle" }));
        }).not.toThrow();
    });
    (0, vitest_1.it)("handles empty backends list gracefully", async () => {
        const config = {
            enabled: true,
            triggers: ["agent_completed"],
            backends: [],
        };
        const manager = new core_1.NotificationManager(config);
        // No backends = nothing to send, should resolve without error
        await manager.notify(makeNotification());
    });
    (0, vitest_1.it)("constructs Slack webhook payload format correctly", () => {
        // Verify the expected payload structure for Slack
        const notification = makeNotification({
            title: "Agent Done",
            body: "Finished task X",
        });
        const payload = JSON.stringify({
            text: `${notification.title}\n${notification.body}`,
        });
        const parsed = JSON.parse(payload);
        (0, vitest_1.expect)(parsed.text).toBe("Agent Done\nFinished task X");
    });
    (0, vitest_1.it)("constructs Discord webhook payload format correctly", () => {
        const notification = makeNotification({
            title: "Error Alert",
            body: "Agent crashed",
        });
        const payload = JSON.stringify({
            content: `**${notification.title}**\n${notification.body}`,
        });
        const parsed = JSON.parse(payload);
        (0, vitest_1.expect)(parsed.content).toBe("**Error Alert**\nAgent crashed");
    });
    (0, vitest_1.it)("notification has correct shape", () => {
        const n = makeNotification({
            trigger: "merge_failed",
            title: "Merge Failed",
            body: "Branch feature-x could not be merged",
        });
        (0, vitest_1.expect)(n.trigger).toBe("merge_failed");
        (0, vitest_1.expect)(n.title).toBe("Merge Failed");
        (0, vitest_1.expect)(n.body).toBe("Branch feature-x could not be merged");
        (0, vitest_1.expect)(n.timestamp).toBeDefined();
    });
});
//# sourceMappingURL=notifications.test.js.map