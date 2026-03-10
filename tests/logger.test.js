"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const core_1 = require("@opcom/core");
(0, vitest_1.describe)("createLogger", () => {
    let stderrSpy;
    const origDebug = process.env.OPCOM_DEBUG;
    const origLog = process.env.OPCOM_LOG;
    (0, vitest_1.beforeEach)(() => {
        stderrSpy = vitest_1.vi.spyOn(process.stderr, "write").mockReturnValue(true);
        delete process.env.OPCOM_DEBUG;
        delete process.env.OPCOM_LOG;
    });
    (0, vitest_1.afterEach)(() => {
        stderrSpy.mockRestore();
        if (origDebug !== undefined)
            process.env.OPCOM_DEBUG = origDebug;
        else
            delete process.env.OPCOM_DEBUG;
        if (origLog !== undefined)
            process.env.OPCOM_LOG = origLog;
        else
            delete process.env.OPCOM_LOG;
    });
    (0, vitest_1.it)("is silent by default", () => {
        const log = (0, core_1.createLogger)("test");
        log.debug("should not appear");
        log.info("should not appear");
        log.warn("should not appear");
        log.error("should not appear");
        (0, vitest_1.expect)(stderrSpy).not.toHaveBeenCalled();
    });
    (0, vitest_1.it)("outputs all levels when OPCOM_DEBUG=1", () => {
        process.env.OPCOM_DEBUG = "1";
        const log = (0, core_1.createLogger)("myns");
        log.debug("d");
        log.info("i");
        log.warn("w");
        log.error("e");
        (0, vitest_1.expect)(stderrSpy).toHaveBeenCalledTimes(4);
        const calls = stderrSpy.mock.calls.map((c) => String(c[0]));
        (0, vitest_1.expect)(calls[0]).toMatch(/DEBUG myns: d/);
        (0, vitest_1.expect)(calls[1]).toMatch(/INFO myns: i/);
        (0, vitest_1.expect)(calls[2]).toMatch(/WARN myns: w/);
        (0, vitest_1.expect)(calls[3]).toMatch(/ERROR myns: e/);
    });
    (0, vitest_1.it)("respects OPCOM_LOG level threshold", () => {
        process.env.OPCOM_LOG = "warn";
        const log = (0, core_1.createLogger)("ns");
        log.debug("nope");
        log.info("nope");
        log.warn("yes");
        log.error("yes");
        (0, vitest_1.expect)(stderrSpy).toHaveBeenCalledTimes(2);
    });
    (0, vitest_1.it)("includes timestamp in output", () => {
        process.env.OPCOM_DEBUG = "1";
        const log = (0, core_1.createLogger)("ts");
        log.info("check");
        const output = String(stderrSpy.mock.calls[0][0]);
        // ISO timestamp format: [2024-01-01T00:00:00.000Z]
        (0, vitest_1.expect)(output).toMatch(/^\[\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
    });
    (0, vitest_1.it)("includes data as JSON when provided", () => {
        process.env.OPCOM_DEBUG = "1";
        const log = (0, core_1.createLogger)("data");
        log.info("msg", { key: "val", num: 42 });
        const output = String(stderrSpy.mock.calls[0][0]);
        (0, vitest_1.expect)(output).toContain('{"key":"val","num":42}');
    });
    (0, vitest_1.it)("output format is [timestamp] LEVEL namespace: message", () => {
        process.env.OPCOM_DEBUG = "1";
        const log = (0, core_1.createLogger)("fmt");
        log.error("boom");
        const output = String(stderrSpy.mock.calls[0][0]);
        (0, vitest_1.expect)(output).toMatch(/^\[.+\] ERROR fmt: boom\n$/);
    });
    (0, vitest_1.it)("separate loggers use their own namespace", () => {
        process.env.OPCOM_DEBUG = "1";
        const logA = (0, core_1.createLogger)("detect");
        const logB = (0, core_1.createLogger)("config");
        logA.info("scanning");
        logB.warn("missing key");
        const calls = stderrSpy.mock.calls.map((c) => String(c[0]));
        (0, vitest_1.expect)(calls[0]).toMatch(/INFO detect: scanning/);
        (0, vitest_1.expect)(calls[1]).toMatch(/WARN config: missing key/);
    });
    (0, vitest_1.it)("namespace appears in output for every log level", () => {
        process.env.OPCOM_DEBUG = "1";
        const log = (0, core_1.createLogger)("orchestrator");
        log.debug("d");
        log.info("i");
        log.warn("w");
        log.error("e");
        const calls = stderrSpy.mock.calls.map((c) => String(c[0]));
        for (const line of calls) {
            (0, vitest_1.expect)(line).toContain("orchestrator:");
        }
    });
    (0, vitest_1.it)("preserves namespace with dotted paths", () => {
        process.env.OPCOM_DEBUG = "1";
        const log = (0, core_1.createLogger)("core.detect.stack");
        log.info("found");
        const output = String(stderrSpy.mock.calls[0][0]);
        (0, vitest_1.expect)(output).toMatch(/INFO core\.detect\.stack: found/);
    });
    (0, vitest_1.it)("handles empty namespace", () => {
        process.env.OPCOM_DEBUG = "1";
        const log = (0, core_1.createLogger)("");
        log.info("msg");
        const output = String(stderrSpy.mock.calls[0][0]);
        (0, vitest_1.expect)(output).toMatch(/INFO : msg/);
    });
    (0, vitest_1.it)("OPCOM_DEBUG takes precedence over OPCOM_LOG", () => {
        process.env.OPCOM_DEBUG = "1";
        process.env.OPCOM_LOG = "error";
        const log = (0, core_1.createLogger)("prec");
        log.debug("visible");
        (0, vitest_1.expect)(stderrSpy).toHaveBeenCalledTimes(1);
    });
    (0, vitest_1.it)("ignores invalid OPCOM_LOG values", () => {
        process.env.OPCOM_LOG = "verbose";
        const log = (0, core_1.createLogger)("inv");
        log.info("should not appear");
        (0, vitest_1.expect)(stderrSpy).not.toHaveBeenCalled();
    });
    (0, vitest_1.it)("namespace with special characters is preserved verbatim", () => {
        process.env.OPCOM_DEBUG = "1";
        const log = (0, core_1.createLogger)("@scope/pkg:sub");
        log.info("test");
        const output = String(stderrSpy.mock.calls[0][0]);
        (0, vitest_1.expect)(output).toMatch(/INFO @scope\/pkg:sub: test/);
    });
});
(0, vitest_1.describe)("isEnabled", () => {
    const origDebug = process.env.OPCOM_DEBUG;
    const origLog = process.env.OPCOM_LOG;
    (0, vitest_1.afterEach)(() => {
        if (origDebug !== undefined)
            process.env.OPCOM_DEBUG = origDebug;
        else
            delete process.env.OPCOM_DEBUG;
        if (origLog !== undefined)
            process.env.OPCOM_LOG = origLog;
        else
            delete process.env.OPCOM_LOG;
    });
    (0, vitest_1.it)("returns false for all levels when silent", () => {
        delete process.env.OPCOM_DEBUG;
        delete process.env.OPCOM_LOG;
        (0, vitest_1.expect)((0, core_1.isEnabled)("debug")).toBe(false);
        (0, vitest_1.expect)((0, core_1.isEnabled)("info")).toBe(false);
        (0, vitest_1.expect)((0, core_1.isEnabled)("warn")).toBe(false);
        (0, vitest_1.expect)((0, core_1.isEnabled)("error")).toBe(false);
    });
    (0, vitest_1.it)("returns true for all levels with OPCOM_DEBUG=1", () => {
        process.env.OPCOM_DEBUG = "1";
        (0, vitest_1.expect)((0, core_1.isEnabled)("debug")).toBe(true);
        (0, vitest_1.expect)((0, core_1.isEnabled)("info")).toBe(true);
        (0, vitest_1.expect)((0, core_1.isEnabled)("warn")).toBe(true);
        (0, vitest_1.expect)((0, core_1.isEnabled)("error")).toBe(true);
    });
    (0, vitest_1.it)("returns correct booleans for OPCOM_LOG=warn", () => {
        delete process.env.OPCOM_DEBUG;
        process.env.OPCOM_LOG = "warn";
        (0, vitest_1.expect)((0, core_1.isEnabled)("debug")).toBe(false);
        (0, vitest_1.expect)((0, core_1.isEnabled)("info")).toBe(false);
        (0, vitest_1.expect)((0, core_1.isEnabled)("warn")).toBe(true);
        (0, vitest_1.expect)((0, core_1.isEnabled)("error")).toBe(true);
    });
    (0, vitest_1.it)("returns correct booleans for OPCOM_LOG=info", () => {
        delete process.env.OPCOM_DEBUG;
        process.env.OPCOM_LOG = "info";
        (0, vitest_1.expect)((0, core_1.isEnabled)("debug")).toBe(false);
        (0, vitest_1.expect)((0, core_1.isEnabled)("info")).toBe(true);
        (0, vitest_1.expect)((0, core_1.isEnabled)("warn")).toBe(true);
        (0, vitest_1.expect)((0, core_1.isEnabled)("error")).toBe(true);
    });
});
//# sourceMappingURL=logger.test.js.map