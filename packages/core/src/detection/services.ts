import { existsSync } from "node:fs";
import { join } from "node:path";
import type { SubProject, DetectionEvidence } from "@opcom/types";
import { readdir } from "node:fs/promises";

export interface SubProjectDetectionResult {
  subProjects: SubProject[];
  evidence: DetectionEvidence[];
}

export async function detectSubProjects(projectPath: string): Promise<SubProjectDetectionResult> {
  const subProjects: SubProject[] = [];
  const evidence: DetectionEvidence[] = [];

  // Check common monorepo patterns
  const patterns = ["packages", "apps", "services", "libs", "modules"];

  for (const dir of patterns) {
    const fullPath = join(projectPath, dir);
    if (!existsSync(fullPath)) continue;

    try {
      const entries = await readdir(fullPath, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        const subPath = join(fullPath, entry.name);
        const hasPackageJson = existsSync(join(subPath, "package.json"));
        const hasPyproject = existsSync(join(subPath, "pyproject.toml"));

        if (hasPackageJson || hasPyproject) {
          subProjects.push({
            name: entry.name,
            path: subPath,
            relativePath: `${dir}/${entry.name}`,
          });
          evidence.push({
            file: `${dir}/${entry.name}`,
            detectedAs: "sub-project",
            details: hasPackageJson ? "has package.json" : "has pyproject.toml",
          });
        }
      }
    } catch {
      // Skip unreadable directories
    }
  }

  // Also check for standalone directories with their own configs
  // (e.g., app/, admin/, functions/, workers/ at project root)
  const rootEntries = await readdir(projectPath, { withFileTypes: true }).catch(() => []);
  for (const entry of rootEntries) {
    if (!entry.isDirectory()) continue;
    if (patterns.includes(entry.name)) continue; // Already checked
    if (entry.name.startsWith(".") || entry.name === "node_modules" || entry.name === "dist") continue;

    const subPath = join(projectPath, entry.name);
    const hasPackageJson = existsSync(join(subPath, "package.json"));
    const hasPyproject = existsSync(join(subPath, "pyproject.toml"));

    if (hasPackageJson || hasPyproject) {
      subProjects.push({
        name: entry.name,
        path: subPath,
        relativePath: entry.name,
      });
      evidence.push({
        file: entry.name,
        detectedAs: "sub-project",
        details: hasPackageJson ? "has package.json" : "has pyproject.toml",
      });
    }
  }

  return { subProjects, evidence };
}
