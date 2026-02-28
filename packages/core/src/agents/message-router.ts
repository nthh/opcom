import { randomUUID } from "node:crypto";
import type { AgentMessage, DeliveryMode } from "@opcom/types";

type MessageHandler = (message: AgentMessage) => void;

export class MessageRouter {
  private queues = new Map<string, AgentMessage[]>();
  private subscribers = new Map<string, Set<MessageHandler>>();
  private agentStates = new Map<string, "idle" | "streaming">();
  private log: AgentMessage[] = [];

  send(
    from: string,
    to: string,
    text: string,
    delivery: DeliveryMode = "followUp",
  ): AgentMessage {
    const message: AgentMessage = {
      id: randomUUID(),
      from,
      to,
      text,
      delivery,
      timestamp: new Date().toISOString(),
      delivered: false,
    };

    this.log.push(message);

    const state = this.agentStates.get(to) ?? "idle";

    if (delivery === "prompt" && state === "idle") {
      // Deliver immediately
      this.deliver(message);
    } else if (delivery === "steer" && state === "streaming") {
      // Inject immediately during streaming
      this.deliver(message);
    } else {
      // Queue for later delivery
      if (!this.queues.has(to)) {
        this.queues.set(to, []);
      }
      this.queues.get(to)!.push(message);
    }

    return message;
  }

  setAgentState(agentId: string, state: "idle" | "streaming"): void {
    const prevState = this.agentStates.get(agentId);
    this.agentStates.set(agentId, state);

    // When agent becomes idle, deliver queued followUp messages
    if (state === "idle" && prevState === "streaming") {
      this.deliverQueued(agentId);
    }
  }

  subscribe(agentId: string): AsyncIterable<AgentMessage> {
    const self = this;
    return {
      [Symbol.asyncIterator]() {
        const queue: AgentMessage[] = [];
        let resolve: (() => void) | null = null;

        const handler: MessageHandler = (msg) => {
          queue.push(msg);
          if (resolve) {
            resolve();
            resolve = null;
          }
        };

        if (!self.subscribers.has(agentId)) {
          self.subscribers.set(agentId, new Set());
        }
        self.subscribers.get(agentId)!.add(handler);

        return {
          async next() {
            if (queue.length > 0) {
              return { value: queue.shift()!, done: false };
            }
            await new Promise<void>((r) => { resolve = r; });
            if (queue.length > 0) {
              return { value: queue.shift()!, done: false };
            }
            return { value: undefined as unknown as AgentMessage, done: true };
          },
          async return() {
            self.subscribers.get(agentId)?.delete(handler);
            return { value: undefined as unknown as AgentMessage, done: true };
          },
          [Symbol.asyncIterator]() { return this; },
        };
      },
    };
  }

  getLog(): AgentMessage[] {
    return [...this.log];
  }

  getQueuedMessages(agentId: string): AgentMessage[] {
    return [...(this.queues.get(agentId) ?? [])];
  }

  clearAgent(agentId: string): void {
    this.queues.delete(agentId);
    this.subscribers.delete(agentId);
    this.agentStates.delete(agentId);
  }

  private deliver(message: AgentMessage): void {
    message.delivered = true;
    const handlers = this.subscribers.get(message.to);
    if (handlers) {
      for (const h of handlers) h(message);
    }
  }

  private deliverQueued(agentId: string): void {
    const queue = this.queues.get(agentId);
    if (!queue || queue.length === 0) return;

    const toDeliver = queue.splice(0);
    for (const msg of toDeliver) {
      this.deliver(msg);
    }
  }
}
