import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, readFile, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { stampTicketFiles } from "../../packages/core/src/orchestrator/executor.js";

describe("stampTicketFiles", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "stamp-test-"));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it("adds files and commits to ticket frontmatter", async () => {
    const ticketPath = join(tempDir, "README.md");
    await writeFile(ticketPath, [
      "---",
      "id: auth-setup",
      "title: Auth Setup",
      "status: closed",
      "deps: []",
      "---",
      "",
      "# Auth Setup",
      "",
      "Content here.",
    ].join("\n"));

    await stampTicketFiles(ticketPath, [
      { path: "src/auth/session.ts", status: "added" },
      { path: "src/auth/middleware.ts", status: "modified" },
    ], ["abc1234", "def5678"]);

    const result = await readFile(ticketPath, "utf-8");
    expect(result).toContain("files:");
    expect(result).toContain("  - path: src/auth/session.ts");
    expect(result).toContain("    status: added");
    expect(result).toContain("  - path: src/auth/middleware.ts");
    expect(result).toContain("    status: modified");
    expect(result).toContain("commits:");
    expect(result).toContain("  - abc1234");
    expect(result).toContain("  - def5678");
    // Body should be preserved
    expect(result).toContain("# Auth Setup");
    expect(result).toContain("Content here.");
  });

  it("replaces existing files/commits on re-close", async () => {
    const ticketPath = join(tempDir, "README.md");
    await writeFile(ticketPath, [
      "---",
      "id: auth-setup",
      "status: closed",
      "files:",
      "  - path: old/file.ts",
      "    status: added",
      "commits:",
      "  - oldsha",
      "---",
      "",
      "# Auth Setup",
    ].join("\n"));

    await stampTicketFiles(ticketPath, [
      { path: "new/file.ts", status: "modified" },
    ], ["newsha"]);

    const result = await readFile(ticketPath, "utf-8");
    expect(result).not.toContain("old/file.ts");
    expect(result).not.toContain("oldsha");
    expect(result).toContain("  - path: new/file.ts");
    expect(result).toContain("  - newsha");
  });

  it("does nothing with empty files and commits", async () => {
    const ticketPath = join(tempDir, "README.md");
    const original = "---\nid: test\nstatus: closed\n---\n\n# Test\n";
    await writeFile(ticketPath, original);

    await stampTicketFiles(ticketPath, [], []);

    const result = await readFile(ticketPath, "utf-8");
    expect(result).toBe(original);
  });

  it("handles ticket with no frontmatter end delimiter gracefully", async () => {
    const ticketPath = join(tempDir, "README.md");
    const content = "---\nid: broken\nno end delimiter\n";
    await writeFile(ticketPath, content);

    // Should not throw
    await stampTicketFiles(ticketPath, [
      { path: "src/foo.ts", status: "added" },
    ], ["sha1"]);

    const result = await readFile(ticketPath, "utf-8");
    // Content unchanged — no second --- delimiter found
    expect(result).toBe(content);
  });
});
