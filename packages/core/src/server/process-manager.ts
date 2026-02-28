import { spawn, type ChildProcess } from "node:child_process";
import { join } from "node:path";
import type { ServiceDefinition, ProjectConfig } from "@opcom/types";

export interface ManagedProcess {
  name: string;
  projectId: string;
  pid: number;
  port?: number;
  command: string;
  cwd: string;
  state: "starting" | "running" | "stopped" | "error";
  startedAt: string;
  stdout: string[];
  stderr: string[];
}

type ProcessEventHandler = (event: ProcessEvent) => void;

export type ProcessEvent =
  | { type: "started"; process: ManagedProcess }
  | { type: "stopped"; name: string; projectId: string; code: number | null }
  | { type: "error"; name: string; projectId: string; message: string }
  | { type: "output"; name: string; projectId: string; stream: "stdout" | "stderr"; text: string };

export class ProcessManager {
  private processes = new Map<string, { managed: ManagedProcess; proc: ChildProcess }>();
  private listeners = new Set<ProcessEventHandler>();
  private maxOutputLines = 500;

  private key(projectId: string, name: string): string {
    return `${projectId}/${name}`;
  }

  async startService(
    project: ProjectConfig,
    service: ServiceDefinition,
  ): Promise<ManagedProcess> {
    const k = this.key(project.id, service.name);

    // Already running?
    const existing = this.processes.get(k);
    if (existing && existing.managed.state === "running") {
      return existing.managed;
    }

    const command = service.command ?? `echo "No command for ${service.name}"`;
    const cwd = service.cwd ? join(project.path, service.cwd) : project.path;

    const proc = spawn("sh", ["-c", command], {
      cwd,
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env },
    });

    const managed: ManagedProcess = {
      name: service.name,
      projectId: project.id,
      pid: proc.pid ?? 0,
      port: service.port,
      command,
      cwd,
      state: "starting",
      startedAt: new Date().toISOString(),
      stdout: [],
      stderr: [],
    };

    this.processes.set(k, { managed, proc });

    // Capture output
    proc.stdout?.on("data", (data: Buffer) => {
      const text = data.toString("utf-8");
      managed.stdout.push(text);
      if (managed.stdout.length > this.maxOutputLines) {
        managed.stdout = managed.stdout.slice(-this.maxOutputLines);
      }
      this.emit({ type: "output", name: service.name, projectId: project.id, stream: "stdout", text });
    });

    proc.stderr?.on("data", (data: Buffer) => {
      const text = data.toString("utf-8");
      managed.stderr.push(text);
      if (managed.stderr.length > this.maxOutputLines) {
        managed.stderr = managed.stderr.slice(-this.maxOutputLines);
      }
      this.emit({ type: "output", name: service.name, projectId: project.id, stream: "stderr", text });
    });

    proc.on("error", (err) => {
      managed.state = "error";
      this.emit({ type: "error", name: service.name, projectId: project.id, message: err.message });
    });

    proc.on("close", (code) => {
      managed.state = "stopped";
      this.emit({ type: "stopped", name: service.name, projectId: project.id, code });
    });

    // Check if port is listening after a delay
    if (service.port) {
      setTimeout(async () => {
        if (managed.state === "starting") {
          const listening = await isPortListening(service.port!);
          managed.state = listening ? "running" : "starting";
          if (listening) {
            this.emit({ type: "started", process: managed });
          }
        }
      }, 2000);
    } else {
      managed.state = "running";
      this.emit({ type: "started", process: managed });
    }

    return managed;
  }

  async startAllServices(project: ProjectConfig): Promise<ManagedProcess[]> {
    const results: ManagedProcess[] = [];

    // Sort services by dependency (services with no port first = databases)
    const sorted = [...project.services].sort((a, b) => {
      // Prioritize databases/infra
      const aDb = isInfraService(a.name);
      const bDb = isInfraService(b.name);
      if (aDb && !bDb) return -1;
      if (!aDb && bDb) return 1;
      return 0;
    });

    for (const service of sorted) {
      if (!service.command) continue;
      const managed = await this.startService(project, service);
      results.push(managed);
    }

    return results;
  }

  async stopService(projectId: string, name: string): Promise<void> {
    const k = this.key(projectId, name);
    const entry = this.processes.get(k);
    if (!entry) return;

    entry.proc.kill("SIGTERM");

    await new Promise<void>((resolve) => {
      const timeout = setTimeout(() => {
        entry.proc.kill("SIGKILL");
        resolve();
      }, 5000);

      entry.proc.on("close", () => {
        clearTimeout(timeout);
        resolve();
      });
    });

    entry.managed.state = "stopped";
    this.processes.delete(k);
  }

  async stopAllServices(projectId: string): Promise<void> {
    const keys = Array.from(this.processes.keys()).filter((k) => k.startsWith(`${projectId}/`));
    await Promise.all(keys.map((k) => {
      const parts = k.split("/");
      return this.stopService(parts[0], parts.slice(1).join("/"));
    }));
  }

  getProcess(projectId: string, name: string): ManagedProcess | undefined {
    return this.processes.get(this.key(projectId, name))?.managed;
  }

  listProcesses(projectId?: string): ManagedProcess[] {
    const all = Array.from(this.processes.values()).map((e) => e.managed);
    if (projectId) return all.filter((p) => p.projectId === projectId);
    return all;
  }

  onEvent(handler: ProcessEventHandler): void {
    this.listeners.add(handler);
  }

  offEvent(handler: ProcessEventHandler): void {
    this.listeners.delete(handler);
  }

  private emit(event: ProcessEvent): void {
    for (const h of this.listeners) h(event);
  }

  async shutdown(): Promise<void> {
    const all = Array.from(this.processes.keys());
    await Promise.all(all.map((k) => {
      const parts = k.split("/");
      return this.stopService(parts[0], parts.slice(1).join("/"));
    }));
  }
}

function isInfraService(name: string): boolean {
  const infra = ["postgres", "postgresql", "mysql", "redis", "mongo", "mongodb", "rabbitmq", "kafka", "zookeeper", "elasticsearch"];
  return infra.some((i) => name.toLowerCase().includes(i));
}

async function isPortListening(port: number): Promise<boolean> {
  const { createConnection } = await import("node:net");
  return new Promise((resolve) => {
    const socket = createConnection({ port, host: "localhost" });
    socket.on("connect", () => {
      socket.destroy();
      resolve(true);
    });
    socket.on("error", () => {
      resolve(false);
    });
    socket.setTimeout(1000, () => {
      socket.destroy();
      resolve(false);
    });
  });
}
