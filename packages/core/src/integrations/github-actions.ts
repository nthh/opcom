import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { access } from "node:fs/promises";
import { join } from "node:path";
import type {
  CICDAdapter,
  CICDProvider,
  CICDEvent,
  Pipeline,
  PipelineJob,
  PipelineStep,
  PipelineStatus,
  DeploymentStatus,
  DeploymentState,
  Disposable,
  ProjectConfig,
} from "@opcom/types";

const execFileAsync = promisify(execFile);

// --- GitHub API response shapes ---

interface GHWorkflowRun {
  id: number;
  name: string;
  head_branch: string;
  head_sha: string;
  status: string;
  conclusion: string | null;
  html_url: string;
  run_started_at?: string;
  updated_at?: string;
  actor?: { login: string };
  event?: string;
  head_commit?: { message: string };
}

interface GHJob {
  id: number;
  name: string;
  status: string;
  conclusion: string | null;
  started_at?: string;
  completed_at?: string;
  html_url?: string;
  runner_name?: string;
  steps?: GHStep[];
}

interface GHStep {
  name: string;
  status: string;
  conclusion: string | null;
  number: number;
}

interface GHDeployment {
  id: number;
  ref: string;
  environment: string;
  created_at: string;
  updated_at: string;
  payload?: Record<string, unknown>;
}

interface GHDeploymentStatusEntry {
  id: number;
  state: string;
  environment_url?: string;
  created_at: string;
  updated_at: string;
}

// --- Status mapping ---

export function mapRunStatus(status: string, conclusion: string | null): PipelineStatus {
  if (status === "queued") return "queued";
  if (status === "in_progress") return "in_progress";
  if (status === "completed" || status === "success") {
    switch (conclusion) {
      case "success": return "success";
      case "failure": return "failure";
      case "cancelled": return "cancelled";
      case "timed_out": return "timed_out";
      case "skipped": return "skipped";
      default: return "failure";
    }
  }
  return "queued";
}

export function mapDeploymentState(state: string): DeploymentState {
  switch (state) {
    case "pending": return "pending";
    case "in_progress": return "in_progress";
    case "success": return "active";
    case "active": return "active";
    case "inactive": return "inactive";
    case "failure": return "failed";
    case "error": return "error";
    default: return "pending";
  }
}

function computeDurationMs(start?: string, end?: string): number | undefined {
  if (!start) return undefined;
  const startMs = new Date(start).getTime();
  const endMs = end ? new Date(end).getTime() : Date.now();
  const diff = endMs - startMs;
  return diff > 0 ? diff : undefined;
}

// --- Parsing helpers ---

export function parseOwnerRepo(remote: string): { owner: string; repo: string } | null {
  // SSH: git@github.com:owner/repo.git
  const sshMatch = remote.match(/github\.com[:/]([^/]+)\/([^/.]+)/);
  if (sshMatch) return { owner: sshMatch[1], repo: sshMatch[2] };

  // HTTPS: https://github.com/owner/repo.git
  const httpsMatch = remote.match(/github\.com\/([^/]+)\/([^/.]+)/);
  if (httpsMatch) return { owner: httpsMatch[1], repo: httpsMatch[2] };

  return null;
}

function mapGHStep(step: GHStep): PipelineStep {
  return {
    name: step.name,
    status: mapRunStatus(step.status, step.conclusion),
    durationMs: undefined, // GitHub API doesn't provide step duration directly
  };
}

function mapGHJob(job: GHJob): PipelineJob {
  return {
    id: String(job.id),
    name: job.name,
    status: mapRunStatus(job.status, job.conclusion),
    startedAt: job.started_at,
    completedAt: job.completed_at,
    durationMs: computeDurationMs(job.started_at, job.completed_at),
    steps: job.steps?.map(mapGHStep),
    runner: job.runner_name,
    url: job.html_url,
  };
}

