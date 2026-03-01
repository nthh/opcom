import type {
  CICDAdapter,
  CICDEvent,
  Disposable,
  Pipeline,
  DeploymentStatus,
  ProjectConfig,
} from "@opcom/types";

export interface CICDPollerConfig {
  activeIntervalMs?: number;   // default 30_000 (30s)
  idleIntervalMs?: number;     // default 300_000 (5m)
}

export interface ProjectCICDState {
  projectId: string;
  pipelines: Pipeline[];
  deployments: DeploymentStatus[];
  lastFetchedAt: string;
}

export type PollerEventCallback = (projectId: string, event: CICDEvent) => void;

/**
 * Manages CI/CD polling across multiple projects.
 * Each tracked project gets its own watch cycle via the adapter.
 */
export class CICDPoller {
  private watchers = new Map<string, Disposable>();
  private state = new Map<string, ProjectCICDState>();
  private listeners: PollerEventCallback[] = [];

  constructor(
    private adapter: CICDAdapter,
    private config: CICDPollerConfig = {},
  ) {}

  /** Subscribe to CI/CD events across all tracked projects. */
  onEvent(callback: PollerEventCallback): Disposable {
    this.listeners.push(callback);
    return {
      dispose: () => {
        const idx = this.listeners.indexOf(callback);
        if (idx >= 0) this.listeners.splice(idx, 1);
      },
    };
  }

  /** Start tracking a project. Fetches initial state then begins polling. */
  async track(project: ProjectConfig): Promise<ProjectCICDState> {
    if (this.watchers.has(project.id)) {
      return this.state.get(project.id)!;
    }

    // Fetch initial snapshot
    const [pipelines, deployments] = await Promise.all([
      this.adapter.listPipelines(project, { limit: 10 }),
      this.adapter.listDeployments(project),
    ]);

    const projectState: ProjectCICDState = {
      projectId: project.id,
      pipelines,
      deployments,
      lastFetchedAt: new Date().toISOString(),
    };
    this.state.set(project.id, projectState);

    // Start watching for changes
    const watcher = this.adapter.watch(project, (event) => {
      this.handleEvent(project.id, event);
    });
    this.watchers.set(project.id, watcher);

    return projectState;
  }

  /** Stop tracking a project. */
  untrack(projectId: string): void {
    const watcher = this.watchers.get(projectId);
    if (watcher) {
      watcher.dispose();
      this.watchers.delete(projectId);
    }
    this.state.delete(projectId);
  }

  /** Get current cached state for a project. */
  getState(projectId: string): ProjectCICDState | undefined {
    return this.state.get(projectId);
  }

  /** Get all tracked project IDs. */
  trackedProjects(): string[] {
    return [...this.watchers.keys()];
  }

  /** Force a refresh of a specific project's CI/CD data. */
  async refresh(project: ProjectConfig): Promise<ProjectCICDState> {
    const [pipelines, deployments] = await Promise.all([
      this.adapter.listPipelines(project, { limit: 10 }),
      this.adapter.listDeployments(project),
    ]);

    const projectState: ProjectCICDState = {
      projectId: project.id,
      pipelines,
      deployments,
      lastFetchedAt: new Date().toISOString(),
    };
    this.state.set(project.id, projectState);
    return projectState;
  }

  /** Stop all watchers and clear state. */
  dispose(): void {
    for (const watcher of this.watchers.values()) {
      watcher.dispose();
    }
    this.watchers.clear();
    this.state.clear();
    this.listeners.length = 0;
  }

  private handleEvent(projectId: string, event: CICDEvent): void {
    const current = this.state.get(projectId);
    if (!current) return;

    if (event.type === "pipeline_updated") {
      const idx = current.pipelines.findIndex((p) => p.id === event.pipeline.id);
      if (idx >= 0) {
        current.pipelines[idx] = event.pipeline;
      } else {
        current.pipelines.unshift(event.pipeline);
        if (current.pipelines.length > 10) current.pipelines.pop();
      }
    } else if (event.type === "deployment_updated") {
      const idx = current.deployments.findIndex((d) => d.id === event.deployment.id);
      if (idx >= 0) {
        current.deployments[idx] = event.deployment;
      } else {
        current.deployments.unshift(event.deployment);
      }
    }

    current.lastFetchedAt = new Date().toISOString();

    for (const listener of this.listeners) {
      listener(projectId, event);
    }
  }
}
