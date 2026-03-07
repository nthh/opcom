import { describe, it, expect } from "vitest";
import { buildContextPacket, contextPacketToMarkdown } from "@opcom/core";
import type { ProjectConfig, ResolvedRoleConfig, RebaseConflict } from "@opcom/types";

function makeProject(overrides?: Partial<ProjectConfig>): ProjectConfig {
  return {
    id: "test-project",
    name: "test-project",
    path: "/tmp/test-project",
    stack: {
      languages: [{ name: "typescript", version: "5.7", sourceFile: "package.json" }],
      frameworks: [],
      packageManagers: [{ name: "npm", sourceFile: "package-lock.json" }],
      infrastructure: [],
      versionManagers: [],
    },
    git: { branch: "main", clean: true, remote: "origin" },
    workSystem: { type: "tickets-dir", ticketDir: ".tickets" },
    docs: {},
    services: [],
    environments: [],
    testing: { framework: "vitest", command: "npm test" },
    linting: [],
    subProjects: [],
    cloudServices: [],
    lastScannedAt: "2026-03-06T00:00:00Z",
    ...overrides,
  };
}

describe("contextPacketToMarkdown with rebaseConflict", () => {
  it("renders Merge Conflict Resolution section when rebaseConflict is passed", async () => {
    const project = makeProject();
    const packet = await buildContextPacket(project);
    const rebaseConflict: RebaseConflict = {
      files: ["src/index.ts", "src/utils.ts"],
      baseBranch: "main",
    };

    const md = contextPacketToMarkdown(packet, undefined, undefined, rebaseConflict);

    expect(md).toContain("## Merge Conflict Resolution");
    expect(md).toContain("Your branch has conflicts with `main`");
    expect(md).toContain("### Conflicting Files");
    expect(md).toContain("- src/index.ts");
    expect(md).toContain("- src/utils.ts");
    expect(md).toContain("### Instructions");
    expect(md).toContain("git rebase main");
    expect(md).toContain("git add <file>");
    expect(md).toContain("git rebase --continue");
  });

  it("does not render rebase section when rebaseConflict is undefined", async () => {
    const project = makeProject();
    const packet = await buildContextPacket(project);

    const md = contextPacketToMarkdown(packet);

    expect(md).not.toContain("## Merge Conflict Resolution");
    expect(md).not.toContain("### Conflicting Files");
  });

  it("handles empty conflict files list", async () => {
    const project = makeProject();
    const packet = await buildContextPacket(project);
    const rebaseConflict: RebaseConflict = {
      files: [],
      baseBranch: "main",
    };

    const md = contextPacketToMarkdown(packet, undefined, undefined, rebaseConflict);

    expect(md).toContain("## Merge Conflict Resolution");
    // No conflicting files section when list is empty
    expect(md).not.toContain("### Conflicting Files");
    expect(md).toContain("### Instructions");
  });

  it("works with both previousVerification and rebaseConflict", async () => {
    const project = makeProject();
    const packet = await buildContextPacket(project);
    const verification = {
      stepTicketId: "t1",
      passed: false,
      failureReasons: ["Tests failed"],
      testGate: {
        passed: false,
        testCommand: "npm test",
        totalTests: 5,
        passedTests: 3,
        failedTests: 2,
        output: "FAIL test.ts",
        durationMs: 1000,
      },
    };
    const rebaseConflict: RebaseConflict = {
      files: ["src/index.ts"],
      baseBranch: "main",
    };

    const md = contextPacketToMarkdown(packet, undefined, verification, rebaseConflict);

    // Both sections should be present
    expect(md).toContain("## Previous Attempt");
    expect(md).toContain("## Merge Conflict Resolution");
    expect(md).toContain("### Conflicting Files");
  });

  it("works with role config and rebaseConflict", async () => {
    const project = makeProject();
    const packet = await buildContextPacket(project);
    const roleConfig: ResolvedRoleConfig = {
      roleId: "engineer",
      name: "Engineer",
      permissionMode: "acceptEdits",
      allowedTools: [],
      disallowedTools: [],
      allowedBashPatterns: [],
      instructions: "- Fix the bug.",
      doneCriteria: "Bug fixed.",
      runTests: true,
      runOracle: false,
    };
    const rebaseConflict: RebaseConflict = {
      files: ["src/file.ts"],
      baseBranch: "main",
    };

    const md = contextPacketToMarkdown(packet, roleConfig, undefined, rebaseConflict);

    expect(md).toContain("## Role: Engineer");
    expect(md).toContain("## Merge Conflict Resolution");
    expect(md).toContain("- src/file.ts");
  });

  it("uses baseBranch from rebaseConflict in instructions", async () => {
    const project = makeProject();
    const packet = await buildContextPacket(project);
    const rebaseConflict: RebaseConflict = {
      files: ["src/file.ts"],
      baseBranch: "develop",
    };

    const md = contextPacketToMarkdown(packet, undefined, undefined, rebaseConflict);

    expect(md).toContain("conflicts with `develop`");
    expect(md).toContain("git rebase develop");
  });
});
