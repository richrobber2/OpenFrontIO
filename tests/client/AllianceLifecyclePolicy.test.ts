import { describe, expect, it } from "vitest";
import { planAllianceLifecycle } from "../../src/client/ai/AllianceLifecyclePolicy";

const base = {
  isSameTeam: false,
  otherIsTraitor: false,
  sharesBorder: true,
  ticksUntilExpiry: 1_000,
  betrayalPenaltyTicks: 300,
  inExtensionWindow: false,
  ownReserveRatio: 0.8,
  otherReserveRatio: 0.15,
  troopRatio: 0.1,
  capacityRatio: 0.15,
  territoryRatio: 0.08,
  allianceCount: 1,
  hostileNationBorders: 0,
  activeNationWars: 0,
  incomingFronts: 0,
};

describe("AllianceLifecyclePolicy", () => {
  it("breaks only an unusually safe weak alliance with a long expiry", () => {
    const plan = planAllianceLifecycle(base);

    expect(plan.safeElimination).toBe(true);
    expect(plan.action).toBe("break");
  });

  it("renews even a weak ally while multiple hostile fronts remain", () => {
    const plan = planAllianceLifecycle({
      ...base,
      inExtensionWindow: true,
      ticksUntilExpiry: 120,
      hostileNationBorders: 2,
    });

    expect(plan.action).toBe("renew");
  });

  it("renews a comparable ally that closes multiple hostile fronts", () => {
    const plan = planAllianceLifecycle({
      ...base,
      inExtensionWindow: true,
      ticksUntilExpiry: 120,
      otherReserveRatio: 0.7,
      troopRatio: 0.9,
      capacityRatio: 0.9,
      territoryRatio: 0.8,
      hostileNationBorders: 3,
    });

    expect(plan.action).toBe("renew");
  });

  it("does not renew an ally that repeatedly ignores coordination", () => {
    const plan = planAllianceLifecycle({
      ...base,
      inExtensionWindow: true,
      ticksUntilExpiry: 120,
      otherReserveRatio: 0.7,
      troopRatio: 0.9,
      capacityRatio: 0.9,
      territoryRatio: 0.8,
      hostileNationBorders: 1,
      cooperationReliability: 0.2,
      cooperationConfidence: 0.8,
      shouldReplaceUncooperativeAlly: true,
      replacementAvailable: true,
    });

    expect(plan.action).toBe("do-not-renew");
    expect(plan.reason).toContain("ignored");
  });

  it("keeps a new ally until cooperation evidence is meaningful", () => {
    const plan = planAllianceLifecycle({
      ...base,
      inExtensionWindow: true,
      ticksUntilExpiry: 120,
      otherReserveRatio: 0.7,
      troopRatio: 0.9,
      capacityRatio: 0.9,
      territoryRatio: 0.8,
      hostileNationBorders: 3,
      cooperationReliability: 0.2,
      cooperationConfidence: 0.2,
    });

    expect(plan.action).toBe("renew");
  });

  it("does not discard an unresponsive ally during an active invasion", () => {
    const plan = planAllianceLifecycle({
      ...base,
      inExtensionWindow: true,
      ticksUntilExpiry: 120,
      otherReserveRatio: 0.7,
      troopRatio: 0.9,
      capacityRatio: 0.9,
      territoryRatio: 0.8,
      incomingFronts: 1,
      cooperationReliability: 0.2,
      cooperationConfidence: 0.8,
      shouldReplaceUncooperativeAlly: true,
      replacementAvailable: true,
    });

    expect(plan.action).toBe("renew");
  });

  it("does not discard a growth-blocking weak ally during an invasion", () => {
    const plan = planAllianceLifecycle({
      ...base,
      inExtensionWindow: true,
      ticksUntilExpiry: 120,
      ownReserveRatio: 0.32,
      incomingFronts: 1,
    });

    expect(plan.action).toBe("renew");
  });

  it("ends the final alliance when a full reserve has the stronger forecast", () => {
    const plan = planAllianceLifecycle({
      ...base,
      sharesBorder: false,
      ownReserveRatio: 0.97,
      otherReserveRatio: 0.7,
      troopRatio: 0.72,
      capacityRatio: 0.9,
      territoryRatio: 1.4,
      otherPlayersAlive: 1,
      forecast: {
        predictedChoice: "bank",
        threat: 0.73,
        confidence: 0.8,
      },
    });

    expect(plan.action).toBe("break");
    expect(plan.reason).toContain("only remaining opponent");
  });

  it("declines a final extension while still preparing for a stronger ally", () => {
    const plan = planAllianceLifecycle({
      ...base,
      sharesBorder: false,
      inExtensionWindow: true,
      ownReserveRatio: 0.7,
      troopRatio: 1.2,
      otherPlayersAlive: 1,
      forecast: {
        predictedChoice: "attack",
        threat: 1.4,
        confidence: 0.8,
      },
    });

    expect(plan.action).toBe("do-not-renew");
  });
});
