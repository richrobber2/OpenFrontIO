import { describe, expect, it } from "vitest";
import {
  capacityEscapeCityBudget,
  EconomicSystemContext,
  planEconomicSystems,
  selectFactoryUpgradeCandidates,
  shouldFundFirstPressureFactory,
} from "../../src/client/ai/EconomicSystemPolicy";

describe("capacityEscapeCityBudget", () => {
  it("spends protected gold on a city when capacity makes conquest impossible", () => {
    expect(
      capacityEscapeCityBudget({
        gold: 500_000,
        protectedSpendableGold: 0,
        cityCost: 250_000,
        cities: 3,
        desiredCities: 5,
        requiredTroops: 1_300_000,
        maxTroops: 1_000_000,
        incomingFronts: 0,
      }),
    ).toEqual({ spendableGold: 500_000, bypassBank: true });
  });

  it("keeps the reserve while under attack or already at the city target", () => {
    const base = {
      gold: 500_000,
      protectedSpendableGold: 0,
      cityCost: 250_000,
      cities: 3,
      desiredCities: 5,
      requiredTroops: 1_300_000,
      maxTroops: 1_000_000,
    };
    expect(
      capacityEscapeCityBudget({ ...base, incomingFronts: 1 }).bypassBank,
    ).toBe(false);
    expect(
      capacityEscapeCityBudget({
        ...base,
        cities: 5,
        incomingFronts: 0,
      }).bypassBank,
    ).toBe(false);
  });

  it("funds an affordable city before a healthy multi-front position collapses", () => {
    expect(
      capacityEscapeCityBudget({
        gold: 140_000,
        protectedSpendableGold: 0,
        cityCost: 100_000,
        cities: 2,
        desiredCities: 12,
        requiredTroops: 900_000,
        maxTroops: 1_000_000,
        incomingFronts: 0,
        hostileFronts: 4,
        activeNationWars: 1,
        reserveRatio: 0.72,
      }),
    ).toEqual({ spendableGold: 140_000, bypassBank: true });
  });

  it("does not drain the bank for pressure cities while reserves are weak", () => {
    expect(
      capacityEscapeCityBudget({
        gold: 140_000,
        protectedSpendableGold: 0,
        cityCost: 100_000,
        cities: 2,
        desiredCities: 12,
        requiredTroops: 900_000,
        maxTroops: 1_000_000,
        incomingFronts: 0,
        hostileFronts: 4,
        activeNationWars: 1,
        reserveRatio: 0.6,
      }).bypassBank,
    ).toBe(false);
  });
});

describe("shouldFundFirstPressureFactory", () => {
  const ready = {
    factories: 0,
    cities: 4,
    ownedTiles: 30_000,
    reserveRatio: 0.76,
    incomingFronts: 0,
    hostileFronts: 2,
    activeNationWars: 2,
    noGrowthTicks: 40,
    unconnectedPorts: 1,
  };

  it("funds the first factory before tiny raids hide strategic stagnation", () => {
    expect(shouldFundFirstPressureFactory(ready)).toBe(true);
  });

  it("lets a boxed-in one-city economy compound before elimination", () => {
    expect(
      shouldFundFirstPressureFactory({
        ...ready,
        cities: 1,
        ownedTiles: 9_600,
        reserveRatio: 0.64,
        hostileFronts: 2,
        activeNationWars: 1,
        unconnectedPorts: 0,
      }),
    ).toBe(true);
  });

  it("waits during an invasion or weak troop reserve", () => {
    expect(
      shouldFundFirstPressureFactory({ ...ready, incomingFronts: 1 }),
    ).toBe(false);
    expect(
      shouldFundFirstPressureFactory({ ...ready, reserveRatio: 0.5 }),
    ).toBe(false);
  });

  it("never uses the bypass for additional factories", () => {
    expect(shouldFundFirstPressureFactory({ ...ready, factories: 1 })).toBe(
      false,
    );
  });
});

const base: EconomicSystemContext = {
  gold: 5_000_000,
  incomePerMinute: 200_000,
  reserveRatio: 0.75,
  incomingTroopRatio: 0,
  hostileFronts: 1,
  activeNationWars: 0,
  hasNeutralLand: false,
  trapped: false,
  cities: 6,
  desiredCities: 6,
  stackedCities: 6,
  factories: 1,
  productiveFactoryStops: 5,
  isolatedFactories: 0,
  ports: 1,
  tradePartners: 2,
  embargoedPartners: 0,
  railStops: 7,
  connectedRailStops: 7,
  defensePosts: 2,
  strategicStructures: 9,
  exposedEconomicStructures: 0,
  cityCost: 1_000_000,
  factoryCost: 1_000_000,
  portCost: 1_000_000,
  defensePostCost: 150_000,
};

