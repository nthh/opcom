import type {
  ProjectConfig,
  ServiceDefinition,
  ServiceInstance,
  EnvironmentStatus,
  HealthCheckConfig,
  PortRegistry,
  PortAllocation,
} from "@opcom/types";
import { ProcessManager } from "./process-manager.js";
import { defaultHealthCheck, runHealthCheck } from "./health-checker.js";
import {
  loadPortRegistry,
  savePortRegistry,
  findConflict,
  allocatePort,
  releasePort,
  findNextAvailablePort,
} from "../config/port-registry.js";

export type EnvironmentEvent =
  | { type: "service_status"; projectId: string; service: ServiceInstance }
  | { type: "port_conflict"; projectId: string; serviceName: string; port: number; conflictsWith: PortAllocation }
  | { type: "environment_status"; projectId: string; status: EnvironmentStatus };

type EnvironmentEventHandler = (event: EnvironmentEvent) => void;

export class EnvironmentManager {
  private processManager: ProcessManager;
  private instances = new Map<string, ServiceInstance>();
  private healthTimers = new Map<string, ReturnType<typeof setInterval>>();
  private listeners = new Set<EnvironmentEventHandler>();
  private registry: PortRegistry | null = null;

  constructor(processManager?: ProcessManager) {
    this.processManager = processManager ?? new ProcessManager();
    this.processManager.onEvent((event) => this.handleProcessEvent(event));
  }

  private key(projectId: string, serviceName: string): string {
    return `${projectId}/${serviceName}`;
  }

  // --- Public API ---

  async startService(project: ProjectConfig, service: ServiceDefinition): Promise<ServiceInstance> {
    const registry = await this.getRegistry();
    let actualPort = service.port;

    // Check port conflicts
    if (actualPort) {
      const conflict = findConflict(actualPort, project.id, service.name, registry);
      if (conflict) {
        this.emit({
          type: "port_conflict",
          projectId: project.id,
          serviceName: service.name,
          port: actualPort,
          conflictsWith: conflict,
        });
        actualPort = findNextAvailablePort(actualPort, registry);
      }
    }

    // Allocate port
    if (actualPort) {
      this.registry = allocatePort(registry, actualPort, project.id, service.name);
      await savePortRegistry(this.registry);
    }

    // Create service definition with resolved port
    const resolvedService: ServiceDefinition = { ...service, port: actualPort };

    // Start process
    const managed = await this.processManager.startService(project, resolvedService);

    const instance: ServiceInstance = {
      serviceName: service.name,
      projectId: project.id,
      pid: managed.pid,
      port: actualPort,
      state: "starting",
      startedAt: managed.startedAt,
      restartCount: 0,
    };

    this.instances.set(this.key(project.id, service.name), instance);
    this.emitServiceStatus(instance);

    // Start health checking
    const hcConfig = service.healthCheck ?? defaultHealthCheck(actualPort);
    if (hcConfig) {
      this.startHealthChecking(project.id, service.name, hcConfig, actualPort);
    } else {
      // No health check — assume running if process is alive
      instance.state = "running";
      this.emitServiceStatus(instance);
    }

    return instance;
  }

  async startAllServices(project: ProjectConfig): Promise<ServiceInstance[]> {
    const services = project.services.filter((s) => s.command);
    const sorted = topologicalSort(services);
    const results: ServiceInstance[] = [];

    for (const service of sorted) {
      // Wait for dependencies to be healthy
      if (service.dependsOn?.length) {
        await this.waitForDependencies(project.id, service.dependsOn);
      }
      const instance = await this.startService(project, service);
      results.push(instance);
    }

    return results;
  }

  async stopService(projectId: string, serviceName: string): Promise<void> {
    const k = this.key(projectId, serviceName);

    // Stop health checking
    this.stopHealthChecking(k);

    // Stop process
    await this.processManager.stopService(projectId, serviceName);

    // Update instance
    const instance = this.instances.get(k);
    if (instance) {
      instance.state = "stopped";
      this.emitServiceStatus(instance);
    }

    // Release port
    const registry = await this.getRegistry();
    this.registry = releasePort(registry, projectId, serviceName);
    await savePortRegistry(this.registry);
  }

  async stopAllServices(projectId: string): Promise<void> {
    const instances = this.listInstances(projectId);
    for (const inst of instances) {
      await this.stopService(projectId, inst.serviceName);
    }
  }

  getInstance(projectId: string, serviceName: string): ServiceInstance | undefined {
    return this.instances.get(this.key(projectId, serviceName));
  }

  listInstances(projectId?: string): ServiceInstance[] {
    const all = Array.from(this.instances.values());
    if (projectId) return all.filter((i) => i.projectId === projectId);
    return all;
  }

