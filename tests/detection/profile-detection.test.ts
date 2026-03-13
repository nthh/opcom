import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  detectProfileCommands,
  detectAgentConstraints,
  detectFieldMappings,
  detectProfile,
  mergeProfiles,
  parseMakefileTargets,
  parseJustfileRecipes,
  parseTaskfileTargets,
  mapTargetsToCommands,
  extractForbiddenCommands,
} from "@opcom/core";
import type { ProjectProfileConfig } from "@opcom/types";

let tmpDir: string;

beforeEach(async () => {
  tmpDir = await mkdtemp(join(tmpdir(), "profile-detect-"));
});

afterEach(async () => {
  await rm(tmpDir, { recursive: true, force: true });
});

// ===================================================================
// parseMakefileTargets
// ===================================================================
describe("parseMakefileTargets", () => {
  it("extracts target names from Makefile", () => {
    const content = `
.PHONY: test build deploy

test-smoke:
\t@echo "smoke"

test:
\t@echo "all tests"

build:
\tgo build ./...

deploy:
\tkubectl apply -f k8s/

lint:
\tgolangci-lint run
`;
    const targets = parseMakefileTargets(content);
    expect(targets).toContain("test-smoke");
    expect(targets).toContain("test");
    expect(targets).toContain("build");
    expect(targets).toContain("deploy");
    expect(targets).toContain("lint");
  });

  it("ignores .PHONY and non-target lines", () => {
    const content = `
.PHONY: all
\techo "indented"
# comment
VAR = value

all:
\techo done
`;
    const targets = parseMakefileTargets(content);
    expect(targets).toEqual(["all"]);
  });
});

// ===================================================================
// parseJustfileRecipes
// ===================================================================
describe("parseJustfileRecipes", () => {
  it("extracts recipe names from justfile", () => {
    const content = `
test:
  cargo test

build:
  cargo build --release

deploy env:
  kubectl apply -f k8s/
`;
    const recipes = parseJustfileRecipes(content);
    expect(recipes).toContain("test");
    expect(recipes).toContain("build");
    expect(recipes).toContain("deploy");
  });
});

// ===================================================================
// parseTaskfileTargets
// ===================================================================
describe("parseTaskfileTargets", () => {
  it("extracts task names from taskfile data", () => {
    const data = {
      version: "3",
      tasks: {
        test: { cmds: ["go test ./..."] },
        build: { cmds: ["go build ./..."] },
        lint: { cmds: ["golangci-lint run"] },
      },
    };
    const targets = parseTaskfileTargets(data);
    expect(targets).toContain("test");
    expect(targets).toContain("build");
    expect(targets).toContain("lint");
  });

  it("returns empty for missing tasks key", () => {
    expect(parseTaskfileTargets({ version: "3" })).toEqual([]);
  });
});

