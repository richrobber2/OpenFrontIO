// @vitest-environment node

import { describe, expect, it } from "vitest";
import { MatchPerformanceTracker } from "../../src/client/hud/MatchPerformanceTracker";

describe("match performance tracker validation", () => {
  it("reports accumulated profiler spans", () => {
    const tracker = new MatchPerformanceTracker();
    tracker.setEnabled(true);
    tracker.record("validation", 1.5);
    tracker.record("validation", 2.5);

    expect(tracker.snapshot().lifetimeSpans.validation).toEqual({
      avgMs: 2,
      totalMs: 4,
      calls: 2,
      maxMs: 2.5,
    });

    tracker.setEnabled(false);
  });
});
