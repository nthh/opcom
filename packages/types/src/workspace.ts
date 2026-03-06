export interface WorkspaceConfig {
  id: string;
  name: string;
  description?: string;
  projectIds: string[];
  createdAt: string;
}

export interface AgentSettings {
  backend: "claude-code" | "opencode";
  model?: string;
  worktree: boolean;
}

export interface ServerSettings {
  port: number;
}

export interface OrchestratorSettings {
  maxConcurrentAgents: number;
  autoCommit: boolean;
  pauseOnFailure: boolean;
  runTests: boolean;
  runOracle: boolean;
}

export interface NotificationSettings {
  enabled: boolean;
}

export interface OpcomSettings {
  agent: AgentSettings;
  server: ServerSettings;
  orchestrator: OrchestratorSettings;
  notifications: NotificationSettings;
}

export interface GlobalConfig {
  defaultWorkspace: string;
  settings: OpcomSettings;
  integrations?: import("./integrations.js").IntegrationsConfig;
}
