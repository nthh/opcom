import { describe, it, expect } from "vitest";
import { contextPacketToMarkdown } from "@opcom/core";
import type { ContextPacket, ResolvedRoleConfig, VerificationMode } from "@opcom/types";

function makePacket(): ContextPacket {
  return {
    project: {
      name: "test-project",
      path: "/tmp/test",
      stack: {
        languages: [{ name: "typescript", version: "5.0" }],
        frameworks: [],
        packageManagers: [{ name: "npm" }],
        infrastructure: [],
        versionManagers: [],
      },
      testing: { framework: "vitest", command: "npx vitest run" },
      linting: [],
      services: [],
    },
    git: { branch: "main", remote: null, clean: true },
  };
}

describe("contextPacketToMarkdown with verificationMode", () => {
  it("includes test instructions for test-gate mode", () => {
    const packet = makePacket();
    const md = contextPacketToMarkdown(packet, undefined, undefined, undefined, undefined, "test-gate");

    expect(md).toContain("All changes MUST include tests");
    expect(md).toContain("Run tests relevant to your changes");
    expect(md).toContain("Do not mark work as complete if tests are failing");
  });

  it("includes test instructions when verificationMode is undefined (default)", () => {
    const packet = makePacket();
    const md = contextPacketToMarkdown(packet);

    expect(md).toContain("All changes MUST include tests");
    expect(md).toContain("Do not mark work as complete if tests are failing");
  });

  it("omits test instructions for confirmation mode", () => {
    const packet = makePacket();
    const md = contextPacketToMarkdown(packet, undefined, undefined, undefined, undefined, "confirmation");

    expect(md).not.toContain("All changes MUST include tests");
    expect(md).not.toContain("Do not mark work as complete if tests are failing");
  });

  it("omits test instructions for none mode", () => {
    const packet = makePacket();
    const md = contextPacketToMarkdown(packet, undefined, undefined, undefined, undefined, "none");

    expect(md).not.toContain("All changes MUST include tests");
    expect(md).not.toContain("Do not mark work as complete if tests are failing");
  });

  it("omits test instructions for oracle mode", () => {
    const packet = makePacket();
    const md = contextPacketToMarkdown(packet, undefined, undefined, undefined, undefined, "oracle");

    expect(md).not.toContain("All changes MUST include tests");
    expect(md).not.toContain("Do not mark work as complete if tests are failing");
  });

  it("omits test instructions for output-exists mode", () => {
    const packet = makePacket();
    const md = contextPacketToMarkdown(packet, undefined, undefined, undefined, undefined, "output-exists");

    expect(md).not.toContain("All changes MUST include tests");
    expect(md).not.toContain("Do not mark work as complete if tests are failing");
  });

  it("still includes git stash and commit message requirements for all modes", () => {
    const modes: VerificationMode[] = ["test-gate", "oracle", "confirmation", "output-exists", "none"];
    for (const mode of modes) {
      const packet = makePacket();
      const md = contextPacketToMarkdown(packet, undefined, undefined, undefined, undefined, mode);

      expect(md).toContain("Never use `git stash`");
      expect(md).toContain("When committing, use a simple single-line commit message");
    }
  });

  it("uses role instructions regardless of verification mode", () => {
    const packet = makePacket();
    const roleConfig: ResolvedRoleConfig = {
      roleId: "researcher",
      name: "Researcher",
      permissionMode: "default",
      allowedTools: [],
      disallowedTools: [],
      allowedBashPatterns: [],
      instructions: "Research and document findings.",
      doneCriteria: "Report written.",
      runTests: false,
      runOracle: false,
    };

    // Even in test-gate mode, role instructions override default test instructions
    const md = contextPacketToMarkdown(packet, roleConfig, undefined, undefined, undefined, "test-gate");
    expect(md).toContain("Research and document findings.");
    expect(md).not.toContain("All changes MUST include tests");
  });
});
