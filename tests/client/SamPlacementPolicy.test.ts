import { describe, expect, it } from "vitest";
import {
  MIRV_SAM_PROTECTION_RADIUS,
  samPlacementProtectionRadius,
  scoreSamPlacement,
} from "../../src/client/ai/SamPlacementPolicy";
import { UnitType } from "../../src/core/game/Game";

describe("scoreSamPlacement", () => {
  it("uses the engine's local MIRV destination radius instead of ordinary SAM range", () => {
    expect(samPlacementProtectionRadius(true, 120)).toBe(
      MIRV_SAM_PROTECTION_RADIUS,
    );
    expect(samPlacementProtectionRadius(false, 120)).toBe(120);
  });
  it("prioritizes first coverage for exposed strategic buildings", () => {
    const exposed = scoreSamPlacement({
      protectedStructures: [
        { type: UnitType.MissileSilo, existingCoverage: 0 },
        { type: UnitType.Factory, existingCoverage: 0 },
      ],
      depth: 30,
      isShore: false,
      nearestSamDistance: 80,
      samRange: 100,
    });
    const redundant = scoreSamPlacement({
      protectedStructures: [
        { type: UnitType.MissileSilo, existingCoverage: 2 },
        { type: UnitType.Factory, existingCoverage: 2 },
      ],
      depth: 30,
      isShore: false,
      nearestSamDistance: 80,
      samRange: 100,
    });
    expect(exposed.score).toBeGreaterThan(redundant.score);
    expect(exposed.newlyCovered).toBe(2);
  });

  it("values a second interception layer but rejects tight SAM stacking", () => {
    const layered = scoreSamPlacement({
      protectedStructures: [{ type: UnitType.City, existingCoverage: 1 }],
      depth: 35,
      isShore: false,
      nearestSamDistance: 70,
      samRange: 100,
    });
    const stacked = scoreSamPlacement({
      protectedStructures: [{ type: UnitType.City, existingCoverage: 1 }],
      depth: 35,
      isShore: false,
      nearestSamDistance: 5,
      samRange: 100,
    });
    expect(layered.layered).toBe(1);
    expect(layered.score).toBeGreaterThan(stacked.score);
  });
});
