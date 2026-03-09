import { describe, it, expect } from "vitest";
import { parseFrontmatter, parseTicketFile } from "@opcom/core";

describe("ticket verification mode parsing", () => {
  it("parses verification field from frontmatter", () => {
    const content = `---
id: book-hotel
title: "Book hotel in Tokyo"
status: open
type: task
verification: confirmation
---

# Book hotel
`;
    const fm = parseFrontmatter(content);
    expect(fm).not.toBeNull();
    expect(fm!.verification).toBe("confirmation");
  });

  it("parses all valid verification modes", () => {
    const modes = ["test-gate", "oracle", "confirmation", "output-exists", "none"];
    for (const mode of modes) {
      const content = `---
id: task-${mode}
title: "Task"
status: open
verification: ${mode}
---`;
      const item = parseTicketFile(content, `/path/${mode}/README.md`, `task-${mode}`);
      expect(item).not.toBeNull();
      expect(item!.verification).toBe(mode);
    }
  });

  it("ignores invalid verification modes", () => {
    const content = `---
id: bad-mode
title: "Bad mode"
status: open
verification: banana
---`;
    const item = parseTicketFile(content, "/path/bad-mode/README.md", "bad-mode");
    expect(item).not.toBeNull();
    expect(item!.verification).toBeUndefined();
  });

  it("returns undefined verification when not specified", () => {
    const content = `---
id: no-mode
title: "No mode"
status: open
---`;
    const item = parseTicketFile(content, "/path/no-mode/README.md", "no-mode");
    expect(item).not.toBeNull();
    expect(item!.verification).toBeUndefined();
  });

  it("parses outputs field from frontmatter", () => {
    const content = `---
id: report
title: "Generate report"
status: open
verification: output-exists
outputs:
  - docs/report.md
  - docs/summary.txt
---`;
    const item = parseTicketFile(content, "/path/report/README.md", "report");
    expect(item).not.toBeNull();
    expect(item!.verification).toBe("output-exists");
    expect(item!.outputs).toEqual(["docs/report.md", "docs/summary.txt"]);
  });

  it("returns undefined outputs when not specified", () => {
    const content = `---
id: no-outputs
title: "No outputs"
status: open
---`;
    const item = parseTicketFile(content, "/path/no-outputs/README.md", "no-outputs");
    expect(item).not.toBeNull();
    expect(item!.outputs).toBeUndefined();
  });
});
