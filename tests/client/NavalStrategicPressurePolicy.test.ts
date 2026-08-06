import { describe, expect, it } from "vitest";
import {
  planShipyardPlacements,
  rankStrategicStructureTargets,
} from "../../src/client/ai/NavalStrategicPressurePolicy";

describe("rankStrategicStructureTargets", () => {
  it("prioritizes an exposed loaded missile silo", () => {
    const ranked = rankStrategicStructureTargets([
      {
        id: "factory",
        kind: "factory",
        distance: 30,
        estimatedDefense: 5,
        exposed: true,
        ownerPowerRatio: 0.8,
      },
      {
        id: "silo",
        kind: "missile-silo",
        distance: 60,
        estimatedDefense: 20,
        exposed: true,
        containsReadyWeapon: true,
        ownerPowerRatio: 1,
      },
    ]);
    expect(ranked[0].id).toBe("silo");
  });
});

describe("planShipyardPlacements", () => {
  const sites = [
    {
      id: "open-coast",
      shorelineLength: 14,
      openWaterDirections: 5,
      nearbyFriendlyShipyards: 0,
      nearbyEnemyWarships: 0,
      distanceToCoastalTargets: 80,
      distanceToFriendlyFactory: 60,
      railConnected: true,
      threatenedBorderPressure: 0.1,
      projectedWarshipThroughput: 2,
    },
    {
      id: "stacked-coast",
      shorelineLength: 16,
      openWaterDirections: 6,
      nearbyFriendlyShipyards: 1,
      nearbyEnemyWarships: 0,
      distanceToCoastalTargets: 55,
      distanceToFriendlyFactory: 40,
      railConnected: true,
      threatenedBorderPressure: 0.05,
      projectedWarshipThroughput: 3,
      marginalStackValue: 0.8,
    },
  ];

  it("avoids stacking during ordinary surplus", () => {
    const plan = planShipyardPlacements({
      goldSurplusRatio: 5,
      existingShipyards: 1,
      coastalTargets: 2,
      maximumPlacements: 4,
      allowStacking: true,
      sites,
    });
    expect(plan.siteIDs).toContain("open-coast");
    expect(plan.siteIDs).not.toContain("stacked-coast");
  });

  it("stacks shipyards when runaway gold and marginal throughput justify it", () => {
    const plan = planShipyardPlacements({
      goldSurplusRatio: 30,
      existingShipyards: 1,
      coastalTargets: 3,
      maximumPlacements: 6,
      allowStacking: true,
      sites,
    });
    expect(plan.siteIDs).toContain("stacked-coast");
    expect(plan.reason).toContain("stack");
  });

  it("rejects a valuable shipyard outside factory range", () => {
    const plan = planShipyardPlacements({
      goldSurplusRatio: 8,
      existingShipyards: 0,
      coastalTargets: 2,
      maximumPlacements: 4,
      allowStacking: false,
      requireFactoryConnection: true,
      sites: [
        {
          ...sites[0],
          id: "isolated",
          railConnected: false,
          distanceToFriendlyFactory: 500,
        },
        sites[0],
      ],
    });

    expect(plan.siteIDs).toEqual(["open-coast"]);
    expect(plan.reason).toContain("factory rail catchment");
  });

  it("uses adaptive coverage and relative site quality when ratios are supplied", () => {
    const plan = planShipyardPlacements({
      goldSurplusRatio: 2,
      existingShipyards: 0,
      coastalTargets: 4,
      maximumPlacements: 4,
      allowStacking: false,
      requireFactoryConnection: true,
      urgency: 0.8,
      targetCoverageRatio: 0.5,
      minimumSiteQuality: 0.4,
      stackingLoadRatio: 0,
      stackingLoadThreshold: 1.2,
      sites,
    });

    expect(plan.siteIDs).toEqual(["open-coast"]);
    expect(plan.reason).toContain("adaptive coverage");
  });
});
