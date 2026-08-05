import { describe, expect, it } from "vitest";
import {
  nationFrontPolicy,
  nationLandFrontAllowed,
  shouldRiskDenialRaid,
} from "../../src/client/ai/StrategyMath";

describe("nationFrontPolicy", () => {
  it("allows at most one proactive nation war", () => {
    const policy = nationFrontPolicy({ nationFronts: 1, activeNationWars: 0 });

    expect(policy.maxNationOffensives).toBe(1);
    expect(policy.reserveFloor).toBeGreaterThanOrEqual(0.48);
    expect(policy.advantageMultiplier).toBeGreaterThanOrEqual(1.25);
  });

  it("allows an existing nation war to resume with one active slot", () => {
    const policy = nationFrontPolicy({ nationFronts: 2, activeNationWars: 1 });

    expect(policy.maxNationOffensives).toBe(1);
    expect(policy.reserveFloor).toBeGreaterThan(0.5);
    expect(policy.advantageMultiplier).toBeGreaterThan(1.4);
  });

  it("keeps one bounded offensive slot when surrounded", () => {
    const policy = nationFrontPolicy({ nationFronts: 4, activeNationWars: 0 });

    expect(policy.maxNationOffensives).toBe(1);
    expect(policy.desiredAlliances).toBe(2);
  });
});

describe("shouldRiskDenialRaid", () => {
  it("rejects a merely local bargain across many exposed borders", () => {
    expect(
      shouldRiskDenialRaid({
        isTribe: false,
        nationBorders: 5,
        targetTroops: 1_200_000,
        ourTroops: 1_700_000,
        targetDistracted: false,
        reserveRatio: 0.85,
      }),
    ).toBe(false);
  });

  it("allows a safely outnumbered distracted nation at a full reserve", () => {
    expect(
      shouldRiskDenialRaid({
        isTribe: false,
        nationBorders: 5,
        targetTroops: 1_200_000,
        ourTroops: 1_700_000,
        targetDistracted: true,
        reserveRatio: 0.92,
      }),
    ).toBe(true);
  });

  it("never blocks a tribe commitment", () => {
    expect(
      shouldRiskDenialRaid({
        isTribe: true,
        nationBorders: 6,
        targetTroops: 2_000_000,
        ourTroops: 1_000_000,
        targetDistracted: false,
        reserveRatio: 0.5,
      }),
    ).toBe(true);
  });
});

describe("nationLandFrontAllowed", () => {
  it("allows the reachable border when only a remote war is remembered", () => {
    expect(
      nationLandFrontAllowed({
        isNation: true,
        targetID: "reachable",
        activeBorderWarIDs: new Set(),
        activeOffensiveIDs: new Set(),
        maxNationOffensives: 1,
      }),
    ).toBe(true);
  });

  it("does not open an unrelated second bordering war", () => {
    expect(
      nationLandFrontAllowed({
        isNation: true,
        targetID: "new-front",
        activeBorderWarIDs: new Set(["existing-front"]),
        activeOffensiveIDs: new Set(),
        maxNationOffensives: 1,
      }),
    ).toBe(false);
  });
});
