import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as fsPromises from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

// Mock rename to be controllable while keeping all other fs operations real
vi.mock("node:fs/promises", async () => {
  const actual = await vi.importActual<typeof import("node:fs/promises")>(
    "node:fs/promises",
  );
  return {
    ...actual,
    rename: vi.fn().mockImplementation(actual.rename),
  };
});

describe("project summary atomic write crash resilience", () => {
  let tempDir: string;
  let originalHome: string;

  beforeEach(async () => {
    tempDir = await fsPromises.mkdtemp(join(tmpdir(), "opcom-crash-test-"));
    originalHome = process.env.HOME!;
    process.env.HOME = tempDir;
  });

  afterEach(async () => {
    process.env.HOME = originalHome;
    await fsPromises.rm(tempDir, { recursive: true, force: true });
  });

  it("preserves original file when rename fails (simulated crash)", async () => {
    const {
      writeProjectSummary,
      readProjectSummary,
      summaryPath,
      ensureOpcomDirs,
    } = await import("@opcom/core");
    await ensureOpcomDirs();

    // Write initial content (rename works normally here)
    const originalContent = "# Original Summary\nIntact content\n";
    await writeProjectSummary("crash-test", originalContent);
    expect(await readProjectSummary("crash-test")).toBe(originalContent);

    // Simulate a crash: rename fails after the temp file has been written
    vi.mocked(fsPromises.rename).mockRejectedValueOnce(
      new Error("simulated crash"),
    );

    // Attempt to overwrite — should fail at the rename step
    const newContent = "# New Summary\nDifferent content\n";
    await expect(
      writeProjectSummary("crash-test", newContent),
    ).rejects.toThrow("simulated crash");

    // The original file must be intact — this is the crash resilience guarantee.
    // A naive writeFile(path, content) would have overwritten the original,
    // but atomic write (write-to-tmp-then-rename) leaves it untouched.
    const preserved = await readProjectSummary("crash-test");
    expect(preserved).toBe(originalContent);

    // The temp file should contain the new content (written but never renamed)
    const tmpPath = summaryPath("crash-test") + ".tmp";
    const tmpContent = await fsPromises.readFile(tmpPath, "utf-8");
    expect(tmpContent).toBe(newContent);
  });
});
