import { describe, it, expect } from "vitest";
import { applyStrategy } from "../../packages/core/src/orchestrator/planner.js";
import type { PlanStep } from "@opcom/types";

function makeStep(ticketId: string, track: string, blockedBy: string[] = []): PlanStep {
  return {
    ticketId,
    projectId: "proj",
    status: "ready",
    track,
    blockedBy,
  };
}

describe("applyStrategy", () => {
  // Steps sorted by priority: track-a has two steps, track-b has one, track-c has two
  const steps: PlanStep[] = [
    makeStep("a1", "track-a"),   // highest priority
    makeStep("b1", "track-b"),
    makeStep("c1", "track-c"),
    makeStep("a2", "track-a"),
    makeStep("c2", "track-c"),
  ];

  describe("mixed (default)", () => {
    it("returns steps in original priority order", () => {
      const result = applyStrategy(steps, "mixed");
      expect(result.map((s) => s.ticketId)).toEqual(["a1", "b1", "c1", "a2", "c2"]);
    });

    it("returns steps unchanged when strategy is undefined", () => {
      const result = applyStrategy(steps, undefined);
      expect(result.map((s) => s.ticketId)).toEqual(["a1", "b1", "c1", "a2", "c2"]);
    });
  });

  describe("spread", () => {
    it("round-robins across tracks", () => {
      const result = applyStrategy(steps, "spread");
      // Round 1: a1 (track-a), b1 (track-b), c1 (track-c)
      // Round 2: a2 (track-a), c2 (track-c)
      expect(result.map((s) => s.ticketId)).toEqual(["a1", "b1", "c1", "a2", "c2"]);
    });

    it("interleaves tracks when one track dominates priority", () => {
      // All high-priority steps are in track-a
      const dominated: PlanStep[] = [
        makeStep("a1", "track-a"),
        makeStep("a2", "track-a"),
        makeStep("a3", "track-a"),
        makeStep("b1", "track-b"),
        makeStep("c1", "track-c"),
      ];
      const result = applyStrategy(dominated, "spread");
      // Round 1: a1, b1, c1 (one per track)
      // Round 2: a2 (only track-a has more)
      // Round 3: a3
      expect(result.map((s) => s.ticketId)).toEqual(["a1", "b1", "c1", "a2", "a3"]);
    });
  });

  describe("swarm", () => {
    it("groups all steps from highest-priority track first", () => {
      const result = applyStrategy(steps, "swarm");
      // track-a steps first (a1, a2), then track-b (b1), then track-c (c1, c2)
      expect(result.map((s) => s.ticketId)).toEqual(["a1", "a2", "b1", "c1", "c2"]);
    });

    it("focuses on dominant track completely before moving on", () => {
      const dominated: PlanStep[] = [
        makeStep("a1", "track-a"),
        makeStep("b1", "track-b"),
        makeStep("b2", "track-b"),
        makeStep("b3", "track-b"),
        makeStep("a2", "track-a"),
      ];
      const result = applyStrategy(dominated, "swarm");
      // track-a first (a1 has highest priority), then track-b
      expect(result.map((s) => s.ticketId)).toEqual(["a1", "a2", "b1", "b2", "b3"]);
    });
  });

  describe("edge cases", () => {
    it("returns empty array for empty input", () => {
      expect(applyStrategy([], "spread")).toEqual([]);
      expect(applyStrategy([], "swarm")).toEqual([]);
      expect(applyStrategy([], "mixed")).toEqual([]);
    });

    it("returns single step unchanged", () => {
      const single = [makeStep("x", "track-x")];
      expect(applyStrategy(single, "spread")).toEqual(single);
      expect(applyStrategy(single, "swarm")).toEqual(single);
    });

    it("uses ticketId as fallback track when track is undefined", () => {
      const noTracks: PlanStep[] = [
        { ...makeStep("a", ""), track: undefined },
        { ...makeStep("b", ""), track: undefined },
      ];
      // Each step gets its own "track" (ticketId), so spread still works
      const result = applyStrategy(noTracks, "spread");
      expect(result).toHaveLength(2);
    });

    it("all steps in same track — spread and swarm produce same result", () => {
      const sameTrack: PlanStep[] = [
        makeStep("s1", "only-track"),
        makeStep("s2", "only-track"),
        makeStep("s3", "only-track"),
      ];
      const spread = applyStrategy(sameTrack, "spread");
      const swarm = applyStrategy(sameTrack, "swarm");
      expect(spread.map((s) => s.ticketId)).toEqual(["s1", "s2", "s3"]);
      expect(swarm.map((s) => s.ticketId)).toEqual(["s1", "s2", "s3"]);
    });
  });
});
