"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const core_1 = require("@opcom/core");
(0, vitest_1.describe)("ticket verification mode parsing", () => {
    (0, vitest_1.it)("parses verification field from frontmatter", () => {
        const content = `---
id: book-hotel
title: "Book hotel in Tokyo"
status: open
type: task
verification: confirmation
---

# Book hotel
`;
        const fm = (0, core_1.parseFrontmatter)(content);
        (0, vitest_1.expect)(fm).not.toBeNull();
        (0, vitest_1.expect)(fm.verification).toBe("confirmation");
    });
    (0, vitest_1.it)("parses all valid verification modes", () => {
        const modes = ["test-gate", "oracle", "confirmation", "output-exists", "none"];
        for (const mode of modes) {
            const content = `---
id: task-${mode}
title: "Task"
status: open
verification: ${mode}
---`;
            const item = (0, core_1.parseTicketFile)(content, `/path/${mode}/README.md`, `task-${mode}`);
            (0, vitest_1.expect)(item).not.toBeNull();
            (0, vitest_1.expect)(item.verification).toBe(mode);
        }
    });
    (0, vitest_1.it)("ignores invalid verification modes", () => {
        const content = `---
id: bad-mode
title: "Bad mode"
status: open
verification: banana
---`;
        const item = (0, core_1.parseTicketFile)(content, "/path/bad-mode/README.md", "bad-mode");
        (0, vitest_1.expect)(item).not.toBeNull();
        (0, vitest_1.expect)(item.verification).toBeUndefined();
    });
    (0, vitest_1.it)("returns undefined verification when not specified", () => {
        const content = `---
id: no-mode
title: "No mode"
status: open
---`;
        const item = (0, core_1.parseTicketFile)(content, "/path/no-mode/README.md", "no-mode");
        (0, vitest_1.expect)(item).not.toBeNull();
        (0, vitest_1.expect)(item.verification).toBeUndefined();
    });
    (0, vitest_1.it)("parses outputs field from frontmatter", () => {
        const content = `---
id: report
title: "Generate report"
status: open
verification: output-exists
outputs:
  - docs/report.md
  - docs/summary.txt
---`;
        const item = (0, core_1.parseTicketFile)(content, "/path/report/README.md", "report");
        (0, vitest_1.expect)(item).not.toBeNull();
        (0, vitest_1.expect)(item.verification).toBe("output-exists");
        (0, vitest_1.expect)(item.outputs).toEqual(["docs/report.md", "docs/summary.txt"]);
    });
    (0, vitest_1.it)("returns undefined outputs when not specified", () => {
        const content = `---
id: no-outputs
title: "No outputs"
status: open
---`;
        const item = (0, core_1.parseTicketFile)(content, "/path/no-outputs/README.md", "no-outputs");
        (0, vitest_1.expect)(item).not.toBeNull();
        (0, vitest_1.expect)(item.outputs).toBeUndefined();
    });
});
//# sourceMappingURL=ticket-verification.test.js.map