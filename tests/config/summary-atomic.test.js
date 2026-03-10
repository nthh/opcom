"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const fsPromises = __importStar(require("node:fs/promises"));
const node_path_1 = require("node:path");
const node_os_1 = require("node:os");
// Mock rename to be controllable while keeping all other fs operations real
vitest_1.vi.mock("node:fs/promises", async () => {
    const actual = await vitest_1.vi.importActual("node:fs/promises");
    return {
        ...actual,
        rename: vitest_1.vi.fn().mockImplementation(actual.rename),
    };
});
(0, vitest_1.describe)("project summary atomic write crash resilience", () => {
    let tempDir;
    let originalHome;
    (0, vitest_1.beforeEach)(async () => {
        tempDir = await fsPromises.mkdtemp((0, node_path_1.join)((0, node_os_1.tmpdir)(), "opcom-crash-test-"));
        originalHome = process.env.HOME;
        process.env.HOME = tempDir;
    });
    (0, vitest_1.afterEach)(async () => {
        process.env.HOME = originalHome;
        await fsPromises.rm(tempDir, { recursive: true, force: true });
    });
    (0, vitest_1.it)("preserves original file when rename fails (simulated crash)", async () => {
        const { writeProjectSummary, readProjectSummary, summaryPath, ensureOpcomDirs, } = await import("@opcom/core");
        await ensureOpcomDirs();
        // Write initial content (rename works normally here)
        const originalContent = "# Original Summary\nIntact content\n";
        await writeProjectSummary("crash-test", originalContent);
        (0, vitest_1.expect)(await readProjectSummary("crash-test")).toBe(originalContent);
        // Simulate a crash: rename fails after the temp file has been written
        vitest_1.vi.mocked(fsPromises.rename).mockRejectedValueOnce(new Error("simulated crash"));
        // Attempt to overwrite — should fail at the rename step
        const newContent = "# New Summary\nDifferent content\n";
        await (0, vitest_1.expect)(writeProjectSummary("crash-test", newContent)).rejects.toThrow("simulated crash");
        // The original file must be intact — this is the crash resilience guarantee.
        // A naive writeFile(path, content) would have overwritten the original,
        // but atomic write (write-to-tmp-then-rename) leaves it untouched.
        const preserved = await readProjectSummary("crash-test");
        (0, vitest_1.expect)(preserved).toBe(originalContent);
        // The temp file should contain the new content (written but never renamed)
        const tmpPath = summaryPath("crash-test") + ".tmp";
        const tmpContent = await fsPromises.readFile(tmpPath, "utf-8");
        (0, vitest_1.expect)(tmpContent).toBe(newContent);
    });
});
//# sourceMappingURL=summary-atomic.test.js.map