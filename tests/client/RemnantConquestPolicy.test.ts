import { describe, expect, it } from "vitest";
import { planRemnantConquest } from "../../src/client/ai/RemnantConquestPolicy";

const base = {
  ownTroops: 800_000,
  ownMaxTroops: 1_000_000,
  ownTiles: 10_000,
  reserveFloor: 0.4,
  targetTroops: 40_000,
  targetMaxTroops: 200_000,
  targetTiles: 300,
  targetGold: 750_000,
  capturesFullGold: true,
  targetIsTribe: false,
  targetIsAllied: false,
  sharesBorder: true,
  activeNationWars: 0,
  maximumNationWars: 1,
  incomingFronts: 0,
  alreadyFightingTarget: false,
  terrainLossCost: 1,
  wrapPotential: 0.3,
  estimatedConquestTicks: 180,
  predictedChoice: "bank" as const,
};

describe("RemnantConquestPolicy", () => {
  it("finishes a nearby small nation to realize its elimination gold", () => {
    const plan = planRemnantConquest(base);

    expect(plan.isRemnant).toBe(true);
    expect(plan.shouldAttack).toBe(true);
    expect(plan.bountyGold).toBe(750_000);
    expect(plan.projectedReserveRatio).toBeGreaterThanOrEqual(0.4);
  });

  it("will not make an allied remnant hostile before diplomacy acts", () => {
    const plan = planRemnantConquest({ ...base, targetIsAllied: true });

    expect(plan.shouldAttack).toBe(false);
    expect(plan.reason).toContain("alliance");
  });

  it("does not open a material extra nation front over its front budget", () => {
    const plan = planRemnantConquest({
      ...base,
      targetTroops: 180_000,
      targetMaxTroops: 500_000,
      activeNationWars: 1,
    });

    expect(plan.shouldAttack).toBe(false);
  });

  it("counts troops already committed in the field before calling it small", () => {
    const plan = planRemnantConquest({
      ...base,
      targetFieldTroops: 500_000,
    });

    expect(plan.isRemnant).toBe(false);
    expect(plan.shouldAttack).toBe(false);
  });
});
