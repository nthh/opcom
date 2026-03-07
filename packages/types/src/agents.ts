// Agent session types

export type AgentBackend = "claude-code" | "opencode";

export type AgentState =
  | "idle"
  | "streaming"
  | "waiting"
  | "error"
  | "stopped";

export interface AgentSession {
  id: string;
  backend: AgentBackend;
  projectId: string;
  state: AgentState;
  startedAt: string;
  stoppedAt?: string;
  workItemId?: string;
  contextUsage?: ContextUsage;
  lastActivity?: string;
  pid?: number;
  backendSessionId?: string; // Claude Code's internal session ID for --resume
}

export interface ContextUsage {
  tokensUsed: number;
  maxTokens: number;
  percentage: number; // 0-100
}

// --- Normalized Events ---

export type NormalizedEventType =
  | "agent_start"
  | "agent_end"
  | "turn_start"
  | "turn_end"
  | "message_start"
  | "message_delta"
  | "message_end"
  | "tool_start"
  | "tool_end"
  | "error"
  | "compaction_start"
  | "compaction_end";

export interface NormalizedEvent {
  type: NormalizedEventType;
  sessionId: string;
  timestamp: string;
  data?: {
    // message events
    text?: string;
    role?: "assistant" | "user" | "system";

    // tool events
    toolName?: string;
    toolInput?: string;
    toolOutput?: string;
    toolSuccess?: boolean;

    // lifecycle events
    reason?: string;

    // compaction events
    contextTokens?: number;

    // raw event for debugging
    raw?: unknown;
  };
}

// --- Agent Adapter ---

export interface AgentStartConfig {
  projectPath: string;
  workItemId?: string;
  contextPacket: ContextPacket;
  cwd?: string;
  model?: string;
  worktree?: boolean;
  allowedTools?: string[];
  disallowedTools?: string[];
  disableAllTools?: boolean;
  permissionMode?: "default" | "acceptEdits" | "bypassPermissions" | "plan";
  additionalDirs?: string[];
  systemPrompt?: string;
  resumeSessionId?: string;
}

export interface AgentAdapter {
  backend: AgentBackend;
  start(config: AgentStartConfig): Promise<AgentSession>;
  stop(sessionId: string): Promise<void>;
  prompt(sessionId: string, message: string): Promise<void>;
  subscribe(sessionId: string): AsyncIterable<NormalizedEvent>;
}

// --- Context Packets ---

export interface ContextPacket {
  project: {
    name: string;
    path: string;
    stack: import("./project.js").StackInfo;
    testing: import("./project.js").TestingConfig | null;
    linting: import("./project.js").LintConfig[];
    services: import("./project.js").ServiceDefinition[];
  };
  workItem?: {
    ticket: import("./work-items.js").WorkItem;
    spec?: string;
    relatedTickets?: import("./work-items.js").WorkItem[];
  };
  git: {
    branch: string;
    remote: string | null;
    clean: boolean;
  };
  graph?: GraphContext;
  agentConfig?: string;
  memory?: string;
}

/** Context pulled from the project's knowledge graph. */
export interface GraphContext {
  /** Files related to the current work item (via spec/ticket edges). */
  relatedFiles: string[];
  /** Test files that cover the related source files. */
  testFiles: string[];
  /** Drift signals relevant to the current scope. */
  driftSignals: DriftSignal[];
}

export interface DriftSignal {
  type: "uncovered_spec" | "untested_file" | "new_failure" | "flaky_test";
  id: string;
  title?: string;
  detail?: string;
}

// --- Message Routing ---

export type DeliveryMode = "prompt" | "followUp" | "steer";

export interface AgentMessage {
  id: string;
  from: string;
  to: string;
  text: string;
  delivery: DeliveryMode;
  timestamp: string;
  delivered: boolean;
}
