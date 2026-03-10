"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const stack_detail_js_1 = require("../../packages/cli/src/tui/views/stack-detail.js");
const project_detail_js_1 = require("../../packages/cli/src/tui/views/project-detail.js");
const renderer_js_1 = require("../../packages/cli/src/tui/renderer.js");
function makeConfig(overrides = {}) {
    return {
        id: "proj-1",
        name: "testproject",
        path: "/tmp/testproject",
        stack: {
            languages: [
                { name: "TypeScript", version: "5.3.3", sourceFile: "package.json" },
            ],
            frameworks: [
                { name: "React", version: "18.2.0", sourceFile: "package.json" },
                { name: "Vite", version: "5.0.0", sourceFile: "vite.config.ts" },
            ],
            infrastructure: [
                { name: "Docker", sourceFile: "Dockerfile" },
            ],
            packageManagers: [
                { name: "npm", sourceFile: "package-lock.json" },
            ],
            versionManagers: [
                { name: "mise", sourceFile: ".mise.toml" },
            ],
        },
        git: null,
        workSystem: null,
        docs: {},
        services: [
            { name: "api", port: 3000 },
            { name: "worker" },
        ],
        environments: [],
        testing: { framework: "vitest", command: "npx vitest run", testDir: "tests/" },
        linting: [
            { name: "eslint", sourceFile: ".eslintrc.json" },
        ],
        subProjects: [],
        cloudServices: [],
        lastScannedAt: "2026-03-01T00:00:00Z",
        ...overrides,
    };
}
function makeInfraResources() {
    return [
        {
            id: "default/api-pod-1",
            projectId: "proj-1",
            provider: "kubernetes",
            kind: "pod",
            name: "api-pod-1",
            namespace: "default",
            status: "healthy",
            age: "2026-03-01T00:00:00Z",
        },
        {
            id: "default/api-svc",
            projectId: "proj-1",
            provider: "kubernetes",
            kind: "service",
            name: "api-svc",
            namespace: "default",
            status: "healthy",
            age: "2026-03-01T00:00:00Z",
        },
    ];
}
(0, vitest_1.describe)("buildStackItemList", () => {
    (0, vitest_1.it)("builds flat list from config", () => {
        const config = makeConfig();
        const items = (0, stack_detail_js_1.buildStackItemList)(config);
        (0, vitest_1.expect)(items.length).toBe(9); // 1 lang + 2 fw + 1 infra + 1 pm + 1 vm + 1 testing + 2 services
    });
    (0, vitest_1.it)("includes languages with category", () => {
        const config = makeConfig();
        const items = (0, stack_detail_js_1.buildStackItemList)(config);
        const ts = items.find((i) => i.name === "TypeScript");
        (0, vitest_1.expect)(ts).toBeDefined();
        (0, vitest_1.expect)(ts.category).toBe("language");
        (0, vitest_1.expect)(ts.version).toBe("5.3.3");
        (0, vitest_1.expect)(ts.sourceFile).toBe("package.json");
    });
    (0, vitest_1.it)("includes frameworks", () => {
        const config = makeConfig();
        const items = (0, stack_detail_js_1.buildStackItemList)(config);
        const react = items.find((i) => i.name === "React");
        (0, vitest_1.expect)(react).toBeDefined();
        (0, vitest_1.expect)(react.category).toBe("framework");
        (0, vitest_1.expect)(react.version).toBe("18.2.0");
    });
    (0, vitest_1.it)("includes infrastructure", () => {
        const config = makeConfig();
        const items = (0, stack_detail_js_1.buildStackItemList)(config);
        const docker = items.find((i) => i.name === "Docker");
        (0, vitest_1.expect)(docker).toBeDefined();
        (0, vitest_1.expect)(docker.category).toBe("infrastructure");
    });
    (0, vitest_1.it)("includes package managers", () => {
        const config = makeConfig();
        const items = (0, stack_detail_js_1.buildStackItemList)(config);
        const npm = items.find((i) => i.name === "npm");
        (0, vitest_1.expect)(npm).toBeDefined();
        (0, vitest_1.expect)(npm.category).toBe("package-manager");
    });
    (0, vitest_1.it)("includes version managers", () => {
        const config = makeConfig();
        const items = (0, stack_detail_js_1.buildStackItemList)(config);
        const mise = items.find((i) => i.name === "mise");
        (0, vitest_1.expect)(mise).toBeDefined();
        (0, vitest_1.expect)(mise.category).toBe("version-manager");
    });
    (0, vitest_1.it)("includes testing framework", () => {
        const config = makeConfig();
        const items = (0, stack_detail_js_1.buildStackItemList)(config);
        const vitest = items.find((i) => i.name === "vitest");
        (0, vitest_1.expect)(vitest).toBeDefined();
        (0, vitest_1.expect)(vitest.category).toBe("testing");
    });
    (0, vitest_1.it)("includes services with ports", () => {
        const config = makeConfig();
        const items = (0, stack_detail_js_1.buildStackItemList)(config);
        const api = items.find((i) => i.name === "api");
        (0, vitest_1.expect)(api).toBeDefined();
        (0, vitest_1.expect)(api.category).toBe("service");
        (0, vitest_1.expect)(api.port).toBe(3000);
    });
    (0, vitest_1.it)("returns empty list when stack is empty", () => {
        const config = makeConfig({
            stack: {
                languages: [],
                frameworks: [],
                infrastructure: [],
                packageManagers: [],
                versionManagers: [],
            },
            testing: null,
            services: [],
        });
        const items = (0, stack_detail_js_1.buildStackItemList)(config);
        (0, vitest_1.expect)(items.length).toBe(0);
    });
});
(0, vitest_1.describe)("getStackList / getPanelItemCount integration", () => {
    (0, vitest_1.it)("returns stack items for panel 3", () => {
        const project = {
            id: "proj-1",
            name: "testproject",
            path: "/tmp/testproject",
            status: "scanned",
            lastScannedAt: "2026-03-01T00:00:00Z",
        };
        const state = (0, project_detail_js_1.createProjectDetailState)(project);
        state.projectConfig = makeConfig();
        const items = (0, project_detail_js_1.getStackList)(state);
        (0, vitest_1.expect)(items.length).toBe(9);
        (0, vitest_1.expect)((0, project_detail_js_1.getPanelItemCount)(state, 3)).toBe(9);
    });
    (0, vitest_1.it)("returns 0 when no config loaded", () => {
        const project = {
            id: "proj-1",
            name: "testproject",
            path: "/tmp/testproject",
            status: "scanned",
            lastScannedAt: "2026-03-01T00:00:00Z",
        };
        const state = (0, project_detail_js_1.createProjectDetailState)(project);
        // projectConfig is null by default
        (0, vitest_1.expect)((0, project_detail_js_1.getStackList)(state).length).toBe(0);
        (0, vitest_1.expect)((0, project_detail_js_1.getPanelItemCount)(state, 3)).toBe(0);
    });
});
(0, vitest_1.describe)("createStackDetailState", () => {
    (0, vitest_1.it)("creates initial state", () => {
        const item = {
            name: "TypeScript",
            category: "language",
            version: "5.3.3",
            sourceFile: "package.json",
        };
        const config = makeConfig();
        const state = (0, stack_detail_js_1.createStackDetailState)(item, "testproject", config, []);
        (0, vitest_1.expect)(state.item).toBe(item);
        (0, vitest_1.expect)(state.projectName).toBe("testproject");
        (0, vitest_1.expect)(state.projectConfig).toBe(config);
        (0, vitest_1.expect)(state.scrollOffset).toBe(0);
        (0, vitest_1.expect)(state.totalLines).toBe(0);
    });
});
(0, vitest_1.describe)("renderStackDetail", () => {
    (0, vitest_1.it)("renders without error", () => {
        const item = {
            name: "TypeScript",
            category: "language",
            version: "5.3.3",
            sourceFile: "package.json",
        };
        const config = makeConfig();
        const state = (0, stack_detail_js_1.createStackDetailState)(item, "testproject", config, []);
        const buf = new renderer_js_1.ScreenBuffer(80, 24);
        const panel = { x: 0, y: 0, width: 80, height: 24 };
        (0, vitest_1.expect)(() => (0, stack_detail_js_1.renderStackDetail)(buf, panel, state)).not.toThrow();
    });
    (0, vitest_1.it)("populates totalLines after render", () => {
        const item = {
            name: "TypeScript",
            category: "language",
            version: "5.3.3",
            sourceFile: "package.json",
        };
        const config = makeConfig();
        const state = (0, stack_detail_js_1.createStackDetailState)(item, "testproject", config, []);
        const buf = new renderer_js_1.ScreenBuffer(80, 24);
        const panel = { x: 0, y: 0, width: 80, height: 24 };
        (0, stack_detail_js_1.renderStackDetail)(buf, panel, state);
        (0, vitest_1.expect)(state.totalLines).toBeGreaterThan(0);
    });
    (0, vitest_1.it)("renders language detail with frameworks section", () => {
        const item = {
            name: "TypeScript",
            category: "language",
            version: "5.3.3",
            sourceFile: "package.json",
        };
        const config = makeConfig();
        const state = (0, stack_detail_js_1.createStackDetailState)(item, "testproject", config, []);
        const lines = (0, stack_detail_js_1.buildDetailLines)(state, 80);
        const output = lines.join("\n");
        (0, vitest_1.expect)(output).toContain("TypeScript");
        (0, vitest_1.expect)(output).toContain("Language");
        (0, vitest_1.expect)(output).toContain("5.3.3");
        (0, vitest_1.expect)(output).toContain("package.json");
        (0, vitest_1.expect)(output).toContain("FRAMEWORKS");
        (0, vitest_1.expect)(output).toContain("React");
    });
    (0, vitest_1.it)("renders framework detail with languages section", () => {
        const item = {
            name: "React",
            category: "framework",
            version: "18.2.0",
            sourceFile: "package.json",
        };
        const config = makeConfig();
        const state = (0, stack_detail_js_1.createStackDetailState)(item, "testproject", config, []);
        const lines = (0, stack_detail_js_1.buildDetailLines)(state, 80);
        const output = lines.join("\n");
        (0, vitest_1.expect)(output).toContain("React");
        (0, vitest_1.expect)(output).toContain("Framework");
        (0, vitest_1.expect)(output).toContain("18.2.0");
        (0, vitest_1.expect)(output).toContain("LANGUAGES");
        (0, vitest_1.expect)(output).toContain("TypeScript");
    });
    (0, vitest_1.it)("renders infrastructure detail with live resources", () => {
        const item = {
            name: "Docker",
            category: "infrastructure",
            sourceFile: "Dockerfile",
        };
        const config = makeConfig();
        const infra = makeInfraResources();
        const state = (0, stack_detail_js_1.createStackDetailState)(item, "testproject", config, infra);
        const lines = (0, stack_detail_js_1.buildDetailLines)(state, 80);
        const output = lines.join("\n");
        (0, vitest_1.expect)(output).toContain("Docker");
        (0, vitest_1.expect)(output).toContain("Infrastructure");
        (0, vitest_1.expect)(output).toContain("LIVE RESOURCES");
        (0, vitest_1.expect)(output).toContain("api-pod-1");
    });
    (0, vitest_1.it)("renders service detail with port", () => {
        const item = {
            name: "api",
            category: "service",
            port: 3000,
        };
        const config = makeConfig({
            services: [
                { name: "api", port: 3000, command: "node server.js", dependsOn: ["db"] },
            ],
        });
        const state = (0, stack_detail_js_1.createStackDetailState)(item, "testproject", config, []);
        const lines = (0, stack_detail_js_1.buildDetailLines)(state, 80);
        const output = lines.join("\n");
        (0, vitest_1.expect)(output).toContain("api");
        (0, vitest_1.expect)(output).toContain("Service");
        (0, vitest_1.expect)(output).toContain("3000");
        (0, vitest_1.expect)(output).toContain("node server.js");
        (0, vitest_1.expect)(output).toContain("db");
    });
    (0, vitest_1.it)("renders testing detail", () => {
        const item = {
            name: "vitest",
            category: "testing",
        };
        const config = makeConfig();
        const state = (0, stack_detail_js_1.createStackDetailState)(item, "testproject", config, []);
        const lines = (0, stack_detail_js_1.buildDetailLines)(state, 80);
        const output = lines.join("\n");
        (0, vitest_1.expect)(output).toContain("vitest");
        (0, vitest_1.expect)(output).toContain("Testing");
        (0, vitest_1.expect)(output).toContain("npx vitest run");
        (0, vitest_1.expect)(output).toContain("LINTING");
        (0, vitest_1.expect)(output).toContain("eslint");
    });
    (0, vitest_1.it)("renders with scroll offset", () => {
        const item = {
            name: "TypeScript",
            category: "language",
            version: "5.3.3",
            sourceFile: "package.json",
        };
        const config = makeConfig();
        const state = (0, stack_detail_js_1.createStackDetailState)(item, "testproject", config, []);
        state.scrollOffset = 2;
        const buf = new renderer_js_1.ScreenBuffer(80, 24);
        const panel = { x: 0, y: 0, width: 80, height: 24 };
        (0, vitest_1.expect)(() => (0, stack_detail_js_1.renderStackDetail)(buf, panel, state)).not.toThrow();
    });
});
(0, vitest_1.describe)("scroll helpers", () => {
    (0, vitest_1.it)("scrollDown increases offset", () => {
        const item = { name: "TypeScript", category: "language" };
        const state = (0, stack_detail_js_1.createStackDetailState)(item, "test", makeConfig(), []);
        state.totalLines = 30;
        (0, stack_detail_js_1.scrollDown)(state, 3, 10);
        (0, vitest_1.expect)(state.scrollOffset).toBe(3);
    });
    (0, vitest_1.it)("scrollUp decreases offset", () => {
        const item = { name: "TypeScript", category: "language" };
        const state = (0, stack_detail_js_1.createStackDetailState)(item, "test", makeConfig(), []);
        state.scrollOffset = 5;
        (0, stack_detail_js_1.scrollUp)(state, 2);
        (0, vitest_1.expect)(state.scrollOffset).toBe(3);
    });
    (0, vitest_1.it)("scrollUp does not go below 0", () => {
        const item = { name: "TypeScript", category: "language" };
        const state = (0, stack_detail_js_1.createStackDetailState)(item, "test", makeConfig(), []);
        (0, stack_detail_js_1.scrollUp)(state, 5);
        (0, vitest_1.expect)(state.scrollOffset).toBe(0);
    });
    (0, vitest_1.it)("scrollToTop resets to 0", () => {
        const item = { name: "TypeScript", category: "language" };
        const state = (0, stack_detail_js_1.createStackDetailState)(item, "test", makeConfig(), []);
        state.scrollOffset = 10;
        (0, stack_detail_js_1.scrollToTop)(state);
        (0, vitest_1.expect)(state.scrollOffset).toBe(0);
    });
    (0, vitest_1.it)("scrollToBottom goes to max offset", () => {
        const item = { name: "TypeScript", category: "language" };
        const state = (0, stack_detail_js_1.createStackDetailState)(item, "test", makeConfig(), []);
        state.totalLines = 30;
        (0, stack_detail_js_1.scrollToBottom)(state, 10);
        (0, vitest_1.expect)(state.scrollOffset).toBe(20);
    });
    (0, vitest_1.it)("scrollDown clamps to max offset", () => {
        const item = { name: "TypeScript", category: "language" };
        const state = (0, stack_detail_js_1.createStackDetailState)(item, "test", makeConfig(), []);
        state.totalLines = 15;
        (0, stack_detail_js_1.scrollDown)(state, 1000, 10);
        (0, vitest_1.expect)(state.scrollOffset).toBe(5);
    });
});
//# sourceMappingURL=stack-detail.test.js.map