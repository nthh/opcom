// Lightweight namespaced logger — writes to stderr, never stdout (reserved for TUI/NDJSON)
// Gated by env vars: OPCOM_DEBUG=1 (all levels) or OPCOM_LOG=debug|info|warn|error
// Silent by default

export type LogLevel = "debug" | "info" | "warn" | "error";

const LEVEL_ORDER: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

function getActiveLevel(): LogLevel | null {
  if (process.env.OPCOM_DEBUG === "1") return "debug";
  const envLog = process.env.OPCOM_LOG as LogLevel | undefined;
  if (envLog && envLog in LEVEL_ORDER) return envLog;
  return null;
}

export function isEnabled(level: LogLevel): boolean {
  const active = getActiveLevel();
  if (!active) return false;
  return LEVEL_ORDER[level] >= LEVEL_ORDER[active];
}

export interface Logger {
  debug(msg: string, data?: Record<string, unknown>): void;
  info(msg: string, data?: Record<string, unknown>): void;
  warn(msg: string, data?: Record<string, unknown>): void;
  error(msg: string, data?: Record<string, unknown>): void;
}

function formatLine(level: LogLevel, namespace: string, msg: string, data?: Record<string, unknown>): string {
  const ts = new Date().toISOString();
  const suffix = data ? " " + JSON.stringify(data) : "";
  return `[${ts}] ${level.toUpperCase()} ${namespace}: ${msg}${suffix}\n`;
}

export function createLogger(namespace: string): Logger {
  const write = (level: LogLevel, msg: string, data?: Record<string, unknown>) => {
    if (!isEnabled(level)) return;
    process.stderr.write(formatLine(level, namespace, msg, data));
  };

  return {
    debug: (msg, data) => write("debug", msg, data),
    info: (msg, data) => write("info", msg, data),
    warn: (msg, data) => write("warn", msg, data),
    error: (msg, data) => write("error", msg, data),
  };
}
