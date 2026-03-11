import { describe, it, expect } from "vitest";
import { extractFilePath, matchesDenyPath } from "@opcom/core";

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
