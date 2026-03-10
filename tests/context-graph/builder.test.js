"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const node_fs_1 = require("node:fs");
const node_path_1 = require("node:path");
const node_os_1 = require("node:os");
const node_child_process_1 = require("node:child_process");
const context_graph_1 = require("@opcom/context-graph");
let projectDir;
let contextDir;
(0, vitest_1.beforeEach)(() => {
    projectDir = (0, node_fs_1.mkdtempSync)((0, node_path_1.join)((0, node_os_1.tmpdir)(), "cg-test-project-"));
    contextDir = (0, node_fs_1.mkdtempSync)((0, node_path_1.join)((0, node_os_1.tmpdir)(), "cg-test-context-"));
    // Init git repo
    (0, node_child_process_1.execSync)("git init", { cwd: projectDir });
    (0, node_child_process_1.execSync)("git config user.email 'test@test.com'", { cwd: projectDir });
    (0, node_child_process_1.execSync)("git config user.name 'Test'", { cwd: projectDir });
});
(0, vitest_1.afterEach)(() => {
    (0, node_fs_1.rmSync)(projectDir, { recursive: true, force: true });
    (0, node_fs_1.rmSync)(contextDir, { recursive: true, force: true });
});
function commitAll(msg) {
    (0, node_child_process_1.execSync)("git add -A", { cwd: projectDir });
    (0, node_child_process_1.execSync)(`git commit -m "${msg}" --allow-empty`, { cwd: projectDir });
}
(0, vitest_1.describe)("GraphBuilder", () => {
    (0, vitest_1.it)("builds an empty graph for an empty project", async () => {
        (0, node_fs_1.writeFileSync)((0, node_path_1.join)(projectDir, "README.md"), "# Test");
        commitAll("init");
        const builder = new context_graph_1.GraphBuilder("test", projectDir, contextDir);
        const result = await builder.build();
        (0, vitest_1.expect)(result.nodes).toBe(0);
        (0, vitest_1.expect)(result.edges).toBe(0);
        builder.close();
    });
    (0, vitest_1.it)("detects TypeScript imports", async () => {
        (0, node_fs_1.writeFileSync)((0, node_path_1.join)(projectDir, "package.json"), '{"name":"test"}');
        (0, node_fs_1.mkdirSync)((0, node_path_1.join)(projectDir, "src"), { recursive: true });
        (0, node_fs_1.writeFileSync)((0, node_path_1.join)(projectDir, "src/utils.ts"), "export function add(a: number, b: number) { return a + b; }");
        (0, node_fs_1.writeFileSync)((0, node_path_1.join)(projectDir, "src/main.ts"), 'import { add } from "./utils.js";\nconsole.log(add(1, 2));');
        commitAll("init");
        const builder = new context_graph_1.GraphBuilder("test", projectDir, contextDir);
        builder.register(new context_graph_1.TypeScriptImportAnalyzer());
        const result = await builder.build();
        (0, vitest_1.expect)(result.nodes).toBeGreaterThanOrEqual(2);
        const db = builder.getDb();
        const edges = db.getEdgesFrom("file:src/main.ts", "imports");
        (0, vitest_1.expect)(edges.length).toBe(1);
        (0, vitest_1.expect)(edges[0].target).toBe("file:src/utils.ts");
        builder.close();
    });
    (0, vitest_1.it)("detects Python imports", async () => {
        (0, node_fs_1.mkdirSync)((0, node_path_1.join)(projectDir, "mylib"), { recursive: true });
        (0, node_fs_1.writeFileSync)((0, node_path_1.join)(projectDir, "pyproject.toml"), '[project]\nname = "test"');
        (0, node_fs_1.writeFileSync)((0, node_path_1.join)(projectDir, "mylib/__init__.py"), "");
        (0, node_fs_1.writeFileSync)((0, node_path_1.join)(projectDir, "mylib/core.py"), "def hello(): pass");
        (0, node_fs_1.writeFileSync)((0, node_path_1.join)(projectDir, "mylib/main.py"), "from mylib.core import hello");
        commitAll("init");
        const builder = new context_graph_1.GraphBuilder("test", projectDir, contextDir);
        builder.register(new context_graph_1.PythonImportAnalyzer());
        const result = await builder.build();
        (0, vitest_1.expect)(result.nodes).toBeGreaterThanOrEqual(3);
        const db = builder.getDb();
        const edges = db.getEdgesFrom("file:mylib/main.py", "imports");
        (0, vitest_1.expect)(edges.length).toBe(1);
        (0, vitest_1.expect)(edges[0].target).toBe("file:mylib/core.py");
        builder.close();
    });
    (0, vitest_1.it)("discovers specs and ADRs", async () => {
        (0, node_fs_1.mkdirSync)((0, node_path_1.join)(projectDir, "docs/spec"), { recursive: true });
        (0, node_fs_1.mkdirSync)((0, node_path_1.join)(projectDir, "docs/decisions"), { recursive: true });
        (0, node_fs_1.writeFileSync)((0, node_path_1.join)(projectDir, "docs/spec/LAYERS.md"), "---\nspec: layers\nstatus: complete\n---\n# Layers\n\nSee [[adr:0001]] for details.");
        (0, node_fs_1.writeFileSync)((0, node_path_1.join)(projectDir, "docs/decisions/0001-unified-layers.md"), "---\nstatus: accepted\n---\n# ADR-0001: Unified Layers");
        commitAll("init");
        const builder = new context_graph_1.GraphBuilder("test", projectDir, contextDir);
        builder.register(new context_graph_1.MarkdownDocAnalyzer());
        const result = await builder.build();
        (0, vitest_1.expect)(result.nodes).toBe(2);
        const db = builder.getDb();
        const edges = db.getEdgesFrom("spec:layers", "links_to");
        (0, vitest_1.expect)(edges.length).toBe(1);
        (0, vitest_1.expect)(edges[0].target).toBe("adr:0001");
        builder.close();
    });
    (0, vitest_1.it)("discovers tickets", async () => {
        (0, node_fs_1.mkdirSync)((0, node_path_1.join)(projectDir, ".tickets/impl/my-feature"), { recursive: true });
        (0, node_fs_1.writeFileSync)((0, node_path_1.join)(projectDir, ".tickets/impl/my-feature/README.md"), '---\nid: my-feature\ntitle: "My Feature"\nstatus: open\nlinks:\n  - docs/spec/LAYERS.md\ndemand:\n  - UC-001\n---\n# My Feature');
        commitAll("init");
        const builder = new context_graph_1.GraphBuilder("test", projectDir, contextDir);
        builder.register(new context_graph_1.TicketAnalyzer());
        const result = await builder.build();
        (0, vitest_1.expect)(result.nodes).toBe(1);
        const db = builder.getDb();
        const node = db.getNode("ticket:my-feature");
        (0, vitest_1.expect)(node?.title).toBe("My Feature");
        (0, vitest_1.expect)(node?.status).toBe("open");
        const edges = db.getEdgesFrom("ticket:my-feature", "implements");
        (0, vitest_1.expect)(edges.some((e) => e.target === "spec:layers")).toBe(true);
        (0, vitest_1.expect)(edges.some((e) => e.target === "use_case:uc-001")).toBe(true);
        builder.close();
    });
    (0, vitest_1.it)("test files create tests edges", async () => {
        (0, node_fs_1.writeFileSync)((0, node_path_1.join)(projectDir, "package.json"), '{"name":"test"}');
        (0, node_fs_1.mkdirSync)((0, node_path_1.join)(projectDir, "src"), { recursive: true });
        (0, node_fs_1.mkdirSync)((0, node_path_1.join)(projectDir, "tests"), { recursive: true });
        (0, node_fs_1.writeFileSync)((0, node_path_1.join)(projectDir, "src/utils.ts"), "export function add(a: number, b: number) { return a + b; }");
        (0, node_fs_1.writeFileSync)((0, node_path_1.join)(projectDir, "tests/utils.test.ts"), 'import { add } from "../src/utils.js";\nimport { describe, it, expect } from "vitest";\ndescribe("add", () => { it("works", () => { expect(add(1, 2)).toBe(3); }); });');
        commitAll("init");
        const builder = new context_graph_1.GraphBuilder("test", projectDir, contextDir);
        builder.register(new context_graph_1.TypeScriptImportAnalyzer());
        const result = await builder.build();
        const db = builder.getDb();
        const testEdges = db.getEdgesFrom("file:tests/utils.test.ts", "tests");
        (0, vitest_1.expect)(testEdges.length).toBe(1);
        (0, vitest_1.expect)(testEdges[0].target).toBe("file:src/utils.ts");
        builder.close();
    });
    (0, vitest_1.it)("replays commit history", async () => {
        (0, node_fs_1.writeFileSync)((0, node_path_1.join)(projectDir, "file1.txt"), "hello");
        commitAll("first commit");
        (0, node_fs_1.writeFileSync)((0, node_path_1.join)(projectDir, "file2.txt"), "world");
        commitAll("second commit");
        const builder = new context_graph_1.GraphBuilder("test", projectDir, contextDir);
        const result = await builder.replay();
        (0, vitest_1.expect)(result.commits).toBe(2);
        const db = builder.getDb();
        const replayCommits = db.getMeta("replay_commits");
        (0, vitest_1.expect)(replayCommits).toBe("2");
        builder.close();
    });
    (0, vitest_1.it)("full-text search works", async () => {
        (0, node_fs_1.writeFileSync)((0, node_path_1.join)(projectDir, "package.json"), '{"name":"test"}');
        (0, node_fs_1.mkdirSync)((0, node_path_1.join)(projectDir, "src"), { recursive: true });
        (0, node_fs_1.writeFileSync)((0, node_path_1.join)(projectDir, "src/authentication.ts"), "export class AuthService {}");
        commitAll("init");
        const builder = new context_graph_1.GraphBuilder("test", projectDir, contextDir);
        builder.register(new context_graph_1.TypeScriptImportAnalyzer());
        await builder.build();
        const db = builder.getDb();
        const results = db.search("authentication");
        (0, vitest_1.expect)(results.length).toBeGreaterThanOrEqual(1);
        (0, vitest_1.expect)(results[0].title).toBe("authentication");
        builder.close();
    });
});
//# sourceMappingURL=builder.test.js.map