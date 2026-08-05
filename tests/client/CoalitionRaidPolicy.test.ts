import { describe, expect, it } from "vitest";
import { planCoalitionRaid } from "../../src/client/ai/CoalitionRaidPolicy";

const base = {
  availableFleetTroops: 10_000,
  reserveFleetTroops: 3_000,
  ownReserveRatio: 0.78,
  ownBorderExposure: 0.2,
  activeNationWars: 0,
  allyStrengthRatio: 0.7,
  allyReliability: 0.82,
  allySharedEnemyCommitment: 0.7,
  allyBorderAccessToUs: 0.15,
  ticksSinceAllianceFormed: 800,
  targets: [
    {
      id: "weak-coast",
      nationReserveRatio: 0.2,
      nationTerritoryRatio: 0.25,
      coastalTroops: 2_000,
      coastalBuildingValue: 4,
      landingDefenseMultiplier: 1,
      nearbyEnemyWarships: 0,
      nearbyFriendlyWarships: 1,
      samRetaliationRisk: 0.1,
      wouldOpenNationWar: true,
    },
  ],
};

describe("planCoalitionRaid", () => {
  it("coordinates against a weak coastal nation with a reliable ally", () => {
    const plan = planCoalitionRaid(base);
    expect(plan.action).toBe("coordinate-raid");
    expect(plan.targetID).toBe("weak-coast");
    expect(plan.troops).toBeGreaterThan(0);
    expect(plan.allyCommitmentCap).toBeGreaterThan(0);
  });

  it("raids alone when betrayal risk is too high", () => {
    const plan = planCoalitionRaid({
      ...base,
      allyReliability: 0.35,
      allySharedEnemyCommitment: 0.2,
      allyBorderAccessToUs: 0.8,
      ticksSinceAllianceFormed: 100,
    });
    expect(plan.action).toBe("solo-raid");
    expect(plan.allyCommitmentCap).toBe(0);
    expect(plan.betrayalReserveRatio).toBeGreaterThan(0.6);
  });

  it("holds when preserving betrayal reserves leaves no safe troops", () => {
    const plan = planCoalitionRaid({
      ...base,
      availableFleetTroops: 4_000,
      reserveFleetTroops: 3_800,
      ownReserveRatio: 0.45,
      allyReliability: 0.25,
      allyBorderAccessToUs: 0.9,
    });
    expect(plan.action).toBe("hold");
  });

  it("prefers the weaker nation when coastal value is similar", () => {
    const plan = planCoalitionRaid({
      ...base,
      targets: [
        base.targets[0],
        {
          ...base.targets[0],
          id: "strong-coast",
          nationReserveRatio: 0.8,
          nationTerritoryRatio: 0.75,
        },
      ],
    });
    expect(plan.targetID).toBe("weak-coast");
  });

  it("caps troop commitment so the raid cannot expose the homeland", () => {
    const plan = planCoalitionRaid(base);
    expect(plan.troops).toBeLessThanOrEqual(
      Math.floor(base.availableFleetTroops * 0.38),
    );
  });
});
