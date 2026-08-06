import { describe, expect, it } from "vitest";
import {
  CommunicationPlanContext,
  planCommunication,
} from "../../src/client/ai/CommunicationPlanner";

function baseContext(): CommunicationPlanContext {
  return {
    aidRequest: {
      reserveRatio: 0.8,
      reserveFloor: 0.48,
      incomingTroopRatio: 0,
      gold: 100_000,
      plannedBuildCost: null,
      activeNationWars: 0,
      hasTrustedAlly: true,
      ticksSinceLastRequest: 500,
    },
    donation: {
      reserveRatio: 0.8,
      reserveFloor: 0.48,
      gold: 100_000,
      emergencyGoldFloor: 30_000,
      activeNationWars: 0,
      allyIncomingTroopRatio: 0,
      allyReserveRatio: 0.8,
    },
    coordination: {
      ownReserveRatio: 0.8,
      allyReserveRatio: 0.7,
      sharedEnemy: false,
      enemyActiveWars: 0,
      ownActiveNationWars: 0,
      ticksSinceLastMessage: 500,
    },
    ownTroops: 100_000,
    ownMaxTroops: 100_000,
    ownGold: 100_000,
    allyPlayerID: "ally",
    sharedEnemyPlayerID: "enemy",
    receivedMeaningfulAid: false,
    ticksSinceLastThanks: 500,
  };
}

describe("planCommunication", () => {
  it("prioritizes an urgent defense request", () => {
    const context = baseContext();
    context.aidRequest.incomingTroopRatio = 0.6;

    expect(planCommunication(context)).toEqual({
      kind: "quick-chat",
      key: "help.help_defend",
      targetPlayerID: "enemy",
    });
  });

  it("requests troops only from an ally with a real reserve", () => {
    const context = baseContext();
    context.aidRequest.reserveRatio = 0.4;
    context.donation.allyReserveRatio = 0.72;

    expect(planCommunication(context)).toEqual({
      kind: "quick-chat",
      key: "help.troops",
      targetPlayerID: "ally",
    });
  });

  it("does not ask a depleted ally to empty its remaining army", () => {
    const context = baseContext();
    context.aidRequest.reserveRatio = 0.4;
    context.donation.allyReserveRatio = 0.35;

    expect(planCommunication(context)).toEqual({ kind: "none" });
  });

  it("coordinates against a distracted shared enemy", () => {
    const context = baseContext();
    context.coordination.sharedEnemy = true;
    context.coordination.enemyActiveWars = 2;

    expect(planCommunication(context)).toEqual({
      kind: "quick-chat",
      key: "attack.focus",
      targetPlayerID: "enemy",
    });
  });

  it("donates only part of the safe troop surplus", () => {
    const context = baseContext();
    context.donation.allyIncomingTroopRatio = 0.5;
    context.donation.allyReserveRatio = 0.3;

    expect(planCommunication(context)).toEqual({
      kind: "donate-troops",
      amount: 18_000,
    });
  });

  it("protects the reserve floor against capacity rather than current troops", () => {
    const context = baseContext();
    context.ownTroops = 60_000;
    context.ownMaxTroops = 100_000;
    context.donation.reserveRatio = 0.8;
    context.donation.allyIncomingTroopRatio = 0.5;
    context.donation.allyReserveRatio = 0.3;

    expect(planCommunication(context)).toEqual({
      kind: "donate-troops",
      amount: 6_000,
    });
  });

  it("preserves emergency gold while helping an ally", () => {
    const context = baseContext();
    context.donation.reserveRatio = 0.6;
    context.donation.allyIncomingTroopRatio = 0.3;
    context.donation.allyReserveRatio = 0.4;

    expect(planCommunication(context)).toEqual({
      kind: "donate-gold",
      amount: 20_000,
    });
  });

  it("thanks an ally only after higher-value actions are exhausted", () => {
    const context = baseContext();
    context.receivedMeaningfulAid = true;

    expect(planCommunication(context)).toEqual({
      kind: "quick-chat",
      key: "greet.thanks",
      targetPlayerID: "ally",
    });
  });

  it("stays silent when no useful diplomacy action exists", () => {
    expect(planCommunication(baseContext())).toEqual({ kind: "none" });
  });
});
