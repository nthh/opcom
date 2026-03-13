import { createInterface } from "node:readline";
import { buildGraph } from "@opcom/core";
import { initPipeline, resolvePath } from "./init-pipeline.js";

// Re-export shared helpers for backwards compatibility (used by scan.ts, etc.)
export { detectionToProjectConfig, confirmProfile } from "./init-pipeline.js";

export interface AddOptions {
  /** For testing: override readline with scripted answers */
  promptFn?: (question: string) => Promise<string>;
}

export async function runAdd(pathArg: string, opts?: AddOptions): Promise<void> {
  const rl = opts?.promptFn
    ? null
    : createInterface({ input: process.stdin, output: process.stdout });

  const ask = opts?.promptFn ?? ((question: string) =>
    new Promise<string>((res) => rl!.question(question, res)));

  try {
    const projectPath = resolvePath(pathArg);
    console.log(`\n  Scanning ${projectPath}...\n`);

    const { config } = await initPipeline({
      mode: "interactive",
      path: pathArg,
      ask,
    });

    console.log(`\n  Project "${config.name}" added.`);

    // Build context graph in background
    console.log(`  Building context graph...`);
    buildGraph(config.name, config.path)
      .then((stats) => {
        console.log(`  Graph built: ${stats.totalNodes} nodes, ${stats.totalEdges} edges.\n`);
      })
      .catch(() => {
        console.log(`  Graph build skipped (not a git repo or no analyzable files).\n`);
      });
  } finally {
    rl?.close();
  }
}
