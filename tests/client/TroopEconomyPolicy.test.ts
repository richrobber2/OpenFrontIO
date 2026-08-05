import { describe, expect, it } from "vitest";
import {
  assessMaxPushRisk,
  decideTroopEconomy,
} from "../../src/client/ai/TroopEconomyPolicy";

const base = {
  reserveRatio: 0.8,
  reserveFloor: 0.48,
  incomingTroopRatio: 0,
  outgoingCommittedRatio: 0,
  activeFronts: 0,
  neutralLandAvailable: false,
  targetTroopAdvantage: 1.8,
  targetValue: 0.9,
  targetFortificationMultiplier: 1,
};

describe("decideTroopEconomy", () => {
  it("refuses another attack under heavy pressure", () => {
    expect(
      decideTroopEconomy({
        ...base,
        incomingTroopRatio: 0.4,
        outgoingCommittedRatio: 0.3,
      }).maxCommitFraction,
    ).toBe(0);
  });

  it("uses bounded pulses for neutral expansion", () => {
    const result = decideTroopEconomy({
      ...base,
      neutralLandAvailable: true,
      reserveRatio: 0.72,
    });
    expect(result.action).toBe("pulse-expand");
    expect(result.maxCommitFraction).toBeLessThanOrEqual(0.28);
  });

  it("rejects a fortified target without enough effective advantage", () => {
    const result = decideTroopEconomy({
      ...base,
      targetTroopAdvantage: 2,
      targetFortificationMultiplier: 5,
    });
    expect(result.action).toBe("hold");
  });

  it("allows a bounded attack that preserves reserve", () => {
    const result = decideTroopEconomy(base);
    expect(result.action).toBe("attack");
    expect(result.maxCommitFraction).toBeGreaterThanOrEqual(0.12);
    expect(result.maxCommitFraction).toBeLessThanOrEqual(0.42);
  });
});

describe("assessMaxPushRisk", () => {
  it("rejects a two-times push when the defender can wipe the squad", () => {
    expect(
      assessMaxPushRisk({
        reserveRatio: 0.9,
        commitFractionOfCurrent: 0.6,
        activeFronts: 0,
        defenderTroopRatio: 0.95,
        takeSpeedMultiplier: 2,
      }).allowed,
    ).toBe(false);
  });

  it("rejects a max push when it exposes an existing front", () => {
    expect(
      assessMaxPushRisk({
        reserveRatio: 0.9,
        commitFractionOfCurrent: 0.5,
        activeFronts: 1,
        defenderTroopRatio: 0.2,
        takeSpeedMultiplier: 2,
      }).allowed,
    ).toBe(false);
  });

  it("allows the speed gamble with a clear front and strong advantage", () => {
    expect(
      assessMaxPushRisk({
        reserveRatio: 0.95,
        commitFractionOfCurrent: 0.45,
        activeFronts: 0,
        defenderTroopRatio: 0.4,
        takeSpeedMultiplier: 2,
      }).allowed,
    ).toBe(true);
  });
});
