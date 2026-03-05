/**
 * Markdown documentation analyzer.
 *
 * Discovers specs, ADRs, and other documentation files.
 * Extracts cross-references using [[type:id]] link patterns.
 * Parses YAML frontmatter for metadata.
 */

import type { Analyzer, AnalyzerContext, AnalyzerResult } from "../core/analyzer.js";
import type { GraphNode, GraphEdge } from "../core/schema.js";

const LINK_PATTERN = /\[\[(\w+):([^\]]+)\]\]/g;

export class MarkdownDocAnalyzer implements Analyzer {
  name = "markdown-docs";

  detect(ctx: AnalyzerContext): boolean {
    // Any project with docs/ or .md files
    return ctx.files.some((f) => f.endsWith(".md") && (f.includes("docs/") || f.includes("spec/")));
  }

  async analyze(ctx: AnalyzerContext): Promise<AnalyzerResult> {
    const nodes: GraphNode[] = [];
    const edges: GraphEdge[] = [];

    const mdFiles = ctx.files.filter((f) => f.endsWith(".md") && !f.includes("node_modules"));

    for (const file of mdFiles) {
      let content: string;
      try {
        content = await ctx.readFile(file);
      } catch {
        continue;
      }

      const nodeType = this.classifyDoc(file);
      if (!nodeType) continue;

      const fm = this.parseFrontmatter(content);
      const title = this.extractTitle(content) ?? file.split("/").pop()?.replace(".md", "") ?? file;

      const id = this.makeId(nodeType, file, fm);
      nodes.push({
        id,
        type: nodeType,
        path: file,
        title,
        status: fm.status as string | undefined,
        meta: fm,
      });

      // Extract [[type:id]] cross-references
      const regex = new RegExp(LINK_PATTERN.source, LINK_PATTERN.flags);
      let match;
      while ((match = regex.exec(content)) !== null) {
        const linkType = match[1];
        const linkId = match[2].split("#")[0].toLowerCase();
        const targetId = `${linkType}:${linkId}`;

        if (targetId !== id) {
          edges.push({ source: id, target: targetId, relation: "links_to" });
        }
      }

      // ADR supersession
      if (nodeType === "adr") {
        const supersedesMatch = content.match(/supersedes\s*(?:ADR[- ]?)(\d{4})/gi);
        if (supersedesMatch) {
          for (const m of supersedesMatch) {
            const num = m.match(/(\d{4})/);
            if (num) {
              edges.push({ source: id, target: `adr:${num[1]}`, relation: "supersedes" });
            }
          }
        }
      }
    }

    return { nodes, edges };
  }

  private classifyDoc(file: string): string | null {
    if (file.includes("/spec/") || file.includes("/specs/")) return "spec";
    if (file.includes("/decisions/") || file.includes("/adr/")) return "adr";
    if (file.includes("/use_cases/") || file.includes("/use-cases/")) return "use_case";
    // Skip generic markdown files (README, CHANGELOG, etc.)
    return null;
  }

  private makeId(type: string, file: string, fm: Record<string, unknown>): string {
    if (type === "adr") {
      const match = file.match(/(\d{3,4})-/);
      if (match) return `adr:${match[1]}`;
    }

    const name = (fm.id as string) ?? (fm.spec as string) ?? file.split("/").pop()?.replace(".md", "");
    return `${type}:${name?.toLowerCase().replace(/\s+/g, "_") ?? file}`;
  }

  private extractTitle(content: string): string | null {
    for (const line of content.split("\n").slice(0, 20)) {
      if (line.startsWith("# ")) return line.slice(2).trim();
    }
    return null;
  }

  private parseFrontmatter(content: string): Record<string, unknown> {
    if (!content.startsWith("---")) return {};
    const end = content.indexOf("\n---", 3);
    if (end === -1) return {};

    const fm = content.slice(4, end).trim();
    const result: Record<string, unknown> = {};
    let currentKey: string | null = null;
    let currentList: string[] | null = null;

    for (const line of fm.split("\n")) {
      if (!line.trim()) continue;

      if (line.startsWith("  - ")) {
        if (currentKey && currentList !== null) {
          currentList.push(line.slice(4).trim().replace(/^["']|["']$/g, ""));
        }
        continue;
      }

      const m = line.match(/^(\w[\w-]*)\s*:\s*(.*)$/);
      if (m) {
        if (currentKey && currentList !== null) {
          result[currentKey] = currentList;
        }
        const [, key, value] = m;
        const v = value.trim().replace(/^["']|["']$/g, "");
        if (v === "" || v === "[]") {
          currentKey = key;
          currentList = [];
        } else {
          result[key] = v;
          currentKey = null;
          currentList = null;
        }
      }
    }

    if (currentKey && currentList !== null) {
      result[currentKey] = currentList;
    }

    return result;
  }
}