function mapGHRun(run: GHWorkflowRun, projectId: string): Pipeline {
  const status = mapRunStatus(run.status, run.conclusion);
  const startedAt = run.run_started_at;
  const completedAt = status !== "queued" && status !== "in_progress" ? run.updated_at : undefined;

  return {
    id: String(run.id),
    projectId,
    provider: "github-actions" as CICDProvider,
    name: run.name,
    ref: run.head_branch,
    commitSha: run.head_sha,
    commitMessage: run.head_commit?.message,
    triggeredBy: run.event === "push" || run.event === "schedule"
      ? run.event
      : run.actor?.login ?? run.event,
    status,
    startedAt,
    completedAt,
    durationMs: computeDurationMs(startedAt, completedAt),
    url: run.html_url,
    jobs: [],
  };
}

// --- GitHub Actions Adapter ---

export class GitHubActionsAdapter implements CICDAdapter {
  provider: CICDProvider = "github-actions";

  private async ghApi<T>(endpoint: string): Promise<T> {
    const { stdout } = await execFileAsync("gh", [
      "api", endpoint,
      "-H", "Accept: application/vnd.github+json",
    ], { timeout: 30_000 });
    return JSON.parse(stdout) as T;
  }

  private getOwnerRepo(project: ProjectConfig): { owner: string; repo: string } {
    const remote = project.git?.remote;
    if (!remote) throw new Error(`Project "${project.name}" has no git remote`);
    const parsed = parseOwnerRepo(remote);
    if (!parsed) throw new Error(`Cannot parse GitHub owner/repo from remote: ${remote}`);
    return parsed;
  }

  async detect(project: ProjectConfig): Promise<boolean> {
    // Must have a GitHub remote
    const remote = project.git?.remote;
    if (!remote || !remote.includes("github.com")) return false;

    // Check for .github/workflows/ directory
    try {
      await access(join(project.path, ".github", "workflows"));
      return true;
    } catch {
      return false;
    }
  }

  async listPipelines(project: ProjectConfig, opts?: {
    branch?: string;
    limit?: number;
  }): Promise<Pipeline[]> {
    const { owner, repo } = this.getOwnerRepo(project);
    const limit = opts?.limit ?? 10;

    let endpoint = `repos/${owner}/${repo}/actions/runs?per_page=${limit}`;
    if (opts?.branch) {
      endpoint += `&branch=${encodeURIComponent(opts.branch)}`;
    }

    const data = await this.ghApi<{ workflow_runs: GHWorkflowRun[] }>(endpoint);
    return data.workflow_runs.map((run) => mapGHRun(run, project.id));
  }

  async getPipeline(project: ProjectConfig, pipelineId: string): Promise<Pipeline> {
    const { owner, repo } = this.getOwnerRepo(project);

    // Fetch the run and its jobs in parallel
    const [runData, jobsData] = await Promise.all([
      this.ghApi<GHWorkflowRun>(`repos/${owner}/${repo}/actions/runs/${pipelineId}`),
      this.ghApi<{ jobs: GHJob[] }>(`repos/${owner}/${repo}/actions/runs/${pipelineId}/jobs`),
    ]);

    const pipeline = mapGHRun(runData, project.id);
    pipeline.jobs = jobsData.jobs.map(mapGHJob);
    return pipeline;
  }

  async listDeployments(project: ProjectConfig): Promise<DeploymentStatus[]> {
    const { owner, repo } = this.getOwnerRepo(project);

    const deployments = await this.ghApi<GHDeployment[]>(
      `repos/${owner}/${repo}/deployments?per_page=20`,
    );

    const results: DeploymentStatus[] = [];

    for (const dep of deployments) {
      // Fetch the latest status for each deployment
      const statuses = await this.ghApi<GHDeploymentStatusEntry[]>(
        `repos/${owner}/${repo}/deployments/${dep.id}/statuses?per_page=1`,
      );

      const latest = statuses[0];
      results.push({
        id: String(dep.id),
        projectId: project.id,
        provider: "github-actions",
        environment: dep.environment,
        ref: dep.ref,
        status: latest ? mapDeploymentState(latest.state) : "pending",
        url: latest?.environment_url,
        createdAt: dep.created_at,
        updatedAt: latest?.updated_at ?? dep.updated_at,
      });
    }

    return results;
  }

