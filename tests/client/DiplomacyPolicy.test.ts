import { describe, expect, it } from "vitest";
import {
  chooseAidRequest,
  shouldCoordinateAttack,
  shouldDonateGold,
  shouldDonateTroops,
} from "../../src/client/ai/DiplomacyPolicy";

describe("AI diplomacy policy", () => {
  it("requests defense under severe incoming pressure", () => {
    expect(
      chooseAidRequest({
        reserveRatio: 0.42,
        reserveFloor: 0.48,
        incomingTroopRatio: 0.6,
        gold: 10_000,
        plannedBuildCost: null,
        activeNationWars: 1,
        hasTrustedAlly: true,
        ticksSinceLastRequest: 300,
      }),
    ).toBe("defense");
  });

  it("requests troops when below the reserve floor", () => {
    expect(
      chooseAidRequest({
        reserveRatio: 0.4,
        reserveFloor: 0.48,
        incomingTroopRatio: 0.1,
        gold: 20_000,
        plannedBuildCost: null,
        activeNationWars: 0,
        hasTrustedAlly: true,
        ticksSinceLastRequest: 300,
      }),
    ).toBe("troops");
  });

  it("requests gold for a planned strategic build", () => {
    expect(
      chooseAidRequest({
        reserveRatio: 0.7,
        reserveFloor: 0.48,
        incomingTroopRatio: 0,
        gold: 25_000,
        plannedBuildCost: 50_000,
        activeNationWars: 0,
        hasTrustedAlly: true,
        ticksSinceLastRequest: 300,
      }),
    ).toBe("gold");
  });

  it("rate limits repeated requests", () => {
    expect(
      chooseAidRequest({
        reserveRatio: 0.2,
        reserveFloor: 0.48,
        incomingTroopRatio: 0.9,
        gold: 0,
        plannedBuildCost: 50_000,
        activeNationWars: 2,
        hasTrustedAlly: true,
        ticksSinceLastRequest: 100,
      }),
    ).toBeNull();
  });

  it("donates troops only from a safe surplus", () => {
    expect(
      shouldDonateTroops({
        reserveRatio: 0.82,
        reserveFloor: 0.48,
        gold: 100_000,
        emergencyGoldFloor: 40_000,
        activeNationWars: 0,
        allyIncomingTroopRatio: 0.5,
        allyReserveRatio: 0.3,
      }),
    ).toBe(true);
  });

  it("preserves its own army during an active nation war", () => {
    expect(
      shouldDonateTroops({
        reserveRatio: 0.9,
        reserveFloor: 0.48,
        gold: 100_000,
        emergencyGoldFloor: 40_000,
        activeNationWars: 1,
        allyIncomingTroopRatio: 0.5,
        allyReserveRatio: 0.3,
      }),
    ).toBe(false);
  });

  it("donates excess gold to a threatened ally", () => {
    expect(
      shouldDonateGold({
        reserveRatio: 0.7,
        reserveFloor: 0.48,
        gold: 100_000,
        emergencyGoldFloor: 40_000,
        activeNationWars: 0,
        allyIncomingTroopRatio: 0.4,
        allyReserveRatio: 0.35,
      }),
    ).toBe(true);
  });

  it("coordinates only when both partners can sustain the attack", () => {
    expect(
      shouldCoordinateAttack({
        ownReserveRatio: 0.72,
        allyReserveRatio: 0.62,
        sharedEnemy: true,
        enemyActiveWars: 1,
        ownActiveNationWars: 0,
        ticksSinceLastMessage: 300,
      }),
    ).toBe(true);
  });
});
