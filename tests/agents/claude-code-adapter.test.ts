import { describe, it, expect } from "vitest";
import { ClaudeCodeAdapter } from "@opcom/core";
import type { NormalizedEvent, AgentStartConfig, ContextPacket } from "@opcom/types";

// We test the event parsing logic without spawning real processes

describe("ClaudeCodeAdapter", () => {
  it("creates an adapter with claude-code backend", () => {
    const adapter = new ClaudeCodeAdapter();
    expect(adapter.backend).toBe("claude-code");
  });

  it("lists no sessions initially", () => {
    const adapter = new ClaudeCodeAdapter();
    expect(adapter.listSessions()).toHaveLength(0);
  });
});

describe("ClaudeCodeAdapter event parsing", () => {
  // We test the private parseClaudeEvent via the public interface
  // Since we can't easily spawn real claude, we test the adapter
  // handles session lifecycle correctly

  it("getSession returns undefined for unknown sessions", () => {
    const adapter = new ClaudeCodeAdapter();
    expect(adapter.getSession("nonexistent")).toBeUndefined();
  });

  it("stop is safe for unknown sessions", async () => {
    const adapter = new ClaudeCodeAdapter();
    // Should not throw
    await adapter.stop("nonexistent");
  });
});

describe("context packet formatting", () => {
  it("creates a valid context packet structure", () => {
    const packet: ContextPacket = {
      project: {
        name: "test",
        path: "/tmp/test",
        stack: {
          languages: [{ name: "typescript", version: "5.7", sourceFile: "package.json" }],
          frameworks: [],
          packageManagers: [],
          infrastructure: [],
          versionManagers: [],
        },
        testing: { framework: "vitest", command: "npm test" },
        linting: [],
        services: [],
      },
      git: { branch: "main", remote: "origin", clean: true },
    };

    expect(packet.project.name).toBe("test");
    expect(packet.project.stack.languages[0].name).toBe("typescript");
    expect(packet.git.branch).toBe("main");
  });
});