// ===================================================================
// mapTargetsToCommands
// ===================================================================
describe("mapTargetsToCommands", () => {
  it("maps smoke test → test, test → testFull", () => {
    const targets = ["test-smoke", "test", "build", "deploy", "lint"];
    const commands = mapTargetsToCommands(targets, "make");

    const test = commands.find((c) => c.name === "test");
    expect(test).toBeDefined();
    expect(test!.command).toBe("make test-smoke");
    expect(test!.description).toBe("fast test gate");

    const testFull = commands.find((c) => c.name === "testFull");
    expect(testFull).toBeDefined();
    expect(testFull!.command).toBe("make test");

    expect(commands.find((c) => c.name === "build")!.command).toBe("make build");
    expect(commands.find((c) => c.name === "deploy")!.command).toBe("make deploy");
    expect(commands.find((c) => c.name === "lint")!.command).toBe("make lint");
  });

  it("maps test → test when no smoke variant", () => {
    const targets = ["test", "build"];
    const commands = mapTargetsToCommands(targets, "npm run");

    expect(commands.find((c) => c.name === "test")!.command).toBe("npm run test");
    expect(commands.find((c) => c.name === "testFull")).toBeUndefined();
  });

  it("uses test:smoke colon variant", () => {
    const targets = ["test:smoke", "test:all"];
    const commands = mapTargetsToCommands(targets, "npm run");

    expect(commands.find((c) => c.name === "test")!.command).toBe("npm run test:smoke");
    expect(commands.find((c) => c.name === "testFull")!.command).toBe("npm run test:all");
  });

  it("maps check to lint", () => {
    const targets = ["check"];
    const commands = mapTargetsToCommands(targets, "make");

    expect(commands.find((c) => c.name === "lint")!.command).toBe("make check");
  });

  it("maps dev target to dev command", () => {
    const targets = ["test", "build", "dev"];
    const commands = mapTargetsToCommands(targets, "make");

    const dev = commands.find((c) => c.name === "dev");
    expect(dev).toBeDefined();
    expect(dev!.command).toBe("make dev");
    expect(dev!.description).toBe("dev environment startup");
  });

  it("maps start target to dev command", () => {
    const targets = ["test", "start"];
    const commands = mapTargetsToCommands(targets, "npm run");

    expect(commands.find((c) => c.name === "dev")!.command).toBe("npm run start");
  });

  it("maps serve target to dev command", () => {
    const targets = ["serve", "build"];
    const commands = mapTargetsToCommands(targets, "just");

    expect(commands.find((c) => c.name === "dev")!.command).toBe("just serve");
  });

  it("maps dev:start target to dev command", () => {
    const targets = ["test", "build", "dev:start"];
    const commands = mapTargetsToCommands(targets, "npm run");

    expect(commands.find((c) => c.name === "dev")!.command).toBe("npm run dev:start");
  });

  it("uses first matching dev target from targets list", () => {
    const targets = ["start", "serve", "dev"];
    const commands = mapTargetsToCommands(targets, "npm run");

    // find() returns the first match from the targets array
    expect(commands.find((c) => c.name === "dev")!.command).toBe("npm run start");
  });
});

// ===================================================================
// detectProfileCommands (integration)
// ===================================================================
describe("detectProfileCommands", () => {
  it("detects Makefile targets", async () => {
    await writeFile(join(tmpDir, "Makefile"), `
test-smoke:
\t@echo "smoke"

test:
\t@echo "full"

build:
\t@echo "build"
`);

    const { commands, evidence } = await detectProfileCommands(tmpDir);

    expect(commands.find((c) => c.name === "test")!.command).toBe("make test-smoke");
    expect(commands.find((c) => c.name === "testFull")!.command).toBe("make test");
    expect(commands.find((c) => c.name === "build")!.command).toBe("make build");
    expect(evidence).toHaveLength(1);
    expect(evidence[0].file).toBe("Makefile");
  });

  it("detects package.json scripts", async () => {
    await writeFile(
      join(tmpDir, "package.json"),
      JSON.stringify({ scripts: { test: "vitest run", build: "tsc", lint: "eslint ." } }),
    );

    const { commands } = await detectProfileCommands(tmpDir);

    expect(commands.find((c) => c.name === "test")!.command).toBe("npm run test");
    expect(commands.find((c) => c.name === "build")!.command).toBe("npm run build");
    expect(commands.find((c) => c.name === "lint")!.command).toBe("npm run lint");
  });

  it("prefers Makefile over package.json", async () => {
    await writeFile(join(tmpDir, "Makefile"), "test:\n\techo test\n");
    await writeFile(
      join(tmpDir, "package.json"),
      JSON.stringify({ scripts: { test: "vitest" } }),
    );

    const { commands } = await detectProfileCommands(tmpDir);
    expect(commands.find((c) => c.name === "test")!.command).toBe("make test");
  });

  it("detects justfile recipes", async () => {
    await writeFile(join(tmpDir, "justfile"), "test:\n  cargo test\n\nbuild:\n  cargo build\n");

    const { commands } = await detectProfileCommands(tmpDir);
    expect(commands.find((c) => c.name === "test")!.command).toBe("just test");
    expect(commands.find((c) => c.name === "build")!.command).toBe("just build");
  });

  it("detects dev target from Makefile", async () => {
    await writeFile(join(tmpDir, "Makefile"), `
dev:
\tdocker compose up

build:
\tgo build ./...
`);

    const { commands } = await detectProfileCommands(tmpDir);

    expect(commands.find((c) => c.name === "dev")!.command).toBe("make dev");
    expect(commands.find((c) => c.name === "build")!.command).toBe("make build");
  });

  it("detects dev script from package.json", async () => {
    await writeFile(
      join(tmpDir, "package.json"),
      JSON.stringify({ scripts: { dev: "vite", test: "vitest run", build: "tsc" } }),
    );

    const { commands } = await detectProfileCommands(tmpDir);

    expect(commands.find((c) => c.name === "dev")!.command).toBe("npm run dev");
  });

  it("detects start script from package.json", async () => {
    await writeFile(
      join(tmpDir, "package.json"),
      JSON.stringify({ scripts: { start: "node server.js", test: "jest" } }),
    );

    const { commands } = await detectProfileCommands(tmpDir);

    expect(commands.find((c) => c.name === "dev")!.command).toBe("npm run start");
  });

  it("detects serve recipe from justfile", async () => {
    await writeFile(join(tmpDir, "justfile"), "serve:\n  python -m http.server\n\nbuild:\n  make build\n");

    const { commands } = await detectProfileCommands(tmpDir);
    expect(commands.find((c) => c.name === "dev")!.command).toBe("just serve");
  });

  it("detects dev task from taskfile.yml", async () => {
    await writeFile(
      join(tmpDir, "taskfile.yml"),
      "version: '3'\ntasks:\n  dev:\n    cmds:\n      - docker compose up\n  build:\n    cmds:\n      - go build\n",
    );

    const { commands } = await detectProfileCommands(tmpDir);
    expect(commands.find((c) => c.name === "dev")!.command).toBe("task dev");
  });

  it("prefers Makefile dev over package.json dev", async () => {
    await writeFile(join(tmpDir, "Makefile"), "dev:\n\tdocker compose up\n");
    await writeFile(
      join(tmpDir, "package.json"),
      JSON.stringify({ scripts: { dev: "vite" } }),
    );

    const { commands } = await detectProfileCommands(tmpDir);
    expect(commands.find((c) => c.name === "dev")!.command).toBe("make dev");
  });

  it("detects dev:start from package.json scripts", async () => {
    await writeFile(
      join(tmpDir, "package.json"),
      JSON.stringify({ scripts: { "dev:start": "concurrently 'tsc -w' 'vite'", build: "tsc" } }),
    );

    const { commands } = await detectProfileCommands(tmpDir);
    expect(commands.find((c) => c.name === "dev")!.command).toBe("npm run dev:start");
  });

  it("returns empty for project with no build system", async () => {
    const { commands, evidence } = await detectProfileCommands(tmpDir);
    expect(commands).toEqual([]);
    expect(evidence).toEqual([]);
  });
});

