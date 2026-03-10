"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const core_1 = require("@opcom/core");
const node_fs_1 = require("node:fs");
const node_path_1 = require("node:path");
const node_fs_2 = require("node:fs");
const node_os_1 = require("node:os");
(0, vitest_1.describe)("parseFrontmatter", () => {
    (0, vitest_1.it)("parses YAML frontmatter from ticket content", () => {
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
        const fm = (0, core_1.parseFrontmatter)(content);
        (0, vitest_1.expect)(fm).not.toBeNull();
        (0, vitest_1.expect)(fm.id).toBe("auth-system");
        (0, vitest_1.expect)(fm.title).toBe("User Authentication System");
        (0, vitest_1.expect)(fm.status).toBe("open");
        (0, vitest_1.expect)(fm.priority).toBe(1);
        (0, vitest_1.expect)(fm.services).toEqual(["api", "web"]);
        (0, vitest_1.expect)(fm.links).toEqual(["docs/spec/AUTH.md"]);
        (0, vitest_1.expect)(fm.deps).toEqual([]);
    });
    (0, vitest_1.it)("returns null for content without frontmatter", () => {
        (0, vitest_1.expect)((0, core_1.parseFrontmatter)("# Just a heading\nNo frontmatter.")).toBeNull();
    });
});
(0, vitest_1.describe)("parseTicketFile", () => {
    (0, vitest_1.it)("parses a ticket with frontmatter", () => {
        const content = `---
id: test-ticket
title: "Test Ticket"
status: closed
type: bug
priority: 0
---

# Test Ticket
`;
        const item = (0, core_1.parseTicketFile)(content, "/path/test-ticket/README.md", "test-ticket");
        (0, vitest_1.expect)(item).not.toBeNull();
        (0, vitest_1.expect)(item.id).toBe("test-ticket");
        (0, vitest_1.expect)(item.status).toBe("closed");
        (0, vitest_1.expect)(item.priority).toBe(0);
        (0, vitest_1.expect)(item.type).toBe("bug");
    });
    (0, vitest_1.it)("falls back to dir name when no frontmatter", () => {
        const item = (0, core_1.parseTicketFile)("# Something", "/path/fallback/README.md", "fallback");
        (0, vitest_1.expect)(item.id).toBe("fallback");
        (0, vitest_1.expect)(item.status).toBe("open");
    });
    (0, vitest_1.it)("parses role from frontmatter", () => {
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
        const item = (0, core_1.parseTicketFile)(content, "/path/deploy-infra/README.md", "deploy-infra");
        (0, vitest_1.expect)(item).not.toBeNull();
        (0, vitest_1.expect)(item.role).toBe("devops");
    });
    (0, vitest_1.it)("role is undefined when not specified", () => {
        const content = `---
id: no-role
title: No Role
status: open
deps: []
---

# No Role
`;
        const item = (0, core_1.parseTicketFile)(content, "/path/no-role/README.md", "no-role");
        (0, vitest_1.expect)(item.role).toBeUndefined();
    });
});
(0, vitest_1.describe)("parseTicketFile — dir field", () => {
    (0, vitest_1.it)("uses dir: frontmatter as parent", () => {
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
        const item = (0, core_1.parseTicketFile)(content, "/path/pipeline-v2/sub-task-1.md", "sub-task-1");
        (0, vitest_1.expect)(item.parent).toBe("pipeline-v2");
    });
    (0, vitest_1.it)("prefers dir: over milestone: for parent", () => {
        const content = `---
id: sub-task-2
title: "Sub Task 2"
status: open
dir: pipeline-v2
milestone: other-parent
deps: []
---
`;
        const item = (0, core_1.parseTicketFile)(content, "/path/pipeline-v2/sub-task-2.md", "sub-task-2");
        (0, vitest_1.expect)(item.parent).toBe("pipeline-v2");
    });
    (0, vitest_1.it)("falls back to milestone: when no dir:", () => {
        const content = `---
id: sub-task-3
title: "Sub Task 3"
status: open
milestone: my-epic
deps: []
---
`;
        const item = (0, core_1.parseTicketFile)(content, "/path/my-epic/sub-task-3.md", "sub-task-3");
        (0, vitest_1.expect)(item.parent).toBe("my-epic");
    });
});
(0, vitest_1.describe)("scanTickets — sibling .md files", () => {
    let tmpDir;
    (0, vitest_1.beforeEach)(() => {
        tmpDir = (0, node_fs_2.mkdtempSync)((0, node_path_1.join)((0, node_os_1.tmpdir)(), "opcom-test-"));
    });
    (0, vitest_1.afterEach)(() => {
        (0, node_fs_1.rmSync)(tmpDir, { recursive: true, force: true });
    });
    (0, vitest_1.it)("returns only README.md items when no siblings exist", async () => {
        const implDir = (0, node_path_1.join)(tmpDir, ".tickets", "impl", "my-ticket");
        (0, node_fs_1.mkdirSync)(implDir, { recursive: true });
        (0, node_fs_1.writeFileSync)((0, node_path_1.join)(implDir, "README.md"), `---
id: my-ticket
title: "My Ticket"
status: open
type: feature
priority: 1
deps: []
---

# My Ticket
`);
        const items = await (0, core_1.scanTickets)(tmpDir);
        (0, vitest_1.expect)(items).toHaveLength(1);
        (0, vitest_1.expect)(items[0].id).toBe("my-ticket");
        (0, vitest_1.expect)(items[0].parent).toBeUndefined();
    });
    (0, vitest_1.it)("scans sibling .md files as sub-tickets with parent inferred from directory", async () => {
        const implDir = (0, node_path_1.join)(tmpDir, ".tickets", "impl", "pipeline-v2");
        (0, node_fs_1.mkdirSync)(implDir, { recursive: true });
        (0, node_fs_1.writeFileSync)((0, node_path_1.join)(implDir, "README.md"), `---
id: pipeline-v2
title: "Pipeline V2"
status: open
type: feature
priority: 1
deps: []
---

# Pipeline V2
`);
        (0, node_fs_1.writeFileSync)((0, node_path_1.join)(implDir, "argo-executor.md"), `---
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
        (0, node_fs_1.writeFileSync)((0, node_path_1.join)(implDir, "cost-estimation.md"), `---
id: cost-estimation
title: "Cost Estimation"
status: in-progress
type: feature
priority: 2
deps: []
---

# Cost Estimation
`);
        const items = await (0, core_1.scanTickets)(tmpDir);
        (0, vitest_1.expect)(items).toHaveLength(3);
        const parent = items.find(i => i.id === "pipeline-v2");
        (0, vitest_1.expect)(parent).toBeDefined();
        (0, vitest_1.expect)(parent.parent).toBeUndefined();
        const argo = items.find(i => i.id === "argo-executor");
        (0, vitest_1.expect)(argo).toBeDefined();
        (0, vitest_1.expect)(argo.parent).toBe("pipeline-v2");
        (0, vitest_1.expect)(argo.deps).toEqual(["pipeline-v2-types"]);
        const cost = items.find(i => i.id === "cost-estimation");
        (0, vitest_1.expect)(cost).toBeDefined();
        (0, vitest_1.expect)(cost.parent).toBe("pipeline-v2");
        (0, vitest_1.expect)(cost.status).toBe("in-progress");
    });
    (0, vitest_1.it)("uses dir: frontmatter field as parent when present", async () => {
        const implDir = (0, node_path_1.join)(tmpDir, ".tickets", "impl", "pipeline-v2");
        (0, node_fs_1.mkdirSync)(implDir, { recursive: true });
        (0, node_fs_1.writeFileSync)((0, node_path_1.join)(implDir, "README.md"), `---
id: pipeline-v2
title: "Pipeline V2"
status: open
deps: []
---
`);
        (0, node_fs_1.writeFileSync)((0, node_path_1.join)(implDir, "scheduling.md"), `---
id: scheduling
title: "Scheduling"
status: open
dir: pipeline-v2
deps: []
---
`);
        const items = await (0, core_1.scanTickets)(tmpDir);
        const child = items.find(i => i.id === "scheduling");
        (0, vitest_1.expect)(child).toBeDefined();
        (0, vitest_1.expect)(child.parent).toBe("pipeline-v2");
    });
    (0, vitest_1.it)("skips sibling .md files without frontmatter", async () => {
        const implDir = (0, node_path_1.join)(tmpDir, ".tickets", "impl", "my-ticket");
        (0, node_fs_1.mkdirSync)(implDir, { recursive: true });
        (0, node_fs_1.writeFileSync)((0, node_path_1.join)(implDir, "README.md"), `---
id: my-ticket
title: "My Ticket"
status: open
deps: []
---
`);
        (0, node_fs_1.writeFileSync)((0, node_path_1.join)(implDir, "notes.md"), `# Just some notes
No frontmatter here.
`);
        const items = await (0, core_1.scanTickets)(tmpDir);
        (0, vitest_1.expect)(items).toHaveLength(1);
        (0, vitest_1.expect)(items[0].id).toBe("my-ticket");
    });
    (0, vitest_1.it)("ignores non-.md files in ticket directories", async () => {
        const implDir = (0, node_path_1.join)(tmpDir, ".tickets", "impl", "my-ticket");
        (0, node_fs_1.mkdirSync)(implDir, { recursive: true });
        (0, node_fs_1.writeFileSync)((0, node_path_1.join)(implDir, "README.md"), `---
id: my-ticket
title: "My Ticket"
status: open
deps: []
---
`);
        (0, node_fs_1.writeFileSync)((0, node_path_1.join)(implDir, "config.yaml"), "key: value\n");
        (0, node_fs_1.writeFileSync)((0, node_path_1.join)(implDir, "script.ts"), "console.log('hello');\n");
        const items = await (0, core_1.scanTickets)(tmpDir);
        (0, vitest_1.expect)(items).toHaveLength(1);
    });
    (0, vitest_1.it)("uses filename stem as fallback id for sub-tickets", async () => {
        const implDir = (0, node_path_1.join)(tmpDir, ".tickets", "impl", "epic");
        (0, node_fs_1.mkdirSync)(implDir, { recursive: true });
        (0, node_fs_1.writeFileSync)((0, node_path_1.join)(implDir, "README.md"), `---
id: epic
title: "Epic"
status: open
deps: []
---
`);
        (0, node_fs_1.writeFileSync)((0, node_path_1.join)(implDir, "my-subtask.md"), `---
title: "My Subtask"
status: open
deps: []
---
`);
        const items = await (0, core_1.scanTickets)(tmpDir);
        const child = items.find(i => i.id === "my-subtask");
        (0, vitest_1.expect)(child).toBeDefined();
        (0, vitest_1.expect)(child.parent).toBe("epic");
    });
});
(0, vitest_1.describe)("scanTickets → computePlan integration", () => {
    let tmpDir;
    (0, vitest_1.beforeEach)(() => {
        tmpDir = (0, node_fs_2.mkdtempSync)((0, node_path_1.join)((0, node_os_1.tmpdir)(), "opcom-test-"));
    });
    (0, vitest_1.afterEach)(() => {
        (0, node_fs_1.rmSync)(tmpDir, { recursive: true, force: true });
    });
    (0, vitest_1.it)("parent ticket with children is excluded from plan steps", async () => {
        const implDir = (0, node_path_1.join)(tmpDir, ".tickets", "impl", "pipeline-v2");
        (0, node_fs_1.mkdirSync)(implDir, { recursive: true });
        (0, node_fs_1.writeFileSync)((0, node_path_1.join)(implDir, "README.md"), `---
id: pipeline-v2
title: "Pipeline V2"
status: open
type: feature
priority: 1
deps: []
---

# Pipeline V2
`);
        (0, node_fs_1.writeFileSync)((0, node_path_1.join)(implDir, "argo-executor.md"), `---
id: argo-executor
title: "Argo Executor"
status: open
type: feature
priority: 1
deps: []
---

# Argo Executor
`);
        (0, node_fs_1.writeFileSync)((0, node_path_1.join)(implDir, "cost-estimation.md"), `---
id: cost-estimation
title: "Cost Estimation"
status: open
type: feature
priority: 2
deps:
  - argo-executor
---

# Cost Estimation
`);
        // Scan returns parent + children
        const items = await (0, core_1.scanTickets)(tmpDir);
        (0, vitest_1.expect)(items).toHaveLength(3);
        // Feed into computePlan — parent should be excluded
        const plan = (0, core_1.computePlan)([{ projectId: "folia", tickets: items }], {}, "test-plan");
        const stepIds = plan.steps.map((s) => s.ticketId);
        (0, vitest_1.expect)(stepIds).not.toContain("pipeline-v2");
        (0, vitest_1.expect)(stepIds).toContain("argo-executor");
        (0, vitest_1.expect)(stepIds).toContain("cost-estimation");
        (0, vitest_1.expect)(plan.steps).toHaveLength(2);
    });
    (0, vitest_1.it)("Folia plan for pipeline-v2 produces a multi-step track instead of a single step", async () => {
        const implDir = (0, node_path_1.join)(tmpDir, ".tickets", "impl", "pipeline-v2");
        (0, node_fs_1.mkdirSync)(implDir, { recursive: true });
        (0, node_fs_1.writeFileSync)((0, node_path_1.join)(implDir, "README.md"), `---
id: pipeline-v2
title: "Pipeline V2"
status: open
type: feature
priority: 1
deps: []
---

# Pipeline V2 — parent epic
`);
        (0, node_fs_1.writeFileSync)((0, node_path_1.join)(implDir, "pipeline-v2-types.md"), `---
id: pipeline-v2-types
title: "Pipeline V2 Types"
status: open
type: feature
priority: 1
deps: []
---

# Pipeline V2 Types
`);
        (0, node_fs_1.writeFileSync)((0, node_path_1.join)(implDir, "argo-executor.md"), `---
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
        (0, node_fs_1.writeFileSync)((0, node_path_1.join)(implDir, "cost-estimation.md"), `---
id: cost-estimation
title: "Cost Estimation"
status: open
type: feature
priority: 2
deps:
  - pipeline-v2-types
---

# Cost Estimation
`);
        const items = await (0, core_1.scanTickets)(tmpDir);
        (0, vitest_1.expect)(items).toHaveLength(4); // parent + 3 children
        const plan = (0, core_1.computePlan)([{ projectId: "folia", tickets: items }], {}, "pipeline-v2-plan");
        // Parent excluded, 3 children become steps
        const stepIds = plan.steps.map((s) => s.ticketId);
        (0, vitest_1.expect)(stepIds).not.toContain("pipeline-v2");
        (0, vitest_1.expect)(plan.steps).toHaveLength(3);
        (0, vitest_1.expect)(stepIds).toContain("pipeline-v2-types");
        (0, vitest_1.expect)(stepIds).toContain("argo-executor");
        (0, vitest_1.expect)(stepIds).toContain("cost-estimation");
        // Children form a multi-step track (connected via deps)
        const typesStep = plan.steps.find((s) => s.ticketId === "pipeline-v2-types");
        const argoStep = plan.steps.find((s) => s.ticketId === "argo-executor");
        const costStep = plan.steps.find((s) => s.ticketId === "cost-estimation");
        // types is ready (no deps), argo and cost are blocked on types
        (0, vitest_1.expect)(typesStep.status).toBe("ready");
        (0, vitest_1.expect)(argoStep.status).toBe("blocked");
        (0, vitest_1.expect)(argoStep.blockedBy).toEqual(["pipeline-v2-types"]);
        (0, vitest_1.expect)(costStep.status).toBe("blocked");
        (0, vitest_1.expect)(costStep.blockedBy).toEqual(["pipeline-v2-types"]);
        // All three should be in the same track (connected by deps)
        (0, vitest_1.expect)(typesStep.track).toBe(argoStep.track);
        (0, vitest_1.expect)(argoStep.track).toBe(costStep.track);
    });
});
(0, vitest_1.describe)("summarizeWorkItems", () => {
    (0, vitest_1.it)("summarizes work item statuses", () => {
        const items = [
            { id: "1", title: "A", status: "open", priority: 1, type: "feature", filePath: "", deps: [], links: [], tags: {} },
            { id: "2", title: "B", status: "open", priority: 2, type: "bug", filePath: "", deps: [], links: [], tags: {} },
            { id: "3", title: "C", status: "closed", priority: 1, type: "feature", filePath: "", deps: [], links: [], tags: {} },
            { id: "4", title: "D", status: "in-progress", priority: 0, type: "feature", filePath: "", deps: [], links: [], tags: {} },
            { id: "5", title: "E", status: "deferred", priority: 3, type: "feature", filePath: "", deps: [], links: [], tags: {} },
        ];
        const summary = (0, core_1.summarizeWorkItems)(items);
        (0, vitest_1.expect)(summary.total).toBe(5);
        (0, vitest_1.expect)(summary.open).toBe(2);
        (0, vitest_1.expect)(summary.closed).toBe(1);
        (0, vitest_1.expect)(summary.inProgress).toBe(1);
        (0, vitest_1.expect)(summary.deferred).toBe(1);
    });
});
//# sourceMappingURL=tickets.test.js.map