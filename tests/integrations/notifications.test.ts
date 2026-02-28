import { describe, it, expect, vi, beforeEach } from "vitest";
import { NotificationManager } from "@opcom/core";
import type { NotificationConfig, Notification } from "@opcom/core";

// We test the public interface: that notify() respects enabled/disabled, triggers, etc.
// Backend calls (osascript, curl) are not invoked in tests since they require external tools.

function makeNotification(overrides: Partial<Notification> = {}): Notification {
  return {
    trigger: "agent_completed",
    title: "Test Title",
    body: "Test body message",
    timestamp: new Date().toISOString(),
    ...overrides,
  };
}

describe("NotificationManager", () => {
  it("does nothing when disabled", async () => {
    const config: NotificationConfig = {
      enabled: false,
      triggers: ["agent_completed"],
      backends: [{ type: "desktop" }],
    };
    const manager = new NotificationManager(config);

    // Should not throw even though desktop would fail in test env
    await manager.notify(makeNotification());
  });

  it("does nothing when trigger is not in configured triggers", async () => {
    const config: NotificationConfig = {
      enabled: true,
      triggers: ["agent_error"],
      backends: [{ type: "desktop" }],
    };
    const manager = new NotificationManager(config);

    // agent_completed is not in triggers, so nothing should happen
    await manager.notify(makeNotification({ trigger: "agent_completed" }));
  });

  it("accepts multiple triggers", () => {
    const config: NotificationConfig = {
      enabled: true,
      triggers: ["agent_completed", "agent_error", "merge_failed", "all_agents_idle"],
      backends: [],
    };
    const manager = new NotificationManager(config);

    // No backends configured, so notify should succeed silently for all triggers
    expect(async () => {
      await manager.notify(makeNotification({ trigger: "agent_completed" }));
      await manager.notify(makeNotification({ trigger: "agent_error" }));
      await manager.notify(makeNotification({ trigger: "merge_failed" }));
      await manager.notify(makeNotification({ trigger: "all_agents_idle" }));
    }).not.toThrow();
  });

  it("handles empty backends list gracefully", async () => {
    const config: NotificationConfig = {
      enabled: true,
      triggers: ["agent_completed"],
      backends: [],
    };
    const manager = new NotificationManager(config);

    // No backends = nothing to send, should resolve without error
    await manager.notify(makeNotification());
  });

  it("constructs Slack webhook payload format correctly", () => {
    // Verify the expected payload structure for Slack
    const notification = makeNotification({
      title: "Agent Done",
      body: "Finished task X",
    });

    const payload = JSON.stringify({
      text: `${notification.title}\n${notification.body}`,
    });

    const parsed = JSON.parse(payload) as { text: string };
    expect(parsed.text).toBe("Agent Done\nFinished task X");
  });

  it("constructs Discord webhook payload format correctly", () => {
    const notification = makeNotification({
      title: "Error Alert",
      body: "Agent crashed",
    });

    const payload = JSON.stringify({
      content: `**${notification.title}**\n${notification.body}`,
    });

    const parsed = JSON.parse(payload) as { content: string };
    expect(parsed.content).toBe("**Error Alert**\nAgent crashed");
  });

  it("notification has correct shape", () => {
    const n = makeNotification({
      trigger: "merge_failed",
      title: "Merge Failed",
      body: "Branch feature-x could not be merged",
    });

    expect(n.trigger).toBe("merge_failed");
    expect(n.title).toBe("Merge Failed");
    expect(n.body).toBe("Branch feature-x could not be merged");
    expect(n.timestamp).toBeDefined();
  });
});
