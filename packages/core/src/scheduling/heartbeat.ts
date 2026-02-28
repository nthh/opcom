import type { SessionManager } from "../agents/session-manager.js";

export interface HeartbeatConfig {
  checkIntervalMs: number;
  staleThresholdMs: number;
  autoRestart: boolean;
}

export type HeartbeatStatus = "healthy" | "stale" | "dead";

export interface HeartbeatResult {
  sessionId: string;
  status: HeartbeatStatus;
}

type HeartbeatEventHandler = (results: HeartbeatResult[]) => void;

const DEFAULT_CONFIG: HeartbeatConfig = {
  checkIntervalMs: 30_000,
  staleThresholdMs: 60_000,
  autoRestart: false,
};

function processIsAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

export class HeartbeatMonitor {
  private interval: ReturnType<typeof setInterval> | null = null;
  private config: HeartbeatConfig;
  private onCheckHandlers: HeartbeatEventHandler[] = [];

  constructor(
    private sessionManager: SessionManager,
    config: Partial<HeartbeatConfig> = {},
  ) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  onCheck(handler: HeartbeatEventHandler): void {
    this.onCheckHandlers.push(handler);
  }

  start(): void {
    if (this.interval) return;

    this.interval = setInterval(() => {
      const results = this.checkAll();

      // Notify listeners
      for (const handler of this.onCheckHandlers) {
        handler(results);
      }

      // Auto-restart dead agents if configured
      if (this.config.autoRestart) {
        for (const result of results) {
          if (result.status === "dead") {
            console.log(`[heartbeat] Agent ${result.sessionId} is dead, would restart (auto-restart enabled)`);
            // In a full implementation, this would re-create the session
            // using the saved session config. For now, log the detection.
          }
        }
      }
    }, this.config.checkIntervalMs);
  }

  stop(): void {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }
  }

  checkAll(): HeartbeatResult[] {
    const sessions = this.sessionManager.getActiveSessions();
    const now = Date.now();
    const results: HeartbeatResult[] = [];

    for (const session of sessions) {
      // Check if the process is still alive
      if (session.pid && !processIsAlive(session.pid)) {
        results.push({ sessionId: session.id, status: "dead" });
        continue;
      }

      // Check if the session is stale (no activity for staleThresholdMs)
      if (session.lastActivity) {
        const lastActivityTime = new Date(session.lastActivity).getTime();
        if (now - lastActivityTime > this.config.staleThresholdMs) {
          results.push({ sessionId: session.id, status: "stale" });
          continue;
        }
      }

      results.push({ sessionId: session.id, status: "healthy" });
    }

    return results;
  }
}
