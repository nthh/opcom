import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { parseFrontmatter, parseTicketFile, summarizeWorkItems, scanTickets } from "@opcom/core";
import type { WorkItem } from "@opcom/types";
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";

describe("parseFrontmatter", () => {
  it("parses YAML frontmatter from ticket content", () => {
    const content = `---
id: auth-system
title: "User Authentication System"
status: open
type: feature
priority: 1
created: 2026-02-01
services:
  - api
  - web
links:
  - docs/spec/AUTH.md
deps: []
---

# Auth System
`;
    const fm = parseFrontmatter(content);
    expect(fm).not.toBeNull();
    expect(fm!.id).toBe("auth-system");
    expect(fm!.title).toBe("User Authentication System");
    expect(fm!.status).toBe("open");
    expect(fm!.priority).toBe(1);
    expect(fm!.services).toEqual(["api", "web"]);
    expect(fm!.links).toEqual(["docs/spec/AUTH.md"]);
    expect(fm!.deps).toEqual([]);
  });

  it("returns null for content without frontmatter", () => {
    expect(parseFrontmatter("# Just a heading\nNo frontmatter.")).toBeNull();
  });
});

describe("parseTicketFile", () => {
  it("parses a ticket with frontmatter", () => {
    const content = `---
id: test-ticket
title: "Test Ticket"
status: closed
type: bug
priority: 0
---

# Test Ticket
`;
    const item = parseTicketFile(content, "/path/test-ticket/README.md", "test-ticket");
    expect(item).not.toBeNull();
    expect(item!.id).toBe("test-ticket");
    expect(item!.status).toBe("closed");
    expect(item!.priority).toBe(0);
    expect(item!.type).toBe("bug");
  });

  it("falls back to dir name when no frontmatter", () => {
    const item = parseTicketFile("# Something", "/path/fallback/README.md", "fallback");
    expect(item!.id).toBe("fallback");
    expect(item!.status).toBe("open");
  });

  it("parses role from frontmatter", () => {
    const content = `---
id: deploy-infra
title: Deploy Infrastructure
status: open
type: feature
priority: 2
role: devops
deps: []
---

# Deploy Infrastructure
`;
    const item = parseTicketFile(content, "/path/deploy-infra/README.md", "deploy-infra");
    expect(item).not.toBeNull();
    expect(item!.role).toBe("devops");
  });

  it("role is undefined when not specified", () => {
    const content = `---
id: no-role
title: No Role
status: open
deps: []
---

# No Role
`;
    const item = parseTicketFile(content, "/path/no-role/README.md", "no-role");
    expect(item!.role).toBeUndefined();
  });
});

describe("parseTicketFile — dir field", () => {
  it("uses dir: frontmatter as parent", () => {
    const content = `---
id: sub-task-1
title: "Sub Task 1"
status: open
type: feature
priority: 1
dir: pipeline-v2
deps: []
---

# Sub Task 1
`;
    const item = parseTicketFile(content, "/path/pipeline-v2/sub-task-1.md", "sub-task-1");
    expect(item!.parent).toBe("pipeline-v2");
  });

  it("prefers dir: over milestone: for parent", () => {
    const content = `---
id: sub-task-2
title: "Sub Task 2"
status: open
dir: pipeline-v2
milestone: other-parent
deps: []
---
`;
    const item = parseTicketFile(content, "/path/pipeline-v2/sub-task-2.md", "sub-task-2");
    expect(item!.parent).toBe("pipeline-v2");
  });

  it("falls back to milestone: when no dir:", () => {
    const content = `---
id: sub-task-3
title: "Sub Task 3"
status: open
milestone: my-epic
deps: []
---
`;
    const item = parseTicketFile(content, "/path/my-epic/sub-task-3.md", "sub-task-3");
    expect(item!.parent).toBe("my-epic");
  });
});

