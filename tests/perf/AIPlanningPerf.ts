import {
  applyActionOutcomeLearning,
  normalizeActionReward,
  scoreCounterfactualActionOutcome,
  scoreDelayedActionOutcome,
} from "../../src/client/ai/ActionOutcomeLearning";
import {
  planAdaptivePortActions,
  rankAdaptiveTradePortOptions,
} from "../../src/client/ai/AdaptivePortPolicy";
import { createDefaultAiModuleRegistry } from "../../src/client/ai/AiModule";
import { planAllianceLifecycle } from "../../src/client/ai/AllianceLifecyclePolicy";
import {
  AdaptivePlanningObservation,
  estimateTicksUntilReserve,
  planAdaptivePlanningCadence,
  shouldLaunchDefensiveCounter,
  shouldPreFortifyInfrastructure,
} from "../../src/client/ai/DecisionTriggerPolicy";
import { planShipyardPlacements } from "../../src/client/ai/NavalStrategicPressurePolicy";
import {
  forecastOpponent,
  OpponentForecast,
  OpponentObservation,
} from "../../src/client/ai/OpponentForecastPolicy";
import {
  modelOpponent,
  planStrategicAction,
} from "../../src/client/ai/StrategicActionPlanner";
import {
  nationFrontPolicy,
  nationLandFrontAllowed,
  predictFutureOutcomes,
  shouldRiskDenialRaid,
} from "../../src/client/ai/StrategyMath";

const ticks = Number(process.argv[2] ?? 6_000);
const opponentCount = Number(process.argv[3] ?? 472);
const forecastInterval = Number(process.argv[4] ?? 5);
const opponents = Array.from({ length: opponentCount }, (_, index) => ({
  id: `opponent-${index}`,
  tiles: 300 + index * 17,
  troops: 20_000 + index * 1_100,
  maxTroops: 50_000 + index * 1_500,
  silos: index % 17 === 0 ? 2 : 0,
  warships: index % 11 === 0 ? 2 : 0,
}));
const observations = new Map<string, OpponentObservation>();
const forecasts = new Map<string, OpponentForecast>();
const samples: number[] = [];
let predictionCount = 0;
let decisionCount = 0;
let lastAction = "hold";
let lastPortAction = "hold";
let portPlacementCycles = 0;
let tradeRankingChecksum = 0;
let outcomeRewardChecksum = 0;
let frontPolicyChecksum = 0;
let defensiveCounterChecks = 0;
let finalAllianceBreaks = 0;
let learnedGenes = { aggression: 0, caution: 0, naval: 0 };
const actionBaselines = Object.fromEntries(
  (["attack", "expand", "fleet", "defend", "hold"] as const).map((action) => [
    action,
    { mean: 0, samples: 0 },
  ]),
);
const aiModules = createDefaultAiModuleRegistry();
let models: ReturnType<typeof modelOpponent>[] = [];
let nextPlanningTick = 0;
let lastPlanningTick = Number.NEGATIVE_INFINITY;
let lastForecastTick = Number.NEGATIVE_INFINITY;
let forecastRefreshes = 0;
let nextPortPlacementTick = 0;
let previousPlanningObservation: AdaptivePlanningObservation | undefined;
let skippedPlanningPasses = 0;
const planningModes = { reactive: 0, scheduled: 0, reuse: 0 };
const shipyardSites = Array.from({ length: 96 }, (_, index) => ({
  id: `shore-${index}`,
  shorelineLength: 4 + (index % 16),
  openWaterDirections: 1 + (index % 6),
  nearbyFriendlyShipyards: index % 19 === 0 ? 1 : 0,
  nearbyEnemyWarships: index % 13 === 0 ? 2 : 0,
  distanceToCoastalTargets: 20 + index * 7,
  distanceToFriendlyFactory: 15 + index * 5,
  railConnected: index % 3 !== 0,
  threatenedBorderPressure: (index % 10) / 10,
  projectedWarshipThroughput: 1 + (index % 5),
  marginalStackValue: (index % 8) / 4,
}));

