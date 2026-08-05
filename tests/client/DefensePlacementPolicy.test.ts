import { describe, expect, it } from "vitest";
import {
  evaluateDefensePlacement,
  evaluateForwardDefenseBait,
  hostileFrontDefensePriority,
  strategicStructureProtectionValue,
} from "../../src/client/ai/DefensePlacementPolicy";
import { UnitType } from "../../src/core/game/Game";

const base = {
  totalOwnedLandTiles: 400,
  alreadyCoveredOwnedLandTiles: 80,
  candidateCoveredOwnedLandTiles: 70,
  candidateNewOwnedLandTiles: 69,
  threatenedBorderTiles: 100,
  alreadyCoveredThreatenedTiles: 20,
  candidateCoveredThreatenedTiles: 30,
  candidateNewThreatenedTiles: 27,
  overlapWithExistingCoverage: 0.01,
  borderPressure: 0.2,
  anticipatedBorderPressure: 0.3,
  estimatedEnemyArrivalTicks: 180,
  defensePostBuildTicks: 80,
  strategicChokepoint: false,
  territoryValue: 0.7,
  nearbyCriticalStructures: 1,
  distanceToNearestDefensePost: 26,
  defenseRadius: 12,
  nearestDefenseRadius: 12,
  gold: 400,
  defensePostCost: 100,
  emergencyGoldFloor: 150,
  activeNationWars: 1,
};

describe("evaluateDefensePlacement", () => {
  it("builds when a post adds broad unique owned-land coverage", () => {
    const decision = evaluateDefensePlacement(base);
    expect(decision.build).toBe(true);
    expect(decision.newCoverageRatio).toBeCloseTo(69 / 400);
    expect(decision.reason).toContain("owned-land coverage");
  });

  it("builds useful interior coverage without current border pressure", () => {
    const decision = evaluateDefensePlacement({
      ...base,
      borderPressure: 0,
      anticipatedBorderPressure: 0,
      strategicChokepoint: false,
      nearbyCriticalStructures: 0,
      estimatedEnemyArrivalTicks: undefined,
    });
    expect(decision.build).toBe(true);
  });

  it("hard rejects geometrically intersecting defense radii", () => {
    const decision = evaluateDefensePlacement({
      ...base,
      distanceToNearestDefensePost: 23,
      defenseRadius: 12,
      nearestDefenseRadius: 12,
      overlapWithExistingCoverage: 0,
    });
    expect(decision.build).toBe(false);
    expect(decision.reason).toContain("overlaps");
  });

  it("hard rejects even small measured radius overlap", () => {
    const decision = evaluateDefensePlacement({
      ...base,
      distanceToNearestDefensePost: 30,
      overlapWithExistingCoverage: 0.08,
      candidateNewOwnedLandTiles: 64,
    });
    expect(decision.build).toBe(false);
    expect(decision.reason).toContain("overlaps");
  });

  it("uses exact unique owned tiles rather than frontier coverage", () => {
    const decision = evaluateDefensePlacement({
      ...base,
      candidateCoveredOwnedLandTiles: 80,
      candidateNewOwnedLandTiles: 20,
      candidateCoveredThreatenedTiles: 30,
      candidateNewThreatenedTiles: 29,
      overlapWithExistingCoverage: 0,
    });
    expect(decision.build).toBe(false);
    expect(decision.newCoverageRatio).toBeCloseTo(0.05);
    expect(decision.reason).toContain("unique owned-land coverage");
  });

  it("rejects candidates that waste their radius outside useful owned land", () => {
    const decision = evaluateDefensePlacement({
      ...base,
      candidateCoveredOwnedLandTiles: 80,
      candidateNewOwnedLandTiles: 60,
      overlapWithExistingCoverage: 0,
    });
    expect(decision.build).toBe(false);
    expect(decision.reason).toContain(
      "fails to add unique owned-land coverage",
    );
  });

  it("does not spend the emergency gold reserve", () => {
    const decision = evaluateDefensePlacement({
      ...base,
      gold: 220,
    });
    expect(decision.build).toBe(false);
    expect(decision.reason).toContain("emergency gold reserve");
  });

  it("stops building once total owned land is sufficiently covered", () => {
    const decision = evaluateDefensePlacement({
      ...base,
      alreadyCoveredOwnedLandTiles: 365,
      candidateCoveredOwnedLandTiles: 30,
      candidateNewOwnedLandTiles: 28,
    });
    expect(decision.build).toBe(false);
    expect(decision.reason).toContain("already sufficiently covered");
  });

  it("accounts for build time when a high-pressure attack is imminent", () => {
    const decision = evaluateDefensePlacement({
      ...base,
      borderPressure: 1,
      estimatedEnemyArrivalTicks: 90,
      defensePostBuildTicks: 80,
    });
    expect(decision.build).toBe(false);
    expect(decision.reason).toContain("finish too late");
  });
});

