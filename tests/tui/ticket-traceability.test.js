"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const node_fs_1 = require("node:fs");
const node_path_1 = require("node:path");
const node_os_1 = require("node:os");
const renderer_js_1 = require("../../packages/cli/src/tui/renderer.js");
const ticket_focus_js_1 = require("../../packages/cli/src/tui/views/ticket-focus.js");
const health_data_js_1 = require("../../packages/cli/src/tui/health-data.js");
function makeTicket(overrides = {}) {
    return {
        id: overrides.id ?? "plan-stages",
        title: overrides.title ?? "Plan stages implementation",
        status: overrides.status ?? "open",
        priority: overrides.priority ?? 2,
        type: overrides.type ?? "feature",
        filePath: overrides.filePath ?? "/tickets/plan-stages/README.md",
        deps: overrides.deps ?? [],
        links: overrides.links ?? [],
        tags: overrides.tags ?? {},
    };
}
function makePanel(overrides = {}) {
    return {
        id: "ticket-focus",
        x: 0,
        y: 0,
        width: 80,
        height: 30,
        title: "Ticket",
        ...overrides,
    };
}
// --- computeTicketTraceability tests ---
(0, vitest_1.describe)("computeTicketTraceability", () => {
    let tmpDir;
    (0, vitest_1.beforeEach)(() => {
        tmpDir = (0, node_fs_1.mkdtempSync)((0, node_path_1.join)((0, node_os_1.tmpdir)(), "opcom-trace-"));
    });
    (0, vitest_1.afterEach)(() => {
        (0, node_fs_1.rmSync)(tmpDir, { recursive: true, force: true });
    });
    (0, vitest_1.it)("extracts spec link with anchor from ticket links", () => {
        const ticket = makeTicket({
            links: ["docs/spec/orchestrator.md#plan-stages"],
        });
        const result = (0, health_data_js_1.computeTicketTraceability)(ticket, [ticket], tmpDir);
        (0, vitest_1.expect)(result.specLink).toEqual({ spec: "orchestrator", anchor: "plan-stages" });
    });
    (0, vitest_1.it)("extracts spec link without anchor", () => {
        const ticket = makeTicket({
            links: ["docs/spec/tui.md"],
        });
        const result = (0, health_data_js_1.computeTicketTraceability)(ticket, [ticket], tmpDir);
        (0, vitest_1.expect)(result.specLink).toEqual({ spec: "tui", anchor: undefined });
    });
    (0, vitest_1.it)("returns null specLink when no spec link present", () => {
        const ticket = makeTicket({ links: [] });
        const result = (0, health_data_js_1.computeTicketTraceability)(ticket, [ticket], tmpDir);
        (0, vitest_1.expect)(result.specLink).toBeNull();
    });
    (0, vitest_1.it)("returns null specLink for non-spec links", () => {
        const ticket = makeTicket({ links: ["README.md", "CHANGELOG.md"] });
        const result = (0, health_data_js_1.computeTicketTraceability)(ticket, [ticket], tmpDir);
        (0, vitest_1.expect)(result.specLink).toBeNull();
    });
    (0, vitest_1.it)("handles short spec path (spec/name without docs/ prefix)", () => {
        const ticket = makeTicket({
            links: ["spec/orchestrator.md#plan-stages"],
        });
        const result = (0, health_data_js_1.computeTicketTraceability)(ticket, [ticket], tmpDir);
        (0, vitest_1.expect)(result.specLink).toEqual({ spec: "orchestrator", anchor: "plan-stages" });
    });
    (0, vitest_1.it)("finds related tickets with same spec and anchor", () => {
        const ticket = makeTicket({
            id: "plan-stages",
            links: ["docs/spec/orchestrator.md#plan-stages"],
        });
        const related1 = makeTicket({
            id: "plan-overview-screen",
            links: ["docs/spec/orchestrator.md#plan-stages"],
            status: "closed",
        });
        const related2 = makeTicket({
            id: "executor-worktree",
            links: ["docs/spec/orchestrator.md#executor"],
        });
        const unrelated = makeTicket({
            id: "tui-nav",
            links: ["docs/spec/tui.md#navigation"],
        });
        const result = (0, health_data_js_1.computeTicketTraceability)(ticket, [ticket, related1, related2, unrelated], tmpDir);
        (0, vitest_1.expect)(result.relatedTickets).toEqual([
            { id: "plan-overview-screen", status: "closed" },
        ]);
    });
    (0, vitest_1.it)("finds related tickets matching spec without anchors", () => {
        const ticket = makeTicket({
            id: "tui-health",
            links: ["docs/spec/tui.md"],
        });
        const related = makeTicket({
            id: "tui-nav",
            links: ["docs/spec/tui.md#navigation"],
            status: "open",
        });
        const result = (0, health_data_js_1.computeTicketTraceability)(ticket, [ticket, related], tmpDir);
        (0, vitest_1.expect)(result.relatedTickets).toEqual([
            { id: "tui-nav", status: "open" },
        ]);
    });
    (0, vitest_1.it)("excludes self from related tickets", () => {
        const ticket = makeTicket({
            id: "plan-stages",
            links: ["docs/spec/orchestrator.md#plan-stages"],
        });
        const result = (0, health_data_js_1.computeTicketTraceability)(ticket, [ticket], tmpDir);
        (0, vitest_1.expect)(result.relatedTickets).toEqual([]);
    });
    (0, vitest_1.it)("returns empty related tickets when no spec link", () => {
        const ticket = makeTicket({ id: "no-spec", links: [] });
        const other = makeTicket({
            id: "other",
            links: ["docs/spec/tui.md"],
        });
        const result = (0, health_data_js_1.computeTicketTraceability)(ticket, [ticket, other], tmpDir);
        (0, vitest_1.expect)(result.relatedTickets).toEqual([]);
    });
    (0, vitest_1.it)("finds test files in spec-named directory", () => {
        // Create tests/orchestrator/ with test files
        const testsDir = (0, node_path_1.join)(tmpDir, "tests", "orchestrator");
        (0, node_fs_1.mkdirSync)(testsDir, { recursive: true });
        (0, node_fs_1.writeFileSync)((0, node_path_1.join)(testsDir, "executor.test.ts"), "test");
        (0, node_fs_1.writeFileSync)((0, node_path_1.join)(testsDir, "plan.test.ts"), "test");
        (0, node_fs_1.writeFileSync)((0, node_path_1.join)(testsDir, "helper.ts"), "not a test");
        const ticket = makeTicket({
            links: ["docs/spec/orchestrator.md#plan-stages"],
        });
        const result = (0, health_data_js_1.computeTicketTraceability)(ticket, [ticket], tmpDir);
        (0, vitest_1.expect)(result.testFiles).toContain("tests/orchestrator/executor.test.ts");
        (0, vitest_1.expect)(result.testFiles).toContain("tests/orchestrator/plan.test.ts");
        (0, vitest_1.expect)(result.testFiles).not.toContain("tests/orchestrator/helper.ts");
    });
    (0, vitest_1.it)("finds top-level test files matching spec name", () => {
        const testsDir = (0, node_path_1.join)(tmpDir, "tests");
        (0, node_fs_1.mkdirSync)(testsDir, { recursive: true });
        (0, node_fs_1.writeFileSync)((0, node_path_1.join)(testsDir, "tui-integration.test.ts"), "test");
        (0, node_fs_1.writeFileSync)((0, node_path_1.join)(testsDir, "other.test.ts"), "test");
        const ticket = makeTicket({
            links: ["docs/spec/tui.md#navigation"],
        });
        const result = (0, health_data_js_1.computeTicketTraceability)(ticket, [ticket], tmpDir);
        (0, vitest_1.expect)(result.testFiles).toContain("tests/tui-integration.test.ts");
        (0, vitest_1.expect)(result.testFiles).not.toContain("tests/other.test.ts");
    });
    (0, vitest_1.it)("returns empty test files when no spec link", () => {
        const ticket = makeTicket({ links: [] });
        const result = (0, health_data_js_1.computeTicketTraceability)(ticket, [ticket], tmpDir);
        (0, vitest_1.expect)(result.testFiles).toEqual([]);
    });
    (0, vitest_1.it)("returns empty test files when tests dir does not exist", () => {
        const ticket = makeTicket({
            links: ["docs/spec/orchestrator.md#plan-stages"],
        });
        const result = (0, health_data_js_1.computeTicketTraceability)(ticket, [ticket], tmpDir);
        (0, vitest_1.expect)(result.testFiles).toEqual([]);
    });
});
// --- rebuildDisplayLines with traceability tests ---
(0, vitest_1.describe)("rebuildDisplayLines with traceability", () => {
    (0, vitest_1.it)("shows spec link with green check when linked", () => {
        const ticket = makeTicket({
            links: ["docs/spec/orchestrator.md#plan-stages"],
        });
        const state = (0, ticket_focus_js_1.createTicketFocusState)(ticket, null);
        state.traceability = {
            specLink: { spec: "orchestrator", anchor: "plan-stages" },
            relatedTickets: [],
            testFiles: [],
        };
        state.loaded = true;
        (0, ticket_focus_js_1.rebuildDisplayLines)(state, 100);
        const text = state.displayLines.map(renderer_js_1.stripAnsi).join("\n");
        (0, vitest_1.expect)(text).toContain("orchestrator.md#plan-stages");
        (0, vitest_1.expect)(text).toContain("\u2713 linked");
    });
    (0, vitest_1.it)("shows red warning when no spec link", () => {
        const ticket = makeTicket({ links: [] });
        const state = (0, ticket_focus_js_1.createTicketFocusState)(ticket, null);
        state.traceability = {
            specLink: null,
            relatedTickets: [],
            testFiles: [],
        };
        state.loaded = true;
        (0, ticket_focus_js_1.rebuildDisplayLines)(state, 100);
        const text = state.displayLines.map(renderer_js_1.stripAnsi).join("\n");
        (0, vitest_1.expect)(text).toContain("\u26A0 no spec link");
    });
    (0, vitest_1.it)("shows spec link without anchor", () => {
        const ticket = makeTicket({ links: ["docs/spec/tui.md"] });
        const state = (0, ticket_focus_js_1.createTicketFocusState)(ticket, null);
        state.traceability = {
            specLink: { spec: "tui" },
            relatedTickets: [],
            testFiles: [],
        };
        state.loaded = true;
        (0, ticket_focus_js_1.rebuildDisplayLines)(state, 100);
        const text = state.displayLines.map(renderer_js_1.stripAnsi).join("\n");
        (0, vitest_1.expect)(text).toContain("tui.md");
        (0, vitest_1.expect)(text).toContain("\u2713 linked");
        (0, vitest_1.expect)(text).not.toContain("#");
    });
    (0, vitest_1.it)("shows related tickets", () => {
        const ticket = makeTicket();
        const state = (0, ticket_focus_js_1.createTicketFocusState)(ticket, null);
        state.traceability = {
            specLink: { spec: "orchestrator", anchor: "plan-stages" },
            relatedTickets: [
                { id: "plan-overview-screen", status: "closed" },
                { id: "executor-worktree", status: "open" },
            ],
            testFiles: [],
        };
        state.loaded = true;
        (0, ticket_focus_js_1.rebuildDisplayLines)(state, 120);
        const text = state.displayLines.map(renderer_js_1.stripAnsi).join("\n");
        (0, vitest_1.expect)(text).toContain("Related:");
        (0, vitest_1.expect)(text).toContain("plan-overview-screen (closed)");
        (0, vitest_1.expect)(text).toContain("executor-worktree (open)");
    });
    (0, vitest_1.it)("omits related section when no related tickets", () => {
        const ticket = makeTicket();
        const state = (0, ticket_focus_js_1.createTicketFocusState)(ticket, null);
        state.traceability = {
            specLink: { spec: "orchestrator" },
            relatedTickets: [],
            testFiles: [],
        };
        state.loaded = true;
        (0, ticket_focus_js_1.rebuildDisplayLines)(state, 100);
        const text = state.displayLines.map(renderer_js_1.stripAnsi).join("\n");
        (0, vitest_1.expect)(text).not.toContain("Related:");
    });
    (0, vitest_1.it)("shows test files", () => {
        const ticket = makeTicket();
        const state = (0, ticket_focus_js_1.createTicketFocusState)(ticket, null);
        state.traceability = {
            specLink: { spec: "orchestrator" },
            relatedTickets: [],
            testFiles: [
                "tests/orchestrator/executor.test.ts",
                "tests/orchestrator/plan.test.ts",
            ],
        };
        state.loaded = true;
        (0, ticket_focus_js_1.rebuildDisplayLines)(state, 120);
        const text = state.displayLines.map(renderer_js_1.stripAnsi).join("\n");
        (0, vitest_1.expect)(text).toContain("Tests:");
        (0, vitest_1.expect)(text).toContain("tests/orchestrator/executor.test.ts");
        (0, vitest_1.expect)(text).toContain("tests/orchestrator/plan.test.ts");
    });
    (0, vitest_1.it)("omits tests section when no test files", () => {
        const ticket = makeTicket();
        const state = (0, ticket_focus_js_1.createTicketFocusState)(ticket, null);
        state.traceability = {
            specLink: { spec: "orchestrator" },
            relatedTickets: [],
            testFiles: [],
        };
        state.loaded = true;
        (0, ticket_focus_js_1.rebuildDisplayLines)(state, 100);
        const text = state.displayLines.map(renderer_js_1.stripAnsi).join("\n");
        (0, vitest_1.expect)(text).not.toContain("Tests:");
    });
    (0, vitest_1.it)("does not show traceability section when traceability is null", () => {
        const ticket = makeTicket();
        const state = (0, ticket_focus_js_1.createTicketFocusState)(ticket, null);
        state.traceability = null;
        state.loaded = true;
        (0, ticket_focus_js_1.rebuildDisplayLines)(state, 100);
        const text = state.displayLines.map(renderer_js_1.stripAnsi).join("\n");
        (0, vitest_1.expect)(text).not.toContain("Spec:");
        (0, vitest_1.expect)(text).not.toContain("\u2713 linked");
        (0, vitest_1.expect)(text).not.toContain("\u26A0 no spec link");
    });
});
// --- renderTicketFocus with traceability tests ---
(0, vitest_1.describe)("renderTicketFocus with traceability", () => {
    (0, vitest_1.it)("renders without crash when traceability data is present", () => {
        const buf = new renderer_js_1.ScreenBuffer(100, 40);
        const panel = makePanel({ width: 100, height: 39 });
        const ticket = makeTicket({
            links: ["docs/spec/orchestrator.md#plan-stages"],
        });
        const state = (0, ticket_focus_js_1.createTicketFocusState)(ticket, null);
        state.traceability = {
            specLink: { spec: "orchestrator", anchor: "plan-stages" },
            relatedTickets: [{ id: "plan-overview", status: "closed" }],
            testFiles: ["tests/orchestrator/executor.test.ts"],
        };
        state.loaded = true;
        (0, ticket_focus_js_1.rebuildDisplayLines)(state, 98);
        (0, ticket_focus_js_1.renderTicketFocus)(buf, panel, state);
        buf.flush();
    });
    (0, vitest_1.it)("renders without crash when traceability is null", () => {
        const buf = new renderer_js_1.ScreenBuffer(80, 30);
        const panel = makePanel();
        const ticket = makeTicket();
        const state = (0, ticket_focus_js_1.createTicketFocusState)(ticket, null);
        state.traceability = null;
        state.loaded = true;
        (0, ticket_focus_js_1.rebuildDisplayLines)(state, 78);
        (0, ticket_focus_js_1.renderTicketFocus)(buf, panel, state);
        buf.flush();
    });
    (0, vitest_1.it)("renders without crash when no spec link (warning state)", () => {
        const buf = new renderer_js_1.ScreenBuffer(80, 30);
        const panel = makePanel();
        const ticket = makeTicket({ links: [] });
        const state = (0, ticket_focus_js_1.createTicketFocusState)(ticket, null);
        state.traceability = {
            specLink: null,
            relatedTickets: [],
            testFiles: [],
        };
        state.loaded = true;
        (0, ticket_focus_js_1.rebuildDisplayLines)(state, 78);
        (0, ticket_focus_js_1.renderTicketFocus)(buf, panel, state);
        buf.flush();
    });
    (0, vitest_1.it)("handles narrow terminal with traceability data", () => {
        const buf = new renderer_js_1.ScreenBuffer(40, 15);
        const panel = makePanel({ width: 40, height: 14 });
        const ticket = makeTicket({
            links: ["docs/spec/orchestrator.md#plan-stages"],
        });
        const state = (0, ticket_focus_js_1.createTicketFocusState)(ticket, null);
        state.traceability = {
            specLink: { spec: "orchestrator", anchor: "plan-stages" },
            relatedTickets: [
                { id: "plan-overview", status: "closed" },
                { id: "executor-gate", status: "open" },
            ],
            testFiles: ["tests/orchestrator/executor.test.ts"],
        };
        state.loaded = true;
        (0, ticket_focus_js_1.rebuildDisplayLines)(state, 38);
        (0, ticket_focus_js_1.renderTicketFocus)(buf, panel, state);
        buf.flush();
    });
});
// --- createTicketFocusState tests ---
(0, vitest_1.describe)("createTicketFocusState", () => {
    (0, vitest_1.it)("initializes traceability as null", () => {
        const ticket = makeTicket();
        const state = (0, ticket_focus_js_1.createTicketFocusState)(ticket, null);
        (0, vitest_1.expect)(state.traceability).toBeNull();
    });
});
//# sourceMappingURL=ticket-traceability.test.js.map