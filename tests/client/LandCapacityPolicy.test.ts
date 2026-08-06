import { describe, expect, it } from "vitest";
import {
  humanTroopRegeneration,
  landTroopCapacity,
  projectLandCapacity,
} from "../../src/client/ai/LandCapacityPolicy";

describe("LandCapacityPolicy", () => {
  it("matches the engine land-capacity formula exactly", () => {
    expect(landTroopCapacity(0)).toBe(100_000);
    expect(landTroopCapacity(100)).toBeCloseTo(
      2 * (Math.pow(100, 0.6) * 1_000 + 50_000),
    );
  });

  it("adds only marginal land capacity when cities already raise the maximum", () => {
    const currentTiles = 1_000;
    const projectedTiles = 1_200;
    const currentMaxTroops = landTroopCapacity(currentTiles) + 500_000;
    const projection = projectLandCapacity({
      currentTiles,
      projectedTiles,
      currentMaxTroops,
      currentTroops: 300_000,
    });

    expect(projection.capacityGain).toBeCloseTo(
      landTroopCapacity(projectedTiles) - landTroopCapacity(currentTiles),
    );
    expect(projection.projectedMaxTroops).toBeCloseTo(
      currentMaxTroops + projection.capacityGain,
    );
  });

  it("reports the regeneration improvement from added empty capacity", () => {
    const projection = projectLandCapacity({
      currentTiles: 200,
      projectedTiles: 400,
      currentMaxTroops: 300_000,
      currentTroops: 180_000,
    });

    expect(projection.projectedRegeneration).toBeGreaterThan(
      humanTroopRegeneration(180_000, 300_000),
    );
    expect(projection.regenerationMultiplier).toBeGreaterThan(1);
  });
});
