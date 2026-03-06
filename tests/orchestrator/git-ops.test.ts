import { describe, it, expect } from "vitest";
import { parseNumstat } from "@opcom/core";

describe("parseNumstat", () => {
  it("parses standard added/modified/deleted files", () => {
    const input = [
      "42\t0\tsrc/new.ts",
      "10\t5\tsrc/existing.ts",
      "0\t30\tsrc/old.ts",
    ].join("\n");

    const files = parseNumstat(input);
    expect(files).toHaveLength(3);

    expect(files[0]).toEqual({ path: "src/new.ts", status: "added", insertions: 42, deletions: 0 });
    expect(files[1]).toEqual({ path: "src/existing.ts", status: "modified", insertions: 10, deletions: 5 });
    expect(files[2]).toEqual({ path: "src/old.ts", status: "deleted", insertions: 0, deletions: 30 });
  });

  it("handles binary files (dashes for insertions/deletions)", () => {
    const input = "-\t-\tassets/logo.png";

    const files = parseNumstat(input);
    expect(files).toHaveLength(1);
    expect(files[0]).toEqual({ path: "assets/logo.png", status: "modified", insertions: 0, deletions: 0 });
  });

  it("handles renames with arrow syntax", () => {
    const input = "5\t3\tsrc/old-name.ts => src/new-name.ts";

    const files = parseNumstat(input);
    expect(files).toHaveLength(1);
    expect(files[0]).toEqual({
      path: "src/new-name.ts",
      status: "renamed",
      insertions: 5,
      deletions: 3,
      oldPath: "src/old-name.ts",
    });
  });

  it("handles renames with brace syntax", () => {
    const input = "2\t1\tsrc/{old => new}/file.ts";

    const files = parseNumstat(input);
    expect(files).toHaveLength(1);
    expect(files[0].status).toBe("renamed");
    expect(files[0].oldPath).toBe("src/{old");
    expect(files[0].path).toBe("new}/file.ts");
  });

  it("returns empty array for empty input", () => {
    expect(parseNumstat("")).toEqual([]);
    expect(parseNumstat("   ")).toEqual([]);
  });

  it("handles paths with tabs", () => {
    const input = "10\t5\tpath\twith\ttabs.ts";

    const files = parseNumstat(input);
    expect(files).toHaveLength(1);
    expect(files[0].path).toBe("path\twith\ttabs.ts");
  });

  it("skips malformed lines", () => {
    const input = [
      "10\t5\tsrc/valid.ts",
      "garbage",
      "20\t10\tsrc/also-valid.ts",
    ].join("\n");

    const files = parseNumstat(input);
    expect(files).toHaveLength(2);
  });
});
