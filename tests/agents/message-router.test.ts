import { describe, it, expect } from "vitest";
import { MessageRouter } from "@opcom/core";

describe("MessageRouter", () => {
  it("sends and receives prompt messages to idle agents", async () => {
    const router = new MessageRouter();
    router.setAgentState("agent-1", "idle");

    const received: string[] = [];
    const iter = router.subscribe("agent-1");
    const reader = (async () => {
      for await (const msg of iter) {
        received.push(msg.text);
        if (received.length >= 1) break;
      }
    })();

    router.send("user", "agent-1", "hello", "prompt");

    await reader;
    expect(received).toEqual(["hello"]);
  });

  it("queues followUp messages when agent is streaming", () => {
    const router = new MessageRouter();
    router.setAgentState("agent-1", "streaming");

    const msg = router.send("user", "agent-1", "check this", "followUp");
    expect(msg.delivered).toBe(false);

    const queued = router.getQueuedMessages("agent-1");
    expect(queued).toHaveLength(1);
    expect(queued[0].text).toBe("check this");
  });

  it("delivers followUp messages when agent becomes idle", async () => {
    const router = new MessageRouter();
    router.setAgentState("agent-1", "streaming");

    const received: string[] = [];
    const iter = router.subscribe("agent-1");
    const reader = (async () => {
      for await (const msg of iter) {
        received.push(msg.text);
        if (received.length >= 2) break;
      }
    })();

    router.send("user", "agent-1", "msg 1", "followUp");
    router.send("user", "agent-1", "msg 2", "followUp");

    // Transition to idle — should deliver queued messages
    router.setAgentState("agent-1", "idle");

    await reader;
    expect(received).toEqual(["msg 1", "msg 2"]);
  });

  it("delivers steer messages to streaming agents", async () => {
    const router = new MessageRouter();
    router.setAgentState("agent-1", "streaming");

    const received: string[] = [];
    const iter = router.subscribe("agent-1");
    const reader = (async () => {
      for await (const msg of iter) {
        received.push(msg.text);
        if (received.length >= 1) break;
      }
    })();

    router.send("user", "agent-1", "change direction", "steer");

    await reader;
    expect(received).toEqual(["change direction"]);
  });

  it("queues steer messages for idle agents", () => {
    const router = new MessageRouter();
    router.setAgentState("agent-1", "idle");

    const msg = router.send("user", "agent-1", "steer msg", "steer");
    expect(msg.delivered).toBe(false);

    const queued = router.getQueuedMessages("agent-1");
    expect(queued).toHaveLength(1);
  });

  it("maintains message log", () => {
    const router = new MessageRouter();
    router.setAgentState("agent-1", "idle");

    router.send("user", "agent-1", "msg 1", "prompt");
    router.send("agent-1", "agent-2", "msg 2", "followUp");

    const log = router.getLog();
    expect(log).toHaveLength(2);
    expect(log[0].from).toBe("user");
    expect(log[0].to).toBe("agent-1");
    expect(log[1].from).toBe("agent-1");
    expect(log[1].to).toBe("agent-2");
  });

  it("clears agent state and queues", () => {
    const router = new MessageRouter();
    router.setAgentState("agent-1", "streaming");
    router.send("user", "agent-1", "msg", "followUp");

    router.clearAgent("agent-1");

    expect(router.getQueuedMessages("agent-1")).toHaveLength(0);
  });
});
