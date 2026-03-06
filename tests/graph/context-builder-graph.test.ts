import { describe, it, expect } from "vitest";
import { contextPacketToMarkdown } from "@opcom/core";
import type { ContextPacket, GraphContext } from "@opcom/types";

function makePacket(graph?: GraphContext): ContextPacket {
  return {
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
    workItem: {
      ticket: {
        id: "fix-auth",
        title: "Fix Auth",
        status: "open",
        priority: 1,
        type: "feature",
        filePath: "/tmp/.tickets/fix-auth/README.md",
        deps: [],
        links: [],
        tags: {},
      },
    },
    git: { branch: "main", remote: null, clean: true },
    graph,
  };
}

describe("contextPacketToMarkdown with graph context", () => {
  it("renders Related Files section", () => {
    const packet = makePacket({
      relatedFiles: ["src/auth/login.ts", "src/auth/session.ts"],
      testFiles: [],
      driftSignals: [],
    });

    const md = contextPacketToMarkdown(packet);

    expect(md).toContain("## Related Files");
    expect(md).toContain("- src/auth/login.ts");
    expect(md).toContain("- src/auth/session.ts");
  });

  it("renders Test Coverage section", () => {
    const packet = makePacket({
      relatedFiles: [],
      testFiles: ["src/auth/login.test.ts", "src/auth/session.test.ts"],
      driftSignals: [],
    });

    const md = contextPacketToMarkdown(packet);

    expect(md).toContain("## Test Coverage");
    expect(md).toContain("- src/auth/login.test.ts");
    expect(md).toContain("- src/auth/session.test.ts");
  });

  it("renders Drift Signals section with all signal types", () => {
    const packet = makePacket({
      relatedFiles: [],
      testFiles: [],
      driftSignals: [
        { type: "uncovered_spec", id: "spec:auth.md", title: "Auth Spec" },
        { type: "untested_file", id: "file:src/utils.ts", title: "src/utils.ts" },
        { type: "new_failure", id: "test:login", title: "login test", detail: "Expected true" },
        { type: "flaky_test", id: "test:session", title: "session test", detail: "3 pass / 2 fail" },
      ],
    });

    const md = contextPacketToMarkdown(packet);

    expect(md).toContain("## Drift Signals");
    expect(md).toContain("[uncovered spec] Auth Spec");
    expect(md).toContain("[untested file] src/utils.ts");
    expect(md).toContain("[new failure] login test — Expected true");
    expect(md).toContain("[flaky test] session test — 3 pass / 2 fail");
  });

  it("renders all three graph sections together", () => {
    const packet = makePacket({
      relatedFiles: ["src/auth/login.ts"],
      testFiles: ["src/auth/login.test.ts"],
      driftSignals: [
        { type: "untested_file", id: "file:src/auth/session.ts", title: "src/auth/session.ts" },
      ],
    });

    const md = contextPacketToMarkdown(packet);

    expect(md).toContain("## Related Files");
    expect(md).toContain("## Test Coverage");
    expect(md).toContain("## Drift Signals");
  });

  it("omits graph sections when no graph context", () => {
    const packet = makePacket();

    const md = contextPacketToMarkdown(packet);

    expect(md).not.toContain("## Related Files");
    expect(md).not.toContain("## Test Coverage");
    expect(md).not.toContain("## Drift Signals");
  });

  it("omits empty graph sections individually", () => {
    const packet = makePacket({
      relatedFiles: ["src/foo.ts"],
      testFiles: [],
      driftSignals: [],
    });

    const md = contextPacketToMarkdown(packet);

    expect(md).toContain("## Related Files");
    expect(md).not.toContain("## Test Coverage");
    expect(md).not.toContain("## Drift Signals");
  });

  it("graph sections appear before Role/Requirements", () => {
    const packet = makePacket({
      relatedFiles: ["src/auth.ts"],
      testFiles: [],
      driftSignals: [],
    });

    const md = contextPacketToMarkdown(packet);

    const relatedIdx = md.indexOf("## Related Files");
    const requirementsIdx = md.indexOf("## Requirements");

    expect(relatedIdx).toBeLessThan(requirementsIdx);
  });
});
