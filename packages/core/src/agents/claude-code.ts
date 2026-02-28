import { spawn, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import { createInterface } from "node:readline";
import type {
  AgentAdapter,
  AgentSession,
  AgentStartConfig,
  NormalizedEvent,
} from "@opcom/types";
import { createLogger } from "../logger.js";

const log = createLogger("claude-code");

interface RunningProcess {
  proc: ChildProcess;
  session: AgentSession;
  eventBuffer: NormalizedEvent[];
  subscribers: Set<(event: NormalizedEvent) => void>;
  prompt_resolve?: () => void;
  streamedText: string; // accumulates text from streaming deltas for dedup
}

export class ClaudeCodeAdapter implements AgentAdapter {
  readonly backend = "claude-code" as const;

  private processes = new Map<string, RunningProcess>();

  async start(config: AgentStartConfig): Promise<AgentSession> {
    const sessionId = randomUUID();
    const cwd = config.cwd ?? config.projectPath;

    // Build initial prompt from context packet (or use explicit system prompt)
    const initialPrompt = config.systemPrompt ?? formatContextAsPrompt(config);

    const args = [
      "--output-format", "stream-json",
      "--verbose",
      "-p", initialPrompt,
    ];

    if (config.model) {
      args.push("--model", config.model);
    }

    if (config.allowedTools) {
      for (const tool of config.allowedTools) {
        args.push("--allowedTools", tool);
      }
    }

    // If resuming a conversation, pass the session ID to continue from
    if (config.resumeSessionId) {
      args.push("--resume", config.resumeSessionId);
    }

    // Strip ALL Claude Code env vars so the child process doesn't
    // detect a nested session and refuse to run (or produce zero output)
    const wasNested = !!process.env.CLAUDECODE;
    const childEnv: Record<string, string> = {};
    for (const [k, v] of Object.entries(process.env)) {
      if (!k.startsWith("CLAUDE") && v !== undefined) {
        childEnv[k] = v;
      }
    }

    const proc = spawn("claude", args, {
      cwd,
      stdio: ["pipe", "pipe", "pipe"],
      env: childEnv,
    });

    // Close stdin immediately — we pass the prompt via -p flag, not stdin.
    // If stdin stays open, Claude Code may block waiting for EOF.
    if (proc.stdin) {
      proc.stdin.end();
    }

    const session: AgentSession = {
      id: sessionId,
      backend: "claude-code",
      projectId: config.contextPacket.project.name,
      state: "streaming",
      startedAt: new Date().toISOString(),
      workItemId: config.workItemId,
      pid: proc.pid,
    };

    const running: RunningProcess = {
      proc,
      session,
      eventBuffer: [],
      subscribers: new Set(),
      streamedText: "",
    };

    this.processes.set(sessionId, running);

    // Emit agent_start
    this.emitEvent(sessionId, {
      type: "agent_start",
      sessionId,
      timestamp: new Date().toISOString(),
      data: { reason: "started" },
    });

    // Parse NDJSON from stdout
    if (proc.stdout) {
      const rl = createInterface({ input: proc.stdout });
      rl.on("line", (line) => {
        if (!line.trim()) return;
        try {
          const raw = JSON.parse(line);
          const events = this.parseClaudeEvent(sessionId, raw);
          for (const event of events) {
            this.emitEvent(sessionId, event);
          }
        } catch (err) {
          log.warn("NDJSON parse error", { line: line.slice(0, 200), error: String(err) });
        }
      });
    }

    // Read stderr and emit as error events
    if (proc.stderr) {
      const stderrRl = createInterface({ input: proc.stderr });
      stderrRl.on("line", (line) => {
        if (!line.trim()) return;
        log.debug("stderr", { sessionId, line });
        this.emitEvent(sessionId, {
          type: "error",
          sessionId,
          timestamp: new Date().toISOString(),
          data: { reason: `stderr: ${line}` },
        });
      });
    }

    // Stall detection — if no stdout/stderr data arrives within 10s,
    // emit a diagnostic event so the user knows what's happening
    let gotOutput = false;
    const stallTimer = setTimeout(() => {
      if (!gotOutput) {
        const hint = wasNested
          ? "Claude Code may not work when spawned from within another Claude Code session. Try running opcom from a separate terminal."
          : "Claude Code has not produced any output. It may be initializing, waiting for API response, or experiencing an error.";
        log.warn("stall detected", { sessionId, pid: proc.pid, wasNested });
        this.emitEvent(sessionId, {
          type: "error",
          sessionId,
          timestamp: new Date().toISOString(),
          data: { reason: `No output from claude (pid ${proc.pid}) after 10s. ${hint}` },
        });
      }
    }, 10000);

    // Track when we first receive output
    const markOutput = () => {
      if (!gotOutput) {
        gotOutput = true;
        clearTimeout(stallTimer);
      }
    };
    if (proc.stdout) proc.stdout.once("data", markOutput);
    if (proc.stderr) proc.stderr.once("data", markOutput);

    // Handle process exit
    proc.on("close", (code) => {
      clearTimeout(stallTimer);
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

    return session;
  }

  async stop(sessionId: string): Promise<void> {
    const running = this.processes.get(sessionId);
    if (!running) return;

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
    if (!running.proc.stdin || !running.proc.stdin.writable) {
      throw new Error("Cannot send follow-up prompt: stdin is closed (one-shot -p mode)");
    }

    running.proc.stdin.write(message + "\n");
    running.session.state = "streaming";
  }

  async *subscribe(sessionId: string): AsyncIterable<NormalizedEvent> {
    const running = this.processes.get(sessionId);
    if (!running) return;

    // Register the subscriber handler FIRST — before yielding buffered events.
    // This prevents a gap where events emitted between yields would be lost
    // (they'd go to eventBuffer + subscribers, but we'd already iterated past
    // the buffer and hadn't registered the handler yet).
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
      // Snapshot the current buffer length — yield everything buffered so far.
      // Any new events arriving during yields go to the queue via the handler.
      const bufferedCount = running.eventBuffer.length;
      for (let i = 0; i < bufferedCount; i++) {
        yield running.eventBuffer[i];
      }

      // Now yield from the queue (which may already have events from the handler)
      while (true) {
        if (queue.length > 0) {
          yield queue.shift()!;
        } else {
          // Wait for next event or session end
          if (running.session.state === "stopped") break;
          await new Promise<void>((r) => { resolve = r; });
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

    log.debug("emitEvent", { sessionId, type: event.type, subscribers: running.subscribers.size });

    running.eventBuffer.push(event);
    running.session.lastActivity = event.timestamp;

    // Update session state based on events
    if (event.type === "message_start" || event.type === "message_delta") {
      running.session.state = "streaming";
    } else if (event.type === "tool_start" || event.type === "tool_end") {
      running.session.state = "streaming";
    } else if (event.type === "turn_end" || event.type === "agent_end") {
      running.session.state = "idle";
    }

    for (const sub of running.subscribers) {
      sub(event);
    }
  }

  private parseClaudeEvent(sessionId: string, raw: unknown): NormalizedEvent[] {
    const events: NormalizedEvent[] = [];
    const obj = raw as Record<string, unknown>;
    const ts = new Date().toISOString();

    // Claude Code stream-json format
    const type = obj.type as string;

    switch (type) {
      case "system": {
        // Capture Claude Code's session_id for --resume support
        const ccSessionId = (obj as Record<string, unknown>).session_id as string | undefined;
        if (ccSessionId) {
          const running = this.processes.get(sessionId);
          if (running) {
            running.session.backendSessionId = ccSessionId;
          }
        }
        events.push({
          type: "agent_start",
          sessionId,
          timestamp: ts,
          data: { raw },
        });
        break;
      }

      case "assistant": {
        // Assistant message — the final summary with complete content blocks.
        // Claude Code also sends native streaming events (content_block_delta)
        // before this, so the text may already be displayed. If the text
        // matches what we already streamed, skip this summary to avoid dupes.
        const message = obj.message as Record<string, unknown> | undefined;
        if (message) {
          const content = message.content as Array<Record<string, unknown>> | undefined;
          const textContent = Array.isArray(content)
            ? content.filter((b) => b.type === "text").map((b) => b.text).join("")
            : "";

          const proc = this.processes.get(sessionId);
          if (proc && proc.streamedText.length > 0) {
            const streamedNorm = proc.streamedText.replace(/\s+/g, " ").trim();
            const summaryNorm = textContent.replace(/\s+/g, " ").trim();
            if (streamedNorm.length > 100 && summaryNorm === streamedNorm) {
              // Already displayed via streaming — skip the summary.
              // Reset for next turn.
              proc.streamedText = "";
              break;
            }
          }
          // Reset streaming buffer (this summary has new/different content)
          if (proc) proc.streamedText = "";

          events.push({
            type: "message_start",
            sessionId,
            timestamp: ts,
            data: { role: "assistant", raw },
          });

          if (Array.isArray(content)) {
            for (const block of content) {
              if (block.type === "text") {
                events.push({
                  type: "message_delta",
                  sessionId,
                  timestamp: ts,
                  data: { text: block.text as string },
                });
              } else if (block.type === "tool_use") {
                events.push({
                  type: "tool_start",
                  sessionId,
                  timestamp: ts,
                  data: {
                    toolName: block.name as string,
                    toolInput: typeof block.input === "string" ? block.input : JSON.stringify(block.input),
                  },
                });
              }
            }
          }

          events.push({
            type: "message_end",
            sessionId,
            timestamp: ts,
            data: { role: "assistant" },
          });
        }
        break;
      }

      case "result": {
        // Tool result
        const result = obj.result as string | undefined;
        events.push({
          type: "tool_end",
          sessionId,
          timestamp: ts,
          data: {
            toolOutput: result,
            toolSuccess: !obj.is_error,
          },
        });
        break;
      }

      default:
        // Native streaming events from Claude API (message_start,
        // content_block_start/delta/stop, message_stop, etc.).
        //
        // The `assistant` case above already reconstructs the complete
        // message with proper message_start/delta/end spans. So we only
        // extract text deltas here for live streaming — we do NOT map
        // structural signals (content_block_start → message_start, etc.)
        // because that creates overlapping/orphaned spans that break dedup.
        if (type === "content_block_delta") {
          const delta = (obj as Record<string, unknown>).delta as Record<string, unknown> | undefined;
          if (delta?.type === "text_delta" && typeof delta.text === "string") {
            // Accumulate for dedup comparison when assistant summary arrives
            const proc = this.processes.get(sessionId);
            if (proc) proc.streamedText += delta.text;

            events.push({
              type: "message_delta",
              sessionId,
              timestamp: ts,
              data: { text: delta.text, raw },
            });
          }
        }
        // All other native streaming signals (message_start, message_stop,
        // content_block_start, content_block_stop) are structural noise —
        // the assistant summary already provides clean span boundaries.
    }

    return events;
  }
}


function formatContextAsPrompt(config: AgentStartConfig): string {
  const ctx = config.contextPacket;
  const parts: string[] = [];

  parts.push(`# Project: ${ctx.project.name}`);
  parts.push(`Path: ${ctx.project.path}`);

  // Stack summary
  const langs = ctx.project.stack.languages.map((l) => l.name + (l.version ? ` ${l.version}` : "")).join(", ");
  if (langs) parts.push(`Languages: ${langs}`);

  const fws = ctx.project.stack.frameworks.map((f) => f.name).join(", ");
  if (fws) parts.push(`Frameworks: ${fws}`);

  const infra = ctx.project.stack.infrastructure.map((i) => i.name).join(", ");
  if (infra) parts.push(`Infrastructure: ${infra}`);

  // Testing
  if (ctx.project.testing) {
    parts.push(`\nTesting: ${ctx.project.testing.framework}`);
    if (ctx.project.testing.command) {
      parts.push(`Test command: ${ctx.project.testing.command}`);
    }
  }

  // Linting
  if (ctx.project.linting.length > 0) {
    parts.push(`Linting: ${ctx.project.linting.map((l) => l.name).join(", ")}`);
  }

  // Git
  parts.push(`\nGit branch: ${ctx.git.branch}`);
  parts.push(`Git clean: ${ctx.git.clean}`);

  // Work item
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

  // Agent config (CLAUDE.md contents)
  if (ctx.agentConfig) {
    parts.push(`\n# Agent Configuration\n${ctx.agentConfig}`);
  }

  // Memory
  if (ctx.memory) {
    parts.push(`\n# Memory\n${ctx.memory}`);
  }

  return parts.join("\n");
}
