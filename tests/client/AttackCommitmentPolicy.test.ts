import { describe, expect, it } from "vitest";
import { assessAttackCommitment } from "../../src/client/ai/AttackCommitmentPolicy";

describe("assessAttackCommitment", () => {
  it("blocks proactive attacks when reserve is already at its floor", () => {
    const result = assessAttackCommitment({
      reserveRatio: 0.46,
      reserveFloor: 0.46,
      activeFronts: 1,
      incomingTroopRatio: 0,
      targetTroopRatio: 0.3,
      estimatedConquestTicks: 180,
      targetStrategicValue: 0.8,
      isRetaliation: false,
    });

    expect(result.allowed).toBe(false);
    expect(result.maxCommitFraction).toBe(0);
  });

  it("shrinks commitment under incoming pressure and multiple fronts", () => {
    const result = assessAttackCommitment({
      reserveRatio: 0.82,
      reserveFloor: 0.45,
      activeFronts: 2,
      incomingTroopRatio: 0.3,
      targetTroopRatio: 0.4,
      estimatedConquestTicks: 250,
      targetStrategicValue: 0.9,
      isRetaliation: false,
    });

    expect(result.allowed).toBe(true);
    expect(result.maxCommitFraction).toBeLessThan(0.2);
  });

  it("blocks opening a fourth front", () => {
    const result = assessAttackCommitment({
      reserveRatio: 0.9,
      reserveFloor: 0.4,
      activeFronts: 3,
      incomingTroopRatio: 0,
      targetTroopRatio: 0.2,
      estimatedConquestTicks: 120,
      targetStrategicValue: 1,
      isRetaliation: false,
    });

    expect(result.allowed).toBe(false);
  });

  it("permits a bounded defensive retaliation", () => {
    const result = assessAttackCommitment({
      reserveRatio: 0.62,
      reserveFloor: 0.45,
      activeFronts: 2,
      incomingTroopRatio: 0.2,
      targetTroopRatio: 0.8,
      estimatedConquestTicks: 500,
      targetStrategicValue: 0.2,
      isRetaliation: true,
    });

    expect(result.allowed).toBe(true);
    expect(result.maxCommitFraction).toBeGreaterThanOrEqual(0.08);
    expect(result.maxCommitFraction).toBeLessThan(0.25);
  });
});
