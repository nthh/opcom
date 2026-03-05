import { defineConfig } from "vitest/config";
import { resolve } from "node:path";

export default defineConfig({
  resolve: {
    alias: {
      "@opcom/types": resolve(__dirname, "packages/types/src/index.ts"),
      "@opcom/core": resolve(__dirname, "packages/core/src/index.ts"),
      "@opcom/cli": resolve(__dirname, "packages/cli/src/index.ts"),
      "@opcom/context-graph": resolve(__dirname, "packages/context-graph/src/index.ts"),
    },
  },
  test: {
    include: ["packages/*/src/**/*.test.ts", "tests/**/*.test.ts"],
    testTimeout: 10_000,
  },
});
