"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const core_1 = require("@opcom/core");
(0, vitest_1.describe)("MessageRouter", () => {
    (0, vitest_1.it)("sends and receives prompt messages to idle agents", async () => {
        const router = new core_1.MessageRouter();
        router.setAgentState("agent-1", "idle");
        const received = [];
        const iter = router.subscribe("agent-1");
        const reader = (async () => {
            for await (const msg of iter) {
                received.push(msg.text);
                if (received.length >= 1)
                    break;
            }
        })();
        router.send("user", "agent-1", "hello", "prompt");
        await reader;
        (0, vitest_1.expect)(received).toEqual(["hello"]);
    });
    (0, vitest_1.it)("queues followUp messages when agent is streaming", () => {
        const router = new core_1.MessageRouter();
        router.setAgentState("agent-1", "streaming");
        const msg = router.send("user", "agent-1", "check this", "followUp");
        (0, vitest_1.expect)(msg.delivered).toBe(false);
        const queued = router.getQueuedMessages("agent-1");
        (0, vitest_1.expect)(queued).toHaveLength(1);
        (0, vitest_1.expect)(queued[0].text).toBe("check this");
    });
    (0, vitest_1.it)("delivers followUp messages when agent becomes idle", async () => {
        const router = new core_1.MessageRouter();
        router.setAgentState("agent-1", "streaming");
        const received = [];
        const iter = router.subscribe("agent-1");
        const reader = (async () => {
            for await (const msg of iter) {
                received.push(msg.text);
                if (received.length >= 2)
                    break;
            }
        })();
        router.send("user", "agent-1", "msg 1", "followUp");
        router.send("user", "agent-1", "msg 2", "followUp");
        // Transition to idle — should deliver queued messages
        router.setAgentState("agent-1", "idle");
        await reader;
        (0, vitest_1.expect)(received).toEqual(["msg 1", "msg 2"]);
    });
    (0, vitest_1.it)("delivers steer messages to streaming agents", async () => {
        const router = new core_1.MessageRouter();
        router.setAgentState("agent-1", "streaming");
        const received = [];
        const iter = router.subscribe("agent-1");
        const reader = (async () => {
            for await (const msg of iter) {
                received.push(msg.text);
                if (received.length >= 1)
                    break;
            }
        })();
        router.send("user", "agent-1", "change direction", "steer");
        await reader;
        (0, vitest_1.expect)(received).toEqual(["change direction"]);
    });
    (0, vitest_1.it)("queues steer messages for idle agents", () => {
        const router = new core_1.MessageRouter();
        router.setAgentState("agent-1", "idle");
        const msg = router.send("user", "agent-1", "steer msg", "steer");
        (0, vitest_1.expect)(msg.delivered).toBe(false);
        const queued = router.getQueuedMessages("agent-1");
        (0, vitest_1.expect)(queued).toHaveLength(1);
    });
    (0, vitest_1.it)("maintains message log", () => {
        const router = new core_1.MessageRouter();
        router.setAgentState("agent-1", "idle");
        router.send("user", "agent-1", "msg 1", "prompt");
        router.send("agent-1", "agent-2", "msg 2", "followUp");
        const log = router.getLog();
        (0, vitest_1.expect)(log).toHaveLength(2);
        (0, vitest_1.expect)(log[0].from).toBe("user");
        (0, vitest_1.expect)(log[0].to).toBe("agent-1");
        (0, vitest_1.expect)(log[1].from).toBe("agent-1");
        (0, vitest_1.expect)(log[1].to).toBe("agent-2");
    });
    (0, vitest_1.it)("clears agent state and queues", () => {
        const router = new core_1.MessageRouter();
        router.setAgentState("agent-1", "streaming");
        router.send("user", "agent-1", "msg", "followUp");
        router.clearAgent("agent-1");
        (0, vitest_1.expect)(router.getQueuedMessages("agent-1")).toHaveLength(0);
    });
});
//# sourceMappingURL=message-router.test.js.map