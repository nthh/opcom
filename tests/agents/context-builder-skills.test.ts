import { describe, it, expect } from "vitest";
import { contextPacketToMarkdown } from "@opcom/core";
import type { ContextPacket, ResolvedRoleConfig } from "@opcom/types";

function makePacket(overrides?: Partial<ContextPacket>): ContextPacket {
  return {
    project: {
      name: "test-project",
      path: "/tmp/test-project",
      stack: {
        languages: [{ name: "typescript", version: "5.7", sourceFile: "package.json" }],
        frameworks: [],
        packageManagers: [{ name: "npm", sourceFile: "package-lock.json" }],
        infrastructure: [],
        versionManagers: [],
      },
      testing: { framework: "vitest", command: "npm test" },
      linting: [],
      services: [],
    },
    git: { branch: "main", remote: "origin", clean: true },
    ...overrides,
  };
}

describe("contextPacketToMarkdown — skills", () => {
  it("renders skills section when skills are present", () => {
    const packet = makePacket({
      skills: [
        { name: "Code Review", content: "Review methodology here." },
        { name: "Test Writing", content: "Test strategy here." },
      ],
    });

    const md = contextPacketToMarkdown(packet);
    expect(md).toContain("## Skills");
    expect(md).toContain("### Code Review");
    expect(md).toContain("Review methodology here.");
    expect(md).toContain("### Test Writing");
    expect(md).toContain("Test strategy here.");
  });

  it("does not render skills section when no skills", () => {
    const packet = makePacket();
    const md = contextPacketToMarkdown(packet);
    expect(md).not.toContain("## Skills");
  });

  it("does not render skills section when skills array is empty", () => {
    const packet = makePacket({ skills: [] });
    const md = contextPacketToMarkdown(packet);
    expect(md).not.toContain("## Skills");
  });

  it("renders skills before agent config", () => {
    const packet = makePacket({
      skills: [{ name: "Research", content: "Research protocol." }],
      agentConfig: "# Agent Config\nFollow these rules.",
    });

    const md = contextPacketToMarkdown(packet);
    const skillsIdx = md.indexOf("## Skills");
    const configIdx = md.indexOf("## Agent Configuration");
    expect(skillsIdx).toBeLessThan(configIdx);
  });
});
