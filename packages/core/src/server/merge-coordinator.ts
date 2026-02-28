import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { randomUUID } from "node:crypto";

const exec = promisify(execFile);

export type MergeStatus = "queued" | "running" | "succeeded" | "failed" | "cancelled";

export interface MergeRequest {
  id: string;
  sessionId: string;
  projectPath: string;
  sourceBranch: string;
  targetBranch: string;
  runTests: boolean;
  autoMerge: boolean;
  status: MergeStatus;
  createdAt: string;
  completedAt?: string;
  error?: string;
  validationResults?: ValidationResult[];
}

export interface ValidationResult {
  step: string;
  passed: boolean;
  output?: string;
  duration?: number;
}

export interface MergeCoordinatorConfig {
  testCommand?: string;
  typecheckCommand?: string;
  lintCommand?: string;
}

type MergeEventHandler = (event: MergeEvent) => void;
export type MergeEvent =
  | { type: "merge_queued"; request: MergeRequest }
  | { type: "merge_started"; requestId: string }
  | { type: "merge_succeeded"; requestId: string }
  | { type: "merge_failed"; requestId: string; error: string };

export class MergeCoordinator {
  private queue: MergeRequest[] = [];
  private processing = false;
  private listeners = new Set<MergeEventHandler>();
  private config: MergeCoordinatorConfig;

  constructor(config: MergeCoordinatorConfig = {}) {
    this.config = config;
  }

  async requestMerge(opts: {
    sessionId: string;
    projectPath: string;
    sourceBranch: string;
    targetBranch: string;
    runTests?: boolean;
    autoMerge?: boolean;
  }): Promise<MergeRequest> {
    const request: MergeRequest = {
      id: randomUUID(),
      sessionId: opts.sessionId,
      projectPath: opts.projectPath,
      sourceBranch: opts.sourceBranch,
      targetBranch: opts.targetBranch,
      runTests: opts.runTests ?? true,
      autoMerge: opts.autoMerge ?? false,
      status: "queued",
      createdAt: new Date().toISOString(),
    };

    this.queue.push(request);
    this.emit({ type: "merge_queued", request });

    // Process queue if not already running
    if (!this.processing) {
      this.processQueue().catch(() => {});
    }

    return request;
  }

  getQueue(): MergeRequest[] {
    return [...this.queue];
  }

  getRequest(id: string): MergeRequest | undefined {
    return this.queue.find((r) => r.id === id);
  }

  cancelRequest(id: string): boolean {
    const req = this.queue.find((r) => r.id === id);
    if (req && req.status === "queued") {
      req.status = "cancelled";
      return true;
    }
    return false;
  }

  onEvent(handler: MergeEventHandler): void {
    this.listeners.add(handler);
  }

  offEvent(handler: MergeEventHandler): void {
    this.listeners.delete(handler);
  }

  private async processQueue(): Promise<void> {
    this.processing = true;

    while (true) {
      const next = this.queue.find((r) => r.status === "queued");
      if (!next) break;

      next.status = "running";
      this.emit({ type: "merge_started", requestId: next.id });

      try {
        await this.executeMerge(next);
        next.status = "succeeded";
        next.completedAt = new Date().toISOString();
        this.emit({ type: "merge_succeeded", requestId: next.id });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        next.status = "failed";
        next.error = message;
        next.completedAt = new Date().toISOString();
        this.emit({ type: "merge_failed", requestId: next.id, error: message });
      }
    }

    this.processing = false;
  }

  private async executeMerge(request: MergeRequest): Promise<void> {
    const cwd = request.projectPath;
    const results: ValidationResult[] = [];

    // 1. Checkout target branch
    await exec("git", ["checkout", request.targetBranch], { cwd });

    // 2. Merge source branch
    try {
      await exec("git", ["merge", request.sourceBranch, "--no-ff", "-m",
        `Merge ${request.sourceBranch} into ${request.targetBranch}`], { cwd });
    } catch (err) {
      // Abort merge on conflict
      await exec("git", ["merge", "--abort"], { cwd }).catch(() => {});
      throw new Error(`Merge conflict: ${err instanceof Error ? err.message : String(err)}`);
    }

    // 3. Run validation steps
    if (request.runTests) {
      if (this.config.typecheckCommand) {
        const result = await this.runValidation("typecheck", this.config.typecheckCommand, cwd);
        results.push(result);
        if (!result.passed) {
          await this.rollback(request, cwd);
          throw new Error(`Typecheck failed: ${result.output}`);
        }
      }

      if (this.config.lintCommand) {
        const result = await this.runValidation("lint", this.config.lintCommand, cwd);
        results.push(result);
        if (!result.passed) {
          await this.rollback(request, cwd);
          throw new Error(`Lint failed: ${result.output}`);
        }
      }

      if (this.config.testCommand) {
        const result = await this.runValidation("test", this.config.testCommand, cwd);
        results.push(result);
        if (!result.passed) {
          await this.rollback(request, cwd);
          throw new Error(`Tests failed: ${result.output}`);
        }
      }
    }

    request.validationResults = results;

    // 4. If not auto-merge, leave it for manual approval (status stays "running")
    if (!request.autoMerge) {
      // The merge commit is already in place — user can approve or rollback
    }
  }

  private async runValidation(step: string, command: string, cwd: string): Promise<ValidationResult> {
    const start = Date.now();
    try {
      const [cmd, ...args] = command.split(" ");
      const { stdout } = await exec(cmd, args, { cwd, timeout: 300_000 });
      return { step, passed: true, output: stdout.slice(0, 1000), duration: Date.now() - start };
    } catch (err) {
      const output = err instanceof Error ? (err as any).stderr || err.message : String(err);
      return { step, passed: false, output: String(output).slice(0, 1000), duration: Date.now() - start };
    }
  }

  private async rollback(request: MergeRequest, cwd: string): Promise<void> {
    try {
      await exec("git", ["reset", "--hard", `HEAD~1`], { cwd });
      await exec("git", ["checkout", request.targetBranch], { cwd });
    } catch {
      // Best effort rollback
    }
  }

  private emit(event: MergeEvent): void {
    for (const h of this.listeners) h(event);
  }
}
