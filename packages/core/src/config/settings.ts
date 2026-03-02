import type { OpcomSettings } from "@opcom/types";

export interface SettingDef {
  key: string;
  type: "string" | "number" | "boolean";
  description: string;
  enum?: string[];
  min?: number;
  max?: number;
}

export const settingsDefs: SettingDef[] = [
  { key: "agent.backend", type: "string", description: "Default agent backend", enum: ["claude-code", "opencode"] },
  { key: "agent.model", type: "string", description: "Default model override (empty for default)" },
  { key: "agent.worktree", type: "boolean", description: "Use git worktrees for agent isolation" },
  { key: "server.port", type: "number", description: "Default daemon port", min: 1, max: 65535 },
  { key: "orchestrator.maxConcurrentAgents", type: "number", description: "Max agents running in parallel", min: 1, max: 32 },
  { key: "orchestrator.autoCommit", type: "boolean", description: "Auto-commit after step completion" },
  { key: "orchestrator.pauseOnFailure", type: "boolean", description: "Pause plan on step failure" },
  { key: "orchestrator.runTests", type: "boolean", description: "Run tests as verification gate" },
  { key: "orchestrator.runOracle", type: "boolean", description: "Run oracle verification after steps" },
  { key: "notifications.enabled", type: "boolean", description: "Enable notification delivery" },
];

export function defaultSettings(): OpcomSettings {
  return {
    agent: {
      backend: "claude-code",
      model: undefined,
      worktree: false,
    },
    server: {
      port: 4700,
    },
    orchestrator: {
      maxConcurrentAgents: 2,
      autoCommit: true,
      pauseOnFailure: true,
      runTests: true,
      runOracle: false,
    },
    notifications: {
      enabled: false,
    },
  };
}

export function getSetting(settings: OpcomSettings, key: string): unknown {
  const def = settingsDefs.find((d) => d.key === key);
  if (!def) return undefined;

  const parts = key.split(".");
  let current: unknown = settings;
  for (const part of parts) {
    if (current == null || typeof current !== "object") return undefined;
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

export function setSetting(settings: OpcomSettings, key: string, rawValue: string): OpcomSettings {
  const def = settingsDefs.find((d) => d.key === key);
  if (!def) {
    throw new Error(`Unknown setting: ${key}\nRun 'opcom settings list' to see available settings.`);
  }

  const value = parseValue(def, rawValue);
  validateValue(def, value);

  const clone = structuredClone(settings);
  const parts = key.split(".");
  let current: Record<string, unknown> = clone as unknown as Record<string, unknown>;
  for (let i = 0; i < parts.length - 1; i++) {
    current = current[parts[i]] as Record<string, unknown>;
  }
  current[parts[parts.length - 1]] = value;
  return clone;
}

function parseValue(def: SettingDef, raw: string): unknown {
  switch (def.type) {
    case "boolean": {
      const lower = raw.toLowerCase();
      if (lower === "true" || lower === "1" || lower === "yes" || lower === "on") return true;
      if (lower === "false" || lower === "0" || lower === "no" || lower === "off") return false;
      throw new Error(`Invalid boolean value for ${def.key}: "${raw}" (use true/false)`);
    }
    case "number": {
      const n = Number(raw);
      if (isNaN(n)) throw new Error(`Invalid number value for ${def.key}: "${raw}"`);
      return n;
    }
    case "string":
      return raw;
  }
}

function validateValue(def: SettingDef, value: unknown): void {
  if (def.enum && !def.enum.includes(value as string)) {
    throw new Error(`Invalid value for ${def.key}: "${value}" (must be one of: ${def.enum.join(", ")})`);
  }
  if (def.type === "number") {
    const n = value as number;
    if (def.min !== undefined && n < def.min) {
      throw new Error(`Value for ${def.key} must be >= ${def.min}`);
    }
    if (def.max !== undefined && n > def.max) {
      throw new Error(`Value for ${def.key} must be <= ${def.max}`);
    }
  }
}

export function validateSettings(data: unknown): OpcomSettings {
  const defaults = defaultSettings();
  if (!data || typeof data !== "object") return defaults;

  const obj = data as Record<string, unknown>;
  const agent = typeof obj.agent === "object" && obj.agent ? (obj.agent as Record<string, unknown>) : {};
  const server = typeof obj.server === "object" && obj.server ? (obj.server as Record<string, unknown>) : {};
  const orch = typeof obj.orchestrator === "object" && obj.orchestrator ? (obj.orchestrator as Record<string, unknown>) : {};
  const notif = typeof obj.notifications === "object" && obj.notifications ? (obj.notifications as Record<string, unknown>) : {};

  return {
    agent: {
      backend: agent.backend === "opencode" ? "opencode" : defaults.agent.backend,
      model: typeof agent.model === "string" ? agent.model : defaults.agent.model,
      worktree: typeof agent.worktree === "boolean" ? agent.worktree : defaults.agent.worktree,
    },
    server: {
      port: typeof server.port === "number" ? server.port : defaults.server.port,
    },
    orchestrator: {
      maxConcurrentAgents: typeof orch.maxConcurrentAgents === "number" ? orch.maxConcurrentAgents : defaults.orchestrator.maxConcurrentAgents,
      autoCommit: typeof orch.autoCommit === "boolean" ? orch.autoCommit : defaults.orchestrator.autoCommit,
      pauseOnFailure: typeof orch.pauseOnFailure === "boolean" ? orch.pauseOnFailure : defaults.orchestrator.pauseOnFailure,
      runTests: typeof orch.runTests === "boolean" ? orch.runTests : defaults.orchestrator.runTests,
      runOracle: typeof orch.runOracle === "boolean" ? orch.runOracle : defaults.orchestrator.runOracle,
    },
    notifications: {
      enabled: typeof notif.enabled === "boolean" ? notif.enabled : defaults.notifications.enabled,
    },
  };
}
