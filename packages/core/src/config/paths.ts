import { join } from "node:path";
import { homedir } from "node:os";

const OPCOM_DIR = ".opcom";

export function opcomRoot(): string {
  return join(homedir(), OPCOM_DIR);
}

export function globalConfigPath(): string {
  return join(opcomRoot(), "config.yaml");
}

export function workspacesDir(): string {
  return join(opcomRoot(), "workspaces");
}

export function workspacePath(id: string): string {
  return join(workspacesDir(), `${id}.yaml`);
}

export function projectsDir(): string {
  return join(opcomRoot(), "projects");
}

export function projectPath(id: string): string {
  return join(projectsDir(), `${id}.yaml`);
}

export function plansDir(): string {
  return join(opcomRoot(), "plans");
}

export function planPath(id: string): string {
  return join(plansDir(), `${id}.yaml`);
}

export function planContextPath(id: string): string {
  return join(plansDir(), `${id}.context.md`);
}
