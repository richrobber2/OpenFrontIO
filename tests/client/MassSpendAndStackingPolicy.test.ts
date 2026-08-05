import { describe, expect, it } from "vitest";
import { planBuildQueue } from "../../src/client/ai/BuildQueuePolicy";
import { chooseGoldBudget } from "../../src/client/ai/GoldBudgetPolicy";

describe("runaway treasury planning", () => {
  it("forces a large batch and permits productive stacking", () => {
    const decision = chooseGoldBudget({
      gold: 300_000_000,
      incomePerMinute: 100_000,
      emergencyGoldFloor: 2_000_000,
      activeNationWars: 0,
      incomingStrikeRisk: 0.1,
      borderPressure: 0.1,
      uncoveredCriticalStructures: 0,
      usefulPortSites: 4,
      existingPorts: 5,
      existingCities: 8,
      existingDefensePosts: 4,
      existingSams: 3,
      existingSilos: 1,
      economyReturnScore: 5,
      navalNeedScore: 8,
      strategicWeaponValue: 4,
      infrastructureNeedScore: 6,
      allyAidUrgency: 0,
      recentLowValuePurchases: 0,
      coastalEconomicTargets: 5,
      enemyWarshipsNearTargets: 2,
      enemyMissileSilos: 2,
      productiveStackSites: 6,
    });

    expect(decision.category).toBe("navy");
    expect(decision.spendCap).toBeGreaterThan(250_000_000);
    expect(decision.minimumQueuedPurchases).toBeGreaterThanOrEqual(10);
    expect(decision.allowProductiveStacking).toBe(true);
  });

  it("queues multiple buildings from the same productive stack group", () => {
    const plan = planBuildQueue({
      gold: 100_000,
      emergencyGoldFloor: 10_000,
      maximumQueuedPlacements: 5,
      actionCapacity: 5,
      allowProductiveStacking: true,
      maximumPerStackGroup: 3,
      minimumMarginalStackScore: 2,
      candidates: [
        {
          id: "port-1",
          kind: "port",
          cost: 10_000,
          strategicScore: 20,
          conflictGroup: "coast-a",
          stackGroup: "coast-a",
          stackOrdinal: 1,
        },
        {
          id: "port-2",
          kind: "port",
          cost: 10_000,
          strategicScore: 18,
          conflictGroup: "coast-a",
          stackGroup: "coast-a",
          stackOrdinal: 2,
          marginalStackScore: 6,
        },
        {
          id: "port-3",
          kind: "port",
          cost: 10_000,
          strategicScore: 16,
          conflictGroup: "coast-a",
          stackGroup: "coast-a",
          stackOrdinal: 3,
          marginalStackScore: 4,
        },
      ],
    });

    expect(plan.queued.map((candidate) => candidate.id)).toEqual([
      "port-1",
      "port-2",
      "port-3",
    ]);
  });
});
