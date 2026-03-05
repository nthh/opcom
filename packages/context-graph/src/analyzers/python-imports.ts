/**
 * Python import analyzer.
 *
 * Parses import/from-import statements using regex (no Python AST dependency).
 * Resolves imports to files within the project.
 */

import { join } from "node:path";
import type { Analyzer, AnalyzerContext, AnalyzerResult } from "../core/analyzer.js";
import type { GraphNode, GraphEdge } from "../core/schema.js";

const IMPORT_PATTERNS = [
  // from X import Y
  /^\s*from\s+([\w.]+)\s+import\b/gm,
  // import X
  /^\s*import\s+([\w.]+)/gm,
];

const SKIP_DIRS = new Set([
  "node_modules", "__pycache__", ".venv", "venv", ".git", "dist",
  ".eggs", "*.egg-info",
]);

export class PythonImportAnalyzer implements Analyzer {
  name = "python-imports";

  detect(ctx: AnalyzerContext): boolean {
    return (
      ctx.fileExists("pyproject.toml") ||
      ctx.fileExists("setup.py") ||
      ctx.fileExists("requirements.txt") ||
      ctx.files.some((f) => f.endsWith(".py"))
    );
  }

  async analyze(ctx: AnalyzerContext): Promise<AnalyzerResult> {
    const nodes: GraphNode[] = [];
    const edges: GraphEdge[] = [];

    const pyFiles = ctx.files.filter((f) => {
      if (!f.endsWith(".py")) return false;
      const parts = f.split("/");
      return !parts.some((p) => SKIP_DIRS.has(p));
    });

    // Detect top-level packages (directories with __init__.py)
    const topPackages = new Set<string>();
    for (const f of pyFiles) {
      const parts = f.split("/");
      if (parts.length >= 2 && parts[parts.length - 1] === "__init__.py") {
        topPackages.add(parts[0]);
      }
    }

    for (const file of pyFiles) {
      const isTest = file.split("/").pop()?.startsWith("test_") ?? false;
      const nodeId = `file:${file}`;

      nodes.push({
        id: nodeId,
        type: isTest ? "test" : "file",
        path: file,
        title: file.split("/").pop()?.replace(/\.py$/, "") ?? file,
        meta: { language: "python" },
      });

      let content: string;
      try {
        content = await ctx.readFile(file);
      } catch {
        continue;
      }

      const imports = this.extractImports(content);
      for (const imp of imports) {
        const resolved = this.resolveImport(imp, topPackages, ctx);
        if (resolved) {
          const targetId = `file:${resolved}`;
          edges.push({ source: nodeId, target: targetId, relation: "imports" });

          if (isTest && !resolved.includes("test_")) {
            edges.push({ source: nodeId, target: targetId, relation: "tests" });
          }
        }
      }
    }

    return { nodes, edges };
  }

  private extractImports(content: string): string[] {
    const imports: string[] = [];
    for (const pattern of IMPORT_PATTERNS) {
      const regex = new RegExp(pattern.source, pattern.flags);
      let match;
      while ((match = regex.exec(content)) !== null) {
        imports.push(match[1]);
      }
    }
    return [...new Set(imports)];
  }

  private resolveImport(importPath: string, topPackages: Set<string>, ctx: AnalyzerContext): string | null {
    const parts = importPath.split(".");
    const topPackage = parts[0];

    // Only resolve imports within the project
    if (!topPackages.has(topPackage)) return null;

    // Try as module file
    const asFile = parts.join("/") + ".py";
    if (ctx.files.includes(asFile)) return asFile;

    // Try as package
    const asPackage = parts.join("/") + "/__init__.py";
    if (ctx.files.includes(asPackage)) return asPackage;

    // Try parent module (e.g., folia.compute → folia/compute.py even if import is folia.compute.X)
    for (let i = parts.length - 1; i >= 1; i--) {
      const partial = parts.slice(0, i).join("/") + ".py";
      if (ctx.files.includes(partial)) return partial;
      const partialPkg = parts.slice(0, i).join("/") + "/__init__.py";
      if (ctx.files.includes(partialPkg)) return partialPkg;
    }

    return null;
  }
}
