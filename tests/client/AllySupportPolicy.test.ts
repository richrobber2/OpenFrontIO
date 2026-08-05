import { describe, expect, it } from "vitest";
import { chooseAllySupport } from "../../src/client/ai/AllySupportPolicy";

const base = {
  ownGold: 5_000,
  ownTroops: 20_000,
  ownMaxTroops: 24_000,
  ownCities: 3,
  ownTroopRegenPerMinute: 900,
  ownEmergencyGoldFloor: 1_500,
  ownReserveTroops: 12_000,
  ownActiveWars: 0,
  ownImmediateSpendingNeed: 0.1,
  ownBorderThreat: 0.1,
  ticksSinceLastAid: 500,
  allianceAgeTicks: 2_000,
  allyTrust: 0.9,
  allyBetrayalRisk: 0.08,
  allyReciprocity: 0.8,
  allySharesBorder: false,
  cumulativeTroopsSentToAlly: 0,
  cumulativeGoldSentToAlly: 0,
  allyGold: 500,
  allyTroops: 2_000,
  allyIncomingTroops: 1_500,
  allyMinimumSurvivalTroops: 4_000,
  allyPlannedBuildCost: 1_200,
  allyPowerRatioToSelf: 0.35,
};

describe("chooseAllySupport", () => {
  it("sends only a small survival bridge rather than filling the ally deficit", () => {
    const decision = chooseAllySupport(base);
    expect(decision.action).toBe("send-troops");
    expect(decision.amount).toBeGreaterThan(0);
    expect(decision.amount).toBeLessThan(1_500);
  });

  it("sends more from proven city-backed capacity without exceeding exposure limits", () => {
    const ordinary = chooseAllySupport(base);
    const cityRich = chooseAllySupport({
      ...base,
      ownTroops: 90_000,
      ownMaxTroops: 100_000,
      ownReserveTroops: 65_000,
      ownCities: 10,
      ownTroopRegenPerMinute: 10_000,
      allyMinimumSurvivalTroops: 30_000,
      allyTroops: 5_000,
      allyIncomingTroops: 5_000,
    });
    expect(cityRich.action).toBe("send-troops");
    expect(cityRich.amount).toBeGreaterThan(ordinary.amount);
    expect(cityRich.amount).toBeLessThanOrEqual(7_000);
  });

  it("does not donate merely because max troops is high when current troops are low", () => {
    const decision = chooseAllySupport({
      ...base,
      ownTroops: 35_000,
      ownMaxTroops: 100_000,
      ownReserveTroops: 30_000,
      ownCities: 10,
      ownTroopRegenPerMinute: 10_000,
    });
    expect(decision.action).not.toBe("send-troops");
  });

  it("refuses further aid after cumulative troop exposure reaches the limit", () => {
    const decision = chooseAllySupport({
      ...base,
      ownMaxTroops: 100_000,
      ownTroops: 90_000,
      cumulativeTroopsSentToAlly: 14_000,
    });
    expect(decision.action).toBe("hold");
  });

  it("requires reciprocity before repeatedly supporting the same ally", () => {
    const decision = chooseAllySupport({
      ...base,
      cumulativeTroopsSentToAlly: 1_000,
      allyReciprocity: 0.2,
    });
    expect(decision.action).toBe("hold");
  });

  it("treats a shared border as additional betrayal exposure", () => {
    const safe = chooseAllySupport(base);
    const exposed = chooseAllySupport({
      ...base,
      allySharesBorder: true,
      allyBetrayalRisk: 0.18,
      allyReciprocity: 0.55,
    });
    expect(safe.action).toBe("send-troops");
    expect(exposed.action).toBe("hold");
  });

  it("does not materially support a young alliance without exceptional trust", () => {
    const decision = chooseAllySupport({
      ...base,
      allianceAgeTicks: 200,
      allyTrust: 0.88,
    });
    expect(decision.action).toBe("hold");
  });

  it("funds only a guarded portion of the ally's immediate build shortfall", () => {
    const decision = chooseAllySupport({
      ...base,
      allyTroops: 6_000,
      allyIncomingTroops: 0,
      allyPlannedBuildCost: 1_200,
      allyGold: 900,
    });
    expect(decision.action).toBe("send-gold");
    expect(decision.amount).toBeGreaterThan(0);
    expect(decision.amount).toBeLessThanOrEqual(300);
  });

  it("does not aid an unreliable ally", () => {
    const decision = chooseAllySupport({
      ...base,
      allyTrust: 0.55,
      allyBetrayalRisk: 0.45,
    });
    expect(decision.action).toBe("hold");
  });

  it("does not strengthen an ally close to our own power", () => {
    const decision = chooseAllySupport({
      ...base,
      allyPowerRatioToSelf: 0.85,
    });
    expect(decision.action).toBe("hold");
  });

  it("keeps aid behind own wars, urgent spending, and border threats", () => {
    expect(
      chooseAllySupport({ ...base, ownActiveWars: 1 }).action,
    ).toBe("hold");
    expect(
      chooseAllySupport({ ...base, ownBorderThreat: 0.7 }).action,
    ).toBe("hold");
  });

  it("does not repeatedly subsidize a stable ally", () => {
    const decision = chooseAllySupport({
      ...base,
      allyTroops: 8_000,
      allyIncomingTroops: 0,
      allyPlannedBuildCost: null,
    });
    expect(decision.action).toBe("hold");
  });
});
