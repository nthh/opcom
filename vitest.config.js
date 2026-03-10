"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const config_1 = require("vitest/config");
const node_path_1 = require("node:path");
exports.default = (0, config_1.defineConfig)({
    resolve: {
        alias: {
            "@opcom/types": (0, node_path_1.resolve)(__dirname, "packages/types/src/index.ts"),
            "@opcom/core": (0, node_path_1.resolve)(__dirname, "packages/core/src/index.ts"),
            "@opcom/cli": (0, node_path_1.resolve)(__dirname, "packages/cli/src/index.ts"),
            "@opcom/context-graph": (0, node_path_1.resolve)(__dirname, "packages/context-graph/src/index.ts"),
        },
    },
    test: {
        include: ["packages/*/src/**/*.test.ts", "tests/**/*.test.ts"],
        testTimeout: 10_000,
    },
});
//# sourceMappingURL=vitest.config.js.map