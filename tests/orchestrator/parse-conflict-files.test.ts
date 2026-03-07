import { describe, it, expect } from "vitest";
import { parseConflictFiles } from "../../packages/core/src/orchestrator/worktree.js";

describe("parseConflictFiles", () => {
  it("parses CONFLICT (content) lines", () => {
    const output = `
First, rewinding head to replay your work on top of it...
Applying: agent work
CONFLICT (content): Merge conflict in src/file.ts
CONFLICT (content): Merge conflict in src/other.ts
error: could not apply abc1234... agent work
    `;
    const files = parseConflictFiles(output);
    expect(files).toEqual(["src/file.ts", "src/other.ts"]);
  });

  it("parses CONFLICT (add/add) lines", () => {
    const output = `
CONFLICT (add/add): Merge conflict in src/new-file.ts
    `;
    const files = parseConflictFiles(output);
    expect(files).toEqual(["src/new-file.ts"]);
  });

  it("returns empty array when no conflicts", () => {
    const output = "Successfully rebased and updated refs/heads/work/ticket-1.";
    const files = parseConflictFiles(output);
    expect(files).toEqual([]);
  });

  it("handles mixed conflict types", () => {
    const output = `
CONFLICT (content): Merge conflict in src/a.ts
CONFLICT (modify/delete): Merge conflict in src/b.ts
CONFLICT (rename/rename): Merge conflict in src/c.ts
    `;
    const files = parseConflictFiles(output);
    expect(files).toEqual(["src/a.ts", "src/b.ts", "src/c.ts"]);
  });

  it("handles empty output", () => {
    expect(parseConflictFiles("")).toEqual([]);
  });
});