for (let tick = 0; tick < ticks; tick++) {
  const start = performance.now();
  const reserveRatio = 0.42 + (tick % 40) / 200;
  const frontPolicy = nationFrontPolicy({
    nationFronts: tick % 6,
    activeNationWars: tick % 9 === 0 ? 1 : 0,
  });
  frontPolicyChecksum += nationLandFrontAllowed({
    isNation: true,
    targetID: "reachable",
    activeBorderWarIDs: new Set(),
    activeOffensiveIDs: new Set(),
    maxNationOffensives: frontPolicy.maxNationOffensives,
  })
    ? 1
    : 0;
  frontPolicyChecksum += shouldRiskDenialRaid({
    isTribe: false,
    nationBorders: tick % 6,
    targetTroops: 800_000 + tick,
    ourTroops: 1_200_000,
    targetDistracted: tick % 3 === 0,
    reserveRatio,
  })
    ? 1
    : 0;
  frontPolicyChecksum +=
    frontPolicy.maxNationOffensives +
    frontPolicy.reserveFloor +
    frontPolicy.advantageMultiplier;
  if (
    shouldLaunchDefensiveCounter({
      homeTroops: 1_000_000 + tick * 10,
      selectedIncomingTroops: 20_000 + (tick % 100_000),
      counterTroops: 25_000 + (tick % 120_000),
    })
  ) {
    defensiveCounterChecks++;
  }
  if (
    shouldPreFortifyInfrastructure({
      borderingNationThreats: tick % 5,
      strategicStructures: 6,
      reserveRatio,
      reserveFloorRatio: 0.48,
      outgoingFronts: tick % 4 === 0 ? 1 : 0,
      defensePosts: tick % 6,
      cities: 3,
    })
  ) {
    defensiveCounterChecks++;
  }
  if (
    planAllianceLifecycle({
      isSameTeam: false,
      otherIsTraitor: false,
      sharesBorder: tick % 2 === 0,
      ticksUntilExpiry: 1_000,
      betrayalPenaltyTicks: 300,
      inExtensionWindow: false,
      ownReserveRatio: tick % 3 === 0 ? 0.95 : reserveRatio,
      otherReserveRatio: 0.7,
      troopRatio: 0.72,
      capacityRatio: 0.9,
      territoryRatio: 1.4,
      allianceCount: 1,
      hostileNationBorders: 0,
      activeNationWars: 0,
      incomingFronts: 0,
      otherPlayersAlive: tick % 3 === 0 ? 1 : 2,
      forecast: { predictedChoice: "bank", threat: 0.73, confidence: 0.8 },
    }).action === "break"
  ) {
    finalAllianceBreaks++;
  }
  const outcomeAction = (
    ["attack", "expand", "fleet", "defend", "hold"] as const
  )[tick % 5];
  const outcomeReward = scoreDelayedActionOutcome({
    action: outcomeAction,
    startingTroops: 100_000,
    endingTroops: 90_000 + (tick % 25) * 1_000,
    maxTroops: 250_000,
    startingTiles: 10_000,
    endingTiles: 10_000 + (tick % 30),
    startingGold: 100_000,
    endingGold: 100_000 + (tick % 20) * 1_000,
    survived: true,
  });
  outcomeRewardChecksum += scoreCounterfactualActionOutcome({
    action: outcomeAction,
    startingTroops: 100_000,
    endingTroops: 90_000 + (tick % 25) * 1_000,
    maxTroops: 250_000,
    startingTiles: 10_000,
    endingTiles: 10_000 + (tick % 30),
    startingGold: 100_000,
    endingGold: 100_000 + (tick % 20) * 1_000,
    survived: true,
    expectedTroops: 100_000,
    expectedTiles: 10_005,
  });
  const normalizedReward = normalizeActionReward(
    outcomeReward,
    actionBaselines[outcomeAction],
  );
  actionBaselines[outcomeAction] = normalizedReward.baseline;
  learnedGenes = applyActionOutcomeLearning(
    learnedGenes,
    outcomeAction,
    normalizedReward.learningSignal,
    tick,
  );
  outcomeRewardChecksum += outcomeReward;
  const incomingPhase = tick % 170;
  const outgoingPhase = tick % 230;
  const incomingFronts = incomingPhase >= 40 && incomingPhase < 65 ? 2 : 0;
  const outgoingFronts = outgoingPhase >= 100 && outgoingPhase < 145 ? 1 : 0;
  const planningObservation: AdaptivePlanningObservation = {
    incomingFronts,
    outgoingFronts,
    tribesAlive: Math.max(0, 400 - Math.floor(tick / 80)),
    reserveRatio,
    tiles: 10_000 + tick,
    strategicStructures: 8,
  };
  const ticksUntilUsefulReserve = estimateTicksUntilReserve({
    troops: reserveRatio * 250_000,
    maxTroops: 250_000,
    troopIncreasePerTick: 2_500,
    targetRatio: incomingFronts > 0 ? 0.55 : outgoingFronts > 0 ? 0.66 : 0.82,
  });
  const cadence = planAdaptivePlanningCadence({
    tick,
    lastPlanningTick,
    nextPlanningTick,
    current: planningObservation,
    previous: previousPlanningObservation,
    ticksUntilUsefulReserve,
  });
  previousPlanningObservation = planningObservation;
  planningModes[cadence.mode]++;
  if (!cadence.run) {
    skippedPlanningPasses++;
    samples.push(performance.now() - start);
    continue;
  }
  lastPlanningTick = tick;
  nextPlanningTick = tick + cadence.intervalTicks;

  const adaptiveForecastInterval =
    cadence.mode === "reactive"
      ? forecastInterval
      : Math.max(
          forecastInterval,
          Math.min(20, Math.ceil(cadence.forecastHorizonTicks / 3)),
        );
  if (
    cadence.refreshOpponentForecasts ||
    tick - lastForecastTick >= adaptiveForecastInterval
  ) {
    lastForecastTick = tick;
    forecastRefreshes++;
    models = opponents.map((opponent, index) => {
      const previousTiles = opponent.tiles;
      const previousTroops = opponent.troops;
      if (tick % (index + 5) === 0) {
        opponent.tiles += 1 + (index % 4);
        opponent.troops += 90 + index * 3;
      }
      const current: OpponentObservation = {
        tick,
        troops: opponent.troops,
        maxTroops: opponent.maxTroops,
        tiles: opponent.tiles,
        gold: 100_000 + tick * 25,
        incomingAttacks: index % 13 === 0 ? 1 : 0,
        incomingTroops: index % 13 === 0 ? 15_000 : 0,
        outgoingAttacks: index % 9 === 0 ? 1 : 0,
        outgoingTroops: index % 9 === 0 ? 12_000 : 0,
        cities: 1 + Math.floor(index / 100),
        factories: index % 7 === 0 ? 1 : 0,
        ports: index % 11 === 0 ? 1 : 0,
        silos: opponent.silos,
        warships: opponent.warships,
        allied: index % 31 === 0,
        sharesBorder: index < 8,
      };
      const forecast = forecastOpponent({
        id: opponent.id,
        current,
        previous: observations.get(opponent.id),
        previousForecast: forecasts.get(opponent.id),
        ownTroops: 105_000,
        ownMaxTroops: 250_000,
        ownTiles: 10_000 + tick,
      });
      observations.set(opponent.id, current);
      forecasts.set(opponent.id, forecast);
      return modelOpponent({
        id: opponent.id,
        troops: opponent.troops,
        maxTroops: opponent.maxTroops,
        tiles: opponent.tiles,
        ownTiles: 10_000 + tick,
        incomingAttacks: index % 13 === 0 ? 1 : 0,
        outgoingAttacks: index % 9 === 0 ? 1 : 0,
        silos: opponent.silos,
        warships: opponent.warships,
        previousTiles,
        previousTroops,
        elapsedTicks: Math.max(1, index + 5),
        predictedChoice: forecast.predictedChoice,
        forecastThreat: forecast.threat,
      });
    });
  }
  const plan = planStrategicAction({
    reserveRatio,
    incomingFronts,
    incomingTroops: incomingFronts > 0 ? 70_000 : 0,
    maxTroops: 250_000,
    hasNeutralLand: tick < 2_000,
    hostileBorders: 3,
    activeNationWars: tick % 23 === 0 ? 1 : 0,
    navalThreats: tick % 29 === 0 ? 2 : 0,
    tradeTargets: tick % 19 === 0 ? 3 : 0,
    navalPressureRatio: tick % 29 === 0 ? 0.55 : 0.05,
    tradeOpportunityRatio: tick % 19 === 0 ? 0.25 : 0.05,
    siloTargets: models.reduce((sum, model) => sum + model.siloCount, 0),
    opponents: models,
  });
  lastAction = plan.action;
  const portPlan = planAdaptivePortActions({
    reserveRatio,
    incomingPressureRatio: incomingFronts > 0 ? 0.28 : 0,
    activeFrontRatio: outgoingFronts > 0 ? 0.4 : 0.1,
    gold: 1_000_000 + tick * 500,
    spendableGold: 400_000 + tick * 100,
    portCost: 500_000,
    ports: tick < 1_000 ? 0 : 2,
    connectedPorts: tick < 1_500 ? 0 : 2,
    tradePartners: 40,
    embargoedPartners: 8,
    ownWarships: tick % 7,
    desiredWarships: 5,
    hostileWarships: tick % 5,
    hostileTransports: tick % 3,
    tradeTargets: 12,
    damagedWarships: tick % 4,
    dockCapacity: 2,
    transportLossRate: 0.25,
    railProductivityRatio: 0.75,
    navalBias: 0.6,
  });
  const modulePlan = aiModules.evaluateCoordinated({
    tick,
    reserveRatio,
    maxTroops: 250_000,
    troops: reserveRatio * 250_000,
    gold: 1_000_000 + tick * 500,
    incomingTroopRatio: incomingFronts > 0 ? 0.28 : 0,
    outgoingCommittedRatio: outgoingFronts > 0 ? 0.3 : 0,
    activeFronts: incomingFronts + outgoingFronts,
    neutralLandAvailable: tick < 2_000,
    activeNationWars: tick % 23 === 0 ? 1 : 0,
    borderPressure: incomingFronts > 0 ? 0.4 : 0,
    economyReturnScore: 8,
    usefulPortSites: 12,
    existingPorts: tick < 1_000 ? 0 : 2,
    existingCities: 6,
    existingDefensePosts: 3,
    existingSams: 2,
    existingSilos: 1,
    infrastructureNeedScore: 4,
    strategicWeaponValue: 3,
    allyAidUrgency: 0,
    existingFactories: 1,
    factoryConnectedPorts: tick < 1_500 ? 0 : 2,
    spendableGold: 400_000 + tick * 100,
    portCost: 500_000,
    tradePartners: 40,
    embargoedPartners: 8,
    ownWarships: tick % 7,
    desiredWarships: 5,
    enemyWarshipsNearTargets: tick % 5,
    hostileTransportsNearCoast: tick % 3,
    coastalEconomicTargets: 12,
    damagedWarships: tick % 4,
    dockCapacity: 2,
    transportLossRate: 0.25,
    connectedRailStops: 6,
    railStops: 8,
    navalBias: 0.6,
  });
  lastPortAction = portPlan.action;
  if (tick >= nextPortPlacementTick) {
    nextPortPlacementTick = tick + 25;
    planShipyardPlacements({
      goldSurplusRatio: portPlan.budgetCoverageRatio,
      existingShipyards: 1,
      coastalTargets: 12,
      maximumPlacements: 12,
      allowStacking: true,
      requireFactoryConnection: portPlan.requireFactoryConnection,
      urgency: portPlan.urgency,
      targetCoverageRatio: portPlan.targetCoverageRatio,
      minimumSiteQuality: portPlan.minimumSiteQuality,
      stackingLoadRatio: portPlan.repairLoadRatio,
      stackingLoadThreshold: portPlan.stackingLoadThreshold,
      sites: shipyardSites,
    });
    portPlacementCycles++;
    const rankedTrade = rankAdaptiveTradePortOptions(
      {
        minimumSiteQuality: portPlan.minimumSiteQuality,
        requiredReturnRatio: portPlan.requiredReturnRatio,
        maximumPaybackTicks: portPlan.maximumPaybackTicks,
        requireFactoryConnection: portPlan.requireFactoryConnection,
      },
      shipyardSites.slice(0, 32).map((site, index) => ({
        id: site.id,
        expectedGold: 90_000 + index * 7_500,
        buildCost: 500_000,
        routeDistance: 120 + index * 25,
        closestFriendlyPortDistance: 40 + index * 11,
        factoryConnected: site.railConnected,
        survivalRatio: 0.7 + (index % 4) * 0.08,
        spawnIntervalTicks: 100 + (tick % 400),
        reachablePartners: 1 + (index % 6),
        partnerConcentration: 1 / (1 + (index % 6)),
      })),
    );
    tradeRankingChecksum +=
      rankedTrade.length +
      (modulePlan.signals.portMaximumPaybackTicks ?? 0) * 0.000_001;
  }
  const predictions = predictFutureOutcomes({
    action:
      plan.action === "defend"
        ? "defend"
        : plan.action === "strike" || plan.action === "attack"
          ? "attack"
          : plan.action === "expand"
            ? "expand"
            : plan.action === "naval"
              ? "fleet"
              : "hold",
    troops: 105_000,
    maxTroops: 250_000,
    tiles: 10_000 + tick,
    enemyTroops: models[0]?.troopRatio * 250_000 || 50_000,
    horizon: cadence.forecastHorizonTicks,
  });
  predictionCount += predictions.length;
  decisionCount++;
  samples.push(performance.now() - start);
}

