import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execSync } from "node:child_process";
import { GraphBuilder, TypeScriptImportAnalyzer, PythonImportAnalyzer, MarkdownDocAnalyzer, TicketAnalyzer } from "@opcom/context-graph";

let projectDir: string;
let contextDir: string;

beforeEach(() => {
  projectDir = mkdtempSync(join(tmpdir(), "cg-test-project-"));
  contextDir = mkdtempSync(join(tmpdir(), "cg-test-context-"));

  // Init git repo
  execSync("git init", { cwd: projectDir });
  execSync("git config user.email 'test@test.com'", { cwd: projectDir });
  execSync("git config user.name 'Test'", { cwd: projectDir });
});

afterEach(() => {
  rmSync(projectDir, { recursive: true, force: true });
  rmSync(contextDir, { recursive: true, force: true });
});

function commitAll(msg: string) {
  execSync("git add -A", { cwd: projectDir });
  execSync(`git commit -m "${msg}" --allow-empty`, { cwd: projectDir });
}

describe("GraphBuilder", () => {
  it("builds an empty graph for an empty project", async () => {
    writeFileSync(join(projectDir, "README.md"), "# Test");
    commitAll("init");

    const builder = new GraphBuilder("test", projectDir, contextDir);
    const result = await builder.build();

    expect(result.nodes).toBe(0);
    expect(result.edges).toBe(0);
    builder.close();
  });

  it("detects TypeScript imports", async () => {
    writeFileSync(join(projectDir, "package.json"), '{"name":"test"}');
    mkdirSync(join(projectDir, "src"), { recursive: true });
    writeFileSync(join(projectDir, "src/utils.ts"), "export function add(a: number, b: number) { return a + b; }");
    writeFileSync(join(projectDir, "src/main.ts"), 'import { add } from "./utils.js";\nconsole.log(add(1, 2));');
    commitAll("init");

    const builder = new GraphBuilder("test", projectDir, contextDir);
    builder.register(new TypeScriptImportAnalyzer());
    const result = await builder.build();

    expect(result.nodes).toBeGreaterThanOrEqual(2);

    const db = builder.getDb();
    const edges = db.getEdgesFrom("file:src/main.ts", "imports");
    expect(edges.length).toBe(1);
    expect(edges[0].target).toBe("file:src/utils.ts");

    builder.close();
  });

  it("detects Python imports", async () => {
    mkdirSync(join(projectDir, "mylib"), { recursive: true });
    writeFileSync(join(projectDir, "pyproject.toml"), '[project]\nname = "test"');
    writeFileSync(join(projectDir, "mylib/__init__.py"), "");
    writeFileSync(join(projectDir, "mylib/core.py"), "def hello(): pass");
    writeFileSync(join(projectDir, "mylib/main.py"), "from mylib.core import hello");
    commitAll("init");

    const builder = new GraphBuilder("test", projectDir, contextDir);
    builder.register(new PythonImportAnalyzer());
    const result = await builder.build();

    expect(result.nodes).toBeGreaterThanOrEqual(3);

    const db = builder.getDb();
    const edges = db.getEdgesFrom("file:mylib/main.py", "imports");
    expect(edges.length).toBe(1);
    expect(edges[0].target).toBe("file:mylib/core.py");

    builder.close();
  });

  it("discovers specs and ADRs", async () => {
    mkdirSync(join(projectDir, "docs/spec"), { recursive: true });
    mkdirSync(join(projectDir, "docs/decisions"), { recursive: true });
    writeFileSync(
      join(projectDir, "docs/spec/LAYERS.md"),
      "---\nspec: layers\nstatus: complete\n---\n# Layers\n\nSee [[adr:0001]] for details.",
    );
    writeFileSync(
      join(projectDir, "docs/decisions/0001-unified-layers.md"),
      "---\nstatus: accepted\n---\n# ADR-0001: Unified Layers",
    );
    commitAll("init");

    const builder = new GraphBuilder("test", projectDir, contextDir);
    builder.register(new MarkdownDocAnalyzer());
    const result = await builder.build();

    expect(result.nodes).toBe(2);

    const db = builder.getDb();
    const edges = db.getEdgesFrom("spec:layers", "links_to");
    expect(edges.length).toBe(1);
    expect(edges[0].target).toBe("adr:0001");

    builder.close();
  });

  it("discovers tickets", async () => {
    mkdirSync(join(projectDir, ".tickets/impl/my-feature"), { recursive: true });
    writeFileSync(
      join(projectDir, ".tickets/impl/my-feature/README.md"),
      '---\nid: my-feature\ntitle: "My Feature"\nstatus: open\nlinks:\n  - docs/spec/LAYERS.md\ndemand:\n  - UC-001\n---\n# My Feature',
    );
    commitAll("init");

    const builder = new GraphBuilder("test", projectDir, contextDir);
    builder.register(new TicketAnalyzer());
    const result = await builder.build();

    expect(result.nodes).toBe(1);

    const db = builder.getDb();
    const node = db.getNode("ticket:my-feature");
    expect(node?.title).toBe("My Feature");
    expect(node?.status).toBe("open");

    const edges = db.getEdgesFrom("ticket:my-feature", "implements");
    expect(edges.some((e) => e.target === "spec:layers")).toBe(true);
    expect(edges.some((e) => e.target === "use_case:uc-001")).toBe(true);

    builder.close();
  });

  it("test files create tests edges", async () => {
    writeFileSync(join(projectDir, "package.json"), '{"name":"test"}');
    mkdirSync(join(projectDir, "src"), { recursive: true });
    mkdirSync(join(projectDir, "tests"), { recursive: true });
    writeFileSync(join(projectDir, "src/utils.ts"), "export function add(a: number, b: number) { return a + b; }");
    writeFileSync(
      join(projectDir, "tests/utils.test.ts"),
      'import { add } from "../src/utils.js";\nimport { describe, it, expect } from "vitest";\ndescribe("add", () => { it("works", () => { expect(add(1, 2)).toBe(3); }); });',
    );
    commitAll("init");

    const builder = new GraphBuilder("test", projectDir, contextDir);
    builder.register(new TypeScriptImportAnalyzer());
    const result = await builder.build();

    const db = builder.getDb();
    const testEdges = db.getEdgesFrom("file:tests/utils.test.ts", "tests");
    expect(testEdges.length).toBe(1);
    expect(testEdges[0].target).toBe("file:src/utils.ts");

    builder.close();
  });

  it("replays commit history", async () => {
    writeFileSync(join(projectDir, "file1.txt"), "hello");
    commitAll("first commit");

    writeFileSync(join(projectDir, "file2.txt"), "world");
    commitAll("second commit");

    const builder = new GraphBuilder("test", projectDir, contextDir);
    const result = await builder.replay();

    expect(result.commits).toBe(2);

    const db = builder.getDb();
    const replayCommits = db.getMeta("replay_commits");
    expect(replayCommits).toBe("2");

    builder.close();
  });

  it("full-text search works", async () => {
    writeFileSync(join(projectDir, "package.json"), '{"name":"test"}');
    mkdirSync(join(projectDir, "src"), { recursive: true });
    writeFileSync(join(projectDir, "src/authentication.ts"), "export class AuthService {}");
    commitAll("init");

    const builder = new GraphBuilder("test", projectDir, contextDir);
    builder.register(new TypeScriptImportAnalyzer());
    await builder.build();

    const db = builder.getDb();
    const results = db.search("authentication");
    expect(results.length).toBeGreaterThanOrEqual(1);
    expect(results[0].title).toBe("authentication");

    builder.close();
  });
});
