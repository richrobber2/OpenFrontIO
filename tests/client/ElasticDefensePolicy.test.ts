import { describe, expect, it } from "vitest";
import { chooseElasticDefense } from "../../src/client/ai/ElasticDefensePolicy";

const base = {
  reserveRatio: 0.5,
  reserveFloor: 0.48,
  incomingTroopRatio: 0.3,
  incomingFronts: 1,
  outgoingCommittedRatio: 0.1,
  borderEconomicValue: 0.6,
  interiorDefenseValue: 0.8,
  territoryShare: 0.2,
  recentTileLossRate: 0.03,
  attackerTroopAdvantage: 1,
};

describe("chooseElasticDefense", () => {
  it("cancels offensives when they starve a pressured defense", () => {
    expect(
      chooseElasticDefense({
        ...base,
        reserveRatio: 0.35,
        incomingTroopRatio: 0.55,
        outgoingCommittedRatio: 0.42,
      }).action,
    ).toBe("cancel_offensives");
  });

  it("trades low-value border land under severe pressure", () => {
    expect(
      chooseElasticDefense({
        ...base,
        incomingTroopRatio: 0.8,
        borderEconomicValue: 0.1,
        interiorDefenseValue: 0.9,
        attackerTroopAdvantage: 1.6,
      }).action,
    ).toBe("trade_land");
  });

  it("counterattacks an overextended attacker from a healthy reserve", () => {
    const decision = chooseElasticDefense({
      ...base,
      reserveRatio: 0.72,
      incomingTroopRatio: 0.35,
      attackerTroopAdvantage: 0.75,
    });
    expect(decision.action).toBe("counterattack");
    expect(decision.counterFraction).toBeGreaterThanOrEqual(0.12);
  });

  it("holds when neither retreat nor counterattack is justified", () => {
    expect(chooseElasticDefense(base).action).toBe("hold");
  });
});
