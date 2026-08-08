// @vitest-environment node

import { describe, expect, it } from "vitest";
import {
  planEconomicSystems,
  type EconomicSystemContext,
} from "../../src/client/ai/EconomicSystemPolicy";

function context(overrides: Partial<EconomicSystemContext> = {}): EconomicSystemContext {
  return {
    gold: 4_000_000,
    incomePerMinute: 100_000,
    reserveRatio: 0.82,
    incomingTroopRatio: 0,
    hostileFronts: 1,
    activeNationWars: 0,
    hasNeutralLand: false,
    trapped: false,
    cities: 4,
    desiredCities: 5,
    stackedCities: 3,
    factories: 0,
    productiveFactoryStops: 0,
    isolatedFactories: 0,
    ports: 1,
    factoryConnectedPorts: 0,
    unconnectedPorts: 1,
    tradePartners: 4,
    embargoedPartners: 0,
    railStops: 5,
    connectedRailStops: 1,
    defensePosts: 1,
    strategicStructures: 6,
    exposedEconomicStructures: 0,
    cityCost: 250_000,
    factoryCost: 250_000,
    portCost: 250_000,
    defensePostCost: 100_000,
    ...overrides,
  };
}

describe("growth-aware economic risk guard", () => {
  it("deploys safe surplus capital but suppresses growth pressure under attack", () => {
    const safe = planEconomicSystems(context());
    const threatened = planEconomicSystems(
      context({
        incomingTroopRatio: 1,
        reserveRatio: 0.35,
        hostileFronts: 4,
        activeNationWars: 2,
        exposedEconomicStructures: 4,
      }),
    );

    expect(safe.action).toBe("activate-rail");
    expect(safe.capitalDeploymentPressure).toBeGreaterThan(0.8);
    expect(threatened.risk).toBe(1);
    expect(threatened.scores.bank).toBeGreaterThan(safe.scores.bank);
    expect(threatened.scores["activate-rail"]).toBeLessThan(
      safe.scores["activate-rail"],
    );
    expect(["bank", "protect-assets"]).toContain(threatened.action);
  });
});