describe("strategic structure defense", () => {
  it("prioritizes a smaller front when it directly threatens valuable buildings", () => {
    const ordinaryFront = hostileFrontDefensePriority({
      troops: 100_000,
      defenseRadius: 12,
      structures: [{ distance: 180, type: UnitType.City }],
    });
    const factoryFront = hostileFrontDefensePriority({
      troops: 80_000,
      defenseRadius: 12,
      structures: [
        { distance: 12, type: UnitType.Factory },
        { distance: 20, type: UnitType.City },
      ],
    });

    expect(factoryFront).toBeGreaterThan(ordinaryFront);
  });

  it("only credits a post whose real radius covers the building", () => {
    const covered = strategicStructureProtectionValue({
      candidateDistance: 4,
      hostileDistance: 20,
      defenseRadius: 12,
      type: UnitType.Factory,
    });
    const uncovered = strategicStructureProtectionValue({
      candidateDistance: 13,
      hostileDistance: 20,
      defenseRadius: 12,
      type: UnitType.Factory,
    });

    expect(covered).toBeGreaterThan(0);
    expect(uncovered).toBe(0);
  });

  it("values a threatened factory above an equally placed SAM launcher", () => {
    const factory = strategicStructureProtectionValue({
      candidateDistance: 6,
      hostileDistance: 12,
      defenseRadius: 12,
      type: UnitType.Factory,
    });
    const sam = strategicStructureProtectionValue({
      candidateDistance: 6,
      hostileDistance: 12,
      defenseRadius: 12,
      type: UnitType.SAMLauncher,
    });

    expect(factory).toBeGreaterThan(sam);
  });
});

describe("forward defense baiting", () => {
  const baitReady = {
    ownTroops: 800_000,
    maxTroops: 1_000_000,
    enemyTroops: 1_000_000,
    existingDefensePosts: 3,
    fallbackDefensePosts: 1,
    activeNationFronts: 1,
    coveredBorderRatio: 0.4,
    candidateDepth: 14,
    defenseRadius: 30,
    attackerAttritionMultiplier: 5,
    captureResistanceMultiplier: 3,
  };

  it("uses the measured engine multipliers to approve a supported forward post", () => {
    const decision = evaluateForwardDefenseBait(baitReady);

    expect(decision.bait).toBe(true);
    expect(decision.projectedAttritionLeverage).toBe(4);
    expect(decision.reason).toContain("measured attacker attrition");
  });

  it("rejects baiting without a fallback layer or enough reserve", () => {
    expect(
      evaluateForwardDefenseBait({
        ...baitReady,
        fallbackDefensePosts: 0,
      }).bait,
    ).toBe(false);
    expect(
      evaluateForwardDefenseBait({
        ...baitReady,
        ownTroops: 600_000,
      }).bait,
    ).toBe(false);
  });

  it("keeps the post close enough to tax the border without exposing it directly", () => {
    expect(
      evaluateForwardDefenseBait({
        ...baitReady,
        candidateDepth: 3,
      }).bait,
    ).toBe(false);
    expect(
      evaluateForwardDefenseBait({
        ...baitReady,
        candidateDepth: 28,
      }).bait,
    ).toBe(false);
  });

  it("will not bait a force that overwhelms the measured attrition leverage", () => {
    const decision = evaluateForwardDefenseBait({
      ...baitReady,
      ownTroops: 700_000,
      enemyTroops: 2_000_000,
    });

    expect(decision.bait).toBe(false);
    expect(decision.projectedAttritionLeverage).toBe(1.75);
  });
});