// ===================================================================
// extractForbiddenCommands
// ===================================================================
describe("extractForbiddenCommands", () => {
  it("extracts NEVER run patterns", () => {
    const content = `
## Rules
- NEVER run \`git reset --hard\`
- NEVER run \`git push --force\`
- Always write tests
`;
    const forbidden = extractForbiddenCommands(content);
    expect(forbidden).toContain("git reset --hard");
    expect(forbidden).toContain("git push --force");
  });

  it("extracts do NOT patterns", () => {
    const content = "do NOT use `rm -rf /`\ndo NOT run `git stash`";
    const forbidden = extractForbiddenCommands(content);
    expect(forbidden).toContain("rm -rf /");
    expect(forbidden).toContain("git stash");
  });

  it("extracts lowercase never patterns", () => {
    const content = "never run `sudo rm -rf`";
    const forbidden = extractForbiddenCommands(content);
    expect(forbidden).toContain("sudo rm -rf");
  });

  it("deduplicates results", () => {
    const content = "NEVER run `git reset`\nNEVER `git reset`";
    const forbidden = extractForbiddenCommands(content);
    expect(forbidden.filter((f) => f === "git reset")).toHaveLength(1);
  });

  it("returns empty for content without forbidden patterns", () => {
    const content = "## Development\nUse TypeScript strict mode.";
    expect(extractForbiddenCommands(content)).toEqual([]);
  });
});

