import { describe, it, expect, afterEach } from "vitest";
import { extractFilePath, matchesDenyPath, updateTicketStatus } from "@opcom/core";
import { mkdtemp, rm, mkdir, writeFile, readFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

describe("extractFilePath", () => {
  it("extracts file_path from JSON input", () => {
    const input = JSON.stringify({ file_path: "/project/.tickets/impl/foo/README.md", content: "test" });
    expect(extractFilePath(input)).toBe("/project/.tickets/impl/foo/README.md");
  });

  it("extracts filePath from JSON input", () => {
    const input = JSON.stringify({ filePath: "/project/src/index.ts" });
    expect(extractFilePath(input)).toBe("/project/src/index.ts");
  });

  it("extracts path from JSON input", () => {
    const input = JSON.stringify({ path: "/project/README.md" });
    expect(extractFilePath(input)).toBe("/project/README.md");
  });

  it("returns null for non-JSON input", () => {
    expect(extractFilePath("not json")).toBeNull();
  });

  it("returns null for JSON without file path fields", () => {
    const input = JSON.stringify({ command: "echo hello" });
    expect(extractFilePath(input)).toBeNull();
  });

  it("prefers file_path over other fields", () => {
    const input = JSON.stringify({ file_path: "/a.ts", filePath: "/b.ts", path: "/c.ts" });
    expect(extractFilePath(input)).toBe("/a.ts");
  });
});

describe("matchesDenyPath", () => {
  describe("directory glob (**)", () => {
    it("matches relative path under .tickets/", () => {
      expect(matchesDenyPath(".tickets/impl/foo/README.md", [".tickets/**"])).toBe(".tickets/**");
    });

    it("matches absolute path containing .tickets/", () => {
      expect(matchesDenyPath("/home/user/project/.tickets/impl/bar.md", [".tickets/**"])).toBe(".tickets/**");
    });

    it("does not match non-ticket paths", () => {
      expect(matchesDenyPath("src/index.ts", [".tickets/**"])).toBeNull();
    });

    it("does not match paths with .tickets in filename", () => {
      expect(matchesDenyPath("src/.tickets-backup.ts", [".tickets/**"])).toBeNull();
    });

    it("matches nested paths under denied directory", () => {
      expect(matchesDenyPath(".tickets/impl/protect-ticket-files/deny-paths-type-and-config.md", [".tickets/**"])).toBe(".tickets/**");
    });
  });

  describe("extension glob (*)", () => {
    it("matches file with matching extension", () => {
      expect(matchesDenyPath("secret.env", ["*.env"])).toBe("*.env");
    });

    it("does not match different extension", () => {
      expect(matchesDenyPath("config.yaml", ["*.env"])).toBeNull();
    });
  });

  describe("literal match", () => {
    it("matches exact relative path", () => {
      expect(matchesDenyPath("LICENSE", ["LICENSE"])).toBe("LICENSE");
    });

    it("matches as suffix of absolute path", () => {
      expect(matchesDenyPath("/project/LICENSE", ["LICENSE"])).toBe("LICENSE");
    });
  });

  describe("multiple patterns", () => {
    it("returns the first matching pattern", () => {
      const result = matchesDenyPath(".tickets/foo.md", [".tickets/**", "docs/**"]);
      expect(result).toBe(".tickets/**");
    });

    it("matches second pattern when first doesn't match", () => {
      const result = matchesDenyPath("docs/spec/roles.md", [".tickets/**", "docs/**"]);
      expect(result).toBe("docs/**");
    });

    it("returns null when no pattern matches", () => {
      expect(matchesDenyPath("src/index.ts", [".tickets/**", "docs/**"])).toBeNull();
    });
  });

  describe("empty deny paths", () => {
    it("returns null for empty array", () => {
      expect(matchesDenyPath("anything.ts", [])).toBeNull();
    });
  });
});

describe("updateTicketStatus (executor bypass)", () => {
  let tmpDir: string;

  afterEach(async () => {
    if (tmpDir) await rm(tmpDir, { recursive: true });
  });

  it("writes to .tickets/ file directly (not subject to denyPaths)", async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "opcom-deny-bypass-"));
    const ticketsDir = join(tmpDir, ".tickets", "impl", "my-ticket");
    await mkdir(ticketsDir, { recursive: true });

    const ticketPath = join(ticketsDir, "README.md");
    await writeFile(ticketPath, `---
id: my-ticket
title: "Test ticket"
status: open
type: feature
priority: 1
---

# Test ticket
`);

    // updateTicketStatus writes directly to the file system — it is NOT
    // intercepted by the executor's denyPaths check because it's not an
    // agent-initiated write (no tool_start event is emitted).
    await updateTicketStatus(ticketPath, "in-progress");

    const content = await readFile(ticketPath, "utf-8");
    expect(content).toContain("status: in-progress");
    expect(content).not.toContain("status: open");
  });

  it("updates ticket status to closed in .tickets/ path", async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "opcom-deny-bypass-"));
    const ticketsDir = join(tmpDir, ".tickets", "impl", "protect-ticket-files");
    await mkdir(ticketsDir, { recursive: true });

    const ticketPath = join(ticketsDir, "executor-enforcement.md");
    await writeFile(ticketPath, `---
id: executor-enforcement
title: "Enforce denyPaths"
status: in-progress
type: feature
priority: 1
---

# Enforce denyPaths
`);

    await updateTicketStatus(ticketPath, "closed");

    const content = await readFile(ticketPath, "utf-8");
    expect(content).toContain("status: closed");
    expect(content).not.toContain("status: in-progress");
  });

  it("does not write when status already matches", async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "opcom-deny-bypass-"));
    const ticketsDir = join(tmpDir, ".tickets", "impl");
    await mkdir(ticketsDir, { recursive: true });

    const ticketPath = join(ticketsDir, "already-closed.md");
    const original = `---
id: already-closed
title: "Already closed"
status: closed
type: feature
priority: 1
---

# Already closed
`;
    await writeFile(ticketPath, original);

    await updateTicketStatus(ticketPath, "closed");

    const content = await readFile(ticketPath, "utf-8");
    // Content should be identical — no write occurred
    expect(content).toBe(original);
  });
});
