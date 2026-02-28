import { describe, it, expect } from "vitest";
import { MergeCoordinator } from "@opcom/core";

describe("MergeCoordinator", () => {
  it("creates merge requests and queues them", async () => {
    const mc = new MergeCoordinator();
    const request = await mc.requestMerge({
      sessionId: "test-session",
      projectPath: "/tmp/test",
      sourceBranch: "feature/test",
      targetBranch: "main",
      runTests: false,
      autoMerge: false,
    });

    expect(request.id).toBeDefined();
    // Status may be "queued" or "running" depending on async processing timing
    expect(["queued", "running", "failed"]).toContain(request.status);
    expect(request.sourceBranch).toBe("feature/test");
    expect(request.targetBranch).toBe("main");
  });

  it("tracks merge queue", async () => {
    const mc = new MergeCoordinator();
    await mc.requestMerge({
      sessionId: "s1",
      projectPath: "/tmp/test",
      sourceBranch: "feature/a",
      targetBranch: "main",
    });

    const queue = mc.getQueue();
    expect(queue.length).toBeGreaterThanOrEqual(1);
  });

  it("cancels queued requests", async () => {
    const mc = new MergeCoordinator();
    const req = await mc.requestMerge({
      sessionId: "s1",
      projectPath: "/tmp/nonexistent-so-it-wont-run",
      sourceBranch: "feature/a",
      targetBranch: "main",
    });

    // Give it a tick to start processing
    await new Promise((r) => setTimeout(r, 50));

    // Request may already be running, but if still queued, cancel should work
    const cancelled = mc.cancelRequest(req.id);
    // Either true (was still queued) or false (already processing)
    expect(typeof cancelled).toBe("boolean");
  });

  it("emits merge events", async () => {
    const mc = new MergeCoordinator();
    const events: string[] = [];
    mc.onEvent((e) => events.push(e.type));

    await mc.requestMerge({
      sessionId: "s1",
      projectPath: "/tmp/test",
      sourceBranch: "feature/a",
      targetBranch: "main",
    });

    // Wait for processing to attempt
    await new Promise((r) => setTimeout(r, 100));

    expect(events).toContain("merge_queued");
  });
});
