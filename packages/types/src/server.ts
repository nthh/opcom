// Server API protocol types (Phase 3)

import type { AgentSession, NormalizedEvent, DeliveryMode } from "./agents.js";
import type { Pipeline, DeploymentStatus } from "./cicd.js";
import type { ServiceInstance, EnvironmentStatus, PortAllocation } from "./environments.js";
import type { GitInfo } from "./project.js";
import type { WorkSummary } from "./work-items.js";

// --- WebSocket: Client → Server ---

export type ClientCommand =
  | { type: "subscribe"; agentId?: string }
  | { type: "prompt"; agentId: string; text: string; delivery?: DeliveryMode }
  | { type: "start_agent"; projectId: string; workItemId?: string; backend?: string }
  | { type: "stop_agent"; agentId: string }
  | { type: "create_ticket"; projectId: string; description: string }
  | { type: "chat_ticket"; projectId: string; workItemId: string; message: string }
  | { type: "refresh_status" }
  | { type: "ping" }
  // Plan commands
  | { type: "create_plan"; name: string; scope?: import("./plan.js").PlanScope; config?: Partial<import("./plan.js").OrchestratorConfig> }
  | { type: "execute_plan"; planId: string }
  | { type: "pause_plan"; planId: string }
  | { type: "resume_plan"; planId: string }
  | { type: "skip_step"; planId: string; ticketId: string }
  | { type: "inject_context"; planId: string; text: string }
  | { type: "run_hygiene" }
  // Changeset queries
  | { type: "get_changesets"; ticketId?: string; sessionId?: string; projectId?: string };

// --- WebSocket: Server → Client ---

export type ServerEvent =
  // Connection
  | { type: "ready"; serverTime: string }
  | { type: "error"; code: string; message: string }
  | { type: "pong" }

  // Agent lifecycle
  | { type: "agent_started"; session: AgentSession }
  | { type: "agent_stopped"; sessionId: string; reason: string }
  | { type: "agent_status"; sessionId: string; state: AgentSession["state"]; contextUsage?: number }

  // Agent output (streaming)
  | { type: "agent_event"; sessionId: string; event: NormalizedEvent }

  // Project status
  | { type: "project_status"; projectId: string; git: GitInfo; workSummary: WorkSummary }

  // Agent messages (inter-agent communication visible to UI)
  | { type: "agent_message"; from: string; to: string; text: string; timestamp: string }

  // Snapshots (full state sync on connect/reconnect)
  | { type: "agents_snapshot"; sessions: AgentSession[] }
  | { type: "projects_snapshot"; projects: ProjectStatusSnapshot[] }

  // Plan events
  | { type: "plan_updated"; plan: import("./plan.js").Plan }
  | { type: "step_started"; step: import("./plan.js").PlanStep; sessionId: string }
  | { type: "step_completed"; step: import("./plan.js").PlanStep }
  | { type: "step_failed"; step: import("./plan.js").PlanStep; error: string }
  | { type: "plan_completed"; plan: import("./plan.js").Plan }
  | { type: "plan_paused"; plan: import("./plan.js").Plan }
  | { type: "hygiene_report"; report: import("./plan.js").HygieneReport }

  // CI/CD events
  | { type: "pipeline_updated"; projectId: string; pipeline: Pipeline }
  | { type: "deployment_updated"; projectId: string; deployment: DeploymentStatus }

  // Cloud service events
  | { type: "cloud_service_updated"; projectId: string; service: import("./cloud-services.js").CloudService }
  | { type: "cloud_service_alert"; projectId: string; serviceId: string; message: string }

  // Environment events
  | { type: "service_status"; projectId: string; service: ServiceInstance }
  | { type: "port_conflict"; projectId: string; serviceName: string; port: number; conflictsWith: PortAllocation }
  | { type: "environment_status"; projectId: string; status: EnvironmentStatus }

  // Context graph events
  | { type: "graph_built"; projectId: string; stats: { totalNodes: number; totalEdges: number } }
  | { type: "drift_detected"; projectId: string; signals: import("./agents.js").DriftSignal[] }

  // Changeset responses
  | { type: "changesets"; changesets: import("./changeset.js").Changeset[] };

export interface ProjectStatusSnapshot {
  id: string;
  name: string;
  path: string;
  git: GitInfo | null;
  workSummary: WorkSummary | null;
  cloudHealthSummary?: CloudHealthSummary;
}

export interface CloudHealthSummary {
  total: number;
  healthy: number;
  degraded: number;
  unreachable: number;
  unknown: number;
}