describe("planEconomicSystems", () => {
  it("protects exposed economic assets before adding more", () => {
    const plan = planEconomicSystems({
      ...base,
      incomingTroopRatio: 0.65,
      activeNationWars: 2,
      exposedEconomicStructures: 6,
      defensePosts: 0,
    });

    expect(plan.action).toBe("protect-assets");
    expect(plan.scores["protect-assets"]).toBeGreaterThan(
      plan.scores["extend-trade"],
    );
  });

  it("stacks cities when capacity and placement are lagging", () => {
    const plan = planEconomicSystems({
      ...base,
      cities: 3,
      desiredCities: 8,
      stackedCities: 1,
      railStops: 4,
      connectedRailStops: 4,
    });

    expect(plan.action).toBe("stack-capacity");
  });

  it("activates a mature city network before opening ports", () => {
    const plan = planEconomicSystems({
      ...base,
      factories: 0,
      productiveFactoryStops: 0,
      ports: 0,
      railStops: 6,
      connectedRailStops: 0,
      tradePartners: 1,
    });

    expect(plan.action).toBe("activate-rail");
  });

  it("extends trade only when factories and partners support it", () => {
    const plan = planEconomicSystems({
      ...base,
      ports: 0,
      tradePartners: 8,
      productiveFactoryStops: 8,
    });

    expect(plan.action).toBe("extend-trade");
  });

  it("scales desired trade coverage as a percentage of usable partners", () => {
    const plan = planEconomicSystems({
      ...base,
      ports: 0,
      tradePartners: 40,
      embargoedPartners: 10,
      productiveFactoryStops: 8,
    });

    expect(plan.tradeCoverageTargetRatio).toBeGreaterThanOrEqual(0.05);
    expect(plan.tradeCoverageTargetRatio).toBeLessThanOrEqual(0.2);
    expect(plan.reason).toContain(
      `${Math.round(plan.tradeCoverageTargetRatio * 100)}%`,
    );
  });

  it("discounts embargoed partners instead of building toward them", () => {
    const openTrade = planEconomicSystems({
      ...base,
      ports: 0,
      tradePartners: 4,
      embargoedPartners: 0,
    });
    const embargoed = planEconomicSystems({
      ...base,
      ports: 0,
      tradePartners: 0,
      embargoedPartners: 4,
    });

    expect(openTrade.scores["extend-trade"]).toBeGreaterThan(
      embargoed.scores["extend-trade"],
    );
    expect(embargoed.action).not.toBe("extend-trade");
  });

  it("uses live income and replacement costs for the reserve floor", () => {
    const lowIncome = planEconomicSystems({
      ...base,
      incomePerMinute: 10_000,
      exposedEconomicStructures: 1,
    });
    const highIncome = planEconomicSystems({
      ...base,
      incomePerMinute: 2_000_000,
      exposedEconomicStructures: 4,
      incomingTroopRatio: 0.5,
    });

    expect(highIncome.goldReserveFloor).toBeGreaterThan(
      lowIncome.goldReserveFloor,
    );
  });

  it("banks when no purchase fits above the connected-system reserve", () => {
    const plan = planEconomicSystems({
      ...base,
      gold: 100_000,
      incomePerMinute: 500_000,
      exposedEconomicStructures: 5,
    });

    expect(plan.spendableGold).toBe(0);
    expect(plan.action).toBe("bank");
  });

  it("prioritizes a factory connection for isolated shipyards", () => {
    const plan = planEconomicSystems({
      ...base,
      ports: 2,
      factoryConnectedPorts: 0,
      unconnectedPorts: 2,
      factories: 1,
      railStops: 4,
      connectedRailStops: 1,
    });

    expect(plan.action).toBe("activate-rail");
    expect(plan.reason).toContain("2 isolated shipyards");
  });

  it("stops treating a saturated rail network as the best investment", () => {
    const plan = planEconomicSystems({
      ...base,
      gold: 72_000_000,
      incomePerMinute: 67_000,
      reserveRatio: 0.94,
      cities: 71,
      desiredCities: 71,
      stackedCities: 29,
      factories: 26,
      productiveFactoryStops: 272,
      isolatedFactories: 0,
      ports: 31,
      factoryConnectedPorts: 29,
      unconnectedPorts: 2,
      tradePartners: 5,
      embargoedPartners: 3,
      railStops: 102,
      connectedRailStops: 101,
      defensePosts: 80,
      strategicStructures: 173,
      exposedEconomicStructures: 42,
    });

    expect(plan.action).toBe("protect-assets");
    expect(plan.scores["activate-rail"]).toBeLessThan(5);
    expect(plan.scores["protect-assets"]).toBeGreaterThan(
      plan.scores["activate-rail"],
    );
  });

  it("bounds upgrade queries to the strongest factory candidates", () => {
    const factories = Array.from({ length: 26 }, (_, id) => ({
      id,
      economicScore: id % 7,
      level: id % 4,
    }));
    const selected = selectFactoryUpgradeCandidates(
      factories,
      (factory) => factory.economicScore * (1 + factory.level * 0.25),
      4,
    );

    expect(selected).toHaveLength(4);
    expect(selected[0].economicScore).toBe(6);
  });
});