describe("scanTickets — sibling .md files", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "opcom-test-"));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("returns only README.md items when no siblings exist", async () => {
    const implDir = join(tmpDir, ".tickets", "impl", "my-ticket");
    mkdirSync(implDir, { recursive: true });
    writeFileSync(join(implDir, "README.md"), `---
id: my-ticket
title: "My Ticket"
status: open
type: feature
priority: 1
deps: []
---

# My Ticket
`);

    const items = await scanTickets(tmpDir);
    expect(items).toHaveLength(1);
    expect(items[0].id).toBe("my-ticket");
    expect(items[0].parent).toBeUndefined();
  });

  it("scans sibling .md files as sub-tickets with parent inferred from directory", async () => {
    const implDir = join(tmpDir, ".tickets", "impl", "pipeline-v2");
    mkdirSync(implDir, { recursive: true });
    writeFileSync(join(implDir, "README.md"), `---
id: pipeline-v2
title: "Pipeline V2"
status: open
type: feature
priority: 1
deps: []
---

# Pipeline V2
`);
    writeFileSync(join(implDir, "argo-executor.md"), `---
id: argo-executor
title: "Argo Executor"
status: open
type: feature
priority: 1
deps:
  - pipeline-v2-types
---

# Argo Executor
`);
    writeFileSync(join(implDir, "cost-estimation.md"), `---
id: cost-estimation
title: "Cost Estimation"
status: in-progress
type: feature
priority: 2
deps: []
---

# Cost Estimation
`);

    const items = await scanTickets(tmpDir);
    expect(items).toHaveLength(3);

    const parent = items.find(i => i.id === "pipeline-v2");
    expect(parent).toBeDefined();
    expect(parent!.parent).toBeUndefined();

    const argo = items.find(i => i.id === "argo-executor");
    expect(argo).toBeDefined();
    expect(argo!.parent).toBe("pipeline-v2");
    expect(argo!.deps).toEqual(["pipeline-v2-types"]);

    const cost = items.find(i => i.id === "cost-estimation");
    expect(cost).toBeDefined();
    expect(cost!.parent).toBe("pipeline-v2");
    expect(cost!.status).toBe("in-progress");
  });

  it("uses dir: frontmatter field as parent when present", async () => {
    const implDir = join(tmpDir, ".tickets", "impl", "pipeline-v2");
    mkdirSync(implDir, { recursive: true });
    writeFileSync(join(implDir, "README.md"), `---
id: pipeline-v2
title: "Pipeline V2"
status: open
deps: []
---
`);
    writeFileSync(join(implDir, "scheduling.md"), `---
id: scheduling
title: "Scheduling"
status: open
dir: pipeline-v2
deps: []
---
`);

    const items = await scanTickets(tmpDir);
    const child = items.find(i => i.id === "scheduling");
    expect(child).toBeDefined();
    expect(child!.parent).toBe("pipeline-v2");
  });

  it("skips sibling .md files without frontmatter", async () => {
    const implDir = join(tmpDir, ".tickets", "impl", "my-ticket");
    mkdirSync(implDir, { recursive: true });
    writeFileSync(join(implDir, "README.md"), `---
id: my-ticket
title: "My Ticket"
status: open
deps: []
---
`);
    writeFileSync(join(implDir, "notes.md"), `# Just some notes
No frontmatter here.
`);

    const items = await scanTickets(tmpDir);
    expect(items).toHaveLength(1);
    expect(items[0].id).toBe("my-ticket");
  });

  it("ignores non-.md files in ticket directories", async () => {
    const implDir = join(tmpDir, ".tickets", "impl", "my-ticket");
    mkdirSync(implDir, { recursive: true });
    writeFileSync(join(implDir, "README.md"), `---
id: my-ticket
title: "My Ticket"
status: open
deps: []
---
`);
    writeFileSync(join(implDir, "config.yaml"), "key: value\n");
    writeFileSync(join(implDir, "script.ts"), "console.log('hello');\n");

    const items = await scanTickets(tmpDir);
    expect(items).toHaveLength(1);
  });

  it("uses filename stem as fallback id for sub-tickets", async () => {
    const implDir = join(tmpDir, ".tickets", "impl", "epic");
    mkdirSync(implDir, { recursive: true });
    writeFileSync(join(implDir, "README.md"), `---
id: epic
title: "Epic"
status: open
deps: []
---
`);
    writeFileSync(join(implDir, "my-subtask.md"), `---
title: "My Subtask"
status: open
deps: []
---
`);

    const items = await scanTickets(tmpDir);
    const child = items.find(i => i.id === "my-subtask");
    expect(child).toBeDefined();
    expect(child!.parent).toBe("epic");
  });
});

describe("summarizeWorkItems", () => {
  it("summarizes work item statuses", () => {
    const items: WorkItem[] = [
      { id: "1", title: "A", status: "open", priority: 1, type: "feature", filePath: "", deps: [], links: [], tags: {} },
      { id: "2", title: "B", status: "open", priority: 2, type: "bug", filePath: "", deps: [], links: [], tags: {} },
      { id: "3", title: "C", status: "closed", priority: 1, type: "feature", filePath: "", deps: [], links: [], tags: {} },
      { id: "4", title: "D", status: "in-progress", priority: 0, type: "feature", filePath: "", deps: [], links: [], tags: {} },
      { id: "5", title: "E", status: "deferred", priority: 3, type: "feature", filePath: "", deps: [], links: [], tags: {} },
    ];

    const summary = summarizeWorkItems(items);
    expect(summary.total).toBe(5);
    expect(summary.open).toBe(2);
    expect(summary.closed).toBe(1);
    expect(summary.inProgress).toBe(1);
    expect(summary.deferred).toBe(1);
  });
});
