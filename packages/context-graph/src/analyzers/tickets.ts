/**
 * Ticket system analyzer.
 *
 * Discovers work items from .tickets/impl/ directories.
 * Compatible with trk format (folia) and generic ticket dirs.
 * Extracts frontmatter links to build ticket→spec, ticket→code edges.
 */

import type { Analyzer, AnalyzerContext, AnalyzerResult } from "../core/analyzer.js";
import type { GraphNode, GraphEdge } from "../core/schema.js";

const LINK_PATTERN = /\[\[(\w+):([^\]]+)\]\]/g;

export class TicketAnalyzer implements Analyzer {
  name = "tickets";

  detect(ctx: AnalyzerContext): boolean {
    return (
      ctx.fileExists(".tickets") ||
      ctx.fileExists(".tickets/impl") ||
      ctx.files.some((f) => f.startsWith(".tickets/"))
    );
  }

  async analyze(ctx: AnalyzerContext): Promise<AnalyzerResult> {
    const nodes: GraphNode[] = [];
    const edges: GraphEdge[] = [];

    // Find all ticket README.md files
    const ticketFiles = ctx.files.filter(
      (f) => f.startsWith(".tickets/impl/") && f.endsWith("/README.md"),
    );

    for (const file of ticketFiles) {
      let content: string;
      try {
        content = await ctx.readFile(file);
      } catch {
        continue;
      }

      const fm = this.parseFrontmatter(content);
      const parts = file.split("/");
      const ticketName = parts[parts.length - 2]; // directory name
      const nodeId = `ticket:${ticketName}`;

      const meta: Record<string, unknown> = {};
      for (const key of ["priority", "services", "domains", "milestone", "demand"]) {
        if (fm[key] !== undefined) meta[key] = fm[key];
      }

      nodes.push({
        id: nodeId,
        type: "ticket",
        path: file,
        title: (fm.title as string) ?? ticketName,
        status: (fm.status as string) ?? "open",
        meta,
      });

      // Links from frontmatter
      const links = fm.links as string[] | string | undefined;
      const linkList = Array.isArray(links) ? links : links ? [links] : [];

      for (const link of linkList) {
        if (!link) continue;

        // [[type:id]] pattern
        const lm = link.match(/\[\[(\w+):([^\]]+)\]\]/);
        if (lm) {
          const targetId = `${lm[1]}:${lm[2].split("#")[0].toLowerCase()}`;
          edges.push({ source: nodeId, target: targetId, relation: "implements" });
        } else if (link.includes("spec/") || link.includes("spec\\")) {
          // Plain path to spec file
          const specName = link.split("/").pop()?.replace(".md", "").toLowerCase();
          if (specName) {
            edges.push({ source: nodeId, target: `spec:${specName}`, relation: "implements" });
          }
        } else if (link.includes("decisions/") || link.includes("adr/")) {
          const adrMatch = link.match(/(\d{3,4})-/);
          if (adrMatch) {
            edges.push({ source: nodeId, target: `adr:${adrMatch[1]}`, relation: "links_to" });
          }
        }
      }

      // Demand (use case links)
      const demand = fm.demand as string[] | string | undefined;
      const demandList = Array.isArray(demand) ? demand : demand ? [demand] : [];
      for (const uc of demandList) {
        if (uc) {
          edges.push({ source: nodeId, target: `use_case:${uc.toLowerCase()}`, relation: "implements" });
        }
      }
    }

    return { nodes, edges };
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
