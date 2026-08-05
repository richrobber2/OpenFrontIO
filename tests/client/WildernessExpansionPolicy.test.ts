import { describe, expect, it } from "vitest";
import { planWildernessExpansion } from "../../src/client/ai/WildernessExpansionPolicy";

describe("WildernessExpansionPolicy", () => {
  const safeOpening = {
    hasNeutralLand: true,
    reserveRatio: 0.42,
    reserveFloor: 0.4,
    incomingFronts: 0,
    outgoingFronts: 0,
    maximumFronts: 5,
    wildernessAttackActive: false,
  };

  it("attacks wilderness at the first useful safe reserve without a tick delay", () => {
    const plan = planWildernessExpansion(safeOpening);

    expect(plan.attack).toBe(true);
    expect(plan.fraction).toBeCloseTo((0.42 - 0.4) / 0.42);
    expect(plan.projectedReserveRatio).toBeCloseTo(0.4);
  });

  it("does not send a useless token force below the reserve floor", () => {
    const plan = planWildernessExpansion({
      ...safeOpening,
      reserveRatio: 0.41,
    });

    expect(plan.attack).toBe(false);
    expect(plan.fraction).toBe(0);
  });

  it("uses up to thirty-five percent when the bank is full", () => {
    const plan = planWildernessExpansion({
      ...safeOpening,
      reserveRatio: 1,
    });

    expect(plan.attack).toBe(true);
    expect(plan.fraction).toBe(0.35);
    expect(plan.projectedReserveRatio).toBe(0.65);
  });

  it("can add wilderness growth beside another safe opening front", () => {
    const plan = planWildernessExpansion({
      ...safeOpening,
      reserveRatio: 0.6,
      reserveFloor: 0.48,
      outgoingFronts: 1,
      maximumFronts: 5,
    });

    expect(plan.attack).toBe(true);
    expect(plan.fraction).toBeCloseTo(0.2);
    expect(plan.projectedReserveRatio).toBeCloseTo(0.48);
  });

  it("does not duplicate an active wilderness attack", () => {
    expect(
      planWildernessExpansion({
        ...safeOpening,
        reserveRatio: 0.8,
        wildernessAttackActive: true,
      }).attack,
    ).toBe(false);
  });

  it("gives incoming defense priority", () => {
    expect(
      planWildernessExpansion({
        ...safeOpening,
        reserveRatio: 0.8,
        incomingFronts: 1,
      }).attack,
    ).toBe(false);
  });

  it("respects the active front limit", () => {
    expect(
      planWildernessExpansion({
        ...safeOpening,
        reserveRatio: 0.8,
        outgoingFronts: 5,
      }).attack,
    ).toBe(false);
  });

  it("does nothing when no adjacent neutral land exists", () => {
    expect(
      planWildernessExpansion({
        ...safeOpening,
        reserveRatio: 0.8,
        hasNeutralLand: false,
      }).attack,
    ).toBe(false);
  });
});