  getEnvironmentStatus(projectId: string): EnvironmentStatus {
    const services = this.listInstances(projectId);
    const ports = services.filter((s) => s.port != null).map((s) => s.port!);
    const running = services.filter((s) => s.state === "running");
    const unhealthy = services.filter((s) => s.state === "unhealthy");

    let state: EnvironmentStatus["state"];
    if (services.length === 0 || running.length === 0) {
      state = "all-down";
    } else if (running.length === services.length) {
      state = "all-up";
    } else if (unhealthy.length > 0) {
      state = "degraded";
    } else {
      state = "partial";
    }

    const startTimes = running.map((s) => s.startedAt).sort();

    return {
      projectId,
      state,
      services,
      ports,
      upSince: startTimes[0],
    };
  }

  async getPortRegistry(): Promise<PortRegistry> {
    return this.getRegistry();
  }

  onEvent(handler: EnvironmentEventHandler): void {
    this.listeners.add(handler);
  }

  offEvent(handler: EnvironmentEventHandler): void {
    this.listeners.delete(handler);
  }

  async shutdown(): Promise<void> {
    for (const [k] of this.healthTimers) {
      this.stopHealthChecking(k);
    }
    await this.processManager.shutdown();
    this.instances.clear();
  }

  // --- Internal ---

  private async getRegistry(): Promise<PortRegistry> {
    if (!this.registry) {
      this.registry = await loadPortRegistry();
    }
    return this.registry;
  }

  private handleProcessEvent(event: import("./process-manager.js").ProcessEvent): void {
    if (event.type === "stopped" || event.type === "error") {
      const k = this.key(event.projectId, event.name);
      const instance = this.instances.get(k);
      if (instance) {
        instance.state = event.type === "error" ? "crashed" : "stopped";
        this.stopHealthChecking(k);
        this.emitServiceStatus(instance);
      }
    }
  }

  private startHealthChecking(
    projectId: string,
    serviceName: string,
    config: HealthCheckConfig,
    port?: number,
  ): void {
    const k = this.key(projectId, serviceName);
    const instance = this.instances.get(k);
    if (!instance) return;

    const startTime = Date.now();
    let consecutiveFailures = 0;

    const check = async () => {
      const inst = this.instances.get(k);
      if (!inst || inst.state === "stopped" || inst.state === "crashed") {
        this.stopHealthChecking(k);
        return;
      }

      const result = await runHealthCheck(config, port);
      inst.lastHealthCheck = result;

      const inGrace = Date.now() - startTime < config.startupGraceMs;

      if (result.healthy) {
        consecutiveFailures = 0;
        if (inst.state !== "running") {
          inst.state = "running";
          this.emitServiceStatus(inst);
        }
      } else if (!inGrace) {
        consecutiveFailures++;
        if (consecutiveFailures >= config.retries && inst.state !== "unhealthy") {
          inst.state = "unhealthy";
          this.emitServiceStatus(inst);
        }
      }
    };

    const timer = setInterval(check, config.intervalMs);
    this.healthTimers.set(k, timer);

    // Run first check after a brief delay
    setTimeout(check, Math.min(1000, config.startupGraceMs));
  }

  private stopHealthChecking(key: string): void {
    const timer = this.healthTimers.get(key);
    if (timer) {
      clearInterval(timer);
      this.healthTimers.delete(key);
    }
  }

  private async waitForDependencies(projectId: string, deps: string[], timeoutMs: number = 60000): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    for (const dep of deps) {
      while (Date.now() < deadline) {
        const inst = this.instances.get(this.key(projectId, dep));
        if (inst?.state === "running") break;
        if (inst?.state === "crashed" || inst?.state === "stopped") {
          throw new Error(`Dependency "${dep}" is ${inst.state}, cannot start dependent service`);
        }
        await new Promise((r) => setTimeout(r, 500));
      }
    }
  }

  private emitServiceStatus(instance: ServiceInstance): void {
    this.emit({ type: "service_status", projectId: instance.projectId, service: { ...instance } });
    this.emit({
      type: "environment_status",
      projectId: instance.projectId,
      status: this.getEnvironmentStatus(instance.projectId),
    });
  }

  private emit(event: EnvironmentEvent): void {
    for (const h of this.listeners) h(event);
  }
}

// --- Topological Sort ---

export function topologicalSort(services: ServiceDefinition[]): ServiceDefinition[] {
  const byName = new Map(services.map((s) => [s.name, s]));
  const visited = new Set<string>();
  const result: ServiceDefinition[] = [];

  function visit(name: string, stack: Set<string>): void {
    if (visited.has(name)) return;
    if (stack.has(name)) {
      throw new Error(`Circular dependency detected: ${Array.from(stack).join(" → ")} → ${name}`);
    }
    const service = byName.get(name);
    if (!service) return;
    stack.add(name);
    for (const dep of service.dependsOn ?? []) {
      visit(dep, stack);
    }
    stack.delete(name);
    visited.add(name);
    result.push(service);
  }

  for (const s of services) {
    visit(s.name, new Set());
  }

  return result;
}
