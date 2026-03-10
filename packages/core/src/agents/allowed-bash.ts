/**
 * Derive allowed Bash tool patterns from a project's detected stack.
 *
 * Returns strings in "Bash(pattern)" format suitable for --allowedTools.
 */

import type { StackInfo, TestingConfig, LintConfig, AgentConstraint } from "@opcom/types";

export interface AllowedBashInput {
  stack: StackInfo;
  testing: TestingConfig | null;
  linting: LintConfig[];
}

/** Read-only commands that are always safe. */
const ALWAYS_SAFE = [
  "git status*",
  "git diff*",
  "git log*",
  "git branch*",
  "git show*",
  "git add*",
  "git commit*",
  "git stash*",
  "git checkout*",
  "git reset*",
  "git restore*",
  "ls *",
  "cat *",
  "head *",
  "tail *",
  "find *",
  "wc *",
];

/** Package manager → allowed command patterns. */
const PM_PATTERNS: Record<string, string[]> = {
  npm: ["npm test*", "npm run *", "npm install*", "npm ci*", "npx *"],
  pnpm: ["pnpm test*", "pnpm run *", "pnpm install*", "pnpm exec *"],
  yarn: ["yarn test*", "yarn run *", "yarn install*"],
  bun: ["bun test*", "bun run *", "bun install*", "bunx *"],
  pip: ["pip install*", "python -m *"],
  pipenv: ["pip install*", "python -m *"],
  poetry: ["poetry run *", "poetry install*"],
  uv: ["uv run *", "uv sync*"],
};

/** Language → allowed command patterns. */
const LANG_PATTERNS: Record<string, string[]> = {
  go: ["go test*", "go build*", "go vet*", "go mod *"],
  rust: ["cargo test*", "cargo build*", "cargo check*", "cargo clippy*", "cargo fmt*"],
  ruby: ["bundle exec *", "bundle install*", "rake *"],
  java: ["mvn *", "gradle *", "./gradlew *"],
};

/** Linter name → command patterns. */
const LINTER_PATTERNS: Record<string, string[]> = {
  eslint: ["eslint *", "npx eslint *"],
  prettier: ["prettier *", "npx prettier *"],
  biome: ["biome *", "npx biome *"],
  ruff: ["ruff *"],
  mypy: ["mypy *"],
  black: ["black *"],
  rubocop: ["rubocop *"],
  clippy: ["cargo clippy*"],
};

/**
 * Derive allowed Bash tool patterns from project stack info.
 *
 * @param input - Stack, testing, and linting configuration from the project
 * @param extraPatterns - User-provided additional patterns from OrchestratorConfig
 * @returns Array of strings in "Bash(pattern)" format
 */
export function deriveAllowedBashTools(
  input: AllowedBashInput,
  extraPatterns?: string[],
): string[] {
  const patterns = new Set<string>(ALWAYS_SAFE);

  // Package managers
  for (const pm of input.stack.packageManagers) {
    const key = pm.name.toLowerCase();
    const pmPatterns = PM_PATTERNS[key];
    if (pmPatterns) {
      for (const p of pmPatterns) patterns.add(p);
    }
  }

  // Languages
  for (const lang of input.stack.languages) {
    const key = lang.name.toLowerCase();
    const langPatterns = LANG_PATTERNS[key];
    if (langPatterns) {
      for (const p of langPatterns) patterns.add(p);
    }
  }

  // Explicit test command
  if (input.testing?.command) {
    patterns.add(input.testing.command + "*");
  }

  // Linters
  for (const lint of input.linting) {
    const key = lint.name.toLowerCase();
    const lintPatterns = LINTER_PATTERNS[key];
    if (lintPatterns) {
      for (const p of lintPatterns) patterns.add(p);
    }
  }

  // User-provided extras
  if (extraPatterns) {
    for (const p of extraPatterns) patterns.add(p);
  }

  // Wrap in Bash() format
  return Array.from(patterns).map((p) => `Bash(${p})`);
}

/**
 * Check a command against agent constraints for forbidden command warnings.
 *
 * Constraints whose name starts with "no-" or "forbidden-" are treated as
 * forbidden command rules. The constraint's `rule` field is matched as a
 * substring against the command. This is a soft check — produces warnings,
 * not hard blocks.
 *
 * @returns `{ forbidden: false }` if allowed, or `{ forbidden: true, constraint }` with the matching constraint.
 */
export function checkForbiddenCommand(
  command: string,
  constraints: AgentConstraint[] | undefined,
): { forbidden: boolean; constraint?: AgentConstraint } {
  if (!constraints || constraints.length === 0) return { forbidden: false };

  for (const constraint of constraints) {
    const lowerName = constraint.name.toLowerCase();
    if (!lowerName.startsWith("no-") && !lowerName.startsWith("forbidden-")) continue;

    // Match the rule text as a substring of the command
    if (command.includes(constraint.rule)) {
      return { forbidden: true, constraint };
    }
  }

  return { forbidden: false };
}
