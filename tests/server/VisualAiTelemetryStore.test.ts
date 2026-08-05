import { describe, expect, it } from "vitest";
import { parseVisualAiTelemetry } from "../../src/server/VisualAiTelemetryStore";

const requiredTelemetry = {
  tick: 1_000,
  decision: "Recall the denial from Siberia",
  detail: "A third-party attack crosses the projected reserve floor.",
  decisionCycles: 900,
  reserveRatio: 0.42,
  troops: 420_000,
  maxTroops: 1_000_000,
  tiles: 20_000,
  incomingFronts: 2,
  incomingTroops: 600_000,
  outgoingFronts: 1,
  opponentsAlive: 70,
  predictionCount: 100,
  predictionError: 4,
  mutationGeneration: 2,
  planningMs: 20,
};

describe("parseVisualAiTelemetry", () => {
  it("retains bounded raid, third-party, and infrastructure diagnostics", () => {
    const parsed = parseVisualAiTelemetry({
      ...requiredTelemetry,
      thirdPartyIncomingTroops: 450_000,
      activeRaidTarget: "Siberia".repeat(20),
      activeRaidTroops: 200_000,
      cities: 5.8,
      stackedCities: 4.9,
      largestCityStack: 3.7,
      factories: 2.2,
      factoryProductiveStops: 7.8,
      isolatedFactories: 1.9,
      factoryConnectedPorts: 2.8,
      unconnectedPorts: 3.9,
      economicAction: "protect-assets".repeat(10),
      economicScore: 83.5,
      economicGoldReserve: 1_500_000,
      economicSpendableGold: 750_000,
      estimatedIncomePerMinute: 125_000,
      recurringIncomeWindfallRatio: 1.4,
      exposedEconomicStructures: 4.7,
      tradePartners: 3.9,
      embargoedPartners: 2.2,
      connectedRailStops: 6.8,
      railStops: 9.4,
      defensePosts: 3.9,
      strategicStructures: 12.7,
      forecastedOpponents: 71.9,
      opponentForecastAccuracy: 1.4,
      highestForecastThreat: 2.75,
      predictedEnemyChoice: "attack",
      predictedEnemyName: "A".repeat(100),
      remnantTargets: 4.8,
      allianceAction: "do-not-renew",
      allyReliability: 1.4,
      trustedAllies: 1.9,
      coalitionTarget: "Coalition target".repeat(10),
      coalitionAvailableHelpers: 2.9,
      coalitionTreatyBlockedHelpers: 3.9,
      coalitionOffensiveCostMultiplier: 1.4,
      coalitionGrowthDonations: 4.9,
      coalitionGrowthRateGain: 1.35,
      allyRequestsSent: 3.8,
      allyRequestsAnswered: 2.9,
      allyIgnoredRequests: 1.9,
      strategicCollateralRejections: 4.9,
      moduleConsensusAction: "invest",
      modulePreferredInvestment: "connect-existing-shipyard",
      shipyardConnectionPriority: 1.4,
      portAction: "connect",
      portActionUrgency: 1.2,
      portBudgetCoverageRatio: 2.4,
      portFleetCoverageRatio: 0.7,
      portRepairLoadRatio: 1.6,
      portThreatRatio: 1.3,
      portTradeCoverageRatio: 0.45,
      landCapacityGain: 250_000.5,
      landRegenerationMultiplier: 1.18,
      planningMode: "reuse",
      planningIntervalTicks: 8.9,
      planningForecastHorizonTicks: 75.8,
      planningPassesSkipped: 400.9,
      planningPassesExecuted: 100.9,
      predictedReadyTick: 1_075.9,
      opponentForecastIntervalTicks: 12.9,
    });

    expect(parsed.thirdPartyIncomingTroops).toBe(450_000);
    expect(parsed.activeRaidTarget).toHaveLength(80);
    expect(parsed.activeRaidTroops).toBe(200_000);
    expect(parsed.cities).toBe(5);
    expect(parsed.stackedCities).toBe(4);
    expect(parsed.largestCityStack).toBe(3);
    expect(parsed.factories).toBe(2);
    expect(parsed.factoryProductiveStops).toBe(7);
    expect(parsed.isolatedFactories).toBe(1);
    expect(parsed.factoryConnectedPorts).toBe(2);
    expect(parsed.unconnectedPorts).toBe(3);
    expect(parsed.economicAction).toHaveLength(40);
    expect(parsed.economicScore).toBe(83.5);
    expect(parsed.economicGoldReserve).toBe(1_500_000);
    expect(parsed.economicSpendableGold).toBe(750_000);
    expect(parsed.estimatedIncomePerMinute).toBe(125_000);
    expect(parsed.recurringIncomeWindfallRatio).toBe(1);
    expect(parsed.exposedEconomicStructures).toBe(4);
    expect(parsed.tradePartners).toBe(3);
    expect(parsed.embargoedPartners).toBe(2);
    expect(parsed.connectedRailStops).toBe(6);
    expect(parsed.railStops).toBe(9);
    expect(parsed.defensePosts).toBe(3);
    expect(parsed.strategicStructures).toBe(12);
    expect(parsed.forecastedOpponents).toBe(71);
    expect(parsed.opponentForecastAccuracy).toBe(1);
    expect(parsed.highestForecastThreat).toBe(2.75);
    expect(parsed.predictedEnemyChoice).toBe("attack");
    expect(parsed.predictedEnemyName).toHaveLength(80);
    expect(parsed.remnantTargets).toBe(4);
    expect(parsed.allianceAction).toBe("do-not-renew");
    expect(parsed.allyReliability).toBe(1);
    expect(parsed.trustedAllies).toBe(1);
    expect(parsed.coalitionTarget).toHaveLength(80);
    expect(parsed.coalitionAvailableHelpers).toBe(2);
    expect(parsed.coalitionTreatyBlockedHelpers).toBe(3);
    expect(parsed.coalitionOffensiveCostMultiplier).toBe(1);
    expect(parsed.coalitionGrowthDonations).toBe(4);
    expect(parsed.coalitionGrowthRateGain).toBe(1.35);
    expect(parsed.allyRequestsSent).toBe(3);
    expect(parsed.allyRequestsAnswered).toBe(2);
    expect(parsed.allyIgnoredRequests).toBe(1);
    expect(parsed.strategicCollateralRejections).toBe(4);
    expect(parsed.moduleConsensusAction).toBe("invest");
    expect(parsed.modulePreferredInvestment).toBe("connect-existing-shipyard");
    expect(parsed.shipyardConnectionPriority).toBe(1);
    expect(parsed.portAction).toBe("connect");
    expect(parsed.portActionUrgency).toBe(1);
    expect(parsed.portBudgetCoverageRatio).toBe(2.4);
    expect(parsed.portFleetCoverageRatio).toBe(0.7);
    expect(parsed.portRepairLoadRatio).toBe(1.6);
    expect(parsed.portThreatRatio).toBe(1);
    expect(parsed.portTradeCoverageRatio).toBe(0.45);
    expect(parsed.landCapacityGain).toBe(250_000.5);
    expect(parsed.landRegenerationMultiplier).toBe(1.18);
    expect(parsed.planningMode).toBe("reuse");
    expect(parsed.planningIntervalTicks).toBe(8);
    expect(parsed.planningForecastHorizonTicks).toBe(75);
    expect(parsed.planningPassesSkipped).toBe(400);
    expect(parsed.planningPassesExecuted).toBe(100);
    expect(parsed.predictedReadyTick).toBe(1_075);
    expect(parsed.opponentForecastIntervalTicks).toBe(12);
  });

  it("keeps new diagnostic fields optional for older telemetry", () => {
    const parsed = parseVisualAiTelemetry(requiredTelemetry);

    expect(parsed.thirdPartyIncomingTroops).toBeUndefined();
    expect(parsed.activeRaidTarget).toBeUndefined();
    expect(parsed.defensePosts).toBeUndefined();
    expect(parsed.forecastedOpponents).toBeUndefined();
    expect(parsed.allianceAction).toBeUndefined();
    expect(parsed.allyReliability).toBeUndefined();
    expect(parsed.coalitionTarget).toBeUndefined();
    expect(parsed.coalitionAvailableHelpers).toBeUndefined();
    expect(parsed.coalitionOffensiveCostMultiplier).toBeUndefined();
    expect(parsed.coalitionGrowthDonations).toBeUndefined();
    expect(parsed.strategicCollateralRejections).toBeUndefined();
    expect(parsed.moduleConsensusAction).toBeUndefined();
    expect(parsed.factoryConnectedPorts).toBeUndefined();
    expect(parsed.landCapacityGain).toBeUndefined();
    expect(parsed.portAction).toBeUndefined();
    expect(parsed.recurringIncomeWindfallRatio).toBeUndefined();
    expect(parsed.planningMode).toBeUndefined();
    expect(parsed.planningIntervalTicks).toBeUndefined();
    expect(parsed.planningPassesSkipped).toBeUndefined();
    expect(parsed.predictedReadyTick).toBeUndefined();
    expect(parsed.opponentForecastIntervalTicks).toBeUndefined();
  });
});
