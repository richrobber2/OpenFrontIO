// @vitest-environment node

import { describe, expect, it } from "vitest";
import { MatchPerformanceTracker } from "../../src/client/hud/MatchPerformanceTracker";

describe("match performance tracker", () => {
  it("accumulates named timings without requiring a browser", () => {
    const tracker = new MatchPerformanceTracker();
    tracker.setEnabled(true);
    tracker.record("phase.test", 2);
    tracker.record("phase.test", 4);

    expect(tracker.snapshot().lifetimeSpans["phase.test"]).toEqual({
      avgMs: 3,
      totalMs: 6,
      calls: 2,
      maxMs: 4,
    });

    tracker.setEnabled(false);
  });

  it("ignores timings while disabled", () => {
    const tracker = new MatchPerformanceTracker();
    tracker.record("phase.disabled", 10);
    expect(tracker.snapshot().lifetimeSpans).toEqual({});
  });
});
