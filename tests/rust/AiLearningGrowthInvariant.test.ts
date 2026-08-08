// @vitest-environment node

import { describe, expect, it } from "vitest";
import { predictFutureOutcome } from "../../src/client/ai/StrategyMath";

describe("growth-aware AI prediction bounds", () => {
  it("values expansion capacity without projecting runaway growth", () => {
    const base = {
      action: "expand" as const,
      troops: 800_000,
      maxTroops: 1_000_000,
      tiles: 5_000,
      enemyTroops: 700_000,
      sample: 2,
    };
    const near = predictFutureOutcome({ ...base, horizon: 120 });
    const far = predictFutureOutcome({ ...base, horizon: 600 });

    expect(near.expectedTiles).toBeGreaterThan(base.tiles);
    expect(near.capacityGain).toBeGreaterThan(0);
    expect(near.expectedMaxTroops).toBeGreaterThan(base.maxTroops);

    expect(far.expectedTiles).toBeGreaterThan(near.expectedTiles);
    expect(far.expectedTiles).toBeLessThanOrEqual(base.tiles * 1.13);
    expect(far.capacityGain).toBeGreaterThan(near.capacityGain);
    expect(far.confidence).toBeLessThan(near.confidence);
  });
});