samples.sort((a, b) => a - b);
const percentile = (value: number) =>
  samples[Math.min(samples.length - 1, Math.floor(samples.length * value))] ??
  0;
const total = samples.reduce((sum, value) => sum + value, 0);
console.log(
  JSON.stringify({
    ok: true,
    ticks,
    opponents: opponents.length,
    forecastInterval,
    forecastRefreshes,
    decisions: decisionCount,
    skippedPlanningPasses,
    planningModes,
    planningReductionRatio: Number(
      (1 - decisionCount / Math.max(1, ticks)).toFixed(4),
    ),
    predictions: predictionCount,
    lastAction,
    lastPortAction,
    tradeRankingChecksum: Number(tradeRankingChecksum.toFixed(3)),
    portPlacementCycles,
    outcomeRewardChecksum: Number(outcomeRewardChecksum.toFixed(3)),
    frontPolicyChecksum: Number(frontPolicyChecksum.toFixed(3)),
    defensiveCounterChecks,
    finalAllianceBreaks,
    learnedGenes,
    actionBaselines,
    totalMs: Number(total.toFixed(2)),
    meanMs: Number((total / Math.max(1, samples.length)).toFixed(4)),
    p95Ms: Number(percentile(0.95).toFixed(4)),
    p99Ms: Number(percentile(0.99).toFixed(4)),
    maxMs: Number((samples[samples.length - 1] ?? 0).toFixed(4)),
    decisionsPerSecond: Number((decisionCount / (total / 1000)).toFixed(1)),
  }),
);
