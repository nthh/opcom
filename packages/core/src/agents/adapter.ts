import type { AgentAdapter, AgentBackend } from "@opcom/types";
import { ClaudeCodeAdapter } from "./claude-code.js";
import { OpenCodeAdapter } from "./opencode.js";

export function createAdapter(backend: AgentBackend): AgentAdapter {
  switch (backend) {
    case "claude-code":
      return new ClaudeCodeAdapter();
    case "opencode":
      return new OpenCodeAdapter();
    default:
      throw new Error(`Unknown agent backend: ${backend}`);
  }
}

export { ClaudeCodeAdapter } from "./claude-code.js";
export { OpenCodeAdapter } from "./opencode.js";
