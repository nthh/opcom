import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createLogger, isEnabled } from "@opcom/core";
import type { LogLevel } from "@opcom/core";

describe("createLogger", () => {
  let stderrSpy: ReturnType<typeof vi.spyOn>;
  const origDebug = process.env.OPCOM_DEBUG;
  const origLog = process.env.OPCOM_LOG;

  beforeEach(() => {
    stderrSpy = vi.spyOn(process.stderr, "write").mockReturnValue(true);
    delete process.env.OPCOM_DEBUG;
    delete process.env.OPCOM_LOG;
  });

  afterEach(() => {
    stderrSpy.mockRestore();
    if (origDebug !== undefined) process.env.OPCOM_DEBUG = origDebug;
    else delete process.env.OPCOM_DEBUG;
    if (origLog !== undefined) process.env.OPCOM_LOG = origLog;
    else delete process.env.OPCOM_LOG;
  });

  it("is silent by default", () => {
    const log = createLogger("test");
    log.debug("should not appear");
    log.info("should not appear");
    log.warn("should not appear");
    log.error("should not appear");
    expect(stderrSpy).not.toHaveBeenCalled();
  });

  it("outputs all levels when OPCOM_DEBUG=1", () => {
    process.env.OPCOM_DEBUG = "1";
    const log = createLogger("myns");

    log.debug("d");
    log.info("i");
    log.warn("w");
    log.error("e");

    expect(stderrSpy).toHaveBeenCalledTimes(4);
    const calls = stderrSpy.mock.calls.map((c) => String(c[0]));
    expect(calls[0]).toMatch(/DEBUG myns: d/);
    expect(calls[1]).toMatch(/INFO myns: i/);
    expect(calls[2]).toMatch(/WARN myns: w/);
    expect(calls[3]).toMatch(/ERROR myns: e/);
  });

  it("respects OPCOM_LOG level threshold", () => {
    process.env.OPCOM_LOG = "warn";
    const log = createLogger("ns");

    log.debug("nope");
    log.info("nope");
    log.warn("yes");
    log.error("yes");

    expect(stderrSpy).toHaveBeenCalledTimes(2);
  });

  it("includes timestamp in output", () => {
    process.env.OPCOM_DEBUG = "1";
    const log = createLogger("ts");
    log.info("check");

    const output = String(stderrSpy.mock.calls[0][0]);
    // ISO timestamp format: [2024-01-01T00:00:00.000Z]
    expect(output).toMatch(/^\[\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
  });

  it("includes data as JSON when provided", () => {
    process.env.OPCOM_DEBUG = "1";
    const log = createLogger("data");
    log.info("msg", { key: "val", num: 42 });

    const output = String(stderrSpy.mock.calls[0][0]);
    expect(output).toContain('{"key":"val","num":42}');
  });

  it("output format is [timestamp] LEVEL namespace: message", () => {
    process.env.OPCOM_DEBUG = "1";
    const log = createLogger("fmt");
    log.error("boom");

    const output = String(stderrSpy.mock.calls[0][0]);
    expect(output).toMatch(/^\[.+\] ERROR fmt: boom\n$/);
  });

  it("separate loggers use their own namespace", () => {
    process.env.OPCOM_DEBUG = "1";
    const logA = createLogger("detect");
    const logB = createLogger("config");

    logA.info("scanning");
    logB.warn("missing key");

    const calls = stderrSpy.mock.calls.map((c) => String(c[0]));
    expect(calls[0]).toMatch(/INFO detect: scanning/);
    expect(calls[1]).toMatch(/WARN config: missing key/);
  });

  it("namespace appears in output for every log level", () => {
    process.env.OPCOM_DEBUG = "1";
    const log = createLogger("orchestrator");

    log.debug("d");
    log.info("i");
    log.warn("w");
    log.error("e");

    const calls = stderrSpy.mock.calls.map((c) => String(c[0]));
    for (const line of calls) {
      expect(line).toContain("orchestrator:");
    }
  });

  it("preserves namespace with dotted paths", () => {
    process.env.OPCOM_DEBUG = "1";
    const log = createLogger("core.detect.stack");
    log.info("found");

    const output = String(stderrSpy.mock.calls[0][0]);
    expect(output).toMatch(/INFO core\.detect\.stack: found/);
  });
});

describe("isEnabled", () => {
  const origDebug = process.env.OPCOM_DEBUG;
  const origLog = process.env.OPCOM_LOG;

  afterEach(() => {
    if (origDebug !== undefined) process.env.OPCOM_DEBUG = origDebug;
    else delete process.env.OPCOM_DEBUG;
    if (origLog !== undefined) process.env.OPCOM_LOG = origLog;
    else delete process.env.OPCOM_LOG;
  });

  it("returns false for all levels when silent", () => {
    delete process.env.OPCOM_DEBUG;
    delete process.env.OPCOM_LOG;
    expect(isEnabled("debug")).toBe(false);
    expect(isEnabled("info")).toBe(false);
    expect(isEnabled("warn")).toBe(false);
    expect(isEnabled("error")).toBe(false);
  });

  it("returns true for all levels with OPCOM_DEBUG=1", () => {
    process.env.OPCOM_DEBUG = "1";
    expect(isEnabled("debug")).toBe(true);
    expect(isEnabled("info")).toBe(true);
    expect(isEnabled("warn")).toBe(true);
    expect(isEnabled("error")).toBe(true);
  });

  it("returns correct booleans for OPCOM_LOG=warn", () => {
    delete process.env.OPCOM_DEBUG;
    process.env.OPCOM_LOG = "warn";
    expect(isEnabled("debug")).toBe(false);
    expect(isEnabled("info")).toBe(false);
    expect(isEnabled("warn")).toBe(true);
    expect(isEnabled("error")).toBe(true);
  });

  it("returns correct booleans for OPCOM_LOG=info", () => {
    delete process.env.OPCOM_DEBUG;
    process.env.OPCOM_LOG = "info";
    expect(isEnabled("debug")).toBe(false);
    expect(isEnabled("info")).toBe(true);
    expect(isEnabled("warn")).toBe(true);
    expect(isEnabled("error")).toBe(true);
  });
});
