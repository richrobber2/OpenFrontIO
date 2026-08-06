import { describe, expect, it } from "vitest";
import {
  AdaptivePortContext,
  planAdaptivePortActions,
  rankAdaptiveTradePortOptions,
} from "../../src/client/ai/AdaptivePortPolicy";

const base: AdaptivePortContext = {
  reserveRatio: 0.8,
  incomingPressureRatio: 0,
  activeFrontRatio: 0,
  gold: 5_000_000,
  spendableGold: 2_000_000,
  portCost: 500_000,
  ports: 1,
  connectedPorts: 1,
  tradePartners: 0,
  embargoedPartners: 0,
  ownWarships: 2,
  desiredWarships: 2,
  hostileWarships: 0,
  hostileTransports: 0,
  tradeTargets: 0,
  damagedWarships: 0,
  dockCapacity: 1,
  transportLossRate: 0.1,
  railProductivityRatio: 1,
  navalBias: 0.5,
};

describe("planAdaptivePortActions", () => {
  it("prioritizes the percentage connection gap before another port", () => {
    const plan = planAdaptivePortActions({
      ...base,
      ports: 2,
      connectedPorts: 1,
      tradePartners: 20,
      tradeTargets: 6,
    });

    expect(plan.action).toBe("connect");
    expect(plan.connectedPortRatio).toBe(0.5);
    expect(plan.reason).toContain("50% factory-connection gap");
  });

  it("switches to defense from local fleet coverage and threat ratios", () => {
    const plan = planAdaptivePortActions({
      ...base,
      ownWarships: 1,
      desiredWarships: 5,
      hostileWarships: 4,
      hostileTransports: 3,
    });

    expect(plan.action).toBe("defend");
    expect(plan.fleetCoverageRatio).toBe(0.2);
    expect(plan.navalThreatRatio).toBeGreaterThan(0.7);
    expect(plan.requireFactoryConnection).toBe(false);
  });

  it("adds repair capacity only when proportional dock load dominates", () => {
    const plan = planAdaptivePortActions({
      ...base,
      damagedWarships: 4,
      dockCapacity: 2,
    });

    expect(plan.action).toBe("repair");
    expect(plan.repairLoadRatio).toBe(2);
    expect(plan.stackingLoadThreshold).toBeLessThan(plan.repairLoadRatio);
  });

  it("holds when there is no proportional demand", () => {
    expect(planAdaptivePortActions(base).action).toBe("hold");
  });
});

describe("rankAdaptiveTradePortOptions", () => {
  it("uses percentage return and relative site quality without a fixed range", () => {
    const ranked = rankAdaptiveTradePortOptions(
      {
        minimumSiteQuality: 0.45,
        requiredReturnRatio: 0.25,
        maximumPaybackTicks: 4_000,
        requireFactoryConnection: true,
      },
      [
        {
          id: "high-return-long-route",
          expectedGold: 220_000,
          buildCost: 500_000,
          routeDistance: 900,
          closestFriendlyPortDistance: 300,
          factoryConnected: true,
        },
        {
          id: "low-return-near-route",
          expectedGold: 80_000,
          buildCost: 500_000,
          routeDistance: 120,
          closestFriendlyPortDistance: 80,
          factoryConnected: true,
        },
        {
          id: "isolated",
          expectedGold: 400_000,
          buildCost: 500_000,
          routeDistance: 500,
          closestFriendlyPortDistance: 500,
          factoryConnected: false,
        },
      ],
    );

    expect(ranked.map(({ id }) => id)).toEqual(["high-return-long-route"]);
    expect(ranked[0].returnRatio).toBeCloseTo(0.44);
  });

  it("prefers sustained gold per tick over a larger but slower payout", () => {
    const ranked = rankAdaptiveTradePortOptions(
      {
        minimumSiteQuality: 0.2,
        requiredReturnRatio: 0.2,
        maximumPaybackTicks: 5_000,
        requireFactoryConnection: true,
      },
      [
        {
          id: "slow-jackpot",
          expectedGold: 300_000,
          buildCost: 500_000,
          routeDistance: 1_000,
          closestFriendlyPortDistance: 200,
          factoryConnected: true,
          spawnIntervalTicks: 100,
        },
        {
          id: "fast-compounder",
          expectedGold: 160_000,
          buildCost: 500_000,
          routeDistance: 180,
          closestFriendlyPortDistance: 200,
          factoryConnected: true,
          spawnIntervalTicks: 100,
        },
      ],
    );

    expect(ranked[0].id).toBe("fast-compounder");
    expect(ranked[0].expectedGoldPerTick).toBeGreaterThan(
      ranked[1].expectedGoldPerTick,
    );
  });

  it("rejects pirate-heavy routes that cannot repay the port in time", () => {
    const ranked = rankAdaptiveTradePortOptions(
      {
        minimumSiteQuality: 0.1,
        requiredReturnRatio: 0.2,
        maximumPaybackTicks: 3_000,
        requireFactoryConnection: true,
      },
      [
        {
          id: "unsafe",
          expectedGold: 300_000,
          buildCost: 500_000,
          routeDistance: 300,
          closestFriendlyPortDistance: 200,
          factoryConnected: true,
          survivalRatio: 0.05,
          spawnIntervalTicks: 100,
        },
        {
          id: "escorted",
          expectedGold: 220_000,
          buildCost: 500_000,
          routeDistance: 300,
          closestFriendlyPortDistance: 200,
          factoryConnected: true,
          survivalRatio: 0.9,
          spawnIntervalTicks: 100,
        },
      ],
    );

    expect(ranked.map(({ id }) => id)).toEqual(["escorted"]);
  });

  it("values diversified partner access over one concentrated customer", () => {
    const ranked = rankAdaptiveTradePortOptions(
      {
        minimumSiteQuality: 0.1,
        requiredReturnRatio: 0.2,
        maximumPaybackTicks: 4_000,
        requireFactoryConnection: true,
      },
      [
        {
          id: "diverse",
          expectedGold: 220_000,
          buildCost: 500_000,
          routeDistance: 300,
          closestFriendlyPortDistance: 200,
          factoryConnected: true,
          reachablePartners: 4,
          partnerConcentration: 0.25,
        },
        {
          id: "concentrated",
          expectedGold: 220_000,
          buildCost: 500_000,
          routeDistance: 300,
          closestFriendlyPortDistance: 200,
          factoryConnected: true,
          reachablePartners: 1,
          partnerConcentration: 1,
        },
      ],
    );

    expect(ranked[0].id).toBe("diverse");
    expect(ranked[0].diversityQuality).toBeGreaterThan(
      ranked[1].diversityQuality,
    );
  });
});
