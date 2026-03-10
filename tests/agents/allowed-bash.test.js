"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const allowed_bash_js_1 = require("../../packages/core/src/agents/allowed-bash.js");
function emptyStack() {
    return {
        languages: [],
        frameworks: [],
        packageManagers: [],
        infrastructure: [],
        versionManagers: [],
    };
}
function makeInput(overrides) {
    return {
        stack: emptyStack(),
        testing: null,
        linting: [],
        ...overrides,
    };
}
(0, vitest_1.describe)("deriveAllowedBashTools", () => {
    (0, vitest_1.it)("always includes read-only git and filesystem commands", () => {
        const result = (0, allowed_bash_js_1.deriveAllowedBashTools)(makeInput());
        (0, vitest_1.expect)(result).toContain("Bash(git status*)");
        (0, vitest_1.expect)(result).toContain("Bash(git diff*)");
        (0, vitest_1.expect)(result).toContain("Bash(git log*)");
        (0, vitest_1.expect)(result).toContain("Bash(git branch*)");
        (0, vitest_1.expect)(result).toContain("Bash(git show*)");
        (0, vitest_1.expect)(result).toContain("Bash(ls *)");
        (0, vitest_1.expect)(result).toContain("Bash(cat *)");
        (0, vitest_1.expect)(result).toContain("Bash(head *)");
        (0, vitest_1.expect)(result).toContain("Bash(tail *)");
        (0, vitest_1.expect)(result).toContain("Bash(find *)");
        (0, vitest_1.expect)(result).toContain("Bash(wc *)");
    });
    (0, vitest_1.it)("derives npm patterns from package manager", () => {
        const input = makeInput({
            stack: {
                ...emptyStack(),
                packageManagers: [{ name: "npm", sourceFile: "package-lock.json" }],
            },
        });
        const result = (0, allowed_bash_js_1.deriveAllowedBashTools)(input);
        (0, vitest_1.expect)(result).toContain("Bash(npm test*)");
        (0, vitest_1.expect)(result).toContain("Bash(npm run *)");
        (0, vitest_1.expect)(result).toContain("Bash(npm install*)");
        (0, vitest_1.expect)(result).toContain("Bash(npm ci*)");
        (0, vitest_1.expect)(result).toContain("Bash(npx *)");
    });
    (0, vitest_1.it)("derives pnpm patterns from package manager", () => {
        const input = makeInput({
            stack: {
                ...emptyStack(),
                packageManagers: [{ name: "pnpm", sourceFile: "pnpm-lock.yaml" }],
            },
        });
        const result = (0, allowed_bash_js_1.deriveAllowedBashTools)(input);
        (0, vitest_1.expect)(result).toContain("Bash(pnpm test*)");
        (0, vitest_1.expect)(result).toContain("Bash(pnpm run *)");
        (0, vitest_1.expect)(result).toContain("Bash(pnpm install*)");
        (0, vitest_1.expect)(result).toContain("Bash(pnpm exec *)");
    });
    (0, vitest_1.it)("derives yarn patterns from package manager", () => {
        const input = makeInput({
            stack: {
                ...emptyStack(),
                packageManagers: [{ name: "yarn", sourceFile: "yarn.lock" }],
            },
        });
        const result = (0, allowed_bash_js_1.deriveAllowedBashTools)(input);
        (0, vitest_1.expect)(result).toContain("Bash(yarn test*)");
        (0, vitest_1.expect)(result).toContain("Bash(yarn run *)");
        (0, vitest_1.expect)(result).toContain("Bash(yarn install*)");
    });
    (0, vitest_1.it)("derives bun patterns from package manager", () => {
        const input = makeInput({
            stack: {
                ...emptyStack(),
                packageManagers: [{ name: "bun", sourceFile: "bun.lockb" }],
            },
        });
        const result = (0, allowed_bash_js_1.deriveAllowedBashTools)(input);
        (0, vitest_1.expect)(result).toContain("Bash(bun test*)");
        (0, vitest_1.expect)(result).toContain("Bash(bun run *)");
        (0, vitest_1.expect)(result).toContain("Bash(bun install*)");
        (0, vitest_1.expect)(result).toContain("Bash(bunx *)");
    });
    (0, vitest_1.it)("derives pip/python patterns from pip", () => {
        const input = makeInput({
            stack: {
                ...emptyStack(),
                packageManagers: [{ name: "pip", sourceFile: "requirements.txt" }],
            },
        });
        const result = (0, allowed_bash_js_1.deriveAllowedBashTools)(input);
        (0, vitest_1.expect)(result).toContain("Bash(pip install*)");
        (0, vitest_1.expect)(result).toContain("Bash(python -m *)");
    });
    (0, vitest_1.it)("derives poetry patterns from package manager", () => {
        const input = makeInput({
            stack: {
                ...emptyStack(),
                packageManagers: [{ name: "poetry", sourceFile: "poetry.lock" }],
            },
        });
        const result = (0, allowed_bash_js_1.deriveAllowedBashTools)(input);
        (0, vitest_1.expect)(result).toContain("Bash(poetry run *)");
        (0, vitest_1.expect)(result).toContain("Bash(poetry install*)");
    });
    (0, vitest_1.it)("derives uv patterns from package manager", () => {
        const input = makeInput({
            stack: {
                ...emptyStack(),
                packageManagers: [{ name: "uv", sourceFile: "uv.lock" }],
            },
        });
        const result = (0, allowed_bash_js_1.deriveAllowedBashTools)(input);
        (0, vitest_1.expect)(result).toContain("Bash(uv run *)");
        (0, vitest_1.expect)(result).toContain("Bash(uv sync*)");
    });
    (0, vitest_1.it)("derives Go patterns from language", () => {
        const input = makeInput({
            stack: {
                ...emptyStack(),
                languages: [{ name: "go", version: "1.22", sourceFile: "go.mod" }],
            },
        });
        const result = (0, allowed_bash_js_1.deriveAllowedBashTools)(input);
        (0, vitest_1.expect)(result).toContain("Bash(go test*)");
        (0, vitest_1.expect)(result).toContain("Bash(go build*)");
        (0, vitest_1.expect)(result).toContain("Bash(go vet*)");
        (0, vitest_1.expect)(result).toContain("Bash(go mod *)");
    });
    (0, vitest_1.it)("derives Rust patterns from language", () => {
        const input = makeInput({
            stack: {
                ...emptyStack(),
                languages: [{ name: "rust", version: "1.75", sourceFile: "Cargo.toml" }],
            },
        });
        const result = (0, allowed_bash_js_1.deriveAllowedBashTools)(input);
        (0, vitest_1.expect)(result).toContain("Bash(cargo test*)");
        (0, vitest_1.expect)(result).toContain("Bash(cargo build*)");
        (0, vitest_1.expect)(result).toContain("Bash(cargo check*)");
        (0, vitest_1.expect)(result).toContain("Bash(cargo clippy*)");
        (0, vitest_1.expect)(result).toContain("Bash(cargo fmt*)");
    });
    (0, vitest_1.it)("derives Ruby patterns from language", () => {
        const input = makeInput({
            stack: {
                ...emptyStack(),
                languages: [{ name: "ruby", version: "3.2", sourceFile: "Gemfile" }],
            },
        });
        const result = (0, allowed_bash_js_1.deriveAllowedBashTools)(input);
        (0, vitest_1.expect)(result).toContain("Bash(bundle exec *)");
        (0, vitest_1.expect)(result).toContain("Bash(bundle install*)");
        (0, vitest_1.expect)(result).toContain("Bash(rake *)");
    });
    (0, vitest_1.it)("derives Java patterns from language", () => {
        const input = makeInput({
            stack: {
                ...emptyStack(),
                languages: [{ name: "java", version: "21", sourceFile: "pom.xml" }],
            },
        });
        const result = (0, allowed_bash_js_1.deriveAllowedBashTools)(input);
        (0, vitest_1.expect)(result).toContain("Bash(mvn *)");
        (0, vitest_1.expect)(result).toContain("Bash(gradle *)");
        (0, vitest_1.expect)(result).toContain("Bash(./gradlew *)");
    });
    (0, vitest_1.it)("includes explicit test command from TestingConfig", () => {
        const input = makeInput({
            testing: { framework: "vitest", command: "npm test" },
        });
        const result = (0, allowed_bash_js_1.deriveAllowedBashTools)(input);
        (0, vitest_1.expect)(result).toContain("Bash(npm test*)");
    });
    (0, vitest_1.it)("includes linter commands", () => {
        const input = makeInput({
            linting: [
                { name: "eslint", sourceFile: ".eslintrc.json" },
                { name: "prettier", sourceFile: ".prettierrc" },
            ],
        });
        const result = (0, allowed_bash_js_1.deriveAllowedBashTools)(input);
        (0, vitest_1.expect)(result).toContain("Bash(eslint *)");
        (0, vitest_1.expect)(result).toContain("Bash(npx eslint *)");
        (0, vitest_1.expect)(result).toContain("Bash(prettier *)");
        (0, vitest_1.expect)(result).toContain("Bash(npx prettier *)");
    });
    (0, vitest_1.it)("includes biome, ruff, mypy, black linter patterns", () => {
        const input = makeInput({
            linting: [
                { name: "biome", sourceFile: "biome.json" },
                { name: "ruff", sourceFile: "ruff.toml" },
                { name: "mypy", sourceFile: "mypy.ini" },
                { name: "black", sourceFile: "pyproject.toml" },
            ],
        });
        const result = (0, allowed_bash_js_1.deriveAllowedBashTools)(input);
        (0, vitest_1.expect)(result).toContain("Bash(biome *)");
        (0, vitest_1.expect)(result).toContain("Bash(ruff *)");
        (0, vitest_1.expect)(result).toContain("Bash(mypy *)");
        (0, vitest_1.expect)(result).toContain("Bash(black *)");
    });
    (0, vitest_1.it)("appends user-provided extra patterns", () => {
        const result = (0, allowed_bash_js_1.deriveAllowedBashTools)(makeInput(), ["docker compose*", "make *"]);
        (0, vitest_1.expect)(result).toContain("Bash(docker compose*)");
        (0, vitest_1.expect)(result).toContain("Bash(make *)");
    });
    (0, vitest_1.it)("deduplicates patterns", () => {
        const input = makeInput({
            stack: {
                ...emptyStack(),
                packageManagers: [{ name: "npm", sourceFile: "package-lock.json" }],
            },
            testing: { framework: "vitest", command: "npm test" },
        });
        const result = (0, allowed_bash_js_1.deriveAllowedBashTools)(input);
        // "npm test*" comes from both PM_PATTERNS and testing command — should appear only once
        const npmTestCount = result.filter((p) => p === "Bash(npm test*)").length;
        (0, vitest_1.expect)(npmTestCount).toBe(1);
    });
    (0, vitest_1.it)("all results match Bash(pattern) format", () => {
        const input = makeInput({
            stack: {
                ...emptyStack(),
                packageManagers: [{ name: "npm", sourceFile: "package-lock.json" }],
                languages: [{ name: "go", sourceFile: "go.mod" }],
            },
            testing: { framework: "vitest", command: "npm test" },
            linting: [{ name: "eslint", sourceFile: ".eslintrc.json" }],
        });
        const result = (0, allowed_bash_js_1.deriveAllowedBashTools)(input, ["make *"]);
        for (const entry of result) {
            (0, vitest_1.expect)(entry).toMatch(/^Bash\(.+\)$/);
        }
    });
    (0, vitest_1.it)("handles multiple package managers simultaneously", () => {
        const input = makeInput({
            stack: {
                ...emptyStack(),
                packageManagers: [
                    { name: "npm", sourceFile: "package-lock.json" },
                    { name: "pip", sourceFile: "requirements.txt" },
                ],
            },
        });
        const result = (0, allowed_bash_js_1.deriveAllowedBashTools)(input);
        (0, vitest_1.expect)(result).toContain("Bash(npm test*)");
        (0, vitest_1.expect)(result).toContain("Bash(pip install*)");
        (0, vitest_1.expect)(result).toContain("Bash(python -m *)");
    });
});
//# sourceMappingURL=allowed-bash.test.js.map