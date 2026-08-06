import { describe, expect, it } from "vitest";
import {
  modelOpponent,
  planStrategicAction,
} from "../../src/client/ai/StrategicActionPlanner";

describe("StrategicActionPlanner", () => {
  it("prioritizes defense when incoming pressure is high", () => {
    const plan = planStrategicAction({
      reserveRatio: 0.34,
      incomingFronts: 2,
      incomingTroops: 80_000,
      maxTroops: 100_000,
      hasNeutralLand: true,
      hostileBorders: 2,
      activeNationWars: 1,
      navalThreats: 0,
      tradeTargets: 3,
      siloTargets: 2,
      opponents: [],
    });
    expect(plan.action).toBe("defend");
  });

  it("does not let a large naval score hide existential land pressure", () => {
    const plan = planStrategicAction({
      reserveRatio: 0.2,
      incomingFronts: 2,
      incomingTroops: 2_400_000,
      maxTroops: 150_000,
      hasNeutralLand: false,
      hostileBorders: 2,
      activeNationWars: 2,
      navalThreats: 200,
      tradeTargets: 200,
      siloTargets: 0,
      opponents: [],
    });

    expect(plan.scores.naval).toBeGreaterThan(plan.scores.defend);
    expect(plan.action).toBe("defend");
    expect(plan.reason).toContain("mandatory");
  });

  it("models silo growth and selects a strike opportunity", () => {
    const opponent = modelOpponent({
      id: "nation-1",
      troops: 90_000,
      maxTroops: 100_000,
      tiles: 5_000,
      ownTiles: 1_000,
      incomingAttacks: 0,
      outgoingAttacks: 2,
      silos: 3,
      warships: 0,
    });
    const plan = planStrategicAction({
      reserveRatio: 0.8,
      incomingFronts: 0,
      incomingTroops: 0,
      maxTroops: 100_000,
      hasNeutralLand: false,
      hostileBorders: 0,
      activeNationWars: 0,
      navalThreats: 0,
      tradeTargets: 0,
      siloTargets: 3,
      readyStrategicSlots: 1,
      affordableStrategicWeapons: 1,
      actionableStrikeTargets: 1,
      opponents: [opponent],
    });
    expect(opponent.growthPressure).toBeGreaterThan(1);
    expect(plan.action).toBe("strike");
  });

  it("uses local naval percentages instead of global ship counts", () => {
    const plan = planStrategicAction({
      reserveRatio: 0.8,
      incomingFronts: 0,
      incomingTroops: 0,
      maxTroops: 100_000,
      hasNeutralLand: true,
      hostileBorders: 1,
      activeNationWars: 0,
      navalThreats: 400,
      tradeTargets: 400,
      navalPressureRatio: 0.02,
      tradeOpportunityRatio: 0.05,
      siloTargets: 0,
      opponents: [],
    });

    expect(plan.action).not.toBe("naval");
    expect(plan.scores.naval).toBeLessThan(plan.scores.expand);
  });

  it("does not let remote silo counts drown out local growth choices", () => {
    const plan = planStrategicAction({
      reserveRatio: 0.8,
      incomingFronts: 0,
      incomingTroops: 0,
      maxTroops: 100_000,
      hasNeutralLand: true,
      hostileBorders: 1,
      activeNationWars: 0,
      navalThreats: 0,
      tradeTargets: 0,
      siloTargets: 400,
      opponents: [],
    });

    expect(plan.scores.strike).toBe(0);
    expect(plan.action).not.toBe("strike");
  });

  it("raises growth pressure when an opponent is rapidly expanding", () => {
    const model = modelOpponent({
      id: "fast-grower",
      troops: 80_000,
      maxTroops: 100_000,
      tiles: 1_000,
      ownTiles: 1_000,
      incomingAttacks: 0,
      outgoingAttacks: 0,
      silos: 0,
      warships: 0,
      previousTiles: 700,
      previousTroops: 70_000,
      elapsedTicks: 10,
    });
    expect(model.territoryGrowthRate).toBe(30);
    expect(model.troopGrowthRate).toBe(1_000);
    expect(model.growthPressure).toBeGreaterThan(0.9);
  });

  it("feeds predicted opponent choices into strategic pressure", () => {
    const baseline = modelOpponent({
      id: "baseline",
      troops: 60_000,
      maxTroops: 100_000,
      tiles: 1_000,
      ownTiles: 1_000,
      incomingAttacks: 0,
      outgoingAttacks: 0,
      silos: 0,
      warships: 0,
    });
    const forecasted = modelOpponent({
      id: "forecasted",
      troops: 60_000,
      maxTroops: 100_000,
      tiles: 1_000,
      ownTiles: 1_000,
      incomingAttacks: 0,
      outgoingAttacks: 0,
      silos: 0,
      warships: 0,
      predictedChoice: "attack",
      forecastThreat: 1.5,
    });

    expect(forecasted.militaryPressure).toBeGreaterThan(
      baseline.militaryPressure,
    );
  });
});
