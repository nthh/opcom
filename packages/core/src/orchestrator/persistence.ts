import { readFile, writeFile, mkdir, readdir, unlink } from "node:fs/promises";
import { existsSync } from "node:fs";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";
import type { Plan, OrchestratorConfig } from "@opcom/types";
import { plansDir, planPath, planContextPath } from "../config/paths.js";

export function defaultConfig(): OrchestratorConfig {
  return {
    maxConcurrentAgents: 3,
    autoStart: false,
    backend: "claude-code",
    worktree: true,
    pauseOnFailure: true,
    ticketTransitions: true,
    autoCommit: true,
    verification: {
      runTests: true,
      runOracle: false,
    },
  };
}

async function ensurePlansDir(): Promise<void> {
  await mkdir(plansDir(), { recursive: true });
}

export async function savePlan(plan: Plan): Promise<void> {
  await ensurePlansDir();
  plan.updatedAt = new Date().toISOString();
  const content = stringifyYaml(plan, { lineWidth: 120 });
  await writeFile(planPath(plan.id), content, "utf-8");
}

export async function loadPlan(id: string): Promise<Plan | null> {
  const path = planPath(id);
  if (!existsSync(path)) return null;
  const raw = await readFile(path, "utf-8");
  return parseYaml(raw) as Plan;
}

export async function listPlans(): Promise<Plan[]> {
  const dir = plansDir();
  if (!existsSync(dir)) return [];
  const files = await readdir(dir);
  const plans: Plan[] = [];
  for (const f of files) {
    if (!f.endsWith(".yaml")) continue;
    try {
      const raw = await readFile(`${dir}/${f}`, "utf-8");
      plans.push(parseYaml(raw) as Plan);
    } catch {
      // Skip unreadable files
    }
  }
  return plans.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export async function deletePlan(id: string): Promise<void> {
  const path = planPath(id);
  if (existsSync(path)) await unlink(path);
  const ctxPath = planContextPath(id);
  if (existsSync(ctxPath)) await unlink(ctxPath);
}

export async function loadPlanContext(id: string): Promise<string> {
  const path = planContextPath(id);
  if (!existsSync(path)) return "";
  return readFile(path, "utf-8");
}

export async function savePlanContext(id: string, context: string): Promise<void> {
  await ensurePlansDir();
  await writeFile(planContextPath(id), context, "utf-8");
}