// ===================================================================
// detectAgentConstraints (integration)
// ===================================================================
describe("detectAgentConstraints", () => {
  it("extracts constraints from AGENTS.md", async () => {
    await writeFile(
      join(tmpDir, "AGENTS.md"),
      `# Agent Rules

## Git
- NEVER run \`git reset\`
- NEVER run \`git stash\`
- ALWAYS create new commits

## Conventions
- MUST write tests for all changes
- IMPORTANT: Follow TypeScript strict mode
`,
    );

    const { constraints, evidence } = await detectAgentConstraints(tmpDir, "AGENTS.md");

    expect(constraints.length).toBeGreaterThanOrEqual(1);
    const forbidden = constraints.find((c) => c.name === "forbidden-commands");
    expect(forbidden).toBeDefined();
    expect(forbidden!.rule).toContain("git reset");
    expect(forbidden!.rule).toContain("git stash");
    expect(evidence).toHaveLength(1);
  });

  it("extracts git section rules", async () => {
    await writeFile(
      join(tmpDir, "AGENTS.md"),
      `## Git
- ALWAYS create new commits rather than amending
`,
    );

    const { constraints } = await detectAgentConstraints(tmpDir, "AGENTS.md");
    const commitRules = constraints.find((c) => c.name === "commit-rules");
    expect(commitRules).toBeDefined();
    expect(commitRules!.rule).toContain("ALWAYS");
  });

  it("returns empty when no agent config", async () => {
    const { constraints } = await detectAgentConstraints(tmpDir, undefined);
    expect(constraints).toEqual([]);
  });

  it("returns empty for non-existent file", async () => {
    const { constraints } = await detectAgentConstraints(tmpDir, "AGENTS.md");
    expect(constraints).toEqual([]);
  });
});

// ===================================================================
// detectFieldMappings (integration)
// ===================================================================
describe("detectFieldMappings", () => {
  it("detects use-case fields from UC-* patterns", async () => {
    const ticketDir = join(tmpDir, ".tickets", "impl");
    await mkdir(ticketDir, { recursive: true });

    // Create 4 tickets, 3 with demand field (75% > 25% threshold)
    for (let i = 1; i <= 4; i++) {
      const dir = join(ticketDir, `ticket-${i}`);
      await mkdir(dir);
      const demand = i <= 3 ? `\ndemand:\n  - UC-00${i}` : "";
      await writeFile(
        join(dir, "README.md"),
        `---\nid: ticket-${i}\ntitle: Ticket ${i}\nstatus: open${demand}\n---\n`,
      );
    }

    const { mappings } = await detectFieldMappings(tmpDir, ".tickets/impl");

    const demandMapping = mappings.find((m) => m.field === "demand");
    expect(demandMapping).toBeDefined();
    expect(demandMapping!.type).toBe("use-case");
    expect(demandMapping!.targetPath).toBe("docs/use-cases/");
  });

  it("detects tag fields from array patterns", async () => {
    const ticketDir = join(tmpDir, ".tickets", "impl");
    await mkdir(ticketDir, { recursive: true });

    for (let i = 1; i <= 4; i++) {
      const dir = join(ticketDir, `ticket-${i}`);
      await mkdir(dir);
      await writeFile(
        join(dir, "README.md"),
        `---\nid: ticket-${i}\ntitle: Ticket ${i}\nstatus: open\ndomains:\n  - frontend\n  - backend\n---\n`,
      );
    }

    const { mappings } = await detectFieldMappings(tmpDir, ".tickets/impl");

    const domainsMapping = mappings.find((m) => m.field === "domains");
    expect(domainsMapping).toBeDefined();
    expect(domainsMapping!.type).toBe("tag");
  });

  it("ignores fields appearing in <25% of tickets", async () => {
    const ticketDir = join(tmpDir, ".tickets", "impl");
    await mkdir(ticketDir, { recursive: true });

    // Create 8 tickets, only 1 has the rare field (12.5% < 25%)
    for (let i = 1; i <= 8; i++) {
      const dir = join(ticketDir, `ticket-${i}`);
      await mkdir(dir);
      const rare = i === 1 ? "\nrare-field:\n  - UC-001" : "";
      await writeFile(
        join(dir, "README.md"),
        `---\nid: ticket-${i}\ntitle: Ticket ${i}\nstatus: open${rare}\n---\n`,
      );
    }

    const { mappings } = await detectFieldMappings(tmpDir, ".tickets/impl");
    expect(mappings.find((m) => m.field === "rare-field")).toBeUndefined();
  });

  it("ignores standard keys", async () => {
    const ticketDir = join(tmpDir, ".tickets", "impl");
    await mkdir(ticketDir, { recursive: true });

    for (let i = 1; i <= 4; i++) {
      const dir = join(ticketDir, `ticket-${i}`);
      await mkdir(dir);
      await writeFile(
        join(dir, "README.md"),
        `---\nid: ticket-${i}\ntitle: Ticket ${i}\nstatus: open\npriority: 2\n---\n`,
      );
    }

    const { mappings } = await detectFieldMappings(tmpDir, ".tickets/impl");
    expect(mappings.find((m) => m.field === "status")).toBeUndefined();
    expect(mappings.find((m) => m.field === "priority")).toBeUndefined();
  });

  it("returns empty for no ticket directory", async () => {
    const { mappings } = await detectFieldMappings(tmpDir, ".tickets/impl");
    expect(mappings).toEqual([]);
  });

  it("returns empty when ticketDir is undefined", async () => {
    const { mappings } = await detectFieldMappings(tmpDir, undefined);
    expect(mappings).toEqual([]);
  });
});

