/**
 * TypeScript/JavaScript import analyzer.
 *
 * Parses import/require statements to build the import graph.
 * Uses regex-based parsing (no TS compiler API dependency).
 * Handles: import X from "Y", import { X } from "Y", require("Y"),
 * export * from "Y", dynamic import("Y").
 */

import { join, dirname, resolve } from "node:path";
import type { Analyzer, AnalyzerContext, AnalyzerResult } from "../core/analyzer.js";
import type { GraphNode, GraphEdge } from "../core/schema.js";

const IMPORT_PATTERNS = [
  // import X from "Y"  /  import { X } from "Y"  /  import "Y"
  /import\s+(?:(?:[\w*{}\s,]+)\s+from\s+)?['"]([^'"]+)['"]/g,
  // export * from "Y"  /  export { X } from "Y"
  /export\s+(?:(?:[\w*{}\s,]+)\s+from\s+)?['"]([^'"]+)['"]/g,
  // require("Y")
  /require\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
  // dynamic import("Y")
  /import\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
];

const TS_EXTENSIONS = [".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"];

const SKIP_DIRS = new Set([
  "node_modules", "dist", "build", ".next", ".expo", "__pycache__",
  ".git", "coverage", ".turbo", ".vercel",
]);

export class TypeScriptImportAnalyzer implements Analyzer {
  name = "typescript-imports";

  detect(ctx: AnalyzerContext): boolean {
    return (
      ctx.fileExists("package.json") ||
      ctx.fileExists("tsconfig.json") ||
      ctx.fileExists("deno.json") ||
      ctx.files.some((f) => f.endsWith(".ts") || f.endsWith(".tsx"))
    );
  }

  async analyze(ctx: AnalyzerContext): Promise<AnalyzerResult> {
    const nodes: GraphNode[] = [];
    const edges: GraphEdge[] = [];

    const tsFiles = ctx.files.filter((f) => {
      if (!TS_EXTENSIONS.some((ext) => f.endsWith(ext))) return false;
      const parts = f.split("/");
      return !parts.some((p) => SKIP_DIRS.has(p));
    });

    for (const file of tsFiles) {
      const nodeId = `file:${file}`;
      const isTest = this.isTestFile(file);

      nodes.push({
        id: nodeId,
        type: isTest ? "test" : "file",
        path: file,
        title: file.split("/").pop()?.replace(/\.[^.]+$/, "") ?? file,
        meta: { language: "typescript" },
      });

      // Parse imports
      let content: string;
      try {
        content = await ctx.readFile(file);
      } catch {
        continue;
      }

      const imports = this.extractImports(content);
      for (const imp of imports) {
        const resolved = this.resolveImport(imp, file, ctx);
        if (resolved) {
          const targetId = `file:${resolved}`;
          edges.push({ source: nodeId, target: targetId, relation: "imports" });

          // If this is a test file importing a source file, add "tests" edge
          if (isTest && !this.isTestFile(resolved)) {
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
      // Reset lastIndex since we're reusing regex
      const regex = new RegExp(pattern.source, pattern.flags);
      let match;
      while ((match = regex.exec(content)) !== null) {
        imports.push(match[1]);
      }
    }
    return [...new Set(imports)];
  }

  private resolveImport(importPath: string, fromFile: string, ctx: AnalyzerContext): string | null {
    // Skip external packages (no . or / prefix)
    if (!importPath.startsWith(".") && !importPath.startsWith("/")) {
      // Could be a path alias — check tsconfig paths
      // For now, skip external imports
      return null;
    }

    const fromDir = dirname(fromFile);
    const resolved = join(fromDir, importPath).replace(/\\/g, "/");

    // Try with extensions
    for (const ext of ["", ".ts", ".tsx", ".js", ".jsx", "/index.ts", "/index.tsx", "/index.js"]) {
      const candidate = resolved + ext;
      if (ctx.files.includes(candidate)) {
        return candidate;
      }
    }

    // Try stripping .js extension (common in ESM TS projects)
    if (importPath.endsWith(".js")) {
      const tsPath = join(fromDir, importPath.replace(/\.js$/, ".ts")).replace(/\\/g, "/");
      if (ctx.files.includes(tsPath)) {
        return tsPath;
      }
    }

    return null;
  }

  private isTestFile(file: string): boolean {
    const name = file.split("/").pop() ?? "";
    return (
      name.includes(".test.") ||
      name.includes(".spec.") ||
      name.startsWith("test_") ||
      file.includes("/tests/") ||
      file.includes("/__tests__/")
    );
  }
}