  async rerunPipeline(project: ProjectConfig, pipelineId: string): Promise<Pipeline> {
    const { owner, repo } = this.getOwnerRepo(project);
    await execFileAsync("gh", [
      "api", `repos/${owner}/${repo}/actions/runs/${pipelineId}/rerun`,
      "-X", "POST",
      "-H", "Accept: application/vnd.github+json",
    ], { timeout: 30_000 });
    // Fetch the updated run
    return this.getPipeline(project, pipelineId);
  }

  async cancelPipeline(project: ProjectConfig, pipelineId: string): Promise<void> {
    const { owner, repo } = this.getOwnerRepo(project);
    await execFileAsync("gh", [
      "api", `repos/${owner}/${repo}/actions/runs/${pipelineId}/cancel`,
      "-X", "POST",
      "-H", "Accept: application/vnd.github+json",
    ], { timeout: 30_000 });
  }

  watch(project: ProjectConfig, callback: (event: CICDEvent) => void): Disposable {
    let disposed = false;
    let timeout: ReturnType<typeof setTimeout> | null = null;

    // Track last-seen pipeline statuses to emit only changes
    const lastStatus = new Map<string, PipelineStatus>();
    const lastDeployState = new Map<string, string>();

    const poll = async () => {
      if (disposed) return;

      try {
        const pipelines = await this.listPipelines(project, { limit: 10 });
        for (const pipeline of pipelines) {
          const prev = lastStatus.get(pipeline.id);
          if (prev !== pipeline.status) {
            lastStatus.set(pipeline.id, pipeline.status);
            if (prev !== undefined) {
              callback({ type: "pipeline_updated", pipeline });
            }
          }
        }

        const deployments = await this.listDeployments(project);
        for (const dep of deployments) {
          const key = `${dep.environment}:${dep.id}`;
          const prev = lastDeployState.get(key);
          if (prev !== dep.status) {
            lastDeployState.set(key, dep.status);
            if (prev !== undefined) {
              callback({ type: "deployment_updated", deployment: dep });
            }
          }
        }

        // Determine next interval: active if any pipeline is in-progress
        const hasActive = pipelines.some(
          (p) => p.status === "queued" || p.status === "in_progress",
        );
        const intervalMs = hasActive ? 30_000 : 300_000; // 30s active, 5m idle

        if (!disposed) {
          timeout = setTimeout(poll, intervalMs);
        }
      } catch {
        // On error, retry after idle interval
        if (!disposed) {
          timeout = setTimeout(poll, 300_000);
        }
      }
    };

    // Seed initial state before emitting change events
    const seed = async () => {
      try {
        const pipelines = await this.listPipelines(project, { limit: 10 });
        for (const p of pipelines) lastStatus.set(p.id, p.status);

        const deployments = await this.listDeployments(project);
        for (const d of deployments) lastDeployState.set(`${d.environment}:${d.id}`, d.status);
      } catch {
        // Seed failure is non-fatal — first poll will populate
      }
      if (!disposed) {
        const hasActive = [...lastStatus.values()].some(
          (s) => s === "queued" || s === "in_progress",
        );
        timeout = setTimeout(poll, hasActive ? 30_000 : 300_000);
      }
    };

    seed();

    return {
      dispose() {
        disposed = true;
        if (timeout) clearTimeout(timeout);
      },
    };
  }
}

// Exported for testing
export { mapGHRun, mapGHJob, mapGHStep, computeDurationMs };
export type { GHWorkflowRun, GHJob, GHStep, GHDeployment, GHDeploymentStatusEntry };