// ===================================================================
// detectProfile (combined)
// ===================================================================
describe("detectProfile", () => {
  it("combines all three detectors", async () => {
    // Set up Makefile
    await writeFile(join(tmpDir, "Makefile"), "test:\n\techo test\nbuild:\n\techo build\n");

    // Set up AGENTS.md
    await writeFile(join(tmpDir, "AGENTS.md"), "## Rules\n- NEVER run `git stash`\n");

    // Set up tickets
    const ticketDir = join(tmpDir, ".tickets", "impl");
    await mkdir(ticketDir, { recursive: true });
    for (let i = 1; i <= 4; i++) {
      const dir = join(ticketDir, `ticket-${i}`);
      await mkdir(dir);
      await writeFile(
        join(dir, "README.md"),
        `---\nid: ticket-${i}\ntitle: Ticket ${i}\nstatus: open\ndomains:\n  - core\n---\n`,
      );
    }

    const result = await detectProfile(tmpDir, "AGENTS.md", ".tickets/impl");

    expect(result.profile.commands).toBeDefined();
    expect(result.profile.commands!.length).toBeGreaterThan(0);
    expect(result.profile.agentConstraints).toBeDefined();
    expect(result.profile.fieldMappings).toBeDefined();
    expect(result.evidence.length).toBeGreaterThan(0);
  });

  it("returns empty profile when nothing detected", async () => {
    const result = await detectProfile(tmpDir);
    expect(Object.keys(result.profile)).toHaveLength(0);
    expect(result.evidence).toEqual([]);
  });
});

// ===================================================================
// mergeProfiles
// ===================================================================
describe("mergeProfiles", () => {
  it("returns detected profile when no existing profile", () => {
    const detected: Partial<ProjectProfileConfig> = {
      commands: [{ name: "test", command: "make test" }],
    };
    const merged = mergeProfiles(undefined, detected);
    expect(merged).toEqual(detected);
  });

  it("preserves existing profile fields", () => {
    const existing: ProjectProfileConfig = {
      commands: [{ name: "test", command: "custom test" }],
    };
    const detected: Partial<ProjectProfileConfig> = {
      commands: [{ name: "test", command: "make test" }],
      agentConstraints: [{ name: "no-force", rule: "never force push" }],
    };
    const merged = mergeProfiles(existing, detected);

    // Existing commands preserved
    expect(merged!.commands![0].command).toBe("custom test");
    // Detected constraints filled in
    expect(merged!.agentConstraints).toEqual(detected.agentConstraints);
  });

  it("fills absent fields without overwriting", () => {
    const existing: ProjectProfileConfig = {
      commands: [{ name: "build", command: "npm run build" }],
      // no fieldMappings or agentConstraints
    };
    const detected: Partial<ProjectProfileConfig> = {
      commands: [{ name: "test", command: "make test" }],
      fieldMappings: [{ field: "demand", type: "use-case" }],
      agentConstraints: [{ name: "rules", rule: "test first" }],
    };
    const merged = mergeProfiles(existing, detected);

    // commands NOT overwritten
    expect(merged!.commands![0].command).toBe("npm run build");
    // absent fields filled
    expect(merged!.fieldMappings).toEqual(detected.fieldMappings);
    expect(merged!.agentConstraints).toEqual(detected.agentConstraints);
  });

  it("returns undefined when both are empty", () => {
    expect(mergeProfiles(undefined, {})).toBeUndefined();
  });

  it("returns existing when detected is empty", () => {
    const existing: ProjectProfileConfig = {
      commands: [{ name: "test", command: "npm test" }],
    };
    expect(mergeProfiles(existing, {})).toEqual(existing);
  });
});
