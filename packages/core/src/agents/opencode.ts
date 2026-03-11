import { spawn, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import type {
  AgentAdapter,
  AgentSession,
  AgentStartConfig,
  NormalizedEvent,
  NormalizedEventType,
} from "@opcom/types";

interface RunningProcess {
  proc: ChildProcess;
  session: AgentSession;
  port: number;
  openCodeSessionId?: string;
  eventBuffer: NormalizedEvent[];
  subscribers: Set<(event: NormalizedEvent) => void>;
  abortController: AbortController;
}

/**
 * Returns a random port in the ephemeral range (49152-65535).
 */
function randomPort(): number {
  return 49152 + Math.floor(Math.random() * (65535 - 49152));
}

/**
 * Wait for the opencode server to become healthy.
 * Retries with exponential backoff up to ~10 seconds total.
 */
async function waitForServer(
  port: number,
  signal: AbortSignal,
  maxAttempts = 20,
  initialDelay = 200,
): Promise<boolean> {
  let delay = initialDelay;
  for (let i = 0; i < maxAttempts; i++) {
    if (signal.aborted) return false;
    try {
      const resp = await fetch(`http://127.0.0.1:${port}/health`, {
        signal: AbortSignal.timeout(2000),
      });
      if (resp.ok) return true;
    } catch {
      // Server not ready yet
    }
    await new Promise<void>((r) => setTimeout(r, delay));
    delay = Math.min(delay * 1.5, 2000);
  }
  return false;
}

/**
 * Build an OpenCode config JSON that injects context and model selection.
 */
function buildOpenCodeConfig(config: AgentStartConfig): string {
  const ctx = config.contextPacket;
  const parts: string[] = [];

  parts.push(`# Project: ${ctx.project.name}`);
  parts.push(`Path: ${ctx.project.path}`);

  const langs = ctx.project.stack.languages
    .map((l) => l.name + (l.version ? ` ${l.version}` : ""))
    .join(", ");
  if (langs) parts.push(`Languages: ${langs}`);

  const fws = ctx.project.stack.frameworks.map((f) => f.name).join(", ");
  if (fws) parts.push(`Frameworks: ${fws}`);

  const infra = ctx.project.stack.infrastructure.map((i) => i.name).join(", ");
  if (infra) parts.push(`Infrastructure: ${infra}`);

  const testSuites = Array.isArray(ctx.project.testing) ? ctx.project.testing : (ctx.project.testing ? [ctx.project.testing] : []);
  if (testSuites.length > 0) {
    if (testSuites.length === 1) {
      parts.push(`\nTesting: ${testSuites[0].framework}`);
      if (testSuites[0].command) parts.push(`Test command: ${testSuites[0].command}`);
    } else {
      parts.push(`\nTest suites:`);
      for (const s of testSuites) {
        const pathHint = s.paths?.length ? ` (for changes in: ${s.paths.join(", ")})` : "";
        parts.push(`- ${s.name} (${s.framework}): \`${s.command}\`${pathHint}`);
      }
    }
  }

  if (ctx.project.linting.length > 0) {
    parts.push(`Linting: ${ctx.project.linting.map((l) => l.name).join(", ")}`);
  }

  parts.push(`\nGit branch: ${ctx.git.branch}`);
  parts.push(`Git clean: ${ctx.git.clean}`);

  if (ctx.workItem) {
    const t = ctx.workItem.ticket;
    parts.push(`\n# Task: ${t.title}`);
    parts.push(`Ticket: ${t.id} (${t.type}, P${t.priority}, ${t.status})`);
    if (t.deps.length > 0) {
      parts.push(`Dependencies: ${t.deps.join(", ")}`);
    }
    if (ctx.workItem.spec) {
      parts.push(`\n# Specification\n${ctx.workItem.spec}`);
    }
  }

  if (ctx.agentConfig) {
    parts.push(`\n# Agent Configuration\n${ctx.agentConfig}`);
  }

  if (ctx.memory) {
    parts.push(`\n# Memory\n${ctx.memory}`);
  }

  const systemPrompt = parts.join("\n");

  // Build opencode config object
  const openCodeConfig: Record<string, unknown> = {
    system_prompt: systemPrompt,
  };

  if (config.model) {
    openCodeConfig.model = config.model;
  }

  return JSON.stringify(openCodeConfig);
}

/**
 * Parse raw SSE text into individual events.
 * Each event is separated by a blank line. Fields are "event:", "data:", "id:".
 */
export function parseSSEEvents(
  raw: string,
): Array<{ event?: string; data: string; id?: string }> {
  const events: Array<{ event?: string; data: string; id?: string }> = [];
  const blocks = raw.split(/\n\n+/);

  for (const block of blocks) {
    const trimmed = block.trim();
    if (!trimmed) continue;

    let event: string | undefined;
    let id: string | undefined;
    const dataLines: string[] = [];

    for (const line of trimmed.split("\n")) {
      if (line.startsWith("event:")) {
        event = line.slice(6).trim();
      } else if (line.startsWith("data:")) {
        dataLines.push(line.slice(5).trim());
      } else if (line.startsWith("id:")) {
        id = line.slice(3).trim();
      }
      // Lines starting with ":" are comments, ignore them
    }

    if (dataLines.length > 0) {
      events.push({
        event,
        data: dataLines.join("\n"),
        id,
      });
    }
  }

  return events;
}

/**
 * Map an OpenCode SSE event to NormalizedEvent(s).
 */
export function mapOpenCodeEvent(
  sessionId: string,
  sseEvent: { event?: string; data: string },
): NormalizedEvent[] {
  const events: NormalizedEvent[] = [];
  const ts = new Date().toISOString();

  let parsed: Record<string, unknown> = {};
  try {
    parsed = JSON.parse(sseEvent.data) as Record<string, unknown>;
  } catch {
    // If data isn't JSON, treat as text delta
    if (sseEvent.data) {
      events.push({
        type: "message_delta",
        sessionId,
        timestamp: ts,
        data: { text: sseEvent.data },
      });
    }
    return events;
  }

  const eventType = sseEvent.event ?? (parsed.type as string | undefined) ?? "";

  switch (eventType) {
    case "session.created":
    case "session_created":
      events.push({
        type: "agent_start",
        sessionId,
        timestamp: ts,
        data: { reason: "session created", raw: parsed },
      });
      break;

    case "session.ended":
    case "session_ended":
      events.push({
        type: "agent_end",
        sessionId,
        timestamp: ts,
        data: { reason: "session ended", raw: parsed },
      });
      break;

    case "message.start":
    case "message_start":
      events.push({
        type: "message_start",
        sessionId,
        timestamp: ts,
        data: { role: "assistant", raw: parsed },
      });
      break;

    case "message.delta":
    case "message_delta":
    case "content.delta":
    case "content_delta": {
      const text =
        (parsed.text as string) ??
        (parsed.delta as string) ??
        (parsed.content as string) ??
        "";
      events.push({
        type: "message_delta",
        sessionId,
        timestamp: ts,
        data: { text, raw: parsed },
      });
      break;
    }

    case "message.end":
    case "message_end":
    case "message.complete":
    case "message_complete":
      events.push({
        type: "message_end",
        sessionId,
        timestamp: ts,
        data: { role: "assistant", raw: parsed },
      });
      break;

    case "tool.start":
    case "tool_start":
    case "tool_call.start":
    case "tool_call_start":
      events.push({
        type: "tool_start",
        sessionId,
        timestamp: ts,
        data: {
          toolName: (parsed.name as string) ?? (parsed.tool as string) ?? "unknown",
          toolInput:
            typeof parsed.input === "string"
              ? parsed.input
              : JSON.stringify(parsed.input ?? parsed.arguments ?? ""),
          raw: parsed,
        },
      });
      break;

    case "tool.end":
    case "tool_end":
    case "tool_call.end":
    case "tool_call_end":
      events.push({
        type: "tool_end",
        sessionId,
        timestamp: ts,
        data: {
          toolOutput:
            typeof parsed.output === "string"
              ? parsed.output
              : JSON.stringify(parsed.output ?? parsed.result ?? ""),
          toolSuccess: parsed.success !== false && parsed.error === undefined,
          raw: parsed,
        },
      });
      break;

    case "error":
      events.push({
        type: "error",
        sessionId,
        timestamp: ts,
        data: {
          reason: (parsed.message as string) ?? (parsed.error as string) ?? "unknown error",
          raw: parsed,
        },
      });
      break;

    case "turn.start":
    case "turn_start":
      events.push({
        type: "turn_start",
        sessionId,
        timestamp: ts,
        data: { raw: parsed },
      });
      break;

    case "turn.end":
    case "turn_end":
      events.push({
        type: "turn_end",
        sessionId,
        timestamp: ts,
        data: { raw: parsed },
      });
      break;

    default:
      // Unknown event, emit as message_delta if there's text content,
      // otherwise skip silently
      if (parsed.text || parsed.content || parsed.delta) {
        events.push({
          type: "message_delta",
          sessionId,
          timestamp: ts,
          data: {
            text: (parsed.text as string) ?? (parsed.content as string) ?? (parsed.delta as string) ?? "",
            raw: parsed,
          },
        });
      }
  }

  return events;
}

export class OpenCodeAdapter implements AgentAdapter {
  readonly backend = "opencode" as const;

  private processes = new Map<string, RunningProcess>();

  async start(config: AgentStartConfig): Promise<AgentSession> {
    const sessionId = randomUUID();
    const cwd = config.cwd ?? config.projectPath;
    const port = randomPort();

    // Build opencode config to inject via env var
    const configContent = buildOpenCodeConfig(config);

    const args = ["serve", "--port", String(port)];

    const proc = spawn("opencode", args, {
      cwd,
      stdio: ["pipe", "pipe", "pipe"],
      env: {
        ...process.env,
        OPENCODE_CONFIG_CONTENT: configContent,
      },
    });

    const session: AgentSession = {
      id: sessionId,
      backend: "opencode",
      projectId: config.contextPacket.project.name,
      state: "idle",
      startedAt: new Date().toISOString(),
      workItemId: config.workItemId,
      pid: proc.pid,
      skills: config.contextPacket.skills,
    };

    const abortController = new AbortController();

    const running: RunningProcess = {
      proc,
      session,
      port,
      eventBuffer: [],
      subscribers: new Set(),
      abortController,
    };

    this.processes.set(sessionId, running);

    // Handle process exit
    proc.on("close", (code) => {
      const r = this.processes.get(sessionId);
      if (r) {
        r.session.state = "stopped";
        r.session.stoppedAt = new Date().toISOString();
      }
      this.emitEvent(sessionId, {
        type: "agent_end",
        sessionId,
        timestamp: new Date().toISOString(),
        data: { reason: code === 0 ? "completed" : `exit code ${code}` },
      });
    });

    proc.on("error", (err) => {
      const r = this.processes.get(sessionId);
      if (r) r.session.state = "error";
      this.emitEvent(sessionId, {
        type: "error",
        sessionId,
        timestamp: new Date().toISOString(),
        data: { reason: err.message },
      });
    });

    // Wait for server to be ready
    const ready = await waitForServer(port, abortController.signal);
    if (!ready) {
      // Cleanup on failure
      proc.kill("SIGTERM");
      this.processes.delete(sessionId);
      throw new Error(`OpenCode server failed to start on port ${port}`);
    }

    // Create a session via the API
    try {
      const createResp = await fetch(`http://127.0.0.1:${port}/session`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });

      if (!createResp.ok) {
        throw new Error(`Failed to create session: ${createResp.status} ${createResp.statusText}`);
      }

      const sessionData = (await createResp.json()) as Record<string, unknown>;
      running.openCodeSessionId = (sessionData.id as string) ?? (sessionData.session_id as string);
    } catch (err) {
      // If session creation fails, kill the server
      proc.kill("SIGTERM");
      this.processes.delete(sessionId);
      throw new Error(
        `Failed to create OpenCode session: ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    session.state = "streaming";

    // Emit agent_start
    this.emitEvent(sessionId, {
      type: "agent_start",
      sessionId,
      timestamp: new Date().toISOString(),
      data: { reason: "started" },
    });

    // Start SSE subscription in background
    this.subscribeToSSE(sessionId).catch(() => {
      // SSE subscription ended, that's fine
    });

    return session;
  }

  async stop(sessionId: string): Promise<void> {
    const running = this.processes.get(sessionId);
    if (!running) return;

    // Abort any in-flight fetch requests
    running.abortController.abort();

    running.proc.kill("SIGTERM");

    // Give it 5s then force kill
    await new Promise<void>((resolve) => {
      const timeout = setTimeout(() => {
        running.proc.kill("SIGKILL");
        resolve();
      }, 5000);

      running.proc.on("close", () => {
        clearTimeout(timeout);
        resolve();
      });
    });

    running.session.state = "stopped";
    running.session.stoppedAt = new Date().toISOString();
    this.processes.delete(sessionId);
  }

  async prompt(sessionId: string, message: string): Promise<void> {
    const running = this.processes.get(sessionId);
    if (!running) throw new Error(`No running session: ${sessionId}`);
    if (!running.openCodeSessionId) throw new Error("OpenCode session not initialized");

    const resp = await fetch(
      `http://127.0.0.1:${running.port}/session/${running.openCodeSessionId}/chat`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: message }),
        signal: running.abortController.signal,
      },
    );

    if (!resp.ok) {
      throw new Error(`Chat request failed: ${resp.status} ${resp.statusText}`);
    }

    running.session.state = "streaming";
  }

  async *subscribe(sessionId: string): AsyncIterable<NormalizedEvent> {
    const running = this.processes.get(sessionId);
    if (!running) return;

    // Yield buffered events first
    for (const event of running.eventBuffer) {
      yield event;
    }

    // Then yield new events as they arrive
    const queue: NormalizedEvent[] = [];
    let resolve: (() => void) | null = null;

    const handler = (event: NormalizedEvent) => {
      queue.push(event);
      if (resolve) {
        resolve();
        resolve = null;
      }
    };

    running.subscribers.add(handler);

    try {
      while (true) {
        if (queue.length > 0) {
          yield queue.shift()!;
        } else {
          if (running.session.state === "stopped") break;
          await new Promise<void>((r) => {
            resolve = r;
          });
        }
      }
      // Drain remaining
      while (queue.length > 0) {
        yield queue.shift()!;
      }
    } finally {
      running.subscribers.delete(handler);
    }
  }

  getSession(sessionId: string): AgentSession | undefined {
    return this.processes.get(sessionId)?.session;
  }

  listSessions(): AgentSession[] {
    return Array.from(this.processes.values()).map((r) => r.session);
  }

  private emitEvent(sessionId: string, event: NormalizedEvent): void {
    const running = this.processes.get(sessionId);
    if (!running) return;

    running.eventBuffer.push(event);
    running.session.lastActivity = event.timestamp;

    // Update session state based on events
    if (event.type === "message_start") {
      running.session.state = "streaming";
    } else if (event.type === "turn_end" || event.type === "message_end") {
      running.session.state = "idle";
    }

    for (const sub of running.subscribers) {
      sub(event);
    }
  }

  /**
   * Subscribe to the OpenCode SSE event stream and map events to NormalizedEvent.
   */
  private async subscribeToSSE(sessionId: string): Promise<void> {
    const running = this.processes.get(sessionId);
    if (!running || !running.openCodeSessionId) return;

    try {
      const resp = await fetch(
        `http://127.0.0.1:${running.port}/session/${running.openCodeSessionId}/events`,
        {
          headers: { Accept: "text/event-stream" },
          signal: running.abortController.signal,
        },
      );

      if (!resp.ok || !resp.body) return;

      const reader = resp.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });

        // Process complete SSE events (separated by double newlines)
        const parts = buffer.split("\n\n");
        // Keep the last part as it may be incomplete
        buffer = parts.pop() ?? "";

        for (const part of parts) {
          if (!part.trim()) continue;

          const sseEvents = parseSSEEvents(part + "\n\n");
          for (const sse of sseEvents) {
            const normalized = mapOpenCodeEvent(sessionId, sse);
            for (const event of normalized) {
              this.emitEvent(sessionId, event);
            }
          }
        }
      }

      // Process any remaining buffer
      if (buffer.trim()) {
        const sseEvents = parseSSEEvents(buffer);
        for (const sse of sseEvents) {
          const normalized = mapOpenCodeEvent(sessionId, sse);
          for (const event of normalized) {
            this.emitEvent(sessionId, event);
          }
        }
      }
    } catch (err) {
      // AbortError is expected when stopping
      if (err instanceof Error && err.name === "AbortError") return;
      // Other errors - emit error event
      this.emitEvent(sessionId, {
        type: "error",
        sessionId,
        timestamp: new Date().toISOString(),
        data: { reason: `SSE connection error: ${err instanceof Error ? err.message : String(err)}` },
      });
    }
  }
}
