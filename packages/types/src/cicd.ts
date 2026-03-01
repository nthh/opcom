// CI/CD normalized types (Phase 8)
// Adapter interface and types for pipeline/deployment tracking across CI providers.

import type { ProjectConfig } from "./project.js";

// --- Provider ---

export type CICDProvider = "github-actions" | "gitlab-ci" | "circleci" | "buildkite";

// --- Pipeline (Workflow Run) ---

export type PipelineStatus =
  | "queued"
  | "in_progress"
  | "success"
  | "failure"
  | "cancelled"
  | "timed_out"
  | "skipped";

export interface PipelineStep {
  name: string;
  status: PipelineStatus;
  durationMs?: number;
}

export interface PipelineJob {
  id: string;
  name: string;
  status: PipelineStatus;
  startedAt?: string;
  completedAt?: string;
  durationMs?: number;
  steps?: PipelineStep[];
  runner?: string;
  url?: string;
}

export interface Pipeline {
  id: string;
  projectId: string;
  provider: CICDProvider;
  name: string;
  ref: string;
  commitSha: string;
  commitMessage?: string;
  triggeredBy?: string;
  status: PipelineStatus;
  startedAt?: string;
  completedAt?: string;
  durationMs?: number;
  url: string;
  jobs: PipelineJob[];
}

// --- Deployment ---

export type DeploymentState =
  | "pending"
  | "in_progress"
  | "active"
  | "inactive"
  | "failed"
  | "error";

export interface DeploymentStatus {
  id: string;
  projectId: string;
  provider: CICDProvider;
  environment: string;
  ref: string;
  status: DeploymentState;
  url?: string;
  createdAt: string;
  updatedAt: string;
}

// --- Events ---

export type CICDEvent =
  | { type: "pipeline_updated"; pipeline: Pipeline }
  | { type: "deployment_updated"; deployment: DeploymentStatus };

// --- Adapter Interface ---

export interface Disposable {
  dispose(): void;
}

export interface CICDAdapter {
  provider: CICDProvider;

  detect(project: ProjectConfig): Promise<boolean>;

  listPipelines(project: ProjectConfig, opts?: {
    branch?: string;
    limit?: number;
  }): Promise<Pipeline[]>;

  getPipeline(project: ProjectConfig, pipelineId: string): Promise<Pipeline>;

  listDeployments(project: ProjectConfig): Promise<DeploymentStatus[]>;

  watch(project: ProjectConfig, callback: (event: CICDEvent) => void): Disposable;
}
