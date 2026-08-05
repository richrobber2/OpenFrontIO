import { describe, expect, it } from "vitest";
import {
  earlyPortSeizureValue,
  isNavalRemnantOpportunity,
  maximumNavalInterceptionRisk,
  minimumNavalLaunchReserveRatio,
  navalLaunchDelayTicks,
  overseasExpansionValue,
  preferTribeExpansionTargets,
  prioritizePortLandingTiles,
  relativeOverseasLaunchTroops,
  transportRecallThreshold,
} from "../../src/client/ai/OverseasExpansionPolicy";

describe("OverseasExpansionPolicy", () => {
  it("prefers a larger coast with ports over a tiny equal-distance target", () => {
    const valuable = overseasExpansionValue({
      landTiles: 2_000,
      ports: 2,
      troopDensity: 100,
      normalizedDistance: 0.4,
      isTribe: true,
      opensNationWar: false,
    });
    const tiny = overseasExpansionValue({
      landTiles: 100,
      ports: 0,
      troopDensity: 100,
      normalizedDistance: 0.4,
      isTribe: true,
      opensNationWar: false,
    });
    expect(valuable).toBeGreaterThan(tiny);
  });

  it("sails again sooner when transport slots remain and losses are low", () => {
    expect(
      navalLaunchDelayTicks({
        maximumTransports: 8,
        activeTransports: 2,
        transportLossRate: 0.05,
      }),
    ).toBeLessThan(
      navalLaunchDelayTicks({
        maximumTransports: 8,
        activeTransports: 7,
        transportLossRate: 0.7,
      }),
    );
  });

  it("charges a strong nation-war and distance penalty", () => {
    const tribe = overseasExpansionValue({
      landTiles: 500,
      ports: 1,
      troopDensity: 50,
      normalizedDistance: 0.3,
      isTribe: true,
      opensNationWar: false,
    });
    const nation = overseasExpansionValue({
      landTiles: 500,
      ports: 1,
      troopDensity: 50,
      normalizedDistance: 0.3,
      isTribe: false,
      opensNationWar: true,
    });
    expect(tribe).toBeGreaterThan(nation);
    expect(Number.isFinite(nation)).toBe(true);
  });

  it("banks troops before opening fleets and spaces early launches", () => {
    expect(minimumNavalLaunchReserveRatio(500, 0.8)).toBe(0.85);
    expect(minimumNavalLaunchReserveRatio(3_000, 0.8)).toBe(0.8);
    expect(
      navalLaunchDelayTicks({
        maximumTransports: 8,
        activeTransports: 2,
        transportLossRate: 0,
        earlyExpansion: true,
        isTribe: true,
      }),
    ).toBe(60);
  });

  it("uses measured naval risk above the hard safety floor", () => {
    expect(
      maximumNavalInterceptionRisk({
        transportLossRate: 0.1,
        navalGene: 0,
        cautionGene: 0,
        noLandFront: false,
        reserveRatio: 0.8,
      }),
    ).toBeCloseTo(0.282);
  });

  it("spends trapped troop overflow on a viable overseas route", () => {
    const normal = maximumNavalInterceptionRisk({
      transportLossRate: 0.2,
      navalGene: 0,
      cautionGene: 0,
      noLandFront: false,
      reserveRatio: 0.98,
    });
    const trapped = maximumNavalInterceptionRisk({
      transportLossRate: 0.2,
      navalGene: 0,
      cautionGene: 0,
      noLandFront: true,
      reserveRatio: 0.98,
    });
    expect(trapped).toBeGreaterThan(normal);
    expect(trapped).toBeGreaterThanOrEqual(0.44);
  });

  it("uses viable tribes before opening a distant nation war", () => {
    const targets = preferTribeExpansionTargets([
      { id: "nation", isTribe: false },
      { id: "tribe-a", isTribe: true },
      { id: "tribe-b", isTribe: true },
    ]);
    expect(targets.map((target) => target.id)).toEqual(["tribe-a", "tribe-b"]);
  });

  it("drops ordinary distant nations instead of using them as fallback growth", () => {
    const targets = preferTribeExpansionTargets([
      { id: "large-nation", isTribe: false },
      { id: "far-nation", isTribe: false },
    ]);
    expect(targets).toEqual([]);
  });

  it("sizes feasible transport attacks with a conservative landing margin", () => {
    const weak = relativeOverseasLaunchTroops({
      enemyTroops: 10_000,
      requiredLandingAdvantage: 1.05,
      minimumLaunchTroops: 8_000,
      maximumLaunchTroops: 100_000,
    });
    const strong = relativeOverseasLaunchTroops({
      enemyTroops: 60_000,
      requiredLandingAdvantage: 1.35,
      minimumLaunchTroops: 8_000,
      maximumLaunchTroops: 100_000,
    });
    expect(weak).toBe(12_600);
    expect(strong).toBe(97_200);
  });

  it("refuses a landing when the available launch force cannot win", () => {
    expect(
      relativeOverseasLaunchTroops({
        enemyTroops: 100_000,
        requiredLandingAdvantage: 1.35,
        minimumLaunchTroops: 8_000,
        maximumLaunchTroops: 100_000,
      }),
    ).toBe(0);
  });

  it("prioritizes only extremely weak early ports without warships", () => {
    expect(
      earlyPortSeizureValue({
        ticks: 500,
        enemyPorts: 2,
        enemyWarships: 0,
        enemyToOwnTroopRatio: 0.12,
      }),
    ).toBeGreaterThan(0);
    expect(
      earlyPortSeizureValue({
        ticks: 500,
        enemyPorts: 2,
        enemyWarships: 0,
        enemyToOwnTroopRatio: 0.18,
      }),
    ).toBe(0);
    expect(
      earlyPortSeizureValue({
        ticks: 500,
        enemyPorts: 2,
        enemyWarships: 1,
        enemyToOwnTroopRatio: 0.12,
      }),
    ).toBe(0);
  });

  it("checks port tiles before sampling the rest of a long coastline", () => {
    expect(prioritizePortLandingTiles([1, 2, 3, 4, 5, 6], [5, 6], 4)).toEqual([
      5, 6, 1, 4,
    ]);
  });

  it("keeps safe early port opportunities alongside preferred tribes", () => {
    const targets = preferTribeExpansionTargets([
      { id: "nation-port", isTribe: false, earlyPortOpportunity: true },
      { id: "nation", isTribe: false },
      { id: "tribe", isTribe: true },
    ]);
    expect(targets.map((target) => target.id)).toEqual([
      "nation-port",
      "tribe",
    ]);
  });

  it("keeps disconnected weak nation remnants in the naval target pool", () => {
    expect(
      isNavalRemnantOpportunity({
        ownTroops: 10_000_000,
        ownTiles: 500_000,
        targetTroops: 400_000,
        targetTiles: 1_200,
        targetIsAllied: false,
      }),
    ).toBe(true);
    const targets = preferTribeExpansionTargets([
      { id: "large-nation", isTribe: false },
      { id: "island-remnant", isTribe: false, navalRemnantOpportunity: true },
      { id: "tribe", isTribe: true },
    ]);
    expect(targets.map((target) => target.id)).toEqual([
      "island-remnant",
      "tribe",
    ]);
  });

  it("commits transports longer against weak targets instead of recalling at 40% risk", () => {
    const threshold = transportRecallThreshold({
      targetIsTribe: true,
      targetForceRatio: 0.08,
      learnedLossRate: 0.2,
    });
    expect(threshold).toBeGreaterThan(0.8);
    expect(threshold).toBeLessThanOrEqual(0.94);
  });
});
