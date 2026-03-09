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

export function portsPath(): string {
  return join(opcomRoot(), "ports.yaml");
}

export function rolesDir(): string {
  return join(opcomRoot(), "roles");
}

export function rolePath(id: string): string {
  return join(rolesDir(), `${id}.yaml`);
}

export function skillsDir(): string {
  return join(opcomRoot(), "skills");
}

export function skillPath(id: string): string {
  return join(skillsDir(), id, "SKILL.md");
}

export function summariesDir(): string {
  return join(opcomRoot(), "summaries");
}

export function summaryPath(projectId: string): string {
  return join(summariesDir(), `${projectId}.md`);
}

export function templatesDir(): string {
  return join(opcomRoot(), "templates");
}

export function templateDir(id: string): string {
  return join(templatesDir(), id);
}

export function stateDir(): string {
  return join(opcomRoot(), "state");
}

export function stateFilePath(concern: "decisions" | "metrics" | "artifacts"): string {
  return join(stateDir(), `${concern}.jsonl`);
}
