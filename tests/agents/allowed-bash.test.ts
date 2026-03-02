import { describe, it, expect } from "vitest";
import { deriveAllowedBashTools } from "../../packages/core/src/agents/allowed-bash.js";
import type { AllowedBashInput } from "../../packages/core/src/agents/allowed-bash.js";
import type { StackInfo, TestingConfig, LintConfig } from "@opcom/types";

function emptyStack(): StackInfo {
  return {
    languages: [],
    frameworks: [],
    packageManagers: [],
    infrastructure: [],
    versionManagers: [],
  };
}

function makeInput(overrides?: Partial<AllowedBashInput>): AllowedBashInput {
  return {
    stack: emptyStack(),
    testing: null,
    linting: [],
    ...overrides,
  };
}

describe("deriveAllowedBashTools", () => {
  it("always includes read-only git and filesystem commands", () => {
    const result = deriveAllowedBashTools(makeInput());
    expect(result).toContain("Bash(git status*)");
    expect(result).toContain("Bash(git diff*)");
    expect(result).toContain("Bash(git log*)");
    expect(result).toContain("Bash(git branch*)");
    expect(result).toContain("Bash(git show*)");
    expect(result).toContain("Bash(ls *)");
    expect(result).toContain("Bash(cat *)");
    expect(result).toContain("Bash(head *)");
    expect(result).toContain("Bash(tail *)");
    expect(result).toContain("Bash(find *)");
    expect(result).toContain("Bash(wc *)");
  });

  it("derives npm patterns from package manager", () => {
    const input = makeInput({
      stack: {
        ...emptyStack(),
        packageManagers: [{ name: "npm", sourceFile: "package-lock.json" }],
      },
    });
    const result = deriveAllowedBashTools(input);
    expect(result).toContain("Bash(npm test*)");
    expect(result).toContain("Bash(npm run *)");
    expect(result).toContain("Bash(npm install*)");
    expect(result).toContain("Bash(npm ci*)");
    expect(result).toContain("Bash(npx *)");
  });

  it("derives pnpm patterns from package manager", () => {
    const input = makeInput({
      stack: {
        ...emptyStack(),
        packageManagers: [{ name: "pnpm", sourceFile: "pnpm-lock.yaml" }],
      },
    });
    const result = deriveAllowedBashTools(input);
    expect(result).toContain("Bash(pnpm test*)");
    expect(result).toContain("Bash(pnpm run *)");
    expect(result).toContain("Bash(pnpm install*)");
    expect(result).toContain("Bash(pnpm exec *)");
  });

  it("derives yarn patterns from package manager", () => {
    const input = makeInput({
      stack: {
        ...emptyStack(),
        packageManagers: [{ name: "yarn", sourceFile: "yarn.lock" }],
      },
    });
    const result = deriveAllowedBashTools(input);
    expect(result).toContain("Bash(yarn test*)");
    expect(result).toContain("Bash(yarn run *)");
    expect(result).toContain("Bash(yarn install*)");
  });

  it("derives bun patterns from package manager", () => {
    const input = makeInput({
      stack: {
        ...emptyStack(),
        packageManagers: [{ name: "bun", sourceFile: "bun.lockb" }],
      },
    });
    const result = deriveAllowedBashTools(input);
    expect(result).toContain("Bash(bun test*)");
    expect(result).toContain("Bash(bun run *)");
    expect(result).toContain("Bash(bun install*)");
    expect(result).toContain("Bash(bunx *)");
  });

  it("derives pip/python patterns from pip", () => {
    const input = makeInput({
      stack: {
        ...emptyStack(),
        packageManagers: [{ name: "pip", sourceFile: "requirements.txt" }],
      },
    });
    const result = deriveAllowedBashTools(input);
    expect(result).toContain("Bash(pip install*)");
    expect(result).toContain("Bash(python -m *)");
  });

  it("derives poetry patterns from package manager", () => {
    const input = makeInput({
      stack: {
        ...emptyStack(),
        packageManagers: [{ name: "poetry", sourceFile: "poetry.lock" }],
      },
    });
    const result = deriveAllowedBashTools(input);
    expect(result).toContain("Bash(poetry run *)");
    expect(result).toContain("Bash(poetry install*)");
  });

  it("derives uv patterns from package manager", () => {
    const input = makeInput({
      stack: {
        ...emptyStack(),
        packageManagers: [{ name: "uv", sourceFile: "uv.lock" }],
      },
    });
    const result = deriveAllowedBashTools(input);
    expect(result).toContain("Bash(uv run *)");
    expect(result).toContain("Bash(uv sync*)");
  });

  it("derives Go patterns from language", () => {
    const input = makeInput({
      stack: {
        ...emptyStack(),
        languages: [{ name: "go", version: "1.22", sourceFile: "go.mod" }],
      },
    });
    const result = deriveAllowedBashTools(input);
    expect(result).toContain("Bash(go test*)");
    expect(result).toContain("Bash(go build*)");
    expect(result).toContain("Bash(go vet*)");
    expect(result).toContain("Bash(go mod *)");
  });

  it("derives Rust patterns from language", () => {
    const input = makeInput({
      stack: {
        ...emptyStack(),
        languages: [{ name: "rust", version: "1.75", sourceFile: "Cargo.toml" }],
      },
    });
    const result = deriveAllowedBashTools(input);
    expect(result).toContain("Bash(cargo test*)");
    expect(result).toContain("Bash(cargo build*)");
    expect(result).toContain("Bash(cargo check*)");
    expect(result).toContain("Bash(cargo clippy*)");
    expect(result).toContain("Bash(cargo fmt*)");
  });

  it("derives Ruby patterns from language", () => {
    const input = makeInput({
      stack: {
        ...emptyStack(),
        languages: [{ name: "ruby", version: "3.2", sourceFile: "Gemfile" }],
      },
    });
    const result = deriveAllowedBashTools(input);
    expect(result).toContain("Bash(bundle exec *)");
    expect(result).toContain("Bash(bundle install*)");
    expect(result).toContain("Bash(rake *)");
  });

  it("derives Java patterns from language", () => {
    const input = makeInput({
      stack: {
        ...emptyStack(),
        languages: [{ name: "java", version: "21", sourceFile: "pom.xml" }],
      },
    });
    const result = deriveAllowedBashTools(input);
    expect(result).toContain("Bash(mvn *)");
    expect(result).toContain("Bash(gradle *)");
    expect(result).toContain("Bash(./gradlew *)");
  });

  it("includes explicit test command from TestingConfig", () => {
    const input = makeInput({
      testing: { framework: "vitest", command: "npm test" },
    });
    const result = deriveAllowedBashTools(input);
    expect(result).toContain("Bash(npm test*)");
  });

  it("includes linter commands", () => {
    const input = makeInput({
      linting: [
        { name: "eslint", sourceFile: ".eslintrc.json" },
        { name: "prettier", sourceFile: ".prettierrc" },
      ],
    });
    const result = deriveAllowedBashTools(input);
    expect(result).toContain("Bash(eslint *)");
    expect(result).toContain("Bash(npx eslint *)");
    expect(result).toContain("Bash(prettier *)");
    expect(result).toContain("Bash(npx prettier *)");
  });

  it("includes biome, ruff, mypy, black linter patterns", () => {
    const input = makeInput({
      linting: [
        { name: "biome", sourceFile: "biome.json" },
        { name: "ruff", sourceFile: "ruff.toml" },
        { name: "mypy", sourceFile: "mypy.ini" },
        { name: "black", sourceFile: "pyproject.toml" },
      ],
    });
    const result = deriveAllowedBashTools(input);
    expect(result).toContain("Bash(biome *)");
    expect(result).toContain("Bash(ruff *)");
    expect(result).toContain("Bash(mypy *)");
    expect(result).toContain("Bash(black *)");
  });

  it("appends user-provided extra patterns", () => {
    const result = deriveAllowedBashTools(makeInput(), ["docker compose*", "make *"]);
    expect(result).toContain("Bash(docker compose*)");
    expect(result).toContain("Bash(make *)");
  });

  it("deduplicates patterns", () => {
    const input = makeInput({
      stack: {
        ...emptyStack(),
        packageManagers: [{ name: "npm", sourceFile: "package-lock.json" }],
      },
      testing: { framework: "vitest", command: "npm test" },
    });
    const result = deriveAllowedBashTools(input);
    // "npm test*" comes from both PM_PATTERNS and testing command — should appear only once
    const npmTestCount = result.filter((p) => p === "Bash(npm test*)").length;
    expect(npmTestCount).toBe(1);
  });

  it("all results match Bash(pattern) format", () => {
    const input = makeInput({
      stack: {
        ...emptyStack(),
        packageManagers: [{ name: "npm", sourceFile: "package-lock.json" }],
        languages: [{ name: "go", sourceFile: "go.mod" }],
      },
      testing: { framework: "vitest", command: "npm test" },
      linting: [{ name: "eslint", sourceFile: ".eslintrc.json" }],
    });
    const result = deriveAllowedBashTools(input, ["make *"]);
    for (const entry of result) {
      expect(entry).toMatch(/^Bash\(.+\)$/);
    }
  });

  it("handles multiple package managers simultaneously", () => {
    const input = makeInput({
      stack: {
        ...emptyStack(),
        packageManagers: [
          { name: "npm", sourceFile: "package-lock.json" },
          { name: "pip", sourceFile: "requirements.txt" },
        ],
      },
    });
    const result = deriveAllowedBashTools(input);
    expect(result).toContain("Bash(npm test*)");
    expect(result).toContain("Bash(pip install*)");
    expect(result).toContain("Bash(python -m *)");
  });
});
